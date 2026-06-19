import { describe, expect, it } from "vitest";
import { ItemCategory } from "@1password/sdk";
import type { ItemCreateParams, ItemsGetAllResponse } from "@1password/sdk";
import {
  OP_ITEMS_CREATE_ALL_BATCH_SIZE,
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
        createAll: async () => {
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

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(OP_ITEMS_GET_ALL_BATCH_SIZE);
    expect(batches[1]).toHaveLength(25);
  });

  it("batches createAll requests at 100 items", async () => {
    const batches: ItemCreateParams[][] = [];
    const baseClient: OnePasswordClient = {
      vaults: {
        list: async () => [],
      },
      items: {
        list: async () => [],
        get: async () => {
          throw new Error("not used");
        },
        getAll: async () => ({ individualResponses: [] }),
        create: async () => {
          throw new Error("not used");
        },
        createAll: async (_vaultId, params) => {
          batches.push([...params]);
          return {
            individualResponses: params.map(() => ({
              error: { type: "internal" as const, message: "not used" },
            })),
          };
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

    const params: ItemCreateParams[] = Array.from(
      { length: 150 },
      (_value, index) => ({
        category: ItemCategory.Login,
        vaultId: "vault-1",
        title: `Item ${index}`,
      }),
    );
    const client = createRateLimitedClient(baseClient, {
      readsPerHour: 10_000,
      writesPerHour: 1_000,
    });

    await client.items.createAll("vault-1", params);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(OP_ITEMS_CREATE_ALL_BATCH_SIZE);
    expect(batches[1]).toHaveLength(50);
  });
});
