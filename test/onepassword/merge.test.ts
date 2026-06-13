import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ItemCategory } from "@1password/sdk";
import { parseExport } from "../../src/bitwarden/export-parser.js";
import {
  buildMatchIndex,
  buildMatchKey,
  decideMergeAction,
  overlayItem,
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
      action: "merge",
      targetItemId: "a",
    });
    assert.deepEqual(decideMergeAction("abort", ["a"]), { action: "abort" });

    const multi = decideMergeAction("merge", ["a", "b"]);
    assert.equal(multi.action, "skip");
    assert.match(multi.warning ?? "", /Multiple matches/);
  });

  it("overlayItem merges notes, tags, and websites", () => {
    const existing = makeLoginItem(
      "existing-1",
      "Example Login",
      "user@example.com",
    );
    existing.notes = "Existing notes";
    existing.tags = ["Old"];

    const mapped = mapItem(loginItem, parsed, "vault-1");
    const merged = overlayItem(
      existing,
      mapped.params.fields ?? [],
      mapped.params.notes,
      mapped.params.tags,
      mapped.params.websites,
      mapped.params.sections,
    );

    assert.match(merged.notes, /Existing notes/);
    assert.match(merged.notes, /Login notes/);
    assert.ok(merged.tags.includes("Work"));
    assert.ok(merged.websites.some((w) => w.url === "https://example.com"));
    assert.ok(
      merged.websites.some((w) => w.url === "https://existing.example.com"),
    );
  });
});
