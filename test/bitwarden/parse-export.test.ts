import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { parseExport } from "../../src/bitwarden/export-parser.js";

const FIXTURES = join(import.meta.dirname, "../fixtures/exports");

describe("parse-export", () => {
  it("parses a valid personal vault export", () => {
    const parsed = parseExport(join(FIXTURES, "personal-vault"));
    assert.equal(parsed.items.length, 5);
    assert.equal(
      parsed.folders.get("folder-work-0001-0001-0001-000000000001"),
      "Work",
    );
    assert.equal(parsed.skippedDeleted, 1);
    assert.equal(parsed.skippedUnsupported, 1);
  });

  it("skips deleted items", () => {
    const parsed = parseExport(join(FIXTURES, "personal-vault"));
    assert.ok(parsed.items.every((item) => item.name !== "Deleted Login"));
  });

  it("rejects encrypted exports", () => {
    assert.throws(
      () => parseExport(join(FIXTURES, "encrypted")),
      /Encrypted Bitwarden export/,
    );
  });

  it("rejects missing data.json", () => {
    assert.throws(() => parseExport(join(FIXTURES, "encrypted-not-real")));
  });

  it("rejects items missing required name", () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-export-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({ encrypted: false, items: [{ type: 1, login: {} }] }),
    );
    assert.throws(() => parseExport(dir), /missing required field "name"/);
  });
});
