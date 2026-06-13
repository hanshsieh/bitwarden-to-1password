import type { ParsedBitwardenExport, ParsedBitwardenItem } from "../bitwarden/types.js";

/** 1Password SDK tags must be ASCII; the desktop app allows broader Unicode. */
export function isAsciiOnlyTag(tag: string): boolean {
  return /^[\x00-\x7F]*$/.test(tag);
}

export type BitwardenLabelSource = "folder" | "collection";

export interface BitwardenLabel {
  name: string;
  source: BitwardenLabelSource;
}

/** Collect Bitwarden folder and collection names attached to an item. */
export function collectBitwardenLabels(
  item: ParsedBitwardenItem,
  exportData: ParsedBitwardenExport,
): BitwardenLabel[] {
  const labels: BitwardenLabel[] = [];

  if (item.folderId) {
    const folderName = exportData.folders.get(item.folderId);
    if (folderName) {
      labels.push({ name: folderName, source: "folder" });
    }
  }

  for (const collectionId of item.collectionIds) {
    const collectionName = exportData.collections.get(collectionId);
    if (collectionName) {
      labels.push({ name: collectionName, source: "collection" });
    }
  }

  return labels;
}

/** Map Bitwarden labels to SDK-safe tags, omitting non-ASCII labels. */
export function mapBitwardenLabelsForSdk(
  labels: readonly BitwardenLabel[],
): string[] {
  return labels
    .map((label) => label.name)
    .filter((name) => isAsciiOnlyTag(name));
}

/** True when an item has folder/collection labels that cannot be sent as SDK tags. */
export function hasNonAsciiBitwardenLabels(
  item: ParsedBitwardenItem,
  exportData: ParsedBitwardenExport,
): boolean {
  return collectBitwardenLabels(item, exportData).some(
    (label) => !isAsciiOnlyTag(label.name),
  );
}
