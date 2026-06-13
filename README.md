# bitwarden-to-1password

Command-line tool to migrate a Bitwarden vault export into 1Password.

1Password can import Bitwarden data natively, but that built-in import does **not** include **attachments** or **custom fields**. This tool fills that gap by reading a full Bitwarden export and writing items into 1Password via the [1Password SDK](https://developer.1password.com/docs/sdks/).

## Prerequisites

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

### 2. Create a 1Password service account

This tool uses the 1Password SDK with a [service account](https://developer.1password.com/docs/service-accounts/) so it can create items programmatically.

1. In 1Password, create a service account with access to the vault where migrated items should be stored.
2. Copy the service account token.
3. Copy `.env.example` to `.env` and set your token:

   ```bash
   cp .env.example .env
   ```

   ```env
   OP_SERVICE_ACCOUNT_TOKEN=<your-service-account-token>
   ```

See the [1Password SDK authentication docs](https://developer.1password.com/docs/sdks/concepts#authentication) for details.

## Setup

Clone the repository, configure your service account token, and install dependencies:

```bash
git clone https://github.com/<your-org>/bitwarden-to-1password.git
cd bitwarden-to-1password
cp .env.example .env
npm install
npm run build
```

`npm install` pulls in everything this tool needs (including the 1Password SDK and `.env` loading). No separate global install is required.

## Usage

The tool loads `OP_SERVICE_ACCOUNT_TOKEN` from your `.env` file automatically.

### `migrate`

Import items from an extracted Bitwarden export into a 1Password vault.

```bash
npm start -- migrate --bw-dir /path/to/extracted-bitwarden-export
```

#### Merge strategies

When an item in the export may already exist in 1Password, use `--merge-strategy` to control what happens. The default is `skip`. A match is an existing item with the **same name and username** and the **same item type** (see [Item type mapping](#item-type-mapping) below). Matching only compares items of the same type.

| Strategy | Behavior |
| --- | --- |
| `skip` (default) | Skip the import if **at least one** matching item already exists. |
| `merge` | If **exactly one** matching item exists, merge the export data into it. |
| `merge-or-create` | If **more than one** matching item exists, create a new item instead of merging. |
| `abort` | Stop the entire migration if **at least one** matching item already exists. |

```bash
npm start -- migrate \
  --bw-dir /path/to/extracted-bitwarden-export \
  --merge-strategy merge
```

#### Dry run

Preview what would be imported without writing to 1Password:

```bash
npm start -- migrate \
  --bw-dir /path/to/extracted-bitwarden-export \
  --dry-run
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

### `purge-1p`

Delete items from a 1Password vault. Useful for resetting a vault before a fresh migration.

By default, the command prompts you to type `yes` before deleting anything:

```bash
npm start -- purge-1p
```

Skip the confirmation prompt:

```bash
npm start -- purge-1p --yes
```

Only delete items updated on or after a given time (ISO 8601):

```bash
npm start -- purge-1p --updated-on-or-after 2024-01-01T00:00:00Z
```

Combine options as needed:

```bash
npm start -- purge-1p \
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
```

## Project status

This repository currently contains project scaffolding only. The subcommands and options documented above are the intended CLI interface; migration and purge logic are not implemented yet.

## License

MIT
