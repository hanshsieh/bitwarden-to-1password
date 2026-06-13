import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ItemCategory, ItemState } from "@1password/sdk";
import { purgeVault } from "../../src/onepassword/vault-purger.js";
import { createMockClient, itemToOverview, makeLoginItem } from "../helpers/mock-client.js";

describe("purge", () => {
  it("dry-run lists items without deleting", async () => {
    const item = makeLoginItem("item-1", "One", "user@example.com");
    const { client } = createMockClient({
      items: new Map([["item-1", item]]),
      overviews: [itemToOverview(item)],
    });

    const result = await purgeVault(client, {
      vaultId: "vault-1",
      yes: false,
      dryRun: true,
    });

    assert.equal(result.matched, 1);
    assert.equal(result.deleted, 0);

    const remaining = await client.items.list("vault-1");
    assert.equal(remaining.length, 1);
  });

  it("filters by updated-on-or-after date", async () => {
    const oldItem = makeLoginItem("old", "Old", "old@example.com");
    oldItem.updatedAt = new Date("2024-01-01T00:00:00Z");
    const newItem = makeLoginItem("new", "New", "new@example.com");
    newItem.updatedAt = new Date("2024-06-15T00:00:00Z");

    const { client } = createMockClient({
      items: new Map([
        ["old", oldItem],
        ["new", newItem],
      ]),
      overviews: [itemToOverview(oldItem), itemToOverview(newItem)],
    });

    const result = await purgeVault(client, {
      vaultId: "vault-1",
      yes: true,
      dryRun: false,
      updatedOnOrAfter: new Date("2024-06-01T00:00:00Z"),
    });

    assert.equal(result.deleted, 1);
    const remaining = await client.items.list("vault-1");
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.id, "old");
  });

  it("deletes all items when confirmed with --yes", async () => {
    const item = makeLoginItem("item-1", "One", "user@example.com");
    const { client } = createMockClient({
      items: new Map([["item-1", item]]),
      overviews: [itemToOverview(item)],
    });

    const result = await purgeVault(client, {
      vaultId: "vault-1",
      yes: true,
      dryRun: false,
    });

    assert.equal(result.deleted, 1);
    assert.equal(result.failed, 0);
    assert.equal((await client.items.list("vault-1")).length, 0);
  });
});
