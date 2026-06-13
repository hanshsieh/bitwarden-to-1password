import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isSupportedCipherType,
  parseBitwardenExport,
} from "./export-schemas.js";
import type {
  BitwardenCipherType,
  BitwardenItemInput,
  ParsedBitwardenExport,
  ParsedBitwardenItem,
} from "./types.js";

/**
 * Reads and validates an extracted Bitwarden vault export directory.
 *
 * Expects `{exportDir}/data.json` from an unencrypted `.zip (with attachments)`
 * export. Structure is validated with Zod; deleted items and unsupported cipher
 * types are counted but excluded from the returned item list.
 */
export class BitwardenExportParser {
  /**
   * Load `{exportDir}/data.json`, validate structure, and return migratable items.
   *
   * @throws When the file is missing, encrypted, or fails Zod validation.
   */
  parse(exportDir: string): ParsedBitwardenExport {
    const data = this.readExportJson(exportDir);
    const validated = parseBitwardenExport(data);

    const folders = this.buildFolderMap(validated.folders);
    const collections = this.buildCollectionMap(validated.collections);
    const { items, skippedDeleted, skippedUnsupported } = this.parseItems(
      validated.items,
    );

    return { folders, collections, items, skippedDeleted, skippedUnsupported };
  }

  /** Read and JSON-parse `data.json` from the export directory. */
  private readExportJson(exportDir: string): unknown {
    const dataPath = join(exportDir, "data.json");
    try {
      return JSON.parse(readFileSync(dataPath, "utf8")) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read ${dataPath}: ${message}`);
    }
  }

  private buildFolderMap(
    folders: { id: string; name: string }[] | undefined,
  ): Map<string, string> {
    const map = new Map<string, string>();
    for (const folder of folders ?? []) {
      map.set(folder.id, folder.name);
    }
    return map;
  }

  private buildCollectionMap(
    collections:
      | { id: string; name: string; organizationId: string }[]
      | undefined,
  ): Map<string, string> {
    const map = new Map<string, string>();
    for (const collection of collections ?? []) {
      map.set(collection.id, collection.name);
    }
    return map;
  }

  /**
   * Filter validated export items.
   * Skips trashed ciphers and unsupported types (with a console warning).
   */
  private parseItems(rawItems: BitwardenItemInput[]): {
    items: ParsedBitwardenItem[];
    skippedDeleted: number;
    skippedUnsupported: number;
  } {
    let skippedDeleted = 0;
    let skippedUnsupported = 0;
    const items: ParsedBitwardenItem[] = [];

    for (const item of rawItems) {
      if (item.deletedDate != null) {
        skippedDeleted++;
        continue;
      }

      if (!isSupportedCipherType(item.type)) {
        console.warn(
          `Skipping unsupported item type ${item.type}: "${item.name}"`,
        );
        skippedUnsupported++;
        continue;
      }

      items.push(this.toParsedItem(item));
    }

    return { items, skippedDeleted, skippedUnsupported };
  }

  /** Convert a validated export item into the normalized in-memory representation. */
  private toParsedItem(item: BitwardenItemInput): ParsedBitwardenItem {
    const type = item.type as BitwardenCipherType;
    const parsed: ParsedBitwardenItem = {
      id: item.id ?? crypto.randomUUID(),
      type,
      name: item.name,
      notes: item.notes ?? "",
      folderId: item.folderId ?? null,
      collectionIds: item.collectionIds ?? [],
      fields: item.fields ?? [],
      archivedDate: item.archivedDate ?? null,
    };

    if (item.login) parsed.login = item.login;
    if (item.secureNote) parsed.secureNote = item.secureNote;
    if (item.card) parsed.card = item.card;
    if (item.identity) parsed.identity = item.identity;
    if (item.sshKey) parsed.sshKey = item.sshKey;

    return parsed;
  }
}

/** Convenience wrapper using a default parser instance. */
export function parseExport(exportDir: string): ParsedBitwardenExport {
  return new BitwardenExportParser().parse(exportDir);
}
