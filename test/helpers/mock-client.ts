import {
  ItemCategory,
  ItemFieldType,
  ItemState,
  type FileCreateParams,
  type Item,
  type ItemCreateParams,
  type ItemOverview,
  type ItemsDeleteAllResponse,
  type ItemsGetAllResponse,
  type VaultOverview,
} from "@1password/sdk";
import type { OnePasswordClient } from "../../src/onepassword/types.js";

export interface MockClientState {
  vaults: VaultOverview[];
  items: Map<string, Item>;
  overviews: ItemOverview[];
  createCalls: ItemCreateParams[];
  putCalls: Item[];
  deleteCalls: string[];
  archiveCalls: string[];
  attachCalls: FileCreateParams[];
}

function normalizeItems(
  items?: Map<string, Item> | Item[],
): Map<string, Item> {
  if (!items) return new Map();
  if (items instanceof Map) return items;
  return new Map(items.map((item) => [item.id, item]));
}

export function createMockClient(
  initial?: Partial<Omit<MockClientState, "items">> & {
    items?: Map<string, Item> | Item[];
  },
): { client: OnePasswordClient; state: MockClientState } {
  const state: MockClientState = {
    vaults: initial?.vaults ?? [
      {
        id: "vault-1",
        title: "Personal",
        description: "",
        vaultType: "userCreated" as VaultOverview["vaultType"],
        activeItemCount: 0,
        contentVersion: 1,
        attributeVersion: 1,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
    ],
    items: normalizeItems(initial?.items),
    overviews: initial?.overviews ?? [],
    createCalls: [],
    putCalls: [],
    deleteCalls: [],
    archiveCalls: [],
    attachCalls: [],
  };

  if (state.items.size > 0 && state.overviews.length === 0) {
    state.overviews = [...state.items.values()].map(itemToOverview);
  }

  const client: OnePasswordClient = {
    vaults: {
      list: async () => state.vaults,
    },
    items: {
      list: async (_vaultId) => state.overviews,
      get: async (_vaultId, itemId) => {
        const item = state.items.get(itemId);
        if (!item) throw new Error(`Item not found: ${itemId}`);
        return structuredClone(item);
      },
      getAll: async (_vaultId, itemIds) => {
        const individualResponses: ItemsGetAllResponse["individualResponses"] =
          itemIds.map((id) => {
            const item = state.items.get(id);
            if (!item) {
              return { error: { type: "itemNotFound" as const } };
            }
            return { content: structuredClone(item) };
          });
        return { individualResponses };
      },
      create: async (params) => {
        state.createCalls.push(params);
        const item: Item = {
          id: `created-${state.createCalls.length}`,
          title: params.title,
          category: params.category,
          vaultId: params.vaultId,
          fields: params.fields ?? [],
          sections: params.sections ?? [],
          notes: params.notes ?? "",
          tags: params.tags ?? [],
          websites: params.websites ?? [],
          version: 1,
          files: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.items.set(item.id, item);
        state.overviews.push(itemToOverview(item));
        return structuredClone(item);
      },
      put: async (item) => {
        state.putCalls.push(structuredClone(item));
        state.items.set(item.id, structuredClone(item));
        const idx = state.overviews.findIndex((o) => o.id === item.id);
        if (idx >= 0) state.overviews[idx] = itemToOverview(item);
        return structuredClone(item);
      },
      delete: async (_vaultId, itemId) => {
        state.deleteCalls.push(itemId);
        state.items.delete(itemId);
        state.overviews = state.overviews.filter((o) => o.id !== itemId);
      },
      deleteAll: async (_vaultId, itemIds) => {
        const individualResponses: ItemsDeleteAllResponse["individualResponses"] =
          {};
        for (const id of itemIds) {
          state.deleteCalls.push(id);
          state.items.delete(id);
          state.overviews = state.overviews.filter((o) => o.id !== id);
          individualResponses[id] = { content: undefined };
        }
        return { individualResponses };
      },
      archive: async (_vaultId, itemId) => {
        state.archiveCalls.push(itemId);
        const idx = state.overviews.findIndex((o) => o.id === itemId);
        if (idx >= 0) {
          state.overviews[idx] = {
            ...state.overviews[idx]!,
            state: ItemState.Archived,
          };
        }
      },
      files: {
        attach: async (item, fileParams) => {
          state.attachCalls.push(fileParams);
          const updated = structuredClone(item);
          updated.files.push({
            attributes: {
              id: `file-${state.attachCalls.length}`,
              name: fileParams.name,
              size: fileParams.content.length,
            },
            sectionId: fileParams.sectionId,
            fieldId: fileParams.fieldId,
          });
          state.items.set(updated.id, updated);
          return updated;
        },
      },
    },
  };

  return { client, state };
}

export function itemToOverview(item: Item): ItemOverview {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    vaultId: item.vaultId,
    websites: item.websites,
    tags: item.tags,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    state: ItemState.Active,
  };
}

export function makeOverview(
  partial: Partial<ItemOverview> & Pick<ItemOverview, "id" | "title">,
): ItemOverview {
  return {
    category: ItemCategory.Login,
    vaultId: "vault-1",
    websites: [],
    tags: [],
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-06-01"),
    state: ItemState.Active,
    ...partial,
  };
}

export function makeLoginItem(
  id: string,
  title: string,
  username: string,
  vaultId = "vault-1",
): Item {
  return {
    id,
    title,
    category: ItemCategory.Login,
    vaultId,
    fields: [
      {
        id: "username",
        title: "username",
        fieldType: ItemFieldType.Text,
        value: username,
      },
    ],
    sections: [],
    notes: "",
    tags: [],
    websites: [
      {
        url: "https://existing.example.com",
        label: "website",
        autofillBehavior: "AnywhereOnWebsite" as const,
      },
    ],
    version: 1,
    files: [],
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-06-01"),
  };
}
