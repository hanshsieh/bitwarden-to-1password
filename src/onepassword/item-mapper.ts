import {
  AutofillBehavior,
  ItemCategory,
  ItemFieldType,
  type ItemCreateParams,
  type ItemField,
  type ItemSection,
} from "@1password/sdk";
import type {
  BitwardenAttachment,
  BitwardenCustomField,
  ParsedBitwardenExport,
  ParsedBitwardenItem,
} from "../bitwarden/types.js";
import { slugify } from "../utils/normalize.js";
import type { MappedItem } from "./types.js";

export const CUSTOM_FIELDS_SECTION_ID = "custom_fields";
export const CUSTOM_FIELDS_SECTION_TITLE = "Custom fields";
export const ATTACHMENTS_SECTION_ID = "attachments";
export const ATTACHMENTS_SECTION_TITLE = "Attachments";
export const SSH_KEYS_SECTION_ID = "keys";

const BW_TYPE_TO_CATEGORY: Record<
  ParsedBitwardenItem["type"],
  ItemCategory
> = {
  1: ItemCategory.Login,
  2: ItemCategory.SecureNote,
  3: ItemCategory.CreditCard,
  4: ItemCategory.Identity,
  5: ItemCategory.SshKey,
};

function formatCardExpiry(
  expMonth: string | null | undefined,
  expYear: string | null | undefined,
): string {
  const month = (expMonth ?? "").trim();
  const year = (expYear ?? "").trim();
  if (!month && !year) return "";
  const paddedMonth = month.padStart(2, "0");
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${paddedMonth}/${fullYear}`;
}

function buildAddressField(
  identity: NonNullable<ParsedBitwardenItem["identity"]>,
): ItemField | null {
  const streetParts = [
    identity.address1,
    identity.address2,
    identity.address3,
  ]
    .filter((part) => part != null && part.trim() !== "")
    .map((part) => part!.trim());

  const street = streetParts.join("\n");
  const city = identity.city?.trim() ?? "";
  const state = identity.state?.trim() ?? "";
  const zip = identity.postalCode?.trim() ?? "";
  const country = identity.country?.trim() ?? "";

  if (!street && !city && !state && !zip && !country) {
    return null;
  }

  return {
    id: "address",
    title: "Address",
    fieldType: ItemFieldType.Address,
    value: "",
    details: {
      type: "Address",
      content: { street, city, state, zip, country },
    },
  };
}

function mapCustomField(field: BitwardenCustomField, index: number): ItemField {
  const id = slugify(field.name) || `custom_${index}`;
  let fieldType = ItemFieldType.Text;
  let value = field.value ?? "";
  let title = field.name;

  switch (field.type) {
    case 0:
      fieldType = ItemFieldType.Text;
      break;
    case 1:
      fieldType = ItemFieldType.Concealed;
      break;
    case 2:
      fieldType = ItemFieldType.Text;
      value = value.toLowerCase() === "true" ? "true" : "false";
      break;
    case 3:
      fieldType = ItemFieldType.Text;
      value = field.linkedId != null ? `[linked field ${field.linkedId}]` : "";
      title = `${field.name} (linked)`;
      break;
  }

  return {
    id,
    title,
    sectionId: CUSTOM_FIELDS_SECTION_ID,
    fieldType,
    value,
  };
}

function collectTags(
  item: ParsedBitwardenItem,
  exportData: ParsedBitwardenExport,
): string[] {
  const tags: string[] = [];

  if (item.folderId) {
    const folderName = exportData.folders.get(item.folderId);
    if (folderName) tags.push(folderName);
  }

  for (const collectionId of item.collectionIds) {
    const collectionName = exportData.collections.get(collectionId);
    if (collectionName) tags.push(collectionName);
  }

  return tags;
}

function mapLoginFields(item: ParsedBitwardenItem): ItemField[] {
  const login = item.login ?? {};
  const fields: ItemField[] = [];

  if (login.username != null && login.username !== "") {
    fields.push({
      id: "username",
      title: "username",
      fieldType: ItemFieldType.Text,
      value: login.username,
    });
  }

  if (login.password != null && login.password !== "") {
    fields.push({
      id: "password",
      title: "password",
      fieldType: ItemFieldType.Concealed,
      value: login.password,
    });
  }

  if (login.totp != null && login.totp !== "") {
    fields.push({
      id: "onetimepassword",
      title: "one-time password",
      fieldType: ItemFieldType.Totp,
      value: login.totp,
    });
  }

  return fields;
}

function mapCardFields(item: ParsedBitwardenItem): ItemField[] {
  const card = item.card ?? {};
  const fields: ItemField[] = [];

  if (card.cardholderName) {
    fields.push({
      id: "cardholder",
      title: "cardholder name",
      fieldType: ItemFieldType.Text,
      value: card.cardholderName,
    });
  }

  if (card.brand) {
    fields.push({
      id: "type",
      title: "type",
      fieldType: ItemFieldType.CreditCardType,
      value: card.brand,
    });
  }

  if (card.number) {
    fields.push({
      id: "ccnum",
      title: "number",
      fieldType: ItemFieldType.CreditCardNumber,
      value: card.number,
    });
  }

  if (card.code) {
    fields.push({
      id: "cvv",
      title: "verification number",
      fieldType: ItemFieldType.Concealed,
      value: card.code,
    });
  }

  const expiry = formatCardExpiry(card.expMonth, card.expYear);
  if (expiry) {
    fields.push({
      id: "expiry",
      title: "expiry date",
      fieldType: ItemFieldType.MonthYear,
      value: expiry,
    });
  }

  return fields;
}

function mapIdentityFields(item: ParsedBitwardenItem): {
  builtin: ItemField[];
  extra: ItemField[];
} {
  const identity = item.identity ?? {};
  const builtin: ItemField[] = [];
  const extra: ItemField[] = [];

  const addBuiltin = (
    id: string,
    title: string,
    value: string | null | undefined,
    fieldType: ItemFieldType = ItemFieldType.Text,
  ) => {
    if (value != null && value.trim() !== "") {
      builtin.push({ id, title, fieldType, value: value.trim() });
    }
  };

  addBuiltin("firstname", "first name", identity.firstName);
  addBuiltin("lastname", "last name", identity.lastName);
  addBuiltin("email", "email", identity.email, ItemFieldType.Email);
  addBuiltin("username", "username", identity.username);
  addBuiltin("company", "company", identity.company);
  addBuiltin("defphone", "default phone", identity.phone, ItemFieldType.Phone);

  const addressField = buildAddressField(identity);
  if (addressField) builtin.push(addressField);

  const unmapped: Array<[string, string | null | undefined]> = [
    ["Title", identity.title],
    ["Middle name", identity.middleName],
    ["SSN", identity.ssn],
    ["Passport number", identity.passportNumber],
    ["License number", identity.licenseNumber],
  ];

  for (const [label, value] of unmapped) {
    if (value != null && value.trim() !== "") {
      extra.push({
        id: slugify(label),
        title: label,
        sectionId: CUSTOM_FIELDS_SECTION_ID,
        fieldType: ItemFieldType.Text,
        value: value.trim(),
      });
    }
  }

  return { builtin, extra };
}

function mapSshKeyFields(item: ParsedBitwardenItem): ItemField[] {
  const sshKey = item.sshKey ?? {};
  if (!sshKey.privateKey) return [];

  return [
    {
      id: "private_key",
      title: "private key",
      sectionId: SSH_KEYS_SECTION_ID,
      fieldType: ItemFieldType.SshKey,
      value: sshKey.privateKey,
    },
  ];
}

function buildAttachmentFieldIds(
  attachments: BitwardenAttachment[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const attachment of attachments) {
    const fieldId =
      attachment.attachmentId ?? slugify(attachment.filename);
    map.set(attachment.filePath, fieldId);
  }
  return map;
}

function buildSections(
  customFields: ItemField[],
  hasAttachments: boolean,
  hasSshKey: boolean,
): ItemSection[] {
  const sections: ItemSection[] = [];

  if (hasSshKey) {
    sections.push({ id: SSH_KEYS_SECTION_ID, title: "Keys" });
  }

  if (customFields.length > 0) {
    sections.push({
      id: CUSTOM_FIELDS_SECTION_ID,
      title: CUSTOM_FIELDS_SECTION_TITLE,
    });
  }

  if (hasAttachments) {
    sections.push({
      id: ATTACHMENTS_SECTION_ID,
      title: ATTACHMENTS_SECTION_TITLE,
    });
  }

  return sections;
}

/** Map a Bitwarden item to 1Password ItemCreateParams. */
export function mapItem(
  item: ParsedBitwardenItem,
  exportData: ParsedBitwardenExport,
  vaultId: string,
  attachments: BitwardenAttachment[] = [],
): MappedItem {
  const category = BW_TYPE_TO_CATEGORY[item.type];
  const tags = collectTags(item, exportData);
  const customFields = (item.fields ?? []).map(mapCustomField);

  let builtinFields: ItemField[] = [];
  let notes = item.notes ?? "";
  let websites: ItemCreateParams["websites"];

  switch (item.type) {
    case 1: {
      builtinFields = mapLoginFields(item);
      const uris = item.login?.uris ?? [];
      websites = uris
        .filter((u) => u.uri != null && u.uri.trim() !== "")
        .map((u, index) => ({
          url: u.uri!.trim(),
          label: index === 0 ? "website" : `website ${index + 1}`,
          autofillBehavior: AutofillBehavior.AnywhereOnWebsite,
        }));
      break;
    }
    case 2:
      break;
    case 3:
      builtinFields = mapCardFields(item);
      break;
    case 4: {
      const { builtin, extra } = mapIdentityFields(item);
      builtinFields = builtin;
      customFields.push(...extra);
      break;
    }
    case 5:
      builtinFields = mapSshKeyFields(item);
      break;
  }

  const hasSshKey = item.type === 5 && Boolean(item.sshKey?.privateKey);
  const sections = buildSections(
    customFields,
    attachments.length > 0,
    hasSshKey,
  );

  const params: ItemCreateParams = {
    category,
    vaultId,
    title: item.name,
    fields: [...builtinFields, ...customFields],
    sections: sections.length > 0 ? sections : undefined,
    notes: notes || undefined,
    tags: tags.length > 0 ? tags : undefined,
    websites,
  };

  return {
    params,
    attachments,
    attachmentFieldIds: buildAttachmentFieldIds(attachments),
  };
}

/** Extract username from a Bitwarden item for merge matching. */
export function extractBitwardenUsername(item: ParsedBitwardenItem): string {
  if (item.type === 1) return item.login?.username ?? "";
  if (item.type === 4) return item.identity?.username ?? "";
  return "";
}

/** Read username from an existing 1Password item's built-in fields. */
export function extractOnePasswordUsername(
  fields: ItemField[],
  category: ItemCategory,
): string {
  if (
    category !== ItemCategory.Login &&
    category !== ItemCategory.Identity
  ) {
    return "";
  }
  const field = fields.find((f) => f.id === "username");
  return field?.value ?? "";
}

/** Category for a Bitwarden cipher type. */
export function bitwardenTypeToCategory(
  type: ParsedBitwardenItem["type"],
): ItemCategory {
  return BW_TYPE_TO_CATEGORY[type];
}
