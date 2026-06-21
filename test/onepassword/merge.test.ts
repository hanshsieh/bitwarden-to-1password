import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ItemCategory, ItemFieldType, ItemState } from "@1password/sdk";
import { parseExport } from "../../src/bitwarden/export-parser.js";
import { MergeEngine, type MatchIndex } from "../../src/onepassword/merge-engine.js";
import {
  DEFAULT_SECTION,
  DEFAULT_SECTION_ID,
  OnePasswordItemMapper,
} from "../../src/onepassword/item-mapper.js";
import {
  createMockClient,
  makeLoginItem,
  makeOverview,
} from "../helpers/mock-client.js";

const FIXTURES = join(import.meta.dirname, "../fixtures/exports/personal-vault");

describe("merge engine", () => {
  const parsed = parseExport(FIXTURES);
  const loginItem = parsed.items.find((i) => i.name === "Example Login")!;
  const mapper = new OnePasswordItemMapper();

  it("builds a match index by category, title, and username", async () => {
    const { client } = createMockClient({
      items: [makeLoginItem("existing-1", "Example Login", "user@example.com")],
    });

    const matchIndex = await new MergeEngine(client).buildIndex(
      "vault-1",
      new Set(["Example Login"]),
    );
    const key = MergeEngine.buildMatchKey(
      ItemCategory.Login,
      "Example Login",
      "user@example.com",
    );
    expect(matchIndex.index.get(key)).toEqual(["existing-1"]);
    expect(matchIndex.itemsById.get("existing-1")?.title).toBe("Example Login");
  });

  it("excludes archived vault items from the match index", async () => {
    const archivedItem = makeLoginItem(
      "archived-1",
      "Archived Login",
      "user@example.com",
    );
    const activeItem = makeLoginItem(
      "active-1",
      "Active Login",
      "user@example.com",
    );
    const { client } = createMockClient({
      items: [archivedItem, activeItem],
      overviews: [
        makeOverview({
          id: "archived-1",
          title: "Archived Login",
          state: ItemState.Archived,
        }),
        makeOverview({
          id: "active-1",
          title: "Active Login",
          state: ItemState.Active,
        }),
      ],
    });

    const matchIndex = await new MergeEngine(client).buildIndex(
      "vault-1",
      new Set(["Archived Login", "Active Login"]),
    );
    const archivedKey = MergeEngine.buildMatchKey(
      ItemCategory.Login,
      "Archived Login",
      "user@example.com",
    );
    const activeKey = MergeEngine.buildMatchKey(
      ItemCategory.Login,
      "Active Login",
      "user@example.com",
    );
    expect(matchIndex.index.get(archivedKey)).toBeUndefined();
    expect(matchIndex.index.get(activeKey)).toEqual(["active-1"]);
  });

  it("lists only active items when building index", async () => {
    const activeItem = makeLoginItem(
      "active-1",
      "Shared Title",
      "user@example.com",
    );
    const { client } = createMockClient({
      items: [activeItem],
      overviews: [
        makeOverview({
          id: "archived-1",
          title: "Shared Title",
          state: ItemState.Archived,
        }),
        makeOverview({
          id: "active-1",
          title: "Shared Title",
          state: ItemState.Active,
        }),
      ],
    });

    const matchIndex = await new MergeEngine(client).buildIndex(
      "vault-1",
      new Set(["Shared Title"]),
    );
    const key = MergeEngine.buildMatchKey(
      ItemCategory.Login,
      "Shared Title",
      "user@example.com",
    );
    expect(matchIndex.index.get(key)).toEqual(["active-1"]);
    expect(client.items.getAll).toHaveBeenCalledWith("vault-1", ["active-1"]);
  });

  it("title-filters getAll to export titles", async () => {
    const relevant = makeLoginItem(
      "relevant-1",
      "Example Login",
      "user@example.com",
    );
    const extra = makeLoginItem(
      "extra-1",
      "Unrelated Item",
      "other@example.com",
    );
    const { client } = createMockClient({
      items: [relevant, extra],
    });

    await new MergeEngine(client).buildIndex(
      "vault-1",
      new Set(["Example Login"]),
    );

    expect(client.items.getAll).toHaveBeenCalledWith("vault-1", ["relevant-1"]);
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

  it("consumeMatch removes a claimed item from the index", () => {
    const key = MergeEngine.buildMatchKey(
      ItemCategory.Login,
      "Example Login",
      "user@example.com",
    );
    const matchIndex: MatchIndex = {
      index: new Map([[key, ["existing-1", "existing-2"]]]),
      itemsById: new Map(),
      statesById: new Map(),
    };

    new MergeEngine(createMockClient().client).consumeMatch(
      matchIndex,
      loginItem,
      "existing-1",
    );

    expect(matchIndex.index.get(key)).toEqual(["existing-2"]);

    new MergeEngine(createMockClient().client).consumeMatch(
      matchIndex,
      loginItem,
      "existing-2",
    );

    expect(matchIndex.index.get(key)).toBeUndefined();
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

  it("itemsMatchDesired requires matching section ids and order", () => {
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

    synced.sections = [{ id: "section_auto", title: "" }];
    synced.fields = synced.fields.map((field) =>
      field.id.startsWith("cust_")
        ? { ...field, sectionId: "section_auto" }
        : field,
    );

    expect(MergeEngine.itemsMatchDesired(synced, desired)).toBe(false);
  });

  it("itemsMatchDesired compares Address field details", () => {
    const addressField = {
      id: "address",
      title: "Address",
      fieldType: ItemFieldType.Address,
      value: "",
      details: {
        type: "Address" as const,
        content: {
          street: "123 Main St",
          city: "Springfield",
          state: "IL",
          zip: "62701",
          country: "US",
        },
      },
    };

    const existing = makeLoginItem("existing-1", "Identity", "user@example.com");
    const desired = MergeEngine.buildDesiredItem(existing, {
      category: ItemCategory.Identity,
      vaultId: "vault-1",
      title: "Identity",
      fields: [addressField],
    });

    existing.category = desired.category;
    existing.fields = structuredClone(desired.fields);
    existing.sections = desired.sections;
    existing.notes = desired.notes;
    existing.tags = desired.tags;
    existing.websites = desired.websites;

    expect(MergeEngine.itemsMatchDesired(existing, desired)).toBe(true);

    existing.fields[0] = {
      ...existing.fields[0]!,
      details: {
        type: "Address",
        content: {
          street: "456 Oak Ave",
          city: "Springfield",
          state: "IL",
          zip: "62701",
          country: "US",
        },
      },
    };
    expect(MergeEngine.itemsMatchDesired(existing, desired)).toBe(false);
  });

  it("itemsMatchDesired rejects fields with different section ids", () => {
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

    synced.fields = synced.fields.map((field) =>
      field.id.startsWith("cust_")
        ? { ...field, sectionId: "other_section" }
        : field,
    );

    expect(MergeEngine.itemsMatchDesired(synced, desired)).toBe(false);
  });

  it("itemsMatchDesired rejects sections with different titles", () => {
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

    synced.sections = [{ id: DEFAULT_SECTION_ID, title: "Other" }];

    expect(MergeEngine.itemsMatchDesired(synced, desired)).toBe(false);
  });

  it("itemContentMatchesDesired compares sections by id, title, and order", () => {
    const existing = makeLoginItem("existing-1", "Login", "user@example.com");
    const desired = MergeEngine.buildDesiredItem(existing, {
      category: ItemCategory.Login,
      vaultId: "vault-1",
      title: "Login",
      sections: [DEFAULT_SECTION],
    });

    existing.fields = desired.fields;
    existing.websites = desired.websites;
    existing.notes = desired.notes;
    existing.tags = desired.tags;
    existing.sections = [{ id: DEFAULT_SECTION_ID, title: "Wrong Title" }];

    expect(MergeEngine.itemContentMatchesDesired(existing, desired)).toBe(false);

    existing.sections = [{ id: "server_assigned", title: DEFAULT_SECTION.title }];
    expect(MergeEngine.itemContentMatchesDesired(existing, desired)).toBe(false);

    existing.sections = [DEFAULT_SECTION];
    expect(MergeEngine.itemContentMatchesDesired(existing, desired)).toBe(true);

    existing.sections = [
      { id: "extra", title: "Extra" },
      DEFAULT_SECTION,
    ];
    expect(MergeEngine.itemContentMatchesDesired(existing, desired)).toBe(false);
  });

  it("itemsMatchDesired compares archive state when provided", () => {
    const existing = makeLoginItem("a", "Login", "user@example.com");
    const desired = MergeEngine.buildDesiredItem(existing, {
      category: ItemCategory.Login,
      vaultId: "vault-1",
      title: "Login",
      sections: [DEFAULT_SECTION],
    });

    existing.fields = desired.fields;
    existing.websites = desired.websites;
    existing.notes = desired.notes;
    existing.tags = desired.tags;
    existing.sections = desired.sections;

    expect(
      MergeEngine.itemsMatchDesired(existing, desired, {
        actualState: ItemState.Active,
        desiredState: ItemState.Archived,
      }),
    ).toBe(false);

    expect(
      MergeEngine.itemsMatchDesired(existing, desired, {
        actualState: ItemState.Archived,
        desiredState: ItemState.Archived,
      }),
    ).toBe(true);
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
        sections: [DEFAULT_SECTION],
      },
      [
        {
          attributes: { id: "file-1", name: "readme.txt", size: 5 },
          sectionId: DEFAULT_SECTION_ID,
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
      sectionId: DEFAULT_SECTION_ID,
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
