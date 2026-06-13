import type { VaultOverview } from "@1password/sdk";
import { promptVaultChoice } from "../utils/prompt.js";
import type { OnePasswordClient } from "./types.js";

export interface ResolveVaultOptions {
  vaultHint?: string;
  interactive?: boolean;
}

/** Filter vaults by case-insensitive ID or title substring. */
export function filterVaultsByHint(
  vaults: VaultOverview[],
  hint: string,
): VaultOverview[] {
  const normalized = hint.trim().toLowerCase();
  if (!normalized) return vaults;

  return vaults.filter(
    (vault) =>
      vault.id.toLowerCase().includes(normalized) ||
      vault.title.toLowerCase().includes(normalized),
  );
}

/** Resolve target vault: --vault match, single vault, or interactive pick. */
export async function resolveVault(
  client: OnePasswordClient,
  vaultQueryOrOptions?: string | ResolveVaultOptions,
): Promise<VaultOverview> {
  const options: ResolveVaultOptions =
    typeof vaultQueryOrOptions === "string"
      ? { vaultHint: vaultQueryOrOptions }
      : (vaultQueryOrOptions ?? {});

  const vaults = await client.vaults.list();
  if (vaults.length === 0) {
    throw new Error("No vaults accessible to the service account.");
  }

  const hint = options.vaultHint?.trim();
  if (hint) {
    const matches = filterVaultsByHint(vaults, hint);
    if (matches.length === 0) {
      throw new Error(
        `No vault matches "${hint}". Available: ${vaults.map((v) => v.title).join(", ")}`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple vaults match "${hint}": ${matches.map((v) => `${v.title} (${v.id})`).join(", ")}`,
      );
    }
    return matches[0]!;
  }

  if (vaults.length === 1) {
    return vaults[0]!;
  }

  if (options.interactive === false) {
    throw new Error(
      `Multiple vaults found and --vault was not specified. Available: ${vaults.map((v) => v.title).join(", ")}`,
    );
  }

  const choice = await promptVaultChoice(
    vaults.map((v) => ({ id: v.id, title: v.title })),
  );
  const selected = vaults.find((v) => v.id === choice.id);
  if (!selected) {
    throw new Error(`Selected vault not found: ${choice.id}`);
  }
  return selected;
}
