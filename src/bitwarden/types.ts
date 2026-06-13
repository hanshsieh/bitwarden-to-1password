/** Bitwarden cipher type identifiers (1–5 supported by this tool). */
export type BitwardenCipherType = 1 | 2 | 3 | 4 | 5;

export type {
  BitwardenExportInput,
  BitwardenItemInput,
} from "./export-schemas.js";

export interface BitwardenCustomField {
  name: string;
  value: string | null;
  type: 0 | 1 | 2 | 3;
  linkedId: number | null;
}

/** Bitwarden login URI match modes (see Bitwarden UriMatchType). */
export const BITWARDEN_URI_MATCH = {
  Domain: 0,
  Host: 1,
  StartsWith: 2,
  Exact: 3,
  RegularExpression: 4,
  Never: 5,
} as const;

export interface BitwardenLoginUri {
  uri: string | null;
  match: number | null;
}

export interface BitwardenFido2Credential {
  credentialId: string;
}

export interface BitwardenLogin {
  username?: string | null;
  password?: string | null;
  totp?: string | null;
  uris?: BitwardenLoginUri[];
  fido2Credentials?: BitwardenFido2Credential[];
}

export interface BitwardenSecureNote {
  type?: number;
}

export interface BitwardenCard {
  cardholderName?: string | null;
  brand?: string | null;
  number?: string | null;
  expMonth?: string | null;
  expYear?: string | null;
  code?: string | null;
}

export interface BitwardenIdentity {
  title?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  address1?: string | null;
  address2?: string | null;
  address3?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  ssn?: string | null;
  username?: string | null;
  passportNumber?: string | null;
  licenseNumber?: string | null;
}

export interface BitwardenSshKey {
  privateKey?: string | null;
  publicKey?: string | null;
  keyFingerprint?: string | null;
}

export interface BitwardenPasswordHistoryEntry {
  lastUsedDate: string;
  password: string;
}

export interface BitwardenItemBase {
  id?: string;
  type: number;
  name: string;
  notes?: string | null;
  favorite?: boolean;
  reprompt?: number;
  folderId?: string | null;
  organizationId?: string | null;
  collectionIds?: string[] | null;
  fields?: BitwardenCustomField[];
  passwordHistory?: BitwardenPasswordHistoryEntry[] | null;
  creationDate?: string;
  revisionDate?: string;
  deletedDate?: string | null;
  archivedDate?: string | null;
  login?: BitwardenLogin;
  secureNote?: BitwardenSecureNote;
  card?: BitwardenCard;
  identity?: BitwardenIdentity;
  sshKey?: BitwardenSshKey;
}

export interface BitwardenFolder {
  id: string;
  name: string;
}

export interface BitwardenCollection {
  id: string;
  organizationId: string;
  name: string;
  externalId?: string | null;
}

export interface BitwardenExport {
  encrypted?: boolean;
  folders?: BitwardenFolder[];
  collections?: BitwardenCollection[];
  items: BitwardenItemBase[];
}

/** Parsed export item with guaranteed supported type and required sub-object. */
export interface ParsedBitwardenItem {
  id: string;
  type: BitwardenCipherType;
  name: string;
  notes: string;
  folderId: string | null;
  collectionIds: string[];
  fields: BitwardenCustomField[];
  archivedDate: string | null;
  login?: BitwardenLogin;
  secureNote?: BitwardenSecureNote;
  card?: BitwardenCard;
  identity?: BitwardenIdentity;
  sshKey?: BitwardenSshKey;
}

export interface ParsedBitwardenExport {
  folders: Map<string, string>;
  collections: Map<string, string>;
  items: ParsedBitwardenItem[];
  skippedDeleted: number;
  skippedUnsupported: number;
}

export interface BitwardenAttachment {
  attachmentId: string | null;
  filename: string;
  filePath: string;
}

/** True when the export item was archived in Bitwarden (not trashed). */
export function isArchivedItem(item: {
  archivedDate: string | null;
}): boolean {
  return item.archivedDate != null;
}

/** True when a login item has FIDO2/passkey credentials in the export. */
export function hasFido2Credentials(item: {
  login?: BitwardenLogin;
}): boolean {
  return (item.login?.fido2Credentials?.length ?? 0) > 0;
}

/** True when an item has Bitwarden linked custom fields (type 3). */
export function hasLinkedCustomFields(item: {
  fields?: BitwardenCustomField[];
}): boolean {
  return (item.fields ?? []).some((field) => field.type === 3);
}

/** True when a login item has at least one URI using regex match detection. */
export function hasRegexLoginUri(item: { login?: BitwardenLogin }): boolean {
  return (item.login?.uris ?? []).some(
    (uri) => uri.match === BITWARDEN_URI_MATCH.RegularExpression,
  );
}
