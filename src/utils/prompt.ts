import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface VaultChoice {
  id: string;
  title: string;
}

/**
 * Interactive stdin prompts for vault selection and destructive confirmations.
 *
 * Used when the service account can access multiple vaults and no `--vault`
 * hint was provided, and before purge deletes unless `--yes` is set.
 */
export class PromptService {
  /**
   * Display a numbered vault list and return the user's selection.
   *
   * Loops until a valid index is entered.
   */
  async chooseVault(vaults: VaultChoice[]): Promise<VaultChoice> {
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

  /**
   * Ask the user to type `yes` exactly before a destructive operation.
   *
   * @returns True only when the trimmed input is the word "yes" (any case).
   */
  async confirmYes(message: string): Promise<boolean> {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(`${message}\nType "yes" to confirm: `);
      return answer.trim().toLowerCase() === "yes";
    } finally {
      rl.close();
    }
  }
}

const defaultPrompts = new PromptService();

export async function promptVaultChoice(
  vaults: VaultChoice[],
): Promise<VaultChoice> {
  return defaultPrompts.chooseVault(vaults);
}

export async function promptYesConfirmation(message: string): Promise<boolean> {
  return defaultPrompts.confirmYes(message);
}
