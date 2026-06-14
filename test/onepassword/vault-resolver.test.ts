import { describe, expect, it } from "vitest";
import { VaultType } from "@1password/sdk";
import { VaultResolver } from "../../src/onepassword/vault-resolver.js";
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
    const matches = VaultResolver.filterByHint(vaults, "personal");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.title).toBe("Personal Migration");
  });

  it("matches vault by id", () => {
    const matches = VaultResolver.filterByHint(vaults, "abc-123-vault-id");
    expect(matches).toHaveLength(1);
  });

  it("uses the only vault when no hint is provided", async () => {
    const { client } = createMockClient({ vaults: [vaults[0]!] });
    const resolved = await new VaultResolver(client).resolve();
    expect(resolved.id).toBe(vaults[0]!.id);
  });

  it("resolves vault by hint", async () => {
    const { client } = createMockClient({ vaults });
    const resolved = await new VaultResolver(client).resolve("work");
    expect(resolved.title).toBe("Work Vault");
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

    await expect(new VaultResolver(client).resolve("personal")).rejects.toThrow(
      /Multiple vaults match/,
    );
  });

  it("throws when hint matches nothing", async () => {
    const { client } = createMockClient({ vaults });
    await expect(
      new VaultResolver(client).resolve("nonexistent"),
    ).rejects.toThrow(/No vault matches/);
  });
});
