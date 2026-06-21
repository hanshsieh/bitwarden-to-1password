import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AutofillBehavior, ItemCategory, ItemFieldType } from "@1password/sdk";
import { parseExport } from "../../src/bitwarden/export-parser.js";
import {
  CUSTOM_SECTION,
  CUSTOM_SECTION_ID,
  OnePasswordItemMapper,
} from "../../src/onepassword/item-mapper.js";
import { MigrateOptions, Migrator } from "../../src/onepassword/migrator.js";
import { attachmentFieldId } from "../../src/utils/attachment-field-id.js";
import { createMockClient, makeLoginItem } from "../helpers/mock-client.js";

const FIXTURES = join(import.meta.dirname, "../fixtures/exports/personal-vault");
const mapper = new OnePasswordItemMapper();

async function migrate(
  client: ReturnType<typeof createMockClient>["client"],
  options: Partial<MigrateOptions> &
    Pick<MigrateOptions, "bwDir" | "vaultId">,
) {
  return new Migrator(client).migrate({
    mergeStrategy: "skip",
    dryRun: false,
    includeState: false,
    ...options,
  });
}

describe("migrator", () => {
  it("dry-run reports planned creates without SDK writes", async () => {
    const { client } = createMockClient();
    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: true,
    });

    expect(summary.created).toBe(5);
    expect(summary.updated).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.aborted).toBe(false);
    expect(client.items.create).not.toHaveBeenCalled();
    expect(client.items.createAll).not.toHaveBeenCalled();
  });

  it("creates items when no matches exist", async () => {
    const { client } = createMockClient();
    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: false,
    });

    expect(summary.created).toBe(5);
    expect(summary.failed).toBe(0);
    expect(client.items.create).not.toHaveBeenCalled();
    expect(client.items.createAll).toHaveBeenCalledTimes(1);
    expect(client.items.createAll).toHaveBeenCalledWith(
      "vault-1",
      expect.arrayContaining([
        expect.objectContaining({ title: expect.any(String) }),
      ]),
    );
    expect(client.items.createAll.mock.calls[0]![1]).toHaveLength(5);
  });

  it("skips matching items with skip strategy", async () => {
    const parsed = parseExport(FIXTURES);
    const login = parsed.items.find((i) => i.type === 1)!;

    const { client } = createMockClient({
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

    expect(summary.skipped).toBe(1);
    expect(summary.created).toBe(4);
    expect(client.items.create).not.toHaveBeenCalled();
    expect(client.items.createAll).toHaveBeenCalledTimes(1);
    expect(client.items.createAll.mock.calls[0]![1]).toHaveLength(4);
  });

  it("aborts when a match exists and strategy is abort", async () => {
    const parsed = parseExport(FIXTURES);
    const login = parsed.items.find((i) => i.type === 1)!;

    const { client } = createMockClient({
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

    expect(summary.aborted).toBe(true);
    expect(summary.created).toBe(0);
    expect(client.items.create).not.toHaveBeenCalled();
    expect(client.items.createAll).not.toHaveBeenCalled();
  });

  it("updates a single matching item to match the export", async () => {
    const parsed = parseExport(FIXTURES);
    const login = parsed.items.find((i) => i.type === 1)!;

    const { client } = createMockClient({
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

    expect(summary.updated).toBe(1);
    expect(summary.created).toBe(4);
    expect(client.items.put).toHaveBeenCalledTimes(1);
  });

  it("creates a new item when duplicate export items share one vault match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
    const exportItem = {
      type: 1 as const,
      name: "Duplicate Login",
      login: {
        username: "user@example.com",
        password: "secret",
        uris: [{ uri: "https://example.com" }],
      },
    };
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          { ...exportItem, id: "bw-1", notes: "First copy" },
          { ...exportItem, id: "bw-2", notes: "Second copy" },
        ],
      }),
    );

    const { client } = createMockClient({
      items: [
        makeLoginItem(
          "existing-1",
          "Duplicate Login",
          "user@example.com",
        ),
      ],
    });

    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      dryRun: false,
    });

    expect(summary.updated).toBe(1);
    expect(summary.created).toBe(1);
    expect(client.items.put).toHaveBeenCalledTimes(1);
    expect(client.items.createAll).toHaveBeenCalledTimes(1);
    expect(client.items.createAll.mock.calls[0]![1]).toHaveLength(1);
    expect(client.items.createAll.mock.calls[0]![1][0]?.notes).toBe(
      "Second copy",
    );
  });

  it("skips update when existing item already matches export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
    const exportItem = {
      type: 1 as const,
      name: "Synced Login",
      login: {
        username: "user@example.com",
        password: "secret",
        uris: [{ uri: "https://example.com" }],
      },
      notes: "Already synced",
    };
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [exportItem],
      }),
    );

    const exportData = parseExport(dir);
    const mapped = mapper.map(exportData.items[0]!, exportData, "vault-1");
    const existing = makeLoginItem(
      "existing-1",
      "Synced Login",
      "user@example.com",
    );
    existing.notes = mapped.params.notes ?? "";
    existing.tags = ["雲端空間"];
    existing.websites = mapped.params.websites ?? [];
    existing.fields = mapped.params.fields ?? [];
    existing.sections = mapped.params.sections ?? [];

    const { client, state } = createMockClient({ items: [existing] });
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      dryRun: false,
    });

    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
    expect(summary.failed).toBe(0);
    expect(client.items.put).not.toHaveBeenCalled();
    expect(client.items.get).not.toHaveBeenCalled();
    expect(state.items.get("existing-1")?.tags).toEqual(["雲端空間"]);
    expect(summary.nonAsciiTagsSkipped).toEqual([]);
  });

  it("overwrites item content when update is required", async () => {
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
        autofillBehavior: AutofillBehavior.AnywhereOnWebsite,
      },
    ];
    existing.fields.push({
      id: "password",
      title: "password",
      fieldType: ItemFieldType.Concealed,
      value: "secret",
    });

    const { client, state } = createMockClient({ items: [existing] });
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      dryRun: false,
    });

    expect(summary.updated).toBe(1);
    expect(summary.failed).toBe(0);
    expect(client.items.put).toHaveBeenCalledTimes(1);
    expect(state.items.get("existing-1")?.tags).toEqual(["Work"]);
    expect(summary.nonAsciiTagsSkipped).toEqual([]);
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

    expect(summary.created).toBe(2);
    expect(summary.fidoCredentialsSkipped).toEqual(["Passkey Login"]);
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

    expect(summary.created).toBe(2);
    expect(summary.linkedFieldsSkipped).toEqual(["Bank Login"]);
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

    expect(summary.created).toBe(1);
    expect(summary.nonAsciiTagsSkipped).toEqual(["adrive"]);
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

    expect(summary.created).toBe(2);
    expect(summary.regexUrlItems).toEqual(["Regex Login"]);
  });

  it("replaces all attachments when file field IDs differ", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
    const itemId = "cipher-id-card";
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            id: itemId,
            type: 2,
            name: "身分證",
            secureNote: { type: 0 },
          },
        ],
      }),
    );

    const attachmentDir = join(dir, "attachments", itemId);
    mkdirSync(attachmentDir, { recursive: true });
    writeFileSync(join(attachmentDir, "身分證正面.jpg"), "front-bytes");
    writeFileSync(join(attachmentDir, "身分證背面.jpg"), "back-bytes");

    const frontFieldId = attachmentFieldId(Buffer.from("front-bytes"));
    const backFieldId = attachmentFieldId(Buffer.from("back-bytes"));

    const existing = makeLoginItem("existing-1", "身分證", "");
    existing.category = ItemCategory.SecureNote;
    existing.fields = [];
    existing.websites = [];
    existing.sections = [
      CUSTOM_SECTION,
    ];
    existing.files = [
      {
        attributes: {
          id: "file-0",
          name: "身分證正面.jpg",
          size: 11,
        },
        sectionId: CUSTOM_SECTION_ID,
        fieldId: frontFieldId,
      },
    ];

    const { client } = createMockClient({ items: [existing] });
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      dryRun: false,
    });

    expect(summary.updated).toBe(1);
    expect(summary.attachmentsUploaded).toBe(2);
    expect(client.items.files.delete).toHaveBeenCalledTimes(1);
    expect(client.items.files.attach).toHaveBeenCalledTimes(2);
    expect(
      client.items.files.attach.mock.calls
        .map((call) => call[1].name)
        .sort(),
    ).toEqual(["身分證正面.jpg", "身分證背面.jpg"]);
    expect(client.items.files.attach.mock.calls[0]?.[1].fieldId).toBe(
      frontFieldId,
    );
    expect(client.items.files.attach.mock.calls[1]?.[1].fieldId).toBe(
      backFieldId,
    );
  });

  it("replaces all attachments when extra field IDs exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
    const itemId = "cipher-id-card";
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            id: itemId,
            type: 2,
            name: "身分證",
            secureNote: { type: 0 },
          },
        ],
      }),
    );

    const attachmentDir = join(dir, "attachments", itemId);
    mkdirSync(attachmentDir, { recursive: true });
    writeFileSync(join(attachmentDir, "身分證正面.jpg"), "front-bytes");
    writeFileSync(join(attachmentDir, "身分證背面.jpg"), "back-bytes");

    const frontFieldId = attachmentFieldId(Buffer.from("front-bytes"));
    const backFieldId = attachmentFieldId(Buffer.from("back-bytes"));

    const existing = makeLoginItem("existing-1", "身分證", "");
    existing.category = ItemCategory.SecureNote;
    existing.fields = [];
    existing.websites = [];
    existing.sections = [
      CUSTOM_SECTION,
    ];
    existing.files = [
      {
        attributes: {
          id: "file-legacy",
          name: "身分證正面.jpg",
          size: 11,
        },
        sectionId: CUSTOM_SECTION_ID,
        fieldId: "jpg",
      },
      {
        attributes: {
          id: "file-index",
          name: "身分證正面.jpg",
          size: 11,
        },
        sectionId: CUSTOM_SECTION_ID,
        fieldId: "attachment_0",
      },
      {
        attributes: {
          id: "file-front",
          name: "身分證正面.jpg",
          size: 11,
        },
        sectionId: CUSTOM_SECTION_ID,
        fieldId: frontFieldId,
      },
      {
        attributes: {
          id: "file-back",
          name: "身分證背面.jpg",
          size: 10,
        },
        sectionId: CUSTOM_SECTION_ID,
        fieldId: backFieldId,
      },
    ];

    const { client, state } = createMockClient({ items: [existing] });
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      dryRun: false,
    });

    expect(summary.updated).toBe(1);
    expect(summary.attachmentsUploaded).toBe(2);
    expect(client.items.files.delete).toHaveBeenCalledTimes(4);
    expect(client.items.files.attach).toHaveBeenCalledTimes(2);
    expect(state.items.get("existing-1")?.files).toHaveLength(2);
  });

  it("skips attachment upload when item already has all export files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bw-migrate-"));
    const itemId = "cipher-id-card";
    writeFileSync(
      join(dir, "data.json"),
      JSON.stringify({
        encrypted: false,
        items: [
          {
            id: itemId,
            type: 2,
            name: "身分證",
            secureNote: { type: 0 },
          },
        ],
      }),
    );

    const attachmentDir = join(dir, "attachments", itemId);
    mkdirSync(attachmentDir, { recursive: true });
    writeFileSync(join(attachmentDir, "身分證正面.jpg"), "front-bytes");
    writeFileSync(join(attachmentDir, "身分證背面.jpg"), "back-bytes");

    const frontFieldId = attachmentFieldId(Buffer.from("front-bytes"));
    const backFieldId = attachmentFieldId(Buffer.from("back-bytes"));

    const existing = makeLoginItem("existing-1", "身分證", "");
    existing.category = ItemCategory.SecureNote;
    existing.fields = [];
    existing.websites = [];
    existing.sections = [
      CUSTOM_SECTION,
    ];
    existing.files = [
      {
        attributes: {
          id: "file-0",
          name: "身分證正面.jpg",
          size: 11,
        },
        sectionId: CUSTOM_SECTION_ID,
        fieldId: frontFieldId,
      },
      {
        attributes: {
          id: "file-1",
          name: "身分證背面.jpg",
          size: 10,
        },
        sectionId: CUSTOM_SECTION_ID,
        fieldId: backFieldId,
      },
    ];

    const { client } = createMockClient({ items: [existing] });
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      dryRun: false,
    });

    expect(summary.unchanged).toBe(1);
    expect(summary.attachmentsUploaded).toBe(0);
    expect(client.items.files.attach).not.toHaveBeenCalled();
    expect(client.items.get).not.toHaveBeenCalled();
  });

  it("archives items when export has archivedDate and includeState", async () => {
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

    const { client } = createMockClient();
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      includeState: true,
    });

    expect(summary.created).toBe(1);
    expect(summary.archived).toBe(1);
    expect(client.items.archive).toHaveBeenCalledTimes(1);
    expect(client.items.archive).toHaveBeenCalledWith("vault-1", "created-1");
  });

  it("does not archive without includeState", async () => {
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

    const { client } = createMockClient();
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
    });

    expect(summary.created).toBe(1);
    expect(summary.archived).toBe(0);
    expect(client.items.archive).not.toHaveBeenCalled();
  });

  it("does not archive skipped items with includeState and skip strategy", async () => {
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

    const existing = makeLoginItem("existing-1", "Archived Note", "");
    existing.category = ItemCategory.SecureNote;
    existing.fields = [];
    existing.websites = [];

    const { client } = createMockClient({ items: [existing] });
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      includeState: true,
    });

    expect(summary.skipped).toBe(1);
    expect(summary.archived).toBe(0);
    expect(client.items.archive).not.toHaveBeenCalled();
  });

  it("archives state-only diff under merge and includeState", async () => {
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

    const parsed = parseExport(dir);
    const bwItem = parsed.items[0]!;
    const mapped = mapper.map(bwItem, parsed, "vault-1");
    const existing = makeLoginItem("existing-1", "Archived Note", "");
    existing.category = ItemCategory.SecureNote;
    existing.fields = mapped.params.fields ?? [];
    existing.sections = mapped.params.sections ?? [];
    existing.notes = mapped.params.notes ?? "";
    existing.tags = mapped.params.tags ?? [];
    existing.websites = mapped.params.websites ?? [];

    const { client } = createMockClient({ items: [existing] });
    const summary = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      includeState: true,
    });

    expect(summary.unchanged).toBe(1);
    expect(summary.updated).toBe(0);
    expect(client.items.put).not.toHaveBeenCalled();
    expect(client.items.archive).toHaveBeenCalledTimes(1);
    expect(client.items.archive).toHaveBeenCalledWith("vault-1", "existing-1");
  });

  it("does not recreate items on a second run without includeState", async () => {
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

    const { client } = createMockClient();
    const first = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
    });
    expect(first.created).toBe(1);
    expect(first.archived).toBe(0);

    const second = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
    });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(client.items.createAll).toHaveBeenCalledTimes(1);
    expect(client.items.archive).not.toHaveBeenCalled();
  });

  it("archives on phase two with merge and includeState", async () => {
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

    const { client } = createMockClient();
    await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
    });

    const second = await migrate(client, {
      bwDir: dir,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      includeState: true,
    });

    expect(second.unchanged).toBe(1);
    expect(second.archived).toBe(1);
    expect(client.items.archive).toHaveBeenCalledTimes(1);
    expect(client.items.archive).toHaveBeenCalledWith("vault-1", "created-1");
  });
});
