import { createClient as createSdkClient, type Client } from "@1password/sdk";
import { createRateLimitedClient } from "./rate-limited-client.js";
import type { OnePasswordClient } from "./types.js";

/**
 * Creates authenticated {@link OnePasswordClient} instances from environment
 * configuration (`OP_SERVICE_ACCOUNT_TOKEN`).
 */
export class OnePasswordClientFactory {
  private readonly integrationName: string;
  private readonly integrationVersion: string;

  constructor(
    integrationName = "bitwarden-to-1password",
    integrationVersion = "0.1.0",
  ) {
    this.integrationName = integrationName;
    this.integrationVersion = integrationVersion;
  }

  /**
   * Build a client using `OP_SERVICE_ACCOUNT_TOKEN` from the environment.
   *
   * @throws When the service account token is not configured.
   */
  async create(): Promise<OnePasswordClient> {
    const token = process.env.OP_SERVICE_ACCOUNT_TOKEN;
    if (!token) {
      throw new Error(
        "Missing OP_SERVICE_ACCOUNT_TOKEN. Set it in your environment or .env file.",
      );
    }

    const client = await createSdkClient({
      auth: token,
      integrationName: this.integrationName,
      integrationVersion: this.integrationVersion,
    });

    return createRateLimitedClient(client as unknown as OnePasswordClient);
  }

  /** Wrap an existing SDK client for dependency injection in tests. */
  wrap(client: Client, rateLimited = false): OnePasswordClient {
    const wrapped = client as unknown as OnePasswordClient;
    return rateLimited ? createRateLimitedClient(wrapped) : wrapped;
  }
}

const defaultFactory = new OnePasswordClientFactory();

/** Create a client via the default factory. */
export async function createClient(): Promise<OnePasswordClient> {
  return defaultFactory.create();
}

export function wrapClient(client: Client, rateLimited = false): OnePasswordClient {
  return defaultFactory.wrap(client, rateLimited);
}
