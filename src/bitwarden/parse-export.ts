import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BitwardenCipherType,
  BitwardenExport,
  BitwardenItemBase,
  ParsedBitwardenExport,
  ParsedBitwardenItem,
} from "./types.js";

const SUPPORTED_TYPES = new Set<number>([1, 2, 3, 4, 5]);

const TYPE_SUB_OBJECT: Record<
  BitwardenCipherType,
  keyof Pick<
    BitwardenItemBase,
    "login" | "secureNote" | "card" | "identity" | "sshKey"
  >
> = {
  1: "login",
  2: "secureNote",
  3: "card",
  4: "identity",
  5: "sshKey",
};

function isSupportedType(type: number): type is BitwardenCipherType {
  return SUPPORTED_TYPES.has(type);
}

function validateItem(item: BitwardenItemBase, index: number): void {
  if (typeof item.type !== "number") {
    throw new Error(`Item at index ${index} is missing required field "type".`);
  }
  if (typeof item.name !== "string" || item.name.length === 0) {
    throw new Error(
      `Item at index ${index} is missing required field "name".`,
    );
  }
  if (!isSupportedType(item.type)) {
    return;
  }
  const subKey = TYPE_SUB_OBJECT[item.type];
  if (item[subKey] === undefined || item[subKey] === null) {
    throw new Error(
      `Item "${item.name}" (type ${item.type}) is missing required sub-object "${subKey}".`,
    );
  }
}

function toParsedItem(item: BitwardenItemBase): ParsedBitwardenItem {
  const type = item.type as BitwardenCipherType;
  const parsed: ParsedBitwardenItem = {
    id: item.id ?? crypto.randomUUID(),
    type,
    name: item.name,
    notes: item.notes ?? "",
    folderId: item.folderId ?? null,
    collectionIds: item.collectionIds ?? [],
    fields: item.fields ?? [],
  };

  if (item.login) parsed.login = item.login;
  if (item.secureNote) parsed.secureNote = item.secureNote;
  if (item.card) parsed.card = item.card;
  if (item.identity) parsed.identity = item.identity;
  if (item.sshKey) parsed.sshKey = item.sshKey;

  return parsed;
}

/** Load and validate a Bitwarden export from `{bwDir}/data.json`. */
export function parseExport(bwDir: string): ParsedBitwardenExport {
  const dataPath = join(bwDir, "data.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(dataPath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${dataPath}: ${message}`);
  }

  const data = raw as BitwardenExport;

  if (data.encrypted === true) {
    throw new Error(
      "Encrypted Bitwarden export detected. Export an unencrypted .zip (with attachments) from Bitwarden and extract it before migrating.",
    );
  }

  if (!Array.isArray(data.items)) {
    throw new Error('Export is missing required "items" array.');
  }

  const folders = new Map<string, string>();
  for (const folder of data.folders ?? []) {
    folders.set(folder.id, folder.name);
  }

  const collections = new Map<string, string>();
  for (const collection of data.collections ?? []) {
    collections.set(collection.id, collection.name);
  }

  let skippedDeleted = 0;
  let skippedUnsupported = 0;
  const items: ParsedBitwardenItem[] = [];

  data.items.forEach((item, index) => {
    validateItem(item, index);

    if (item.deletedDate != null) {
      skippedDeleted++;
      return;
    }

    if (!isSupportedType(item.type)) {
      console.warn(
        `Skipping unsupported item type ${item.type}: "${item.name}"`,
      );
      skippedUnsupported++;
      return;
    }

    items.push(toParsedItem(item));
  });

  return { folders, collections, items, skippedDeleted, skippedUnsupported };
}
