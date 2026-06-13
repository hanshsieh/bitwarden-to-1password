import { OnePasswordClientFactory } from "../onepassword/client.js";

/**
 * CLI handler for the `list-vaults` subcommand.
 *
 * Authenticates with 1Password and prints vaults accessible to the service
 * account.
 */
export class ListVaultsCommand {
  constructor(
    private readonly clientFactory = new OnePasswordClientFactory(),
  ) {}

  /** @returns Process exit code (always 0 unless an error is thrown). */
  async run(): Promise<number> {
    const client = await this.clientFactory.create();
    const vaults = await client.vaults.list();

    if (vaults.length === 0) {
      console.log("No vaults accessible to the service account.");
      return 0;
    }

    console.log(
      `Vaults accessible to the service account (${vaults.length}):\n`,
    );

    for (const vault of vaults) {
      console.log(`  ${vault.title} (${vault.id})`);
    }

    return 0;
  }
}

/** Run the list-vaults subcommand using a default command instance. */
export async function runListVaults(): Promise<number> {
  return new ListVaultsCommand().run();
}
