import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultType } from "@1password/sdk";
import { GetItemCommand } from "../../src/cli/get-item.js";
import { OnePasswordClientFactory } from "../../src/onepassword/client.js";
import { createMockClient, makeLoginItem } from "../helpers/mock-client.js";

describe("get-item", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the full item as pretty JSON", async () => {
    const item = makeLoginItem("item-abc", "GitHub", "alice@example.com");
    item.notes = "Personal account";
    item.tags = ["Work"];

    const { client } = createMockClient({
      vaults: [
        {
          id: "vault-1",
          title: "Migration Vault",
          description: "",
          vaultType: VaultType.UserCreated,
          activeItemCount: 1,
          contentVersion: 1,
          attributeVersion: 1,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
      ],
      items: [item],
    });

    const factory = new OnePasswordClientFactory();
    vi.spyOn(factory, "create").mockResolvedValue(client);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const code = await new GetItemCommand(factory).run({
      vault: "Migration",
      item: "item-abc",
    });

    expect(code).toBe(0);
    expect(client.items.get).toHaveBeenCalledWith("vault-1", "item-abc");

    const parsed = JSON.parse(logs.join("\n")) as typeof item;
    expect(parsed.id).toBe("item-abc");
    expect(parsed.title).toBe("GitHub");
    expect(parsed.notes).toBe("Personal account");
    expect(parsed.tags).toEqual(["Work"]);
    expect(parsed.fields[0]?.value).toBe("alice@example.com");
  });

  it("throws when the item ID is not found", async () => {
    const { client } = createMockClient({ items: [] });
    const factory = new OnePasswordClientFactory();
    vi.spyOn(factory, "create").mockResolvedValue(client);

    await expect(
      new GetItemCommand(factory).run({
        vault: "Personal",
        item: "missing-id",
      }),
    ).rejects.toThrow(/Item not found: missing-id/);
  });
});
