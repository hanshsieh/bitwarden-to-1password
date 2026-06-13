# Bitwarden export format

Reference for reading Bitwarden vault exports in this tool.

Bitwarden does not publish a public SDK for parsing export files. This document describes the JSON schema and ZIP layout so the migration tool can read exports directly.

Official references:

- [Export vault data](https://bitwarden.com/help/export-your-data/)
- [Import from a custom file (JSON schema)](https://bitwarden.com/help/condition-bitwarden-import/)
- [Bitwarden SDK `bitwarden_exporters` source](https://sdk-api-docs.bitwarden.com/src/bitwarden_exporters/json.rs.html)

## Export formats

| Format | Contents | Notes |
| --- | --- | --- |
| `.json` | Plaintext vault JSON | All cipher types; attachments are metadata-only or omitted |
| `.json (Encrypted)` | Password- or account-protected JSON | Same schema after decryption |
| `.zip (with attachments)` | `data.json` + attachment files | Individual vault only; this tool expects this format |
| `.csv` | Logins and secure notes only | Not supported by this tool |

This tool reads the extracted `.zip (with attachments)` directory passed to `migrate --bw-dir`.

## ZIP layout

After unzipping:

```text
{bw-dir}/
├── data.json
└── attachments/
    └── {itemId}/
        └── {attachmentId}/
            └── filename.pdf
```

Newer exports nest each attachment under `{itemId}/{attachmentId}/` so duplicate filenames within one item do not overwrite each other. Attachment bytes are **not** embedded in JSON; resolve files on disk using the item `id` and the folder layout above.

## Root JSON structure

Personal vault export (`data.json`):

```json
{
  "encrypted": false,
  "folders": [
    {
      "id": "942e2984-1b9a-453b-b039-b107012713b9",
      "name": "Work"
    }
  ],
  "items": []
}
```

Organization exports may also include:

```json
{
  "encrypted": false,
  "collections": [
    {
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "organizationId": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
      "name": "My Collection",
      "externalId": null
    }
  ],
  "items": []
}
```

| Root field | Type | Scope |
| --- | --- | --- |
| `encrypted` | boolean | Present on some exports |
| `folders` | array | Personal vault |
| `collections` | array | Organization vault |
| `items` | array | Required; vault entries |

## Item types

Each item has a numeric `type` and exactly one type-specific sub-object.

| `type` | Name | Sub-object key |
| --- | --- | --- |
| `1` | Login | `login` |
| `2` | Secure Note | `secureNote` |
| `3` | Card | `card` |
| `4` | Identity | `identity` |
| `5` | SSH Key | `sshKey` |

Minimum valid item (import requirement):

```json
{ "type": 1, "name": "Login", "login": {} }
{ "type": 2, "name": "Note", "secureNote": {} }
{ "type": 3, "name": "Card", "card": {} }
{ "type": 4, "name": "Identity", "identity": {} }
```

Full exports include additional metadata and populated sub-objects.

## Common item fields

All item types share these top-level fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID string | Item ID; used for attachment paths |
| `type` | integer | `1`–`5` |
| `name` | string | Item title |
| `notes` | string or `null` | Free-text notes |
| `favorite` | boolean | |
| `reprompt` | integer | `0` = no master-password reprompt, `1` = require reprompt |
| `folderId` | UUID or `null` | Personal vault only |
| `organizationId` | UUID or `null` | Organization vault only |
| `collectionIds` | array or `null` | Organization vault only |
| `fields` | array | Custom fields |
| `passwordHistory` | array or `null` | Past passwords |
| `creationDate` | ISO 8601 string | |
| `revisionDate` | ISO 8601 string | |
| `deletedDate` | ISO 8601 or `null` | |

### Custom fields (`fields[]`)

```json
{
  "name": "PIN",
  "value": "1234",
  "type": 0,
  "linkedId": null
}
```

| `type` | Meaning |
| --- | --- |
| `0` | Text |
| `1` | Hidden |
| `2` | Boolean (`"true"` / `"false"`) |
| `3` | Linked (uses `linkedId` instead of `value`) |

### Password history (`passwordHistory[]`)

```json
{
  "lastUsedDate": "2025-06-01T00:00:00.000Z",
  "password": "old-password-value"
}
```

Exports may set `passwordHistory` to `null` when empty.

## Type-specific schemas

### Login (`type: 1`)

```json
{
  "id": "25c8c414-b446-48e9-a1bd-b10700bbd740",
  "folderId": "942e2984-1b9a-453b-b039-b107012713b9",
  "organizationId": null,
  "type": 1,
  "reprompt": 0,
  "name": "Bitwarden",
  "notes": "My note",
  "favorite": true,
  "fields": [
    {
      "name": "Security question",
      "value": "answer",
      "type": 0,
      "linkedId": null
    }
  ],
  "passwordHistory": null,
  "creationDate": "2024-01-30T11:23:54.416Z",
  "revisionDate": "2024-01-30T14:09:33.753Z",
  "deletedDate": null,
  "login": {
    "username": "user@example.com",
    "password": "secret",
    "totp": "otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    "uris": [
      { "uri": "https://vault.bitwarden.com", "match": null }
    ],
    "fido2Credentials": []
  },
  "collectionIds": null
}
```

| `login` field | Type | Notes |
| --- | --- | --- |
| `username` | string or `null` | |
| `password` | string or `null` | |
| `totp` | string or `null` | TOTP seed or `otpauth://` URI |
| `uris` | array | `{ "uri", "match" }` objects |
| `fido2Credentials` | array | Often empty in exports |
| `match` (in `uris[]`) | integer or `null` | URI matching mode |

### Secure Note (`type: 2`)

Body text is stored in the top-level `notes` field. `secureNote` is mostly a type marker.

```json
{
  "id": "23f0f877-42b1-4820-a850-b10700bc41eb",
  "folderId": null,
  "organizationId": null,
  "type": 2,
  "reprompt": 0,
  "name": "My secure note",
  "notes": "Very secure!",
  "favorite": false,
  "fields": [],
  "passwordHistory": null,
  "creationDate": "2024-01-30T11:25:25.466Z",
  "revisionDate": "2024-01-30T11:25:25.466Z",
  "deletedDate": null,
  "secureNote": {
    "type": 0
  },
  "collectionIds": null
}
```

| `secureNote.type` | Meaning |
| --- | --- |
| `0` | Generic secure note |

### Card (`type: 3`)

```json
{
  "id": "3ed8de45-48ee-4e26-a2dc-b10701276c53",
  "folderId": null,
  "organizationId": null,
  "type": 3,
  "reprompt": 0,
  "name": "My card",
  "notes": null,
  "favorite": false,
  "fields": [],
  "passwordHistory": null,
  "creationDate": "2024-01-30T17:55:36.150Z",
  "revisionDate": "2024-01-30T17:55:36.150Z",
  "deletedDate": null,
  "card": {
    "cardholderName": "John Doe",
    "brand": "Visa",
    "number": "4111111111111111",
    "expMonth": "1",
    "expYear": "2032",
    "code": "123"
  },
  "collectionIds": null
}
```

| `card` field | Type | Notes |
| --- | --- | --- |
| `cardholderName` | string or `null` | |
| `brand` | string or `null` | e.g. `"Visa"`, `"Mastercard"` |
| `number` | string or `null` | Card number |
| `expMonth` | string or `null` | |
| `expYear` | string or `null` | |
| `code` | string or `null` | CVV |

### Identity (`type: 4`)

```json
{
  "id": "41cc3bc1-c3d9-4637-876c-b10701273712",
  "folderId": "942e2984-1b9a-453b-b039-b107012713b9",
  "organizationId": null,
  "type": 4,
  "reprompt": 0,
  "name": "My identity",
  "notes": null,
  "favorite": false,
  "fields": [],
  "passwordHistory": null,
  "creationDate": "2024-01-30T17:54:50.706Z",
  "revisionDate": "2024-01-30T17:54:50.706Z",
  "deletedDate": null,
  "identity": {
    "title": "Mr",
    "firstName": "John",
    "middleName": null,
    "lastName": "Doe",
    "address1": "123 Main St",
    "address2": null,
    "address3": null,
    "city": "Springfield",
    "state": "IL",
    "postalCode": "62701",
    "country": "US",
    "company": "Bitwarden",
    "email": "john@example.com",
    "phone": "555-0100",
    "ssn": null,
    "username": "JDoe",
    "passportNumber": null,
    "licenseNumber": null
  },
  "collectionIds": null
}
```

All `identity` fields are optional strings (or `null`).

### SSH Key (`type: 5`)

```json
{
  "id": "35253688-7d32-4903-a978-b3a700d2c8d6",
  "folderId": null,
  "organizationId": null,
  "type": 5,
  "reprompt": 0,
  "name": "Example SSH key",
  "notes": null,
  "favorite": false,
  "fields": [],
  "passwordHistory": [],
  "creationDate": "2025-12-02T12:47:26.576Z",
  "revisionDate": "2025-12-02T12:47:26.576Z",
  "deletedDate": null,
  "sshKey": {
    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----\n",
    "publicKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...",
    "keyFingerprint": "SHA256:k1cXY3a8i2B2uvb2nu10Omy/MOd31YFbdhp6griUjC0"
  },
  "collectionIds": null
}
```

| `sshKey` field | Type | Notes |
| --- | --- | --- |
| `privateKey` | string | PEM-encoded OpenSSH private key |
| `publicKey` | string | Public key string |
| `keyFingerprint` | string | `SHA256:...` fingerprint |

## Encrypted JSON export

Password-protected or account-restricted exports wrap the vault in an outer envelope:

```json
{
  "encrypted": true,
  "passwordProtected": true,
  "salt": "base64-encoded-salt",
  "kdfIterations": 600000,
  "kdfType": 0,
  "encKeyValidation_DO_NOT_EDIT": "encrypted-validation-string",
  "data": "encrypted-vault-data-base64"
}
```

After decryption, `data` contains the same schema as a plaintext export. This tool currently expects an **unencrypted** `.zip (with attachments)` export.

## Mapping to 1Password

This tool maps Bitwarden cipher types to 1Password categories as follows:

| Bitwarden `type` | Bitwarden name | 1Password category |
| --- | --- | --- |
| `1` | Login | Login |
| `2` | Secure Note | Secure Note |
| `3` | Card | Credit Card |
| `4` | Identity | Identity |
| `5` | SSH Key | SSH Key |

## Implementation notes

- Read `{bw-dir}/data.json` and parse with standard JSON tooling.
- Resolve attachments from `{bw-dir}/attachments/{itemId}/`.
- Skip items with a non-null `deletedDate` if present.
- For merge matching, compare `name`, `username` (from `login` or `identity`), and item type.
- Custom fields in `fields[]` are not imported by 1Password's built-in Bitwarden importer; this tool should migrate them explicitly.
