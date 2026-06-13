import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BitwardenAttachment } from "./types.js";

/**
 * Discovers attachment files on disk for a Bitwarden export directory.
 *
 * Bitwarden ZIP exports store attachment bytes outside `data.json`. Two layouts
 * are supported:
 *
 * - **New:** `attachments/{itemId}/{attachmentId}/{filename}`
 * - **Legacy:** `attachments/{itemId}/{filename}`
 */
export class BitwardenAttachmentScanner {
  constructor(private readonly exportDir: string) {}

  /**
   * List all attachment files for a given cipher ID.
   * Returns an empty array when the item has no attachment folder.
   */
  scanForItem(itemId: string): BitwardenAttachment[] {
    const itemDir = join(this.exportDir, "attachments", itemId);
    if (!existsSync(itemDir)) {
      return [];
    }

    const attachments: BitwardenAttachment[] = [];
    const entries = readdirSync(itemDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(itemDir, entry.name);

      if (entry.isDirectory()) {
        // New layout: nested attachmentId folder contains the file(s).
        attachments.push(...this.scanNestedAttachment(entry.name, entryPath));
      } else if (entry.isFile()) {
        // Legacy layout: file sits directly under the item folder.
        attachments.push({
          attachmentId: null,
          filename: entry.name,
          filePath: entryPath,
        });
      }
    }

    return attachments.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  /** Read raw bytes for an attachment discovered by {@link scanForItem}. */
  readFile(attachment: BitwardenAttachment): Uint8Array {
    return new Uint8Array(readFileSync(attachment.filePath));
  }

  /** Return on-disk byte size (used for logging and dry-run output). */
  fileSize(attachment: BitwardenAttachment): number {
    return statSync(attachment.filePath).size;
  }

  /**
   * Scan `attachments/{itemId}/{attachmentId}/` for files.
   * Skips subdirectories (only regular files are attachments).
   */
  private scanNestedAttachment(
    attachmentId: string,
    attachmentDir: string,
  ): BitwardenAttachment[] {
    const attachments: BitwardenAttachment[] = [];
    const files = readdirSync(attachmentDir, { withFileTypes: true });

    for (const file of files) {
      if (!file.isFile()) continue;
      attachments.push({
        attachmentId,
        filename: file.name,
        filePath: join(attachmentDir, file.name),
      });
    }

    return attachments;
  }
}

/** Scan attachments for one item using a short-lived scanner instance. */
export function scanAttachments(
  exportDir: string,
  itemId: string,
): BitwardenAttachment[] {
  return new BitwardenAttachmentScanner(exportDir).scanForItem(itemId);
}

/** Read attachment bytes from disk. */
export function readAttachmentFile(filePath: string): Uint8Array {
  return new Uint8Array(readFileSync(filePath));
}

/** Return total byte size of an attachment file. */
export function attachmentSize(filePath: string): number {
  return statSync(filePath).size;
}
