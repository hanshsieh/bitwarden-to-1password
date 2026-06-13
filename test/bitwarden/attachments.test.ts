import { strict as assert } from "node:assert";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  attachmentSize,
  readAttachmentFile,
  scanAttachments,
} from "../../src/bitwarden/attachments.js";

const FIXTURES = join(
  import.meta.dirname,
  "../fixtures/exports/personal-vault",
);
const LOGIN_ID = "item-login-0001-0001-0001-000000000001";

describe("attachments", () => {
  it("scans new and legacy attachment layouts", () => {
    const attachments = scanAttachments(FIXTURES, LOGIN_ID);
    assert.equal(attachments.length, 2);

    const legacy = attachments.find((a) => a.filename === "legacy-file.txt");
    assert.ok(legacy);
    assert.equal(legacy.attachmentId, null);

    const nested = attachments.find((a) => a.filename === "readme.txt");
    assert.ok(nested);
    assert.equal(nested.attachmentId, "att-new-layout");
  });

  it("returns empty list when no attachment directory exists", () => {
    assert.deepEqual(scanAttachments(FIXTURES, "missing-item"), []);
  });

  it("reads attachment bytes and reports size", () => {
    const attachments = scanAttachments(FIXTURES, LOGIN_ID);
    const legacy = attachments.find((a) => a.filename === "legacy-file.txt")!;
    const content = readAttachmentFile(legacy.filePath);
    assert.ok(content.length > 0);
    assert.equal(attachmentSize(legacy.filePath), content.length);
  });
});
