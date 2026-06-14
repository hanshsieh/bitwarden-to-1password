import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Build a stable 1Password attachment field ID from file bytes. */
export function attachmentFieldId(content: Uint8Array | Buffer): string {
  return `attach_${createHash("sha1").update(content).digest("hex")}`;
}

/** Read a file from disk and derive its attachment field ID. */
export function attachmentFieldIdFromPath(filePath: string): string {
  return attachmentFieldId(readFileSync(filePath));
}
