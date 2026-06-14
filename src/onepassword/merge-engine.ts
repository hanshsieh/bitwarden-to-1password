import type {
  Item,
  ItemCategory,
  ItemCreateParams,
  ItemField,
  ItemOverview,
  Website,
} from "@1password/sdk";
import type { ParsedBitwardenItem } from "../bitwarden/types.js";
import { filterSdkSafeTags } from "./tags.js";
import { normalizeUsername } from "../utils/normalize.js";
import {
  OnePasswordItemMapper,
  bitwardenTypeToCategory,
} from "./item-mapper.js";
import type {
  MergeDecision,
  MergeStrategy,
  OnePasswordClient,
} from "./types.js";

/** Composite lookup key: category + title + normalized username. */
export type MatchKey = string;

/** In-memory index of existing vault items for duplicate detection. */
export interface MatchIndex {
  index: Map<MatchKey, string[]>;
}

/**
 * Resolves duplicate items during migration and syncs export data onto
 * existing 1Password items when the merge strategy allows it.
 */
export class MergeEngine {
  private readonly itemMapper: OnePasswordItemMapper;

  constructor(
    private readonly client: OnePasswordClient,
    itemMapper?: OnePasswordItemMapper,
  ) {
    this.itemMapper = itemMapper ?? new OnePasswordItemMapper();
  }

  /**
   * Build a match index key from category, title, and normalized username.
   * Null bytes separate segments so titles cannot collide with usernames.
   */
  static buildMatchKey(
    category: ItemCategory,
    title: string,
    username: string,
  ): MatchKey {
    return `${category}\0${title}\0${normalizeUsername(username)}`;
  }

  /**
   * Fetch all items in the vault and index them by (category, title, username).
   * Requires a full item fetch because overviews do not include username fields.
   */
  async buildIndex(vaultId: string): Promise<MatchIndex> {
    const overviews = await this.client.items.list(vaultId);
    const index = new Map<MatchKey, string[]>();

    if (overviews.length === 0) {
      return { index };
    }

    const ids = overviews.map((o) => o.id);
    const response = await this.client.items.getAll(vaultId, ids);

    for (const entry of response.individualResponses) {
      if (!entry.content) continue;
      const item = entry.content;
      const username = this.itemMapper.extractOnePasswordUsername(
        item.fields,
        item.category,
      );
      const key = MergeEngine.buildMatchKey(
        item.category,
        item.title,
        username,
      );
      const existing = index.get(key) ?? [];
      existing.push(item.id);
      index.set(key, existing);
    }

    return { index };
  }

  /** Find existing item IDs that match an export cipher. */
  findMatches(matchIndex: MatchIndex, item: ParsedBitwardenItem): string[] {
    const category = bitwardenTypeToCategory(item.type);
    const username = this.itemMapper.extractBitwardenUsername(item);
    const key = MergeEngine.buildMatchKey(category, item.name, username);
    return matchIndex.index.get(key) ?? [];
  }

  /** Static variant for tests that do not need a client instance. */
  static findMatchesInIndex(
    matchIndex: MatchIndex,
    item: ParsedBitwardenItem,
    itemMapper = new OnePasswordItemMapper(),
  ): string[] {
    const category = bitwardenTypeToCategory(item.type);
    const username = itemMapper.extractBitwardenUsername(item);
    const key = MergeEngine.buildMatchKey(category, item.name, username);
    return matchIndex.index.get(key) ?? [];
  }

  /**
   * Choose create / update / skip / abort based on strategy and match count.
   *
   * | Matches | skip    | merge              | abort   |
   * |---------|---------|--------------------|---------|
   * | 0       | create  | create             | create  |
   * | 1       | skip    | update             | abort   |
   * | 2+      | skip    | skip (+ warn)      | abort   |
   */
  static decide(strategy: MergeStrategy, matchIds: string[]): MergeDecision {
    const count = matchIds.length;

    if (count === 0) {
      return { action: "create" };
    }

    if (count === 1) {
      switch (strategy) {
        case "skip":
          return { action: "skip", targetItemId: matchIds[0] };
        case "merge":
          return { action: "update", targetItemId: matchIds[0] };
        case "abort":
          return { action: "abort" };
      }
    }

    // Ambiguous duplicate: more than one existing item shares the same match key.
    switch (strategy) {
      case "skip":
        return {
          action: "skip",
          warning: `Multiple matches (${count}); skipping.`,
        };
      case "merge":
        return {
          action: "skip",
          warning: `Multiple matches (${count}); skipping update.`,
        };
      case "abort":
        return {
          action: "abort",
          warning: `Multiple matches (${count}); aborting.`,
        };
    }
  }

  /**
   * Build the target item state from mapped export params while preserving
   * server-managed metadata on an existing vault item.
   */
  static buildDesiredItem(existing: Item, params: ItemCreateParams): Item {
    return {
      ...existing,
      title: params.title,
      category: params.category,
      fields: structuredClone(params.fields ?? []),
      sections: structuredClone(params.sections ?? []),
      notes: params.notes ?? "",
      tags: [...(params.tags ?? [])],
      websites: structuredClone(params.websites ?? []),
    };
  }

