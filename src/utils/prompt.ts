import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface VaultChoice {
  id: string;
  title: string;
}

/** Prompt the user to pick a vault from a numbered list. */
export async function promptVaultChoice(
  vaults: VaultChoice[],
): Promise<VaultChoice> {
  if (vaults.length === 0) {
    throw new Error("No vaults available for the service account.");
  }

  console.log("Multiple vaults found. Select one:");
  vaults.forEach((vault, index) => {
    console.log(`  ${index + 1}. ${vault.title} (${vault.id})`);
  });

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const answer = await rl.question("Enter number: ");
      const choice = Number.parseInt(answer.trim(), 10);
      if (choice >= 1 && choice <= vaults.length) {
        return vaults[choice - 1]!;
      }
      console.log(`Please enter a number between 1 and ${vaults.length}.`);
    }
  } finally {
    rl.close();
  }
}

/** Prompt the user to type "yes" to confirm a destructive action. */
export async function promptYesConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${message}\nType "yes" to confirm: `);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}
