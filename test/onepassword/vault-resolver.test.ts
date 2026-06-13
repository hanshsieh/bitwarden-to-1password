import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VaultType } from "@1password/sdk";
import {
  filterVaultsByHint,
  resolveVault,
} from "../../src/onepassword/vault-resolver.js";
import { createMockClient } from "../helpers/mock-client.js";

const vaults = [
  {
    id: "abc-123-vault-id",
    title: "Personal Migration",
    description: "",
    vaultType: VaultType.UserCreated,
    activeItemCount: 0,
    contentVersion: 1,
    attributeVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "def-456-other-vault",
    title: "Work Vault",
    description: "",
    vaultType: VaultType.UserCreated,
    activeItemCount: 0,
    contentVersion: 1,
    attributeVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe("vault-resolver", () => {
  it("matches vault by case-insensitive title substring", () => {
    const matches = filterVaultsByHint(vaults, "personal");
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.title, "Personal Migration");
  });

  it("matches vault by id", () => {
    const matches = filterVaultsByHint(vaults, "abc-123-vault-id");
    assert.equal(matches.length, 1);
  });

  it("uses the only vault when no hint is provided", async () => {
    const { client } = createMockClient({ vaults: [vaults[0]!] });
    const resolved = await resolveVault(client);
    assert.equal(resolved.id, vaults[0]!.id);
  });

  it("resolves vault by hint", async () => {
    const { client } = createMockClient({ vaults });
    const resolved = await resolveVault(client, "work");
    assert.equal(resolved.title, "Work Vault");
  });

  it("throws when hint matches multiple vaults", async () => {
    const { client } = createMockClient({
      vaults: [
        ...vaults,
        {
          ...vaults[0]!,
          id: "another-personal",
          title: "Personal Backup",
        },
      ],
    });

    await assert.rejects(
      () => resolveVault(client, "personal"),
      /Multiple vaults match/,
    );
  });

  it("throws when hint matches nothing", async () => {
    const { client } = createMockClient({ vaults });
    await assert.rejects(
      () => resolveVault(client, "nonexistent"),
      /No vault matches/,
    );
  });
});