  /**
   * True when an existing vault item already matches the desired export state.
   * Fields are compared strictly (order, ids, types, values). Field sectionId
   * is ignored because 1Password may assign sections on save. Tags match when
   * every desired tag is present on the actual item (order ignored).
   */
  static itemsMatchDesired(actual: Item, desired: Item): boolean {
    return (
      actual.title === desired.title &&
      actual.category === desired.category &&
      (actual.notes ?? "") === (desired.notes ?? "") &&
      MergeEngine.fieldsEqualStrict(actual.fields, desired.fields) &&
      MergeEngine.websitesEqual(actual.websites, desired.websites) &&
      MergeEngine.tagsDesiredSubsetOfActual(desired.tags, actual.tags)
    );
  }

  /** Replace migratable content on an existing item with the desired state. */
  static applyDesiredContent(existing: Item, desired: Item): Item {
    existing.title = desired.title;
    existing.category = desired.category;
    existing.fields = structuredClone(desired.fields);
    existing.sections = structuredClone(desired.sections);
    existing.notes = desired.notes;
    existing.tags = [...desired.tags];
    existing.websites = structuredClone(desired.websites);
    return existing;
  }

  /** Remove tags the SDK rejects; desktop-created items may still carry them. */
  static stripNonAsciiTags(item: Item): void {
    item.tags = filterSdkSafeTags(item.tags);
  }

  /** Field IDs already used by attachments on an item (skip re-upload on sync). */
  static existingAttachmentFieldIds(item: Item): Set<string> {
    return new Set(item.files.map((f) => f.fieldId));
  }

  /** Build index from preloaded data (used in unit tests). */
  static buildIndexFromOverviews(
    overviews: ItemOverview[],
    itemsById: Map<string, Item>,
    itemMapper = new OnePasswordItemMapper(),
  ): MatchIndex {
    const index = new Map<MatchKey, string[]>();

    for (const overview of overviews) {
      const item = itemsById.get(overview.id);
      const username = item
        ? itemMapper.extractOnePasswordUsername(item.fields, item.category)
        : "";
      const key = MergeEngine.buildMatchKey(
        overview.category,
        overview.title,
        username,
      );
      const existing = index.get(key) ?? [];
      existing.push(overview.id);
      index.set(key, existing);
    }

    return { index };
  }

  private static fieldEqual(a: ItemField, b: ItemField): boolean {
    return (
      a.id === b.id &&
      a.title === b.title &&
      a.fieldType === b.fieldType &&
      a.value === b.value &&
      JSON.stringify(a.details ?? null) === JSON.stringify(b.details ?? null)
    );
  }

  private static fieldsEqualStrict(a: ItemField[], b: ItemField[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((field, index) =>
      MergeEngine.fieldEqual(field, b[index]!),
    );
  }

  private static tagsDesiredSubsetOfActual(
    desired: readonly string[],
    actual: readonly string[],
  ): boolean {
    const actualSet = new Set(actual);
    return desired.every((tag) => actualSet.has(tag));
  }

  private static websitesEqual(a: Website[], b: Website[]): boolean {
    if (a.length !== b.length) return false;

    const serialize = (websites: Website[]) =>
      [...websites]
        .map((website) => JSON.stringify(website))
        .sort()
        .join("\0");

    return serialize(a) === serialize(b);
  }
}

// Thin function exports preserve test and legacy import paths.
export const buildMatchKey = MergeEngine.buildMatchKey;

export async function buildMatchIndex(
  client: OnePasswordClient,
  vaultId: string,
): Promise<MatchIndex> {
  return new MergeEngine(client).buildIndex(vaultId);
}

export function decideMergeAction(
  strategy: MergeStrategy,
  matchIds: string[],
): MergeDecision {
  return MergeEngine.decide(strategy, matchIds);
}

export function findMatches(
  matchIndex: MatchIndex,
  item: ParsedBitwardenItem,
): string[] {
  return MergeEngine.findMatchesInIndex(matchIndex, item);
}

export function buildDesiredItem(
  existing: Item,
  params: ItemCreateParams,
): Item {
  return MergeEngine.buildDesiredItem(existing, params);
}

export function itemsMatchDesired(actual: Item, desired: Item): boolean {
  return MergeEngine.itemsMatchDesired(actual, desired);
}

export function applyDesiredContent(existing: Item, desired: Item): Item {
  return MergeEngine.applyDesiredContent(existing, desired);
}

export function existingAttachmentFieldIds(item: Item): Set<string> {
  return MergeEngine.existingAttachmentFieldIds(item);
}

export function stripNonAsciiTags(item: Item): void {
  MergeEngine.stripNonAsciiTags(item);
}

export const buildMatchIndexFromOverviews = MergeEngine.buildIndexFromOverviews;
