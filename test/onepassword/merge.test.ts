import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ItemCategory, ItemFieldType } from "@1password/sdk";
import { parseExport } from "../../src/bitwarden/export-parser.js";
import { MergeEngine } from "../../src/onepassword/merge-engine.js";
import {
  ATTACHMENTS_SECTION_ID,
  ATTACHMENTS_SECTION_TITLE,
  CUSTOM_FIELDS_SECTION_TITLE,
  OnePasswordItemMapper,
} from "../../src/onepassword/item-mapper.js";
import { createMockClient, makeLoginItem } from "../helpers/mock-client.js";

const FIXTURES = join(import.meta.dirname, "../fixtures/exports/personal-vault");

describe("merge engine", () => {
  const parsed = parseExport(FIXTURES);
  const loginItem = parsed.items.find((i) => i.name === "Example Login")!;
  const mapper = new OnePasswordItemMapper();

  it("builds a match index by category, title, and username", async () => {
    const { client } = createMockClient({
      items: [makeLoginItem("existing-1", "Example Login", "user@example.com")],
    });

    const matchIndex = await new MergeEngine(client).buildIndex("vault-1");
    const key = MergeEngine.buildMatchKey(
      ItemCategory.Login,
      "Example Login",
      "user@example.com",
    );
    expect(matchIndex.index.get(key)).toEqual(["existing-1"]);
    expect(matchIndex.itemsById.get("existing-1")?.title).toBe("Example Login");
  });

  it("decideMergeAction handles all strategies", () => {
    expect(MergeEngine.decide("skip", [])).toEqual({ action: "create" });
    expect(MergeEngine.decide("skip", ["a"])).toEqual({
      action: "skip",
      targetItemId: "a",
    });
    expect(MergeEngine.decide("merge", ["a"])).toEqual({
      action: "update",
      targetItemId: "a",
    });
    expect(MergeEngine.decide("abort", ["a"])).toEqual({ action: "abort" });

    const multi = MergeEngine.decide("merge", ["a", "b"]);
    expect(multi.action).toBe("skip");
    expect(multi.warning ?? "").toMatch(/Multiple matches/);
  });

  it("itemsMatchDesired compares fields strictly including order and ids", () => {
    const existing = makeLoginItem(
      "existing-1",
      "Example Login",
      "user@example.com",
    );
    const mapped = mapper.map(loginItem, parsed, "vault-1");
    const desired = MergeEngine.buildDesiredItem(
      existing,
      mapped.params,
      MergeEngine.expectedFilesFromMapped(mapped),
    );

    expect(MergeEngine.itemsMatchDesired(existing, desired)).toBe(false);

    const synced = MergeEngine.applyDesiredContent(structuredClone(existing), desired);
    expect(MergeEngine.itemsMatchDesired(synced, desired)).toBe(true);

    const reordered = structuredClone(synced);
    reordered.fields.reverse();
    expect(MergeEngine.itemsMatchDesired(reordered, desired)).toBe(false);

    const differentId = structuredClone(synced);
    differentId.fields[0] = { ...differentId.fields[0]!, id: "other" };
    expect(MergeEngine.itemsMatchDesired(differentId, desired)).toBe(false);
  });

  it("itemsMatchDesired matches fields in different sections when section titles match", () => {
    const existing = makeLoginItem(
      "existing-1",
      "Example Login",
      "user@example.com",
    );
    const mapped = mapper.map(loginItem, parsed, "vault-1");
    const desired = MergeEngine.buildDesiredItem(
      existing,
      mapped.params,
      MergeEngine.expectedFilesFromMapped(mapped),
    );
    const synced = MergeEngine.applyDesiredContent(structuredClone(existing), desired);

    synced.sections = (synced.sections ?? []).map((section) =>
      section.title === CUSTOM_FIELDS_SECTION_TITLE
        ? { ...section, id: "section_auto" }
        : section,
    );
    synced.fields = synced.fields.map((field) =>
      field.id.startsWith("cust_")
        ? { ...field, sectionId: "section_auto" }
        : field,
    );

    expect(MergeEngine.itemsMatchDesired(synced, desired)).toBe(true);
  });

  it("itemsMatchDesired rejects fields with different section titles", () => {
    const existing = makeLoginItem(
      "existing-1",
      "Example Login",
      "user@example.com",
    );
    const mapped = mapper.map(loginItem, parsed, "vault-1");
    const desired = MergeEngine.buildDesiredItem(
      existing,
      mapped.params,
      MergeEngine.expectedFilesFromMapped(mapped),
    );
    const synced = MergeEngine.applyDesiredContent(structuredClone(existing), desired);

    synced.sections = (synced.sections ?? []).map((section) =>
      section.title === CUSTOM_FIELDS_SECTION_TITLE
        ? { ...section, title: "Other" }
        : section,
    );

    expect(MergeEngine.itemsMatchDesired(synced, desired)).toBe(false);
  });

  it("itemContentMatchesDesired compares unreferenced sections by title", () => {
    const existing = makeLoginItem("existing-1", "Login", "user@example.com");
    const desired = MergeEngine.buildDesiredItem(existing, {
      category: ItemCategory.Login,
      vaultId: "vault-1",
      title: "Login",
      sections: [
        {
          id: ATTACHMENTS_SECTION_ID,
          title: ATTACHMENTS_SECTION_TITLE,
        },
      ],
    });

    existing.fields = desired.fields;
    existing.websites = desired.websites;
    existing.notes = desired.notes;
    existing.tags = desired.tags;
    existing.sections = [
      {
        id: ATTACHMENTS_SECTION_ID,
        title: "Wrong Title",
      },
    ];

    expect(MergeEngine.itemContentMatchesDesired(existing, desired)).toBe(false);

    existing.sections = [
      {
        id: "server_assigned",
        title: ATTACHMENTS_SECTION_TITLE,
      },
    ];
    expect(MergeEngine.itemContentMatchesDesired(existing, desired)).toBe(true);
  });

  it("itemsMatchDesired treats desired tags as a subset of actual tags", () => {
    const existing = makeLoginItem("a", "Login", "user@example.com");
    const desired = MergeEngine.buildDesiredItem(existing, {
      category: ItemCategory.Login,
      vaultId: "vault-1",
      title: "Login",
      tags: ["Work"],
    });

    existing.tags = ["Extra"];
    expect(MergeEngine.itemsMatchDesired(existing, desired)).toBe(false);

    existing.fields = desired.fields;
    existing.websites = desired.websites;
    existing.notes = desired.notes;
    existing.sections = desired.sections;
    existing.tags = ["Work", "Extra"];
    expect(MergeEngine.itemsMatchDesired(existing, desired)).toBe(true);

    existing.tags = ["Work", "雲端空間"];
    expect(MergeEngine.itemsMatchDesired(existing, desired)).toBe(true);
  });

  it("itemsMatchDesired compares attachment field IDs and section IDs", () => {
    const existing = makeLoginItem(
      "existing-1",
      "Example Login",
      "user@example.com",
    );
    const desired = MergeEngine.buildDesiredItem(
      existing,
      {
        category: ItemCategory.Login,
        vaultId: "vault-1",
        title: "Example Login",
        sections: [
          {
            id: ATTACHMENTS_SECTION_ID,
            title: ATTACHMENTS_SECTION_TITLE,
          },
        ],
      },
      [
        {
          attributes: { id: "file-1", name: "readme.txt", size: 5 },
          sectionId: ATTACHMENTS_SECTION_ID,
          fieldId: "attach_abc",
        },
      ],
    );

    existing.fields = desired.fields;
    existing.websites = desired.websites;
    existing.notes = desired.notes;
    existing.sections = desired.sections;
    existing.files = [];
    expect(MergeEngine.itemsMatchDesired(existing, desired)).toBe(false);

    existing.files = structuredClone(desired.files);
    expect(MergeEngine.itemsMatchDesired(existing, desired)).toBe(true);

    existing.files[0] = {
      ...existing.files[0]!,
      sectionId: "other_section",
    };
    expect(MergeEngine.itemsMatchDesired(existing, desired)).toBe(false);

    existing.files[0] = structuredClone(desired.files[0]!);
    existing.files.push({
      attributes: { id: "file-2", name: "extra.txt", size: 1 },
      sectionId: ATTACHMENTS_SECTION_ID,
      fieldId: "attach_def",
    });
    expect(MergeEngine.itemsMatchDesired(existing, desired)).toBe(false);
  });

  it("applyDesiredContent overwrites migratable fields", () => {
    const existing = makeLoginItem(
      "existing-1",
      "Example Login",
      "user@example.com",
    );
    existing.notes = "Old notes";
    existing.tags = ["Old"];
    existing.fields.push({
      id: "cust_0",
      title: "Secret PIN",
      fieldType: ItemFieldType.Concealed,
      value: "9999",
    });

    const mapped = mapper.map(loginItem, parsed, "vault-1");
    const desired = MergeEngine.buildDesiredItem(
      existing,
      mapped.params,
      MergeEngine.expectedFilesFromMapped(mapped),
    );
    const updated = MergeEngine.applyDesiredContent(structuredClone(existing), desired);

    expect(updated.notes).toBe("Login notes");
    expect(updated.tags).toEqual(["Work"]);
    expect(updated.fields.find((f) => f.id === "cust_1")?.value).toBe("1234");
    expect(
      updated.websites.some((w) => w.url === "https://existing.example.com"),
    ).toBe(false);
  });

  it("stripNonAsciiTags keeps only ASCII tags", () => {
    const item = makeLoginItem("a", "Login", "user@example.com");
    item.tags = ["Work", "雲端空間", "Team"];
    MergeEngine.stripNonAsciiTags(item);
    expect(item.tags).toEqual(["Work", "Team"]);
  });
});
