import type { Item, ItemCategory, ItemField, ItemOverview } from "@1password/sdk";
import type { ParsedBitwardenItem } from "../bitwarden/types.js";
import { normalizeUsername } from "../utils/normalize.js";
import {
  bitwardenTypeToCategory,
  extractBitwardenUsername,
  extractOnePasswordUsername,
} from "./item-mapper.js";
import type {
  MergeAction,
  MergeDecision,
  MergeStrategy,
  OnePasswordClient,
} from "./types.js";

export type MatchKey = string;

/** Build a match index key from category, title, and normalized username. */
export function buildMatchKey(
  category: ItemCategory,
  title: string,
  username: string,
): MatchKey {
  return `${category}\0${title}\0${normalizeUsername(username)}`;
}

export interface MatchIndex {
  index: Map<MatchKey, string[]>;
}

/** Build an index of existing items by (category, title, username). */
export async function buildMatchIndex(
  client: OnePasswordClient,
  vaultId: string,
): Promise<MatchIndex> {
  const overviews = await client.items.list(vaultId);
  const index = new Map<MatchKey, string[]>();

  if (overviews.length === 0) {
    return { index };
  }

  const ids = overviews.map((o) => o.id);
  const response = await client.items.getAll(vaultId, ids);

  for (const entry of response.individualResponses) {
    if (!entry.content) continue;
    const item = entry.content;
    const username = extractOnePasswordUsername(item.fields, item.category);
    const key = buildMatchKey(item.category, item.title, username);
    const existing = index.get(key) ?? [];
    existing.push(item.id);
    index.set(key, existing);
  }

  return { index };
}

/** Resolve merge action for an export item against the match index. */
export function decideMergeAction(
  strategy: MergeStrategy,
  matchIds: string[],
): MergeDecision {
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

  // 2+ matches
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

/** Look up match IDs for a Bitwarden item. */
export function findMatches(
  matchIndex: MatchIndex,
  item: ParsedBitwardenItem,
): string[] {
  const category = bitwardenTypeToCategory(item.type);
  const username = extractBitwardenUsername(item);
  const key = buildMatchKey(category, item.name, username);
  return matchIndex.index.get(key) ?? [];
}

/** Overlay mapped fields onto an existing 1Password item. */
export function overlayItem(
  existing: Item,
  mappedFields: ItemField[],
  mappedNotes: string | undefined,
  mappedTags: string[] | undefined,
  mappedWebsites: Item["websites"] | undefined,
  mappedSections: Item["sections"] | undefined,
): Item {
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

  if (mappedNotes !== undefined && mappedNotes !== "") {
    const existingNotes = existing.notes?.trim() ?? "";
    if (existingNotes && !existingNotes.includes(mappedNotes)) {
      existing.notes = `${existingNotes}\n\n${mappedNotes}`;
    } else if (!existingNotes) {
      existing.notes = mappedNotes;
    }
  }

  if (mappedTags && mappedTags.length > 0) {
    const tagSet = new Set([...existing.tags, ...mappedTags]);
    existing.tags = [...tagSet];
  }

  if (mappedWebsites && mappedWebsites.length > 0) {
    const urlSet = new Set(existing.websites.map((w) => w.url));
    for (const website of mappedWebsites) {
      if (!urlSet.has(website.url)) {
        existing.websites.push(website);
        urlSet.add(website.url);
      }
    }
  }

  if (mappedSections && mappedSections.length > 0) {
    const sectionIds = new Set(existing.sections.map((s) => s.id));
    for (const section of mappedSections) {
      if (!sectionIds.has(section.id)) {
        existing.sections.push(section);
        sectionIds.add(section.id);
      }
    }
  }

  return existing;
}

/** Return attachment field IDs already present on an item. */
export function existingAttachmentFieldIds(item: Item): Set<string> {
  return new Set(item.files.map((f) => f.fieldId));
}

/** Log-friendly action label. */
export function formatMergeAction(action: MergeAction): string {
  return action;
}

/** Index overview items without fetching full details (for lightweight tests). */
export function buildMatchIndexFromOverviews(
  overviews: ItemOverview[],
  itemsById: Map<string, Item>,
): MatchIndex {
  const index = new Map<MatchKey, string[]>();

  for (const overview of overviews) {
    const item = itemsById.get(overview.id);
    const username = item
      ? extractOnePasswordUsername(item.fields, item.category)
      : "";
    const key = buildMatchKey(overview.category, overview.title, username);
    const existing = index.get(key) ?? [];
    existing.push(overview.id);
    index.set(key, existing);
  }

  return { index };
}
