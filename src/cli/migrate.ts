import { OnePasswordClientFactory } from "../onepassword/client.js";
import { Migrator } from "../onepassword/migrator.js";
import { VaultResolver } from "../onepassword/vault-resolver.js";
import type { MergeStrategy } from "../onepassword/types.js";

export interface MigrateCommandOptions {
  bwDir: string;
  mergeStrategy: MergeStrategy;
  dryRun: boolean;
  vault: string;
}

/**
 * CLI handler for the `migrate` subcommand.
 *
 * Authenticates with 1Password, resolves the target vault, and delegates to
 * {@link Migrator}.
 */
export class MigrateCommand {
  constructor(
    private readonly clientFactory = new OnePasswordClientFactory(),
  ) {}

  /** @returns Process exit code (0 success, 1 when migration aborted). */
  async run(options: MigrateCommandOptions): Promise<number> {
    const client = await this.clientFactory.create();
    const vault = await new VaultResolver(client).resolve(options.vault);

    console.log(`Target vault: ${vault.title} (${vault.id})`);

    const summary = await new Migrator(client).migrate({
      bwDir: options.bwDir,
      vaultId: vault.id,
      mergeStrategy: options.mergeStrategy,
      dryRun: options.dryRun,
    });

    return summary.aborted ? 1 : 0;
  }
}

/** Run the migrate subcommand using a default command instance. */
export async function runMigrate(
  options: MigrateCommandOptions,
): Promise<number> {
  return new MigrateCommand().run(options);
}
