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

const DELETE_BATCH_SIZE = 50;

/** List items in a vault, optionally filtered by updatedAt. */
export function filterItemsByDate(
  items: ItemOverview[],
  updatedOnOrAfter?: Date,
): ItemOverview[] {
  if (!updatedOnOrAfter) return items;
  return items.filter((item) => item.updatedAt >= updatedOnOrAfter);
}

/** Purge items from a 1Password vault. */
export async function purgeVault(
  client: OnePasswordClient,
  options: PurgeOptions,
): Promise<PurgeResult> {
  const allItems = await client.items.list(options.vaultId);
  const items = filterItemsByDate(allItems, options.updatedOnOrAfter);

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

  console.log(`${items.length} item(s) matched:`);
  for (const item of items) {
    console.log(`  - ${item.title} (${item.id}) updated ${item.updatedAt.toISOString()}`);
  }

  if (options.dryRun) {
    console.log("[dry-run] No items deleted.");
    return result;
  }

  const confirmFn =
    options.confirm ??
    (async () => {
      const { promptYesConfirmation } = await import("../utils/prompt.js");
      return promptYesConfirmation(
        `Delete ${items.length} item(s) from vault ${options.vaultId}?`,
      );
    });

  if (!options.yes) {
    const confirmed = await confirmFn();
    if (!confirmed) {
      console.log("Purge cancelled.");
      return result;
    }
  }

  const ids = items.map((i) => i.id);
  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    const batch = ids.slice(i, i + DELETE_BATCH_SIZE);
    const response = await client.items.deleteAll(options.vaultId, batch);

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

  console.log(
    `Purge complete: deleted=${result.deleted} failed=${result.failed}`,
  );
  return result;
}
