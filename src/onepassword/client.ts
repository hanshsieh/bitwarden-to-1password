import { createClient as createSdkClient, type Client } from "@1password/sdk";
import type { OnePasswordClient } from "./types.js";

/** Create an authenticated 1Password SDK client wrapper. */
export async function createClient(): Promise<OnePasswordClient> {
  const token = process.env.OP_SERVICE_ACCOUNT_TOKEN;
  if (!token) {
    throw new Error(
      "Missing OP_SERVICE_ACCOUNT_TOKEN. Set it in your environment or .env file.",
    );
  }

  const client = await createSdkClient({
    auth: token,
    integrationName: "bitwarden-to-1password",
    integrationVersion: "0.1.0",
  });

  return client as unknown as OnePasswordClient;
}

export function wrapClient(client: Client): OnePasswordClient {
  return client as unknown as OnePasswordClient;
}
