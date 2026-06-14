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
import { attachmentFieldIdFromPath } from "../utils/attachment-field-id.js";
import {
  collectBitwardenLabels,
  mapBitwardenLabelsForSdk,
} from "./tags.js";
import type { MappedItem } from "./types.js";

/** Well-known 1Password section IDs used when mapping Bitwarden data. */
export class OnePasswordItemMapper {
  static readonly CUSTOM_FIELDS_SECTION_ID = "custom_fields";
  static readonly CUSTOM_FIELDS_SECTION_TITLE = "Custom";
  static readonly ATTACHMENTS_SECTION_ID = "attachments";
  static readonly ATTACHMENTS_SECTION_TITLE = "Attachments";
  static readonly SSH_KEYS_SECTION_ID = "keys";
  static readonly SSH_KEYS_SECTION_TITLE = "Keys";

  private static readonly BW_TYPE_TO_CATEGORY: Record<
    ParsedBitwardenItem["type"],
    ItemCategory
  > = {
    1: ItemCategory.Login,
    2: ItemCategory.SecureNote,
    3: ItemCategory.CreditCard,
    4: ItemCategory.Identity,
    5: ItemCategory.SshKey,
  };

  /**
   * Convert one Bitwarden cipher into 1Password {@link ItemCreateParams}.
   *
   * Folder and collection names become tags when ASCII-safe; non-ASCII labels are
   * omitted because the 1Password SDK rejects them as tags. Custom fields use
   * indexed IDs (`cust_0`, …) in the "Custom" section. Attachment metadata is
   * returned separately for upload after create.
   */
  map(
    item: ParsedBitwardenItem,
    exportData: ParsedBitwardenExport,
    vaultId: string,
    attachments: BitwardenAttachment[] = [],
  ): MappedItem {
    const category = OnePasswordItemMapper.bitwardenTypeToCategory(item.type);
    const tags = mapBitwardenLabelsForSdk(
      collectBitwardenLabels(item, exportData),
    );
    const customFields = (item.fields ?? [])
      .filter((field) => field.type !== 3)
      .map((field, index) => this.mapCustomField(field, index));

    let customFieldCount = customFields.length;

    let builtinFields: ItemField[] = [];
    let notes = item.notes ?? "";
    let websites: ItemCreateParams["websites"];

    switch (item.type) {
      case 1: {
        builtinFields = this.mapLoginFields(item);
        websites = this.mapLoginWebsites(item);
        break;
      }
      case 2:
        // Secure note body lives in top-level `notes`; no extra fields.
        break;
      case 3:
        builtinFields = this.mapCardFields(item);
        break;
      case 4: {
        const { builtin, extra } = this.mapIdentityFields(item, customFieldCount);
        builtinFields = builtin;
        customFields.push(...extra);
        break;
      }
      case 5:
        builtinFields = this.mapSshKeyFields(item);
        break;
    }

    const hasSshKey = item.type === 5 && Boolean(item.sshKey?.privateKey);
    const sections = this.buildSections(
      customFields.length > 0,
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
      attachmentFieldIds: this.buildAttachmentFieldIds(attachments),
    };
  }

  /** Username from a Bitwarden item, used for duplicate detection during merge. */
  extractBitwardenUsername(item: ParsedBitwardenItem): string {
    if (item.type === 1) return item.login?.username ?? "";
    if (item.type === 4) return item.identity?.username ?? "";
    return "";
  }

