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

/**
 * Minimal 1Password SDK surface used by this tool.
 *
 * Defined as an interface so unit tests can inject {@link createMockClient}
 * without calling the real API.
 */
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
    archive(vaultId: string, itemId: string): Promise<void>;
    files: {
      attach(item: Item, fileParams: FileCreateParams): Promise<Item>;
    };
  };
}

/** How to handle export items that may already exist in the target vault. */
export type MergeStrategy = "skip" | "merge" | "abort";

/** Outcome of evaluating one export item against the match index. */
export type MergeAction = "create" | "update" | "skip" | "abort";

export interface MergeDecision {
  action: MergeAction;
  targetItemId?: string;
  warning?: string;
}

/** Counters collected during a migration run. */
export interface MigrationSummary {
  created: number;
  /** Existing vault items overwritten to match the export. */
  updated: number;
  /** Matched items that already matched the desired export state. */
  unchanged: number;
  skipped: number;
  failed: number;
  attachmentsUploaded: number;
  attachmentFailures: number;
  archived: number;
  archiveFailures: number;
  /** Login item names whose FIDO2 credentials could not be migrated. */
  fidoCredentialsSkipped: string[];
  /** Item names with linked custom fields omitted (1Password has no equivalent). */
  linkedFieldsSkipped: string[];
  /** Item names where non-ASCII tags were omitted when writing to 1Password. */
  nonAsciiTagsSkipped: string[];
  /** Login item names with regex URIs mapped to Never autofill for manual review. */
  regexUrlItems: string[];
  aborted: boolean;
}

export interface PurgeSummary {
  deleted: number;
  failed: number;
  dryRun: boolean;
}

/** Result of mapping one Bitwarden cipher before create/merge. */
export interface MappedItem {
  params: ItemCreateParams;
  attachments: BitwardenAttachment[];
  attachmentFieldIds: Map<string, string>;
}

export { ItemCategory, ItemFieldType };
export type { Item, ItemCreateParams, ItemField, ItemOverview, ItemSection };
