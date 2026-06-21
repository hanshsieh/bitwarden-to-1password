import type {
  Item,
  ItemCategory,
  ItemCreateParams,
  ItemField,
  ItemFieldDetails,
  ItemFile,
  ItemSection,
  ItemState,
  Website,
} from "@1password/sdk";
import { ItemFieldType } from "@1password/sdk";
import type { ParsedBitwardenItem } from "../bitwarden/types.js";
import { filterSdkSafeTags } from "./tags.js";
import { DEFAULT_SECTION_ID, OnePasswordItemMapper } from "./item-mapper.js";
import type {
  MappedItem,
  MergeDecision,
  MergeStrategy,
  OnePasswordClient,
} from "./types.js";

/** Composite lookup key: category + title + username. */
export type MatchKey = string;

/** In-memory index of existing vault items for duplicate detection. */
export interface MatchIndex {
  index: Map<MatchKey, string[]>;
  /** Full items prefetched during index build; updated after writes in the same run. */
  itemsById: Map<string, Item>;
  /** Item archive/active state from overviews; updated after archive in the same run. */
  statesById: Map<string, ItemState>;
}

/** Optional archive-state inputs for {@link MergeEngine.itemsMatchDesired}. */
export interface ItemMatchOptions {
  actualState?: ItemState;
  desiredState?: ItemState;
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
   * Build a match index key from category, title, and username.
   * Null bytes separate segments so titles cannot collide with usernames.
   */
  static buildMatchKey(
    category: ItemCategory,
    title: string,
    username: string,
  ): MatchKey {
    return `${category}\0${title}\0${username}`;
  }

