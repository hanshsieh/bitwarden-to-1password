import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ItemCategory, ItemFieldType } from "@1password/sdk";
import { parseExport } from "../../src/bitwarden/export-parser.js";
import {
  applyDesiredContent,
  buildDesiredItem,
  buildMatchIndex,
  buildMatchKey,
  decideMergeAction,
  itemsMatchDesired,
  stripNonAsciiTags,
} from "../../src/onepassword/merge-engine.js";
import { mapItem } from "../../src/onepassword/item-mapper.js";
import { createMockClient, makeLoginItem } from "../helpers/mock-client.js";

const FIXTURES = join(import.meta.dirname, "../fixtures/exports/personal-vault");

describe("merge engine", () => {
  const parsed = parseExport(FIXTURES);
  const loginItem = parsed.items.find((i) => i.name === "Example Login")!;

  it("builds a match index by category, title, and username", async () => {
    const { client } = createMockClient({
      items: [makeLoginItem("existing-1", "Example Login", "user@example.com")],
    });

    const matchIndex = await buildMatchIndex(client, "vault-1");
    const key = buildMatchKey(
      ItemCategory.Login,
      "Example Login",
      "user@example.com",
    );
    assert.deepEqual(matchIndex.index.get(key), ["existing-1"]);
  });

  it("decideMergeAction handles all strategies", () => {
    assert.deepEqual(decideMergeAction("skip", []), { action: "create" });
    assert.deepEqual(decideMergeAction("skip", ["a"]), {
      action: "skip",
      targetItemId: "a",
    });
    assert.deepEqual(decideMergeAction("merge", ["a"]), {
      action: "update",
      targetItemId: "a",
    });
    assert.deepEqual(decideMergeAction("abort", ["a"]), { action: "abort" });

    const multi = decideMergeAction("merge", ["a", "b"]);
    assert.equal(multi.action, "skip");
    assert.match(multi.warning ?? "", /Multiple matches/);
  });

  it("itemsMatchDesired compares fields strictly including order and ids", () => {
    const existing = makeLoginItem(
      "existing-1",
      "Example Login",
      "user@example.com",
    );
    const mapped = mapItem(loginItem, parsed, "vault-1");
    const desired = buildDesiredItem(existing, mapped.params);

    assert.equal(itemsMatchDesired(existing, desired), false);

    const synced = applyDesiredContent(structuredClone(existing), desired);
    assert.equal(itemsMatchDesired(synced, desired), true);

    const reordered = structuredClone(synced);
    reordered.fields.reverse();
    assert.equal(itemsMatchDesired(reordered, desired), false);

    const differentId = structuredClone(synced);
    differentId.fields[0] = { ...differentId.fields[0]!, id: "other" };
    assert.equal(itemsMatchDesired(differentId, desired), false);
  });

  it("itemsMatchDesired treats desired tags as a subset of actual tags", () => {
    const existing = makeLoginItem("a", "Login", "user@example.com");
    const desired = buildDesiredItem(existing, {
      category: ItemCategory.Login,
      vaultId: "vault-1",
      title: "Login",
      tags: ["Work"],
    });

    existing.tags = ["Extra"];
    assert.equal(itemsMatchDesired(existing, desired), false);

    existing.fields = desired.fields;
    existing.websites = desired.websites;
    existing.notes = desired.notes;
    existing.sections = desired.sections;
    existing.tags = ["Work", "Extra"];
    assert.equal(itemsMatchDesired(existing, desired), true);

    existing.tags = ["Work", "雲端空間"];
    assert.equal(itemsMatchDesired(existing, desired), true);
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

    const mapped = mapItem(loginItem, parsed, "vault-1");
    const desired = buildDesiredItem(existing, mapped.params);
    const updated = applyDesiredContent(structuredClone(existing), desired);

    assert.equal(updated.notes, "Login notes");
    assert.deepEqual(updated.tags, ["Work"]);
    assert.equal(
      updated.fields.find((f) => f.id === "cust_1")?.value,
      "1234",
    );
    assert.ok(
      !updated.websites.some((w) => w.url === "https://existing.example.com"),
    );
  });

  it("stripNonAsciiTags keeps only ASCII tags", () => {
    const item = makeLoginItem("a", "Login", "user@example.com");
    item.tags = ["Work", "雲端空間", "Team"];
    stripNonAsciiTags(item);
    assert.deepEqual(item.tags, ["Work", "Team"]);
  });
});
