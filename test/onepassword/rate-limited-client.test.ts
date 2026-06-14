import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemsGetAllResponse } from "@1password/sdk";
import {
  OP_ITEMS_GET_ALL_BATCH_SIZE,
  createRateLimitedClient,
} from "../../src/onepassword/rate-limited-client.js";
import type { OnePasswordClient } from "../../src/onepassword/types.js";

describe("rate-limited-client", () => {
  it("batches getAll requests at 50 item IDs", async () => {
    const batches: string[][] = [];
    const baseClient: OnePasswordClient = {
      vaults: {
        list: async () => [],
      },
      items: {
        list: async () => [],
        get: async () => {
          throw new Error("not used");
        },
        getAll: async (_vaultId, itemIds) => {
          batches.push([...itemIds]);
          const individualResponses: ItemsGetAllResponse["individualResponses"] =
            itemIds.map((id) => ({
              error: { type: "itemNotFound" as const },
            }));
          return { individualResponses };
        },
        create: async () => {
          throw new Error("not used");
        },
        put: async () => {
          throw new Error("not used");
        },
        delete: async () => undefined,
        deleteAll: async () => ({ individualResponses: {} }),
        archive: async () => undefined,
        files: {
          attach: async () => {
            throw new Error("not used");
          },
          delete: async () => {
            throw new Error("not used");
          },
        },
      },
    };

    const itemIds = Array.from({ length: 75 }, (_value, index) => `item-${index}`);
    const client = createRateLimitedClient(baseClient, {
      readsPerHour: 10_000,
      writesPerHour: 1_000,
    });

    await client.items.getAll("vault-1", itemIds);

    assert.equal(batches.length, 2);
    assert.equal(batches[0]?.length, OP_ITEMS_GET_ALL_BATCH_SIZE);
    assert.equal(batches[1]?.length, 25);
  });
});
