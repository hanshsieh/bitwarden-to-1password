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
    assert.throws(
      () => parseExport(dir),
      /item at index 0, type 1 is missing required field "name"/,
    );
  });

  it("reports item index and field path on validation failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-export-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 1,
            name: "Broken Login",
            id: "item-123",
            login: {
              uris: [{ match: 0 }],
              fido2Credentials: [{ rpId: "example.com" }],
            },
            fields: [{ type: 0, value: "secret" }],
          },
        ],
      }),
    );

    assert.throws(() => parseExport(dir), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid Bitwarden export:/);
      assert.match(
        error.message,
        /item at index 0, name "Broken Login", id item-123, type 1, fields\[0\]\.name/,
      );
      assert.match(
        error.message,
        /item at index 0, name "Broken Login", id item-123, type 1, login\.uris\[0\]\.uri/,
      );
      assert.match(
        error.message,
        /item at index 0, name "Broken Login", id item-123, type 1, login\.fido2Credentials\[0\]\.credentialId/,
      );
      return true;
    });
  });

  it("preserves login fido2Credentials from export", () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-export-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 1,
            name: "Passkey Login",
            login: {
              username: "user@example.com",
              fido2Credentials: [{ credentialId: "cred-1", rpId: "example.com" }],
            },
          },
        ],
      }),
    );

    const parsed = parseExport(dir);
    assert.equal(parsed.items[0]?.login?.fido2Credentials?.length, 1);
    assert.equal(
      parsed.items[0]?.login?.fido2Credentials?.[0]?.credentialId,
      "cred-1",
    );
  });

  it("accepts custom fields and URIs with omitted linkedId and match", () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-export-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 1,
            name: "Login With Omitted Field Metadata",
            login: {
              username: "user@example.com",
              uris: [{ uri: "https://example.com" }],
            },
            fields: [{ type: 0, name: "Email", value: "user@example.com" }],
          },
        ],
      }),
    );

    const parsed = parseExport(dir);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0]?.fields[0]?.linkedId, null);
    assert.equal(parsed.items[0]?.login?.uris?.[0]?.match, null);
  });

  it("includes archived items with archivedDate preserved", () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-export-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 2,
            name: "Archived Note",
            secureNote: { type: 0 },
            archivedDate: "2026-06-13T08:16:07.105Z",
          },
        ],
      }),
    );

    const parsed = parseExport(dir);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0]?.archivedDate, "2026-06-13T08:16:07.105Z");
  });
});
