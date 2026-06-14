import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultType } from "@1password/sdk";
import { ListVaultsCommand } from "../../src/cli/list-vaults.js";
import { OnePasswordClientFactory } from "../../src/onepassword/client.js";
import { createMockClient } from "../helpers/mock-client.js";

describe("list-vaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    vi.spyOn(factory, "create").mockResolvedValue(client);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const code = await new ListVaultsCommand(factory).run();
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(
      /Vaults accessible to the service account \(2\)/,
    );
    expect(logs.join("\n")).toMatch(/Personal Migration \(abc-123\)/);
    expect(logs.join("\n")).toMatch(/Work Vault \(def-456\)/);
  });

  it("prints a message when no vaults are accessible", async () => {
    const { client } = createMockClient({ vaults: [] });
    const factory = new OnePasswordClientFactory();
    vi.spyOn(factory, "create").mockResolvedValue(client);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const code = await new ListVaultsCommand(factory).run();
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(
      /No vaults accessible to the service account/,
    );
  });
});
