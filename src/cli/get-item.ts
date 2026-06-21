import { OnePasswordClientFactory } from "../onepassword/client.js";
import { VaultResolver } from "../onepassword/vault-resolver.js";

export interface GetItemCommandOptions {
  vault: string;
  item: string;
}

/**
 * CLI handler for the `get-item` subcommand.
 *
 * Authenticates with 1Password, resolves the target vault and item, and
 * prints the full item as pretty-printed JSON.
 */
export class GetItemCommand {
  constructor(
    private readonly clientFactory = new OnePasswordClientFactory(),
  ) {}

  /** @returns Process exit code (always 0 unless an error is thrown). */
  async run(options: GetItemCommandOptions): Promise<number> {
    const client = await this.clientFactory.create();
    const vault = await new VaultResolver(client).resolve(options.vault);
    const item = await client.items.get(vault.id, options.item);

    console.log(JSON.stringify(item, null, 2));
    return 0;
  }
}

/** Run the get-item subcommand using a default command instance. */
export async function runGetItem(
  options: GetItemCommandOptions,
): Promise<number> {
  return new GetItemCommand().run(options);
}
