import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BitwardenAttachment } from "./types.js";

/** Scan `{bwDir}/attachments/{itemId}/` for attachment files. */
export function scanAttachments(
  bwDir: string,
  itemId: string,
): BitwardenAttachment[] {
  const itemDir = join(bwDir, "attachments", itemId);
  if (!existsSync(itemDir)) {
    return [];
  }

  const attachments: BitwardenAttachment[] = [];
  const entries = readdirSync(itemDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(itemDir, entry.name);

    if (entry.isDirectory()) {
      // New layout: attachments/{itemId}/{attachmentId}/{filename}
      const attachmentId = entry.name;
      const files = readdirSync(entryPath, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) continue;
        attachments.push({
          attachmentId,
          filename: file.name,
          filePath: join(entryPath, file.name),
        });
      }
    } else if (entry.isFile()) {
      // Legacy layout: attachments/{itemId}/{filename}
      attachments.push({
        attachmentId: null,
        filename: entry.name,
        filePath: entryPath,
      });
    }
  }

  return attachments.sort((a, b) => a.filename.localeCompare(b.filename));
}

/** Read attachment file bytes from disk. */
export function readAttachmentFile(filePath: string): Uint8Array {
  return new Uint8Array(readFileSync(filePath));
}

/** Return total byte size of an attachment (for dry-run logging). */
export function attachmentSize(filePath: string): number {
  return statSync(filePath).size;
}
