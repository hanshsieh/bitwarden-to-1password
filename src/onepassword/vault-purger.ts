import type { ItemOverview } from "@1password/sdk";
import type { OnePasswordClient } from "./types.js";

export interface PurgeOptions {
  vaultId: string;
  updatedOnOrAfter?: Date;
  dryRun: boolean;
  yes: boolean;
  confirm?: () => Promise<boolean>;
}

export interface PurgeResult {
  matched: number;
  deleted: number;
  failed: number;
  items: ItemOverview[];
}

/** Maximum items per SDK batch delete call. */
const DELETE_BATCH_SIZE = 50;

/**
 * Deletes items from a 1Password vault, with optional date filtering,
 * dry-run preview, and interactive confirmation.
 */
export class VaultPurger {
  constructor(private readonly client: OnePasswordClient) {}

  /**
   * List matching items and optionally delete them from the vault.
   *
   * When `dryRun` is true, matched items are logged but never deleted and
   * confirmation is skipped.
   */
  async purge(options: PurgeOptions): Promise<PurgeResult> {
    const allItems = await this.client.items.list(options.vaultId);
    const items = VaultPurger.filterByUpdatedDate(
      allItems,
      options.updatedOnOrAfter,
    );

    const result: PurgeResult = {
      matched: items.length,
      deleted: 0,
      failed: 0,
      items,
    };

    if (items.length === 0) {
      console.log("No items matched the purge criteria.");
      return result;
    }

    this.logMatchedItems(items);

    if (options.dryRun) {
      console.log("[dry-run] No items deleted.");
      return result;
    }

    const confirmed = await this.confirmDeletion(options, items.length);
    if (!confirmed) {
      console.log("Purge cancelled.");
      return result;
    }

    await this.deleteInBatches(options.vaultId, items, result);
    console.log(
      `Purge complete: deleted=${result.deleted} failed=${result.failed}`,
    );
    return result;
  }

  /**
   * Keep only items whose `updatedAt` is on or after the cutoff date.
   * When no cutoff is provided, all active vault items match.
   */
  static filterByUpdatedDate(
    items: ItemOverview[],
    updatedOnOrAfter?: Date,
  ): ItemOverview[] {
    if (!updatedOnOrAfter) return items;
    return items.filter((item) => item.updatedAt >= updatedOnOrAfter);
  }

  private logMatchedItems(items: ItemOverview[]): void {
    console.log(`${items.length} item(s) matched:`);
    for (const item of items) {
      console.log(
        `  - ${item.title} (${item.id}) updated ${item.updatedAt.toISOString()}`,
      );
    }
  }

  /** Prompt unless `--yes` was passed or a custom confirm function is injected. */
  private async confirmDeletion(
    options: PurgeOptions,
    itemCount: number,
  ): Promise<boolean> {
    if (options.yes) return true;

    const confirmFn =
      options.confirm ??
      (async () => {
        const { promptYesConfirmation } = await import("../utils/prompt.js");
        return promptYesConfirmation(
          `Delete ${itemCount} item(s) from vault ${options.vaultId}?`,
        );
      });

    return confirmFn();
  }

  /** Delete items in fixed-size batches and tally per-item errors. */
  private async deleteInBatches(
    vaultId: string,
    items: ItemOverview[],
    result: PurgeResult,
  ): Promise<void> {
    const ids = items.map((i) => i.id);

    for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
      const batch = ids.slice(i, i + DELETE_BATCH_SIZE);
      const response = await this.client.items.deleteAll(vaultId, batch);

      for (const [itemId, individual] of Object.entries(
        response.individualResponses,
      )) {
        if (!individual.error) {
          result.deleted++;
        } else {
          result.failed++;
          const err = individual.error;
          const message =
            err && "message" in err && err.message
              ? err.message
              : err?.type ?? "unknown error";
          console.error(`delete failed: ${itemId} — ${message}`);
        }
      }
    }
  }
}
