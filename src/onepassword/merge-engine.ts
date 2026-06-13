import type { Item, ItemCategory, ItemField, ItemOverview } from "@1password/sdk";
import type { ParsedBitwardenItem } from "../bitwarden/types.js";
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
 * Resolves duplicate items during migration and merges export data into
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
   * Choose create / merge / skip / abort based on strategy and match count.
   *
   * | Matches | skip    | merge              | abort   |
   * |---------|---------|--------------------|---------|
   * | 0       | create  | create             | create  |
   * | 1       | skip    | merge              | abort   |
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
          return { action: "merge", targetItemId: matchIds[0] };
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
          warning: `Multiple matches (${count}); skipping merge.`,
        };
      case "abort":
        return {
          action: "abort",
          warning: `Multiple matches (${count}); aborting.`,
        };
    }
  }

  /**
   * Apply mapped export fields onto an existing item without removing data.
   * Updates matching fields by id/section, appends new fields, and unions
   * notes, tags, websites, and sections.
   */
  static overlay(
    existing: Item,
    mappedFields: ItemField[],
    mappedNotes: string | undefined,
    mappedTags: string[] | undefined,
    mappedWebsites: Item["websites"] | undefined,
    mappedSections: Item["sections"] | undefined,
  ): Item {
    MergeEngine.overlayFields(existing, mappedFields);
    MergeEngine.overlayNotes(existing, mappedNotes);
    MergeEngine.overlayTags(existing, mappedTags);
    MergeEngine.overlayWebsites(existing, mappedWebsites);
    MergeEngine.overlaySections(existing, mappedSections);
    return existing;
  }

  /** Field IDs already used by attachments on an item (skip re-upload on merge). */
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

  /** Update in-place or append fields keyed by sectionId:id or bare id. */
  private static overlayFields(existing: Item, mappedFields: ItemField[]): void {
    const fieldByKey = new Map<string, ItemField>();
    for (const field of existing.fields) {
      const key = field.sectionId
        ? `${field.sectionId}:${field.id}`
        : field.id;
      fieldByKey.set(key, field);
    }

    for (const field of mappedFields) {
      const key = field.sectionId
        ? `${field.sectionId}:${field.id}`
        : field.id;
      const current = fieldByKey.get(key);
      if (current) {
        current.value = field.value;
        if (field.details) current.details = field.details;
        if (field.title) current.title = field.title;
      } else {
        existing.fields.push({ ...field });
      }
    }
  }

  /** Append export notes when they are not already present. */
  private static overlayNotes(existing: Item, mappedNotes: string | undefined): void {
    if (mappedNotes === undefined || mappedNotes === "") return;

    const existingNotes = existing.notes?.trim() ?? "";
    if (existingNotes && !existingNotes.includes(mappedNotes)) {
      existing.notes = `${existingNotes}\n\n${mappedNotes}`;
    } else if (!existingNotes) {
      existing.notes = mappedNotes;
    }
  }

  private static overlayTags(
    existing: Item,
    mappedTags: string[] | undefined,
  ): void {
    if (!mappedTags || mappedTags.length === 0) return;
    const tagSet = new Set([...existing.tags, ...mappedTags]);
    existing.tags = [...tagSet];
  }

  /** Add websites from the export without duplicating URLs. */
  private static overlayWebsites(
    existing: Item,
    mappedWebsites: Item["websites"] | undefined,
  ): void {
    if (!mappedWebsites || mappedWebsites.length === 0) return;

    const urlSet = new Set(existing.websites.map((w) => w.url));
    for (const website of mappedWebsites) {
      if (!urlSet.has(website.url)) {
        existing.websites.push(website);
        urlSet.add(website.url);
      }
    }
  }

  private static overlaySections(
    existing: Item,
    mappedSections: Item["sections"] | undefined,
  ): void {
    if (!mappedSections || mappedSections.length === 0) return;

    const sectionIds = new Set(existing.sections.map((s) => s.id));
    for (const section of mappedSections) {
      if (!sectionIds.has(section.id)) {
        existing.sections.push(section);
        sectionIds.add(section.id);
      }
    }
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

export function overlayItem(
  existing: Item,
  mappedFields: ItemField[],
  mappedNotes: string | undefined,
  mappedTags: string[] | undefined,
  mappedWebsites: Item["websites"] | undefined,
  mappedSections: Item["sections"] | undefined,
): Item {
  return MergeEngine.overlay(
    existing,
    mappedFields,
    mappedNotes,
    mappedTags,
    mappedWebsites,
    mappedSections,
  );
}

export function existingAttachmentFieldIds(item: Item): Set<string> {
  return MergeEngine.existingAttachmentFieldIds(item);
}

export const buildMatchIndexFromOverviews = MergeEngine.buildIndexFromOverviews;
