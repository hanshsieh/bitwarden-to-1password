import type { MergeStrategy } from "../onepassword/types.js";
import { createClient } from "../onepassword/client.js";
import { migrate } from "../onepassword/migrator.js";
import { resolveVault } from "../onepassword/vault-resolver.js";

export interface MigrateCommandOptions {
  bwDir: string;
  mergeStrategy: MergeStrategy;
  dryRun: boolean;
  vault?: string;
}

/** Run the migrate subcommand. */
export async function runMigrate(
  options: MigrateCommandOptions,
): Promise<number> {
  const client = await createClient();
  const vault = await resolveVault(client, options.vault);

  console.log(`Target vault: ${vault.title} (${vault.id})`);

  const summary = await migrate(client, {
    bwDir: options.bwDir,
    vaultId: vault.id,
    mergeStrategy: options.mergeStrategy,
    dryRun: options.dryRun,
  });

  return summary.aborted ? 1 : 0;
}
