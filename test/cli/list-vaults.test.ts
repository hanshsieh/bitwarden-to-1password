import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VaultType } from "@1password/sdk";
import { ListVaultsCommand } from "../../src/cli/list-vaults.js";
import { OnePasswordClientFactory } from "../../src/onepassword/client.js";
import { createMockClient } from "../helpers/mock-client.js";

describe("list-vaults", () => {
  it("prints accessible vaults", async () => {
    const vaults = [
      {
        id: "abc-123",
        title: "Personal Migration",
        description: "",
        vaultType: VaultType.UserCreated,
        activeItemCount: 5,
        contentVersion: 1,
        attributeVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "def-456",
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

    const { client } = createMockClient({ vaults });
    const factory = new OnePasswordClientFactory();
    const originalCreate = factory.create.bind(factory);
    factory.create = async () => client;

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const code = await new ListVaultsCommand(factory).run();
      assert.equal(code, 0);
      assert.match(logs.join("\n"), /Vaults accessible to the service account \(2\)/);
      assert.match(logs.join("\n"), /Personal Migration \(abc-123\)/);
      assert.match(logs.join("\n"), /Work Vault \(def-456\)/);
    } finally {
      console.log = originalLog;
      factory.create = originalCreate;
    }
  });

  it("prints a message when no vaults are accessible", async () => {
    const { client } = createMockClient({ vaults: [] });
    const factory = new OnePasswordClientFactory();
    const originalCreate = factory.create.bind(factory);
    factory.create = async () => client;

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const code = await new ListVaultsCommand(factory).run();
      assert.equal(code, 0);
      assert.match(logs.join("\n"), /No vaults accessible to the service account/);
    } finally {
      console.log = originalLog;
      factory.create = originalCreate;
    }
  });
});
