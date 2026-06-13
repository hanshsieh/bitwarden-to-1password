import type {
  FileCreateParams,
  Item,
  ItemCategory,
  ItemCreateParams,
  ItemField,
  ItemFieldType,
  ItemOverview,
  ItemsDeleteAllResponse,
  ItemsGetAllResponse,
  ItemSection,
  VaultOverview,
} from "@1password/sdk";
import type { BitwardenAttachment } from "../bitwarden/types.js";

export interface OnePasswordClient {
  vaults: {
    list(): Promise<VaultOverview[]>;
  };
  items: {
    list(vaultId: string): Promise<ItemOverview[]>;
    get(vaultId: string, itemId: string): Promise<Item>;
    getAll(vaultId: string, itemIds: string[]): Promise<ItemsGetAllResponse>;
    create(params: ItemCreateParams): Promise<Item>;
    put(item: Item): Promise<Item>;
    delete(vaultId: string, itemId: string): Promise<void>;
    deleteAll(
      vaultId: string,
      itemIds: string[],
    ): Promise<ItemsDeleteAllResponse>;
    files: {
      attach(item: Item, fileParams: FileCreateParams): Promise<Item>;
    };
  };
}

export type MergeStrategy = "skip" | "merge" | "abort";

export type MergeAction = "create" | "merge" | "skip" | "abort";

export interface MergeDecision {
  action: MergeAction;
  targetItemId?: string;
  warning?: string;
}

export interface MigrationSummary {
  created: number;
  merged: number;
  skipped: number;
  failed: number;
  attachmentsUploaded: number;
  attachmentFailures: number;
  aborted: boolean;
}

export interface PurgeSummary {
  deleted: number;
  failed: number;
  dryRun: boolean;
}

export interface MappedItem {
  params: ItemCreateParams;
  attachments: BitwardenAttachment[];
  attachmentFieldIds: Map<string, string>;
}

export { ItemCategory, ItemFieldType };
export type { Item, ItemCreateParams, ItemField, ItemOverview, ItemSection };
