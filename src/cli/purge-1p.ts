import { OnePasswordClientFactory } from "../onepassword/client.js";
import { VaultPurger } from "../onepassword/vault-purger.js";
import { VaultResolver } from "../onepassword/vault-resolver.js";

export interface PurgeCommandOptions {
  yes: boolean;
  dryRun: boolean;
  updatedOnOrAfter?: string;
  vault: string;
}

/**
 * CLI handler for the `purge-1p` subcommand.
 *
 * Authenticates with 1Password, resolves the target vault, parses optional
 * date filters, and delegates to {@link VaultPurger}.
 */
export class PurgeCommand {
  constructor(
    private readonly clientFactory = new OnePasswordClientFactory(),
  ) {}

  /** @returns Process exit code (always 0 unless an error is thrown). */
  async run(options: PurgeCommandOptions): Promise<number> {
    const client = await this.clientFactory.create();
    const vault = await new VaultResolver(client).resolve(options.vault);

    console.log(`Target vault: ${vault.title} (${vault.id})`);

    const updatedOnOrAfter = this.parseUpdatedOnOrAfter(
      options.updatedOnOrAfter,
    );

    await new VaultPurger(client).purge({
      vaultId: vault.id,
      updatedOnOrAfter,
      dryRun: options.dryRun,
      yes: options.yes,
    });

    return 0;
  }

  /** Parse ISO 8601 cutoff for `--updated-on-or-after`. */
  private parseUpdatedOnOrAfter(value?: string): Date | undefined {
    if (!value) return undefined;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid --updated-on-or-after value: ${value}`);
    }
    return date;
  }
}

/** Run the purge-1p subcommand using a default command instance. */
export async function runPurge(options: PurgeCommandOptions): Promise<number> {
  return new PurgeCommand().run(options);
}