  /**
   * Fetch active vault items whose titles appear in the export and index them
   * by (category, title, username). Archived items are excluded because the
   * SDK cannot get or put them. Requires a full item fetch because overviews
   * do not include username fields.
   */
  async buildIndex(
    vaultId: string,
    exportTitles: Set<string>,
  ): Promise<MatchIndex> {
    const overviews = await this.client.items.list(vaultId, {
      type: "ByState",
      content: { active: true, archived: false },
    });
    const index = new Map<MatchKey, string[]>();
    const itemsById = new Map<string, Item>();
    const statesById = new Map<string, ItemState>();

    const matchingOverviews = overviews.filter((overview) =>
      exportTitles.has(overview.title),
    );

    if (matchingOverviews.length === 0) {
      return { index, itemsById, statesById };
    }

    for (const overview of matchingOverviews) {
      statesById.set(overview.id, overview.state);
    }

    const ids = matchingOverviews.map((o) => o.id);
    const response = await this.client.items.getAll(vaultId, ids);

    for (const entry of response.individualResponses) {
      if (!entry.content) continue;
      const item = entry.content;
      itemsById.set(item.id, item);
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

    return { index, itemsById, statesById };
  }

  /** Keep archive state in sync after archive in the same migration run. */
  static setCachedItemState(
    matchIndex: MatchIndex,
    itemId: string,
    state: ItemState,
  ): void {
    matchIndex.statesById.set(itemId, state);
  }

  /** Return a copy of a prefetched vault item (same isolation as items.get). */
  static getCachedItem(matchIndex: MatchIndex, itemId: string): Item {
    const item = matchIndex.itemsById.get(itemId);
    if (!item) {
      throw new Error(`Item not found in match index: ${itemId}`);
    }
    return structuredClone(item);
  }

  /** Keep the in-memory cache in sync after a create, put, or attachment change. */
  static setCachedItem(matchIndex: MatchIndex, item: Item): void {
    matchIndex.itemsById.set(item.id, structuredClone(item));
  }

  /** Find existing item IDs that match an export cipher. */
  findMatches(matchIndex: MatchIndex, item: ParsedBitwardenItem): string[] {
    const key = this.buildMatchKeyForBitwardenItem(item);
    return matchIndex.index.get(key) ?? [];
  }

  /**
   * Remove a vault item from the match index after it is claimed by an export
   * item. Ensures one 1Password item is not matched to multiple export items.
   */
  consumeMatch(
    matchIndex: MatchIndex,
    item: ParsedBitwardenItem,
    itemId: string,
  ): void {
    const key = this.buildMatchKeyForBitwardenItem(item);
    MergeEngine.removeFromIndex(matchIndex, key, itemId);
  }

  private buildMatchKeyForBitwardenItem(item: ParsedBitwardenItem): MatchKey {
    const category = OnePasswordItemMapper.bitwardenTypeToCategory(item.type);
    const username = this.itemMapper.extractBitwardenUsername(item);
    return MergeEngine.buildMatchKey(category, item.name, username);
  }

  private static removeFromIndex(
    matchIndex: MatchIndex,
    key: MatchKey,
    itemId: string,
  ): void {
    const matchIds = matchIndex.index.get(key);
    if (!matchIds) {
      return;
    }

    const remaining = matchIds.filter((id) => id !== itemId);
    if (remaining.length === 0) {
      matchIndex.index.delete(key);
    } else {
      matchIndex.index.set(key, remaining);
    }
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
  static buildDesiredItem(
    existing: Item,
    params: ItemCreateParams,
    expectedFiles: ItemFile[] = [],
  ): Item {
    return {
      ...existing,
      title: params.title,
      category: params.category,
      fields: structuredClone(params.fields ?? []),
      sections: structuredClone(params.sections ?? []),
      notes: params.notes ?? "",
      tags: [...(params.tags ?? [])],
      websites: structuredClone(params.websites ?? []),
      files: structuredClone(expectedFiles),
    };
  }

  /** Expected attachment file fields from a mapped export item. */
  static expectedFilesFromMapped(mapped: MappedItem): ItemFile[] {
    return mapped.attachments.map((attachment) => ({
      attributes: {
        id: "",
        name: attachment.filename,
        size: 0,
      },
      sectionId: DEFAULT_SECTION_ID,
      fieldId:
        mapped.attachmentFieldIds.get(attachment.filePath) ??
        attachment.filename,
    }));
  }

  /**
   * True when field content matches the desired export state (files and archive
   * state excluded). Sections are compared in order by id and title. Fields are
   * compared in order by id, title, type, value, details, and sectionId.
   */
  static itemContentMatchesDesired(actual: Item, desired: Item): boolean {
    return (
      actual.title === desired.title &&
      actual.category === desired.category &&
      (actual.notes ?? "") === (desired.notes ?? "") &&
      MergeEngine.fieldsEqualStrict(actual.fields, desired.fields) &&
      MergeEngine.sectionsEqual(actual.sections, desired.sections) &&
      MergeEngine.websitesEqual(actual.websites, desired.websites) &&
      MergeEngine.tagsDesiredSubsetOfActual(desired.tags, actual.tags)
    );
  }

  /**
   * True when an existing vault item already matches the desired export state.
   * Compares title, category, notes, tags, websites, sections (order, id, title),
   * fields (order, id, title, type, value, sectionId, details), files
   * (fieldId, sectionId), and optional archive state.
   */
  static itemsMatchDesired(
    actual: Item,
    desired: Item,
    options?: ItemMatchOptions,
  ): boolean {
    const stateMatches =
      options?.actualState === undefined ||
      options?.desiredState === undefined ||
      options.actualState === options.desiredState;

    return (
      MergeEngine.itemContentMatchesDesired(actual, desired) &&
      MergeEngine.filesEqual(actual.files, desired.files) &&
      stateMatches
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

  /** Field IDs already used by file fields on an item. */
  static existingAttachmentFieldIds(item: Item): Set<string> {
    return new Set(item.files.map((f) => f.fieldId));
  }

  private static fieldEqual(a: ItemField, b: ItemField): boolean {
    let result = (
      a.id === b.id &&
      a.title === b.title &&
      a.fieldType === b.fieldType &&
      a.value === b.value &&
      a.sectionId === b.sectionId &&
      (a.fieldType !== ItemFieldType.Address ||
        MergeEngine.addressDetailsEqual(a.details, b.details))
    );
    return result;
  }

  private static addressDetailsEqual(
    a: ItemFieldDetails | undefined,
    b: ItemFieldDetails | undefined,
  ): boolean {
    if (a === b) {
      return true;
    }
    if (a?.type !== "Address" || b?.type !== "Address") {
      return false;
    }

    const left = a.content;
    const right = b.content;
    if (left === right) {
      return true;
    }
    if (!left || !right) {
      return false;
    }

    return (
      left.street === right.street &&
      left.city === right.city &&
      left.state === right.state &&
      left.zip === right.zip &&
      left.country === right.country
    );
  }

  private static fieldsEqualStrict(a: ItemField[], b: ItemField[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((field, index) =>
      MergeEngine.fieldEqual(field, b[index]!),
    );
  }

  /** Compare section lists in order by id and title. */
  private static sectionsEqual(a: ItemSection[], b: ItemSection[]): boolean {
    if (a.length !== b.length) return false;
    return a.every(
      (section, index) =>
        section.id === b[index]!.id && section.title === b[index]!.title,
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

  /** Compare actual item files to the expected export attachment field IDs. */
  static filesMatchExpected(actual: ItemFile[], expected: ItemFile[]): boolean {
    return MergeEngine.filesEqual(actual, expected);
  }

  private static filesEqual(a: ItemFile[], b: ItemFile[]): boolean {
    if (a.length !== b.length) return false;

    const byFieldId = (files: ItemFile[]) =>
      [...files].sort((left, right) =>
        left.fieldId.localeCompare(right.fieldId),
      );

    const actual = byFieldId(a);
    const desired = byFieldId(b);
    return actual.every(
      (file, index) =>
        file.fieldId === desired[index]!.fieldId &&
        file.sectionId === desired[index]!.sectionId,
    );
  }
}
