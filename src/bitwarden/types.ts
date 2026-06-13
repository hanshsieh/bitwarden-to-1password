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

export interface BitwardenLoginUri {
  uri: string | null;
  match: number | null;
}

export interface BitwardenLogin {
  username?: string | null;
  password?: string | null;
  totp?: string | null;
  uris?: BitwardenLoginUri[];
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
