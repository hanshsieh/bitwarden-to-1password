import { createClient } from "../onepassword/client.js";
import { purgeVault } from "../onepassword/purge.js";
import { resolveVault } from "../onepassword/vault-resolver.js";

export interface PurgeCommandOptions {
  yes: boolean;
  dryRun: boolean;
  updatedOnOrAfter?: string;
  vault?: string;
}

/** Run the purge-1p subcommand. */
export async function runPurge(options: PurgeCommandOptions): Promise<number> {
  const client = await createClient();
  const vault = await resolveVault(client, options.vault);

  console.log(`Target vault: ${vault.title} (${vault.id})`);

  let updatedOnOrAfter: Date | undefined;
  if (options.updatedOnOrAfter) {
    updatedOnOrAfter = new Date(options.updatedOnOrAfter);
    if (Number.isNaN(updatedOnOrAfter.getTime())) {
      throw new Error(
        `Invalid --updated-on-or-after value: ${options.updatedOnOrAfter}`,
      );
    }
  }

  await purgeVault(client, {
    vaultId: vault.id,
    updatedOnOrAfter,
    dryRun: options.dryRun,
    yes: options.yes,
  });

  return 0;
}
