#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrate } from "./cli/migrate.js";
import { runPurge } from "./cli/purge-1p.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("bitwarden-to-1password")
  .description(
    "Migrate a Bitwarden vault export to 1Password, including attachments and custom fields",
  )
  .version(pkg.version);

program
  .command("migrate")
  .description("Import items from an extracted Bitwarden export")
  .requiredOption("--bw-dir <path>", "Path to extracted Bitwarden export directory")
  .option(
    "--merge-strategy <strategy>",
    "How to handle duplicates: skip, merge, or abort",
    "skip",
  )
  .option("--dry-run", "Preview actions without writing to 1Password", false)
  .option(
    "--vault <id-or-title>",
    "Target vault ID or title substring (case-insensitive)",
  )
  .action(async (opts) => {
    const strategy = opts.mergeStrategy as string;
    if (!["skip", "merge", "abort"].includes(strategy)) {
      console.error(
        `Invalid --merge-strategy "${strategy}". Use skip, merge, or abort.`,
      );
      process.exit(1);
    }

    try {
      const code = await runMigrate({
        bwDir: opts.bwDir,
        mergeStrategy: strategy as "skip" | "merge" | "abort",
        dryRun: Boolean(opts.dryRun),
        vault: opts.vault,
      });
      process.exit(code);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
  });

program
  .command("purge-1p")
  .description("Delete items from a 1Password vault")
  .option("--yes", "Skip confirmation prompt", false)
  .option("--dry-run", "List items that would be deleted", false)
  .option(
    "--updated-on-or-after <iso8601>",
    "Only delete items updated on or after this time",
  )
  .option(
    "--vault <id-or-title>",
    "Target vault ID or title substring (case-insensitive)",
  )
  .action(async (opts) => {
    try {
      const code = await runPurge({
        yes: Boolean(opts.yes),
        dryRun: Boolean(opts.dryRun),
        updatedOnOrAfter: opts.updatedOnOrAfter,
        vault: opts.vault,
      });
      process.exit(code);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
  });

program.parse();
