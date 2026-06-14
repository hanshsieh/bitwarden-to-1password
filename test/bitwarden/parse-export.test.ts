import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseExport } from "../../src/bitwarden/export-parser.js";

const FIXTURES = join(import.meta.dirname, "../fixtures/exports");

describe("parse-export", () => {
  it("parses a valid personal vault export", () => {
    const parsed = parseExport(join(FIXTURES, "personal-vault"));
    expect(parsed.items).toHaveLength(5);
    expect(
      parsed.folders.get("folder-work-0001-0001-0001-000000000001"),
    ).toBe("Work");
    expect(parsed.skippedDeleted).toBe(1);
    expect(parsed.skippedUnsupported).toBe(1);
  });

  it("skips deleted items", () => {
    const parsed = parseExport(join(FIXTURES, "personal-vault"));
    expect(parsed.items.every((item) => item.name !== "Deleted Login")).toBe(
      true,
    );
  });

  it("rejects encrypted exports", () => {
    expect(() => parseExport(join(FIXTURES, "encrypted"))).toThrow(
      /Encrypted Bitwarden export/,
    );
  });

  it("rejects missing data.json", () => {
    expect(() =>
      parseExport(join(FIXTURES, "encrypted-not-real")),
    ).toThrow();
  });

  it("rejects items missing required name", () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-export-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({ encrypted: false, items: [{ type: 1, login: {} }] }),
    );
    expect(() => parseExport(dir)).toThrow(
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

    expect(() => parseExport(dir)).toThrow(/Invalid Bitwarden export:/);

    try {
      parseExport(dir);
      expect.unreachable("parseExport should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(
        /item at index 0, name "Broken Login", id item-123, type 1, fields\[0\]\.name/,
      );
      expect(message).toMatch(
        /item at index 0, name "Broken Login", id item-123, type 1, login\.uris\[0\]\.uri/,
      );
      expect(message).toMatch(
        /item at index 0, name "Broken Login", id item-123, type 1, login\.fido2Credentials\[0\]\.credentialId/,
      );
    }
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
    expect(parsed.items[0]?.login?.fido2Credentials).toHaveLength(1);
    expect(parsed.items[0]?.login?.fido2Credentials?.[0]?.credentialId).toBe(
      "cred-1",
    );
  });

  it("accepts linked custom fields with omitted value", () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-export-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 1,
            name: "Bank Login",
            login: { username: "user", password: "secret" },
            fields: [
              { type: 0, name: "Account", value: "12345" },
              { type: 3, name: "Password", linkedId: 100 },
            ],
          },
        ],
      }),
    );

    const parsed = parseExport(dir);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.fields).toHaveLength(2);
    expect(parsed.items[0]?.fields[1]?.type).toBe(3);
    expect(parsed.items[0]?.fields[1]?.value).toBeNull();
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
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.fields[0]?.linkedId).toBeNull();
    expect(parsed.items[0]?.login?.uris?.[0]?.match).toBeNull();
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
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.archivedDate).toBe("2026-06-13T08:16:07.105Z");
  });
});
