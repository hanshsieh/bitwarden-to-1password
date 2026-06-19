import Bottleneck from "bottleneck";
import type { ItemCreateParams, ItemsGetAllResponse, ItemsUpdateAllResponse } from "@1password/sdk";
import { chunk } from "../utils/chunk.js";
import type { OnePasswordClient } from "./types.js";

/** Maximum item IDs per {@link OnePasswordClient.items.getAll} request. */
export const OP_ITEMS_GET_ALL_BATCH_SIZE = 50;

/** Maximum items per {@link OnePasswordClient.items.createAll} request. */
export const OP_ITEMS_CREATE_ALL_BATCH_SIZE = 100;

/** Default hourly read limit for 1Password Business service accounts. */
export const OP_DEFAULT_READS_PER_HOUR = 10_000;

/** Default hourly write limit for 1Password Business service accounts. */
export const OP_DEFAULT_WRITES_PER_HOUR = 1_000;

export interface RateLimitConfig {
  readsPerHour: number;
  writesPerHour: number;
}

/** Read rate-limit settings from the environment with Business-plan defaults. */
export function readRateLimitConfig(): RateLimitConfig {
  return {
    readsPerHour: readPositiveIntEnv(
      "OP_RATE_LIMIT_READS_PER_HOUR",
      OP_DEFAULT_READS_PER_HOUR,
    ),
    writesPerHour: readPositiveIntEnv(
      "OP_RATE_LIMIT_WRITES_PER_HOUR",
      OP_DEFAULT_WRITES_PER_HOUR,
    ),
  };
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}".`);
  }

  return parsed;
}

function msBetweenRequests(perHour: number): number {
  return Math.ceil(3_600_000 / perHour);
}

function createLimiter(maxConcurrent: number, perHour: number): Bottleneck {
  return new Bottleneck({
    maxConcurrent,
    minTime: msBetweenRequests(perHour),
  });
}

/**
 * Wrap a 1Password client with hourly rate limits aligned to service account
 * quotas documented at https://www.1password.dev/service-accounts/rate-limits
 */
export function createRateLimitedClient(
  client: OnePasswordClient,
  config: RateLimitConfig = readRateLimitConfig(),
): OnePasswordClient {
  const readLimiter = createLimiter(2, config.readsPerHour);
  const writeLimiter = createLimiter(1, config.writesPerHour);

  const scheduleRead = <T>(operation: () => Promise<T>): Promise<T> =>
    readLimiter.schedule(operation);
  const scheduleWrite = <T>(operation: () => Promise<T>): Promise<T> =>
    writeLimiter.schedule(operation);

  return {
    vaults: {
      list: () => scheduleRead(() => client.vaults.list()),
    },
    items: {
      list: (vaultId, ...filters) =>
        scheduleRead(() => client.items.list(vaultId, ...filters)),
      get: (vaultId, itemId) =>
        scheduleRead(() => client.items.get(vaultId, itemId)),
      getAll: (vaultId, itemIds) =>
        scheduleRead(() => getAllInBatches(client, vaultId, itemIds)),
      create: (params) => scheduleWrite(() => client.items.create(params)),
      createAll: (vaultId, params) =>
        scheduleWrite(() => createAllInBatches(client, vaultId, params)),
      put: (item) => scheduleWrite(() => client.items.put(item)),
      delete: (vaultId, itemId) =>
        scheduleWrite(() => client.items.delete(vaultId, itemId)),
      deleteAll: (vaultId, itemIds) =>
        scheduleWrite(() => client.items.deleteAll(vaultId, itemIds)),
      archive: (vaultId, itemId) =>
        scheduleWrite(() => client.items.archive(vaultId, itemId)),
      files: {
        attach: (item, fileParams) =>
          scheduleWrite(() => client.items.files.attach(item, fileParams)),
        delete: (item, sectionId, fieldId) =>
          scheduleWrite(() =>
            client.items.files.delete(item, sectionId, fieldId),
          ),
      },
    },
  };
}

async function getAllInBatches(
  client: OnePasswordClient,
  vaultId: string,
  itemIds: string[],
): Promise<ItemsGetAllResponse> {
  if (itemIds.length <= OP_ITEMS_GET_ALL_BATCH_SIZE) {
    return client.items.getAll(vaultId, itemIds);
  }

  const individualResponses: ItemsGetAllResponse["individualResponses"] = [];
  for (const batch of chunk(itemIds, OP_ITEMS_GET_ALL_BATCH_SIZE)) {
    const response = await client.items.getAll(vaultId, batch);
    individualResponses.push(...response.individualResponses);
  }

  return { individualResponses };
}

async function createAllInBatches(
  client: OnePasswordClient,
  vaultId: string,
  params: ItemCreateParams[],
): Promise<ItemsUpdateAllResponse> {
  if (params.length <= OP_ITEMS_CREATE_ALL_BATCH_SIZE) {
    return client.items.createAll(vaultId, params);
  }

  const individualResponses: ItemsUpdateAllResponse["individualResponses"] = [];
  for (const batch of chunk(params, OP_ITEMS_CREATE_ALL_BATCH_SIZE)) {
    const response = await client.items.createAll(vaultId, batch);
    individualResponses.push(...response.individualResponses);
  }

  return { individualResponses };
}
