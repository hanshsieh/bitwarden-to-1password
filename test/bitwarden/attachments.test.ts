import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attachmentSize,
  readAttachmentFile,
  scanAttachments,
} from "../../src/bitwarden/attachment-scanner.js";

const FIXTURES = join(
  import.meta.dirname,
  "../fixtures/exports/personal-vault",
);
const LOGIN_ID = "item-login-0001-0001-0001-000000000001";

describe("attachments", () => {
  it("scans new and legacy attachment layouts", () => {
    const attachments = scanAttachments(FIXTURES, LOGIN_ID);
    expect(attachments).toHaveLength(2);

    const legacy = attachments.find((a) => a.filename === "legacy-file.txt");
    expect(legacy).toBeDefined();
    expect(legacy?.attachmentId).toBeNull();

    const nested = attachments.find((a) => a.filename === "readme.txt");
    expect(nested).toBeDefined();
    expect(nested?.attachmentId).toBe("att-new-layout");
  });

  it("returns empty list when no attachment directory exists", () => {
    expect(scanAttachments(FIXTURES, "missing-item")).toEqual([]);
  });

  it("reads attachment bytes and reports size", () => {
    const attachments = scanAttachments(FIXTURES, LOGIN_ID);
    const legacy = attachments.find((a) => a.filename === "legacy-file.txt")!;
    const content = readAttachmentFile(legacy.filePath);
    expect(content.length).toBeGreaterThan(0);
    expect(attachmentSize(legacy.filePath)).toBe(content.length);
  });
});
