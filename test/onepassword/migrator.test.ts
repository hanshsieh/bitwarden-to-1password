import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { migrate } from "../../src/onepassword/migrator.js";
import { parseExport } from "../../src/bitwarden/export-parser.js";
import { createMockClient, makeLoginItem } from "../helpers/mock-client.js";

const FIXTURES = join(import.meta.dirname, "../fixtures/exports/personal-vault");

describe("migrator", () => {
  it("dry-run reports planned creates without SDK writes", async () => {
    const { client, state } = createMockClient();
    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: true,
    });

    assert.equal(summary.created, 5);
    assert.equal(summary.merged, 0);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.failed, 0);
    assert.equal(summary.aborted, false);
    assert.equal(state.createCalls.length, 0);
  });

  it("creates items when no matches exist", async () => {
    const { client, state } = createMockClient();
    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: false,
    });

    assert.equal(summary.created, 5);
    assert.equal(summary.failed, 0);
    assert.equal(state.createCalls.length, 5);
  });

  it("skips matching items with skip strategy", async () => {
    const parsed = parseExport(FIXTURES);
    const login = parsed.items.find((i) => i.type === 1)!;

    const { client, state } = createMockClient({
      items: [
        makeLoginItem("existing-1", login.name, login.login?.username ?? ""),
      ],
    });

    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: false,
    });

    assert.equal(summary.skipped, 1);
    assert.equal(summary.created, 4);
    assert.equal(state.createCalls.length, 4);
  });

  it("aborts when a match exists and strategy is abort", async () => {
    const parsed = parseExport(FIXTURES);
    const login = parsed.items.find((i) => i.type === 1)!;

    const { client, state } = createMockClient({
      items: [
        makeLoginItem("existing-1", login.name, login.login?.username ?? ""),
      ],
    });

    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "abort",
      dryRun: false,
    });

    assert.equal(summary.aborted, true);
    assert.equal(summary.created, 0);
    assert.equal(state.createCalls.length, 0);
  });

  it("merges into a single matching item", async () => {
    const parsed = parseExport(FIXTURES);
    const login = parsed.items.find((i) => i.type === 1)!;

    const { client, state } = createMockClient({
      items: [
        makeLoginItem("existing-1", login.name, login.login?.username ?? ""),
      ],
    });

    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      dryRun: false,
    });

    assert.equal(summary.merged, 1);
    assert.equal(summary.created, 4);
    assert.equal(state.putCalls.length, 1);
  });

  it("skips merge update when existing item already matches export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 1,
            name: "Synced Login",
            login: {
              username: "user@example.com",
              password: "secret",
              uris: [{ uri: "https://example.com" }],
            },
            notes: "Already synced",
          },
        ],
      }),
    );

    const existing = makeLoginItem(
      "existing-1",
      "Synced Login",
      "user@example.com",
    );
    existing.notes = "Already synced";
    existing.tags = ["雲端空間"];
    existing.websites = [
      {
        url: "https://example.com",
        label: "website",
        autofillBehavior: "AnywhereOnWebsite" as const,
      },
    ];
    existing.fields.push({
      id: "password",
      title: "password",
      fieldType: 1,
      value: "secret",
    });

    const { client, state } = createMockClient({ items: [existing] });
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      dryRun: false,
    });

    assert.equal(summary.merged, 0);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.failed, 0);
    assert.equal(state.putCalls.length, 0);
    assert.deepEqual(state.items.get("existing-1")?.tags, ["雲端空間"]);
    assert.deepEqual(summary.nonAsciiTagsSkipped, []);
  });

  it("strips non-ASCII tags when merge update is required", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        folders: [{ id: "folder-1", name: "Work" }],
        items: [
          {
            type: 1,
            name: "Needs Tag",
            folderId: "folder-1",
            login: {
              username: "user@example.com",
              password: "secret",
              uris: [{ uri: "https://example.com" }],
            },
          },
        ],
      }),
    );

    const existing = makeLoginItem(
      "existing-1",
      "Needs Tag",
      "user@example.com",
    );
    existing.tags = ["雲端空間"];
    existing.websites = [
      {
        url: "https://example.com",
        label: "website",
        autofillBehavior: "AnywhereOnWebsite" as const,
      },
    ];
    existing.fields.push({
      id: "password",
      title: "password",
      fieldType: 1,
      value: "secret",
    });

    const { client, state } = createMockClient({ items: [existing] });
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      dryRun: false,
    });

    assert.equal(summary.merged, 1);
    assert.equal(summary.failed, 0);
    assert.equal(state.putCalls.length, 1);
    assert.deepEqual(state.items.get("existing-1")?.tags, ["Work"]);
    assert.deepEqual(summary.nonAsciiTagsSkipped, ["Needs Tag"]);
  });

  it("reports items with FIDO2 credentials in summary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
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
              password: "secret",
              fido2Credentials: [
                {
                  credentialId: "cred-1",
                  rpId: "example.com",
                  keyValue: "key-material",
                },
              ],
            },
          },
          {
            type: 2,
            name: "Plain Note",
            secureNote: { type: 0 },
          },
        ],
      }),
    );

    const { client } = createMockClient();
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: false,
    });

    assert.equal(summary.created, 2);
    assert.deepEqual(summary.fidoCredentialsSkipped, ["Passkey Login"]);
  });

  it("reports items with linked custom fields in summary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 1,
            name: "Bank Login",
            login: { username: "user@example.com", password: "secret" },
            fields: [
              { type: 0, name: "Account", value: "12345" },
              { type: 3, name: "Password", linkedId: 100 },
            ],
          },
          {
            type: 2,
            name: "Plain Note",
            secureNote: { type: 0 },
          },
        ],
      }),
    );

    const { client } = createMockClient();
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: false,
    });

    assert.equal(summary.created, 2);
    assert.deepEqual(summary.linkedFieldsSkipped, ["Bank Login"]);
  });

  it("reports items with non-ASCII folder labels in summary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        folders: [{ id: "folder-1", name: "雲端空間" }],
        items: [
          {
            type: 1,
            name: "adrive",
            folderId: "folder-1",
            login: {
              username: "user@example.com",
              password: "secret",
              uris: [{ uri: "https://www.adrive.com" }],
            },
          },
        ],
      }),
    );

    const { client } = createMockClient();
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: false,
    });

    assert.equal(summary.created, 1);
    assert.deepEqual(summary.nonAsciiTagsSkipped, ["adrive"]);
  });

  it("reports items with regex URLs in summary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            type: 1,
            name: "Regex Login",
            login: {
              username: "user@example.com",
              password: "secret",
              uris: [
                {
                  uri: "^https://.*\\.example\\.com$",
                  match: 4,
                },
              ],
            },
          },
          {
            type: 2,
            name: "Plain Note",
            secureNote: { type: 0 },
          },
        ],
      }),
    );

    const { client } = createMockClient();
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: false,
    });

    assert.equal(summary.created, 2);
    assert.deepEqual(summary.regexUrlItems, ["Regex Login"]);
  });

  it("archives items when export has archivedDate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
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

    const { client, state } = createMockClient();
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: false,
    });

    assert.equal(summary.created, 1);
    assert.equal(summary.archived, 1);
    assert.equal(state.archiveCalls.length, 1);
    assert.equal(state.archiveCalls[0], "created-1");
  });
});
