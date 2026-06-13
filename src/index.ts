#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

program.parse();
