import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { migrate } from "../../src/onepassword/migrator.js";
import { parseExport } from "../../src/bitwarden/parse-export.js";
import { createMockClient, makeLoginItem } from "../helpers/mock-client.js";

const FIXTURES = join(import.meta.dirname, "../fixtures/exports/personal-vault");

describe("migrator", () => {
  it("dry-run reports planned creates without SDK writes", async () => {
    const { client, state } = createMockClient();
    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: true,
    });

    assert.equal(summary.created, 5);
    assert.equal(summary.merged, 0);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.failed, 0);
    assert.equal(summary.aborted, false);
    assert.equal(state.createCalls.length, 0);
  });

  it("creates items when no matches exist", async () => {
    const { client, state } = createMockClient();
    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: false,
    });

    assert.equal(summary.created, 5);
    assert.equal(summary.failed, 0);
    assert.equal(state.createCalls.length, 5);
  });

  it("skips matching items with skip strategy", async () => {
    const parsed = parseExport(FIXTURES);
    const login = parsed.items.find((i) => i.type === 1)!;

    const { client, state } = createMockClient({
      items: [
        makeLoginItem("existing-1", login.name, login.login?.username ?? ""),
      ],
    });

    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "skip",
      dryRun: false,
    });

    assert.equal(summary.skipped, 1);
    assert.equal(summary.created, 4);
    assert.equal(state.createCalls.length, 4);
  });

  it("aborts when a match exists and strategy is abort", async () => {
    const parsed = parseExport(FIXTURES);
    const login = parsed.items.find((i) => i.type === 1)!;

    const { client, state } = createMockClient({
      items: [
        makeLoginItem("existing-1", login.name, login.login?.username ?? ""),
      ],
    });

    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "abort",
      dryRun: false,
    });

    assert.equal(summary.aborted, true);
    assert.equal(summary.created, 0);
    assert.equal(state.createCalls.length, 0);
  });

  it("merges into a single matching item", async () => {
    const parsed = parseExport(FIXTURES);
    const login = parsed.items.find((i) => i.type === 1)!;

    const { client, state } = createMockClient({
      items: [
        makeLoginItem("existing-1", login.name, login.login?.username ?? ""),
      ],
    });

    const summary = await migrate(client, {
      bwDir: FIXTURES,
      vaultId: "vault-1",
      mergeStrategy: "merge",
      dryRun: false,
    });

    assert.equal(summary.merged, 1);
    assert.equal(summary.created, 4);
    assert.equal(state.putCalls.length, 1);
  });
});