  /** Read the built-in username field from an existing 1Password item. */
  extractOnePasswordUsername(
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

  /** Map a Bitwarden numeric cipher type to the closest 1Password category. */
  static bitwardenTypeToCategory(
    type: ParsedBitwardenItem["type"],
  ): ItemCategory {
    return OnePasswordItemMapper.BW_TYPE_TO_CATEGORY[type];
  }

  /** Map Bitwarden login URIs to 1Password website autofill entries. */
  private mapLoginWebsites(
    item: ParsedBitwardenItem,
  ): ItemCreateParams["websites"] {
    const uris = item.login?.uris ?? [];
    return uris
      .filter((u) => u.uri != null && u.uri.trim() !== "")
      .map((u, index) => ({
        url: u.uri!.trim(),
        label: index === 0 ? "website" : `website ${index + 1}`,
        autofillBehavior: bitwardenUriMatchToAutofillBehavior(u.match),
      }));
  }

  private mapLoginFields(item: ParsedBitwardenItem): ItemField[] {
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

  private mapCardFields(item: ParsedBitwardenItem): ItemField[] {
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

    const expiry = this.formatCardExpiry(card.expMonth, card.expYear);
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

  /** Format Bitwarden exp month/year into 1Password's MM/YYYY MonthYear field. */
  private formatCardExpiry(
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

  /**
   * Map identity built-in fields and push unmapped Bitwarden fields into custom
   * section (title, middle name, SSN, passport, license).
   */
  private mapIdentityFields(
    item: ParsedBitwardenItem,
    customFieldStartIndex: number,
  ): {
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
    addBuiltin(
      "defphone",
      "default phone",
      identity.phone,
      ItemFieldType.Phone,
    );

    const addressField = this.buildAddressField(identity);
    if (addressField) builtin.push(addressField);

    const unmapped: Array<[string, string | null | undefined]> = [
      ["Title", identity.title],
      ["Middle name", identity.middleName],
      ["SSN", identity.ssn],
      ["Passport number", identity.passportNumber],
      ["License number", identity.licenseNumber],
    ];

    let customIndex = customFieldStartIndex;
    for (const [label, value] of unmapped) {
      if (value != null && value.trim() !== "") {
        extra.push({
          id: `cust_${customIndex}`,
          title: label,
          sectionId: OnePasswordItemMapper.CUSTOM_FIELDS_SECTION_ID,
          fieldType: ItemFieldType.Text,
          value: value.trim(),
        });
        customIndex++;
      }
    }

    return { builtin, extra };
  }

  /** Combine Bitwarden address lines into one 1Password Address field. */
  private buildAddressField(
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

  private mapSshKeyFields(item: ParsedBitwardenItem): ItemField[] {
    const sshKey = item.sshKey ?? {};
    if (!sshKey.privateKey) return [];

    return [
      {
        id: "private_key",
        title: "private key",
        sectionId: OnePasswordItemMapper.SSH_KEYS_SECTION_ID,
        fieldType: ItemFieldType.SshKey,
        value: sshKey.privateKey,
      },
    ];
  }

  /** Map Bitwarden custom field types to the closest 1Password field type. */
  private mapCustomField(
    field: BitwardenCustomField,
    index: number,
  ): ItemField {
    const id = `cust_${index}`;
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
    }

    return {
      id,
      title,
      sectionId: OnePasswordItemMapper.CUSTOM_FIELDS_SECTION_ID,
      fieldType,
      value,
    };
  }

  /** Stable field IDs for attachment upload (`attach_{sha1}` from file content). */
  private buildAttachmentFieldIds(
    attachments: BitwardenAttachment[],
  ): Map<string, string> {
    const map = new Map<string, string>();
    for (const attachment of attachments) {
      map.set(attachment.filePath, attachmentFieldIdFromPath(attachment.filePath));
    }
    return map;
  }

  private buildSections(
    hasCustomFields: boolean,
    hasAttachments: boolean,
    hasSshKey: boolean,
  ): ItemSection[] {
    const sections: ItemSection[] = [];

    if (hasSshKey) {
      sections.push({
        id: OnePasswordItemMapper.SSH_KEYS_SECTION_ID,
        title: OnePasswordItemMapper.SSH_KEYS_SECTION_TITLE,
      });
    }

    if (hasCustomFields) {
      sections.push({
        id: OnePasswordItemMapper.CUSTOM_FIELDS_SECTION_ID,
        title: OnePasswordItemMapper.CUSTOM_FIELDS_SECTION_TITLE,
      });
    }

    if (hasAttachments) {
      sections.push({
        id: OnePasswordItemMapper.ATTACHMENTS_SECTION_ID,
        title: OnePasswordItemMapper.ATTACHMENTS_SECTION_TITLE,
      });
    }

    return sections;
  }
}

// Re-export section ID constants for callers and tests.
export const CUSTOM_FIELDS_SECTION_ID =
  OnePasswordItemMapper.CUSTOM_FIELDS_SECTION_ID;
export const CUSTOM_FIELDS_SECTION_TITLE =
  OnePasswordItemMapper.CUSTOM_FIELDS_SECTION_TITLE;
export const ATTACHMENTS_SECTION_ID =
  OnePasswordItemMapper.ATTACHMENTS_SECTION_ID;
export const ATTACHMENTS_SECTION_TITLE =
  OnePasswordItemMapper.ATTACHMENTS_SECTION_TITLE;
export const SSH_KEYS_SECTION_ID = OnePasswordItemMapper.SSH_KEYS_SECTION_ID;
export const SSH_KEYS_SECTION_TITLE =
  OnePasswordItemMapper.SSH_KEYS_SECTION_TITLE;

/** Convenience wrapper using a default mapper instance. */
export function mapItem(
  item: ParsedBitwardenItem,
  exportData: ParsedBitwardenExport,
  vaultId: string,
  attachments: BitwardenAttachment[] = [],
): MappedItem {
  return new OnePasswordItemMapper().map(
    item,
    exportData,
    vaultId,
    attachments,
  );
}

export function extractBitwardenUsername(item: ParsedBitwardenItem): string {
  return new OnePasswordItemMapper().extractBitwardenUsername(item);
}

export function extractOnePasswordUsername(
  fields: ItemField[],
  category: ItemCategory,
): string {
  return new OnePasswordItemMapper().extractOnePasswordUsername(
    fields,
    category,
  );
}

export function bitwardenTypeToCategory(
  type: ParsedBitwardenItem["type"],
): ItemCategory {
  return OnePasswordItemMapper.bitwardenTypeToCategory(type);
}

/**
 * Map a Bitwarden URI match mode to 1Password autofill behavior.
 *
 * Regex URIs have no 1Password equivalent and are mapped to Never so users
 * can review and fix them manually after migration.
 */
export function bitwardenUriMatchToAutofillBehavior(
  match: number | null,
): AutofillBehavior {
  switch (match) {
    case 1:
    case 3:
      return AutofillBehavior.ExactDomain;
    case 4:
    case 5:
      return AutofillBehavior.Never;
    case 0:
    case 2:
    default:
      return AutofillBehavior.AnywhereOnWebsite;
  }
}
