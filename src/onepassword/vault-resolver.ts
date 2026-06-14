import type { VaultOverview } from "@1password/sdk";
import { promptVaultChoice } from "../utils/prompt.js";
import type { OnePasswordClient } from "./types.js";

export interface ResolveVaultOptions {
  vaultHint?: string;
  interactive?: boolean;
}

/**
 * Selects the target 1Password vault for migrate and purge commands.
 *
 * Resolution order:
 * 1. Match `--vault` hint against vault ID or title (case-insensitive substring)
 * 2. Auto-select when the service account can access exactly one vault
 * 3. Prompt interactively when multiple vaults exist and no hint was given
 */
export class VaultResolver {
  constructor(private readonly client: OnePasswordClient) {}

  /**
   * Resolve the vault to operate on.
   *
   * @param vaultQueryOrOptions Vault hint string or structured options.
   * @throws When no vaults exist, hint matches zero or many vaults, or
   *         multiple vaults exist with interactive mode disabled.
   */
  async resolve(
    vaultQueryOrOptions?: string | ResolveVaultOptions,
  ): Promise<VaultOverview> {
    const options = this.normalizeOptions(vaultQueryOrOptions);
    const vaults = await this.client.vaults.list();

    if (vaults.length === 0) {
      throw new Error("No vaults accessible to the service account.");
    }

    const hint = options.vaultHint?.trim();
    if (hint) {
      return this.resolveByHint(vaults, hint);
    }

    if (vaults.length === 1) {
      return vaults[0]!;
    }

    return this.resolveInteractively(vaults, options.interactive);
  }

  /**
   * Filter vaults whose ID or title contains the hint (case-insensitive).
   */
  static filterByHint(
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

  private normalizeOptions(
    vaultQueryOrOptions?: string | ResolveVaultOptions,
  ): ResolveVaultOptions {
    if (typeof vaultQueryOrOptions === "string") {
      return { vaultHint: vaultQueryOrOptions };
    }
    return vaultQueryOrOptions ?? {};
  }

  private resolveByHint(
    vaults: VaultOverview[],
    hint: string,
  ): VaultOverview {
    const matches = VaultResolver.filterByHint(vaults, hint);
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

  private async resolveInteractively(
    vaults: VaultOverview[],
    interactive?: boolean,
  ): Promise<VaultOverview> {
    if (interactive === false) {
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
}
