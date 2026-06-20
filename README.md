# bitwarden-to-1password

Command-line tool to migrate a Bitwarden vault export into 1Password.

1Password can import Bitwarden data natively, but that built-in import does **not** include **attachments** or **custom fields**. This tool fills that gap by reading a full Bitwarden export and writing items into 1Password via the [1Password SDK](https://developer.1password.com/docs/sdks/).

## Setup

### 1. Export your Bitwarden vault as a ZIP file

1. Open the Bitwarden web vault or desktop app.
2. Go to **Tools → Export vault**.
3. Choose **My vault** (ZIP export with attachments is currently available for individual vaults only).
4. Select **`.zip (with attachments)`** as the file format.
5. Download the export and unzip it locally.

The extracted directory should contain:

- A JSON file with your vault items (for example, `data.json`)
- Attachment files organized alongside the export

See [docs/bitwarden-export-format.md](docs/bitwarden-export-format.md) for the export JSON schema and ZIP layout.

> **Security note:** The ZIP export is **unencrypted**. Handle and delete the export files carefully after migration.

### 2. Create a 1Password vault for migration

This tool uses the 1Password SDK with a [service account](https://developer.1password.com/docs/service-accounts/) so it can create items programmatically. Service accounts **cannot** access 1Password's built-in [Personal](https://support.1password.com/1password-glossary/#personal-vault), [Private](https://support.1password.com/1password-glossary/#private-vault), default [Shared](https://support.1password.com/1password-glossary/#shared-vault), or [Employee](https://support.1password.com/1password-glossary/#employee-vault) vaults. See the [1Password SDK docs](https://www.1password.dev/sdks) for details.

Because of that limitation, create a **dedicated vault** for the migration (for example, `Bitwarden Migration`) and import your Bitwarden items there first. In the 1Password desktop or web app, create a new vault and use it as the migration target.

> **After migration:** Use the 1Password desktop app to batch move items into your target vault (for example, Personal) once import is complete.

### 3. Create a 1Password service account

Follow the steps in [Get started with 1Password Service Accounts](https://www.1password.dev/service-accounts/get-started) to create a service account. When configuring vault access, grant the service account **read and write** permissions to the migration vault you created above.

See the [1Password SDK authentication docs](https://developer.1password.com/docs/sdks/concepts#authentication) for details.

### 4. Install this tool and configure your token

Clone the repository, set your service account token, and install dependencies:

```bash
git clone https://github.com/<your-org>/bitwarden-to-1password.git
cd bitwarden-to-1password
cp .env.example .env
npm install
npm run build
```

Open `.env` and set your service account token:

```env
OP_SERVICE_ACCOUNT_TOKEN=<your-service-account-token>
```

`npm install` pulls in everything this tool needs (including the 1Password SDK and `.env` loading). No separate global install is required.

## Usage

The tool loads `OP_SERVICE_ACCOUNT_TOKEN` from your `.env` file automatically.

### `migrate`

Import items from an extracted Bitwarden export into a 1Password vault.

```bash
npm start -- migrate \
  --bw-dir /path/to/extracted-bitwarden-export \
  --vault "Bitwarden Migration"
```

#### Vault selection

`--vault` is required. It targets a vault by ID or title (case-insensitive substring match). Use the migration vault you created for your service account (see [Create a 1Password vault for migration](#2-create-a-1password-vault-for-migration)):

```bash
npm start -- migrate --bw-dir /path/to/export --vault "Bitwarden Migration"
```

If the hint matches multiple vaults, the command fails with an error listing the matches. Use `list-vaults` to see accessible vault IDs and titles:

```bash
npm start -- list-vaults
```

#### Merge strategies

When an item in the export may already exist in 1Password, use `--merge-strategy` to control what happens. The default is `skip`. A match is an existing item with the **same name and username** and the **same item type** (see [Item type mapping](#item-type-mapping) below). Matching only compares items of the same type.

| Strategy | 0 matches | 1 match | 2+ matches |
| --- | --- | --- | --- |
| `skip` (default) | create | skip | skip + warn |
| `merge` | create | merge | skip + warn |
| `abort` | create | exit 1 | exit 1 |

```bash
npm start -- migrate \
  --bw-dir /path/to/extracted-bitwarden-export \
  --vault "Bitwarden Migration" \
  --merge-strategy merge
```

#### Dry run

Preview what would be imported without writing to 1Password:

```bash
npm start -- migrate \
  --bw-dir /path/to/extracted-bitwarden-export \
  --vault "Bitwarden Migration" \
  --dry-run
```

#### Recommended migration workflow

Because the 1Password SDK cannot unarchive items, syncing archive state is a **one-way** action. Run migration in two phases:

1. **First run — content only** (no `--include-state`):

   ```bash
   npm start -- migrate \
     --bw-dir /path/to/extracted-bitwarden-export \
     --vault "Bitwarden Migration"
   ```

2. **Verify** imported items in 1Password. Adjust the export or re-run with `--merge-strategy merge` if content needs fixing.

3. **Second run — sync archive state** (irreversible). Use `--merge-strategy merge` so existing items are processed (not skipped) and can be archived:

   ```bash
   npm start -- migrate \
     --bw-dir /path/to/extracted-bitwarden-export \
     --vault "Bitwarden Migration" \
     --merge-strategy merge \
     --include-state
   ```

`--include-state` archives Bitwarden items that have `archivedDate` in the export. It only affects items **created** or **updated** in that run. With `--merge-strategy skip`, matched items are skipped and **will not** be archived — phase 2 therefore requires `merge`.

#### Archive state sync

Use `--include-state` to move corresponding 1Password items into the Archive when the Bitwarden export marks them as archived. Without this flag, all items are imported as active regardless of their Bitwarden archive state.

```bash
npm start -- migrate \
  --bw-dir /path/to/extracted-bitwarden-export \
  --vault "Bitwarden Migration" \
  --merge-strategy merge \
  --include-state
```

#### Item type mapping

Bitwarden and 1Password both support multiple item types. This tool maps Bitwarden cipher types to the closest 1Password category:

| Bitwarden type | Bitwarden name | 1Password category |
| --- | --- | --- |
| `1` | Login | Login |
| `2` | Secure Note | Secure Note |
| `3` | Card | Credit Card |
| `4` | Identity | Identity |
| `5` | SSH Key | SSH Key |

Bitwarden folders are added as 1Password tags. Bitwarden password history is not imported (the 1Password SDK has no API for seeding historical password entries).

### `purge-1p`

Delete items from a 1Password vault. Useful for resetting a vault before a fresh migration.

By default, the command prompts you to type `yes` before deleting anything (confirmation is skipped when `--dry-run` is set):

```bash
npm start -- purge-1p --vault "Test Migration"
```

Skip the confirmation prompt:

```bash
npm start -- purge-1p --vault "Test Migration" --yes
```

Preview items that would be deleted without removing anything:

```bash
npm start -- purge-1p --vault "Test Migration" --dry-run
```

Only delete items updated on or after a given time (ISO 8601):

```bash
npm start -- purge-1p \
  --vault "Test Migration" \
  --updated-on-or-after 2024-01-01T00:00:00Z
```

Combine options as needed:

```bash
npm start -- purge-1p \
  --vault "Test Migration" \
  --updated-on-or-after 2024-06-01T00:00:00Z \
  --yes
```

## Documentation

- [Bitwarden export format](docs/bitwarden-export-format.md) — JSON schema, item types, and attachment layout

## Development

```bash
npm install
npm run dev
npm run build
npm test
```

## License

MIT
