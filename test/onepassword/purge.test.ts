import { describe, expect, it } from "vitest";
import { VaultPurger } from "../../src/onepassword/vault-purger.js";
import { createMockClient, itemToOverview, makeLoginItem } from "../helpers/mock-client.js";

describe("purge", () => {
  it("dry-run lists items without deleting", async () => {
    const item = makeLoginItem("item-1", "One", "user@example.com");
    const { client } = createMockClient({
      items: new Map([["item-1", item]]),
      overviews: [itemToOverview(item)],
    });

    const result = await new VaultPurger(client).purge({
      vaultId: "vault-1",
      yes: false,
      dryRun: true,
    });

    expect(result.matched).toBe(1);
    expect(result.deleted).toBe(0);

    const remaining = await client.items.list("vault-1");
    expect(remaining).toHaveLength(1);
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

    const result = await new VaultPurger(client).purge({
      vaultId: "vault-1",
      yes: true,
      dryRun: false,
      updatedOnOrAfter: new Date("2024-06-01T00:00:00Z"),
    });

    expect(result.deleted).toBe(1);
    const remaining = await client.items.list("vault-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("old");
  });

  it("deletes all items when confirmed with --yes", async () => {
    const item = makeLoginItem("item-1", "One", "user@example.com");
    const { client } = createMockClient({
      items: new Map([["item-1", item]]),
      overviews: [itemToOverview(item)],
    });

    const result = await new VaultPurger(client).purge({
      vaultId: "vault-1",
      yes: true,
      dryRun: false,
    });

    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
    expect((await client.items.list("vault-1")).length).toBe(0);
  });
});
