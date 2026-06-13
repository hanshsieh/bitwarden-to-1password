import { z } from "zod";

/** Cipher types this tool migrates (Login through SSH Key). */
export const SUPPORTED_CIPHER_TYPES = [1, 2, 3, 4, 5] as const;

export type SupportedCipherType = (typeof SUPPORTED_CIPHER_TYPES)[number];

/** Type-specific sub-object key required for each supported cipher type. */
export const CIPHER_SUB_OBJECT_KEY: Record<
  SupportedCipherType,
  "login" | "secureNote" | "card" | "identity" | "sshKey"
> = {
  1: "login",
  2: "secureNote",
  3: "card",
  4: "identity",
  5: "sshKey",
};

export const bitwardenCustomFieldSchema = z.object({
  name: z.string(),
  value: z.string().nullable(),
  type: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  linkedId: z.number().nullable(),
});

export const bitwardenLoginUriSchema = z.object({
  uri: z.string().nullable(),
  match: z.number().nullable(),
});

export const bitwardenLoginSchema = z.object({
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  totp: z.string().nullable().optional(),
  uris: z.array(bitwardenLoginUriSchema).optional(),
});

export const bitwardenSecureNoteSchema = z.object({
  type: z.number().optional(),
});

export const bitwardenCardSchema = z.object({
  cardholderName: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  number: z.string().nullable().optional(),
  expMonth: z.string().nullable().optional(),
  expYear: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
});

export const bitwardenIdentitySchema = z.object({
  title: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  middleName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  address1: z.string().nullable().optional(),
  address2: z.string().nullable().optional(),
  address3: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  ssn: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  passportNumber: z.string().nullable().optional(),
  licenseNumber: z.string().nullable().optional(),
});

export const bitwardenSshKeySchema = z.object({
  privateKey: z.string().nullable().optional(),
  publicKey: z.string().nullable().optional(),
  keyFingerprint: z.string().nullable().optional(),
});

export const bitwardenPasswordHistoryEntrySchema = z.object({
  lastUsedDate: z.string(),
  password: z.string(),
});

/**
 * Schema for a single cipher in a Bitwarden export `items` array.
 *
 * Unsupported cipher types are allowed at parse time; they are filtered out
 * later. Supported types must include their type-specific sub-object.
 */
export const bitwardenItemSchema = z
  .object({
    id: z.string().optional(),
    type: z.number(),
    name: z.string().min(1),
    notes: z.string().nullable().optional(),
    favorite: z.boolean().optional(),
    reprompt: z.number().optional(),
    folderId: z.string().nullable().optional(),
    organizationId: z.string().nullable().optional(),
    collectionIds: z.array(z.string()).nullable().optional(),
    fields: z.array(bitwardenCustomFieldSchema).optional(),
    passwordHistory: z
      .array(bitwardenPasswordHistoryEntrySchema)
      .nullable()
      .optional(),
    creationDate: z.string().optional(),
    revisionDate: z.string().optional(),
    deletedDate: z.string().nullable().optional(),
    login: bitwardenLoginSchema.optional(),
    secureNote: bitwardenSecureNoteSchema.optional(),
    card: bitwardenCardSchema.optional(),
    identity: bitwardenIdentitySchema.optional(),
    sshKey: bitwardenSshKeySchema.optional(),
  })
  .superRefine((item, ctx) => {
    if (!isSupportedCipherType(item.type)) {
      return;
    }

    const subKey = CIPHER_SUB_OBJECT_KEY[item.type];
    const subObject = item[subKey];
    if (subObject === undefined || subObject === null) {
      ctx.addIssue({
        code: "custom",
        message: `Item "${item.name}" (type ${item.type}) is missing required sub-object "${subKey}".`,
      });
    }
  });

export const bitwardenFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const bitwardenCollectionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  externalId: z.string().nullable().optional(),
});

/** Password-protected export envelope (rejected before plaintext parsing). */
export const encryptedExportEnvelopeSchema = z
  .object({
    encrypted: z.literal(true),
  })
  .passthrough();

/**
 * Plaintext personal/organization vault export root object.
 * Requires an `items` array; folder and collection arrays are optional.
 */
export const bitwardenExportSchema = z.object({
  encrypted: z.literal(false).optional(),
  folders: z.array(bitwardenFolderSchema).optional(),
  collections: z.array(bitwardenCollectionSchema).optional(),
  items: z.array(bitwardenItemSchema),
});

export type BitwardenItemInput = z.infer<typeof bitwardenItemSchema>;
export type BitwardenExportInput = z.infer<typeof bitwardenExportSchema>;

/** True when `type` is one of the cipher types this tool migrates. */
export function isSupportedCipherType(
  type: number,
): type is SupportedCipherType {
  return (SUPPORTED_CIPHER_TYPES as readonly number[]).includes(type);
}

/**
 * Detect encrypted exports before validating plaintext structure.
 *
 * Encrypted envelopes omit the `items` array, so this check must run first.
 */
export function assertPlaintextExport(data: unknown): void {
  if (encryptedExportEnvelopeSchema.safeParse(data).success) {
    throw new Error(
      "Encrypted Bitwarden export detected. Export an unencrypted .zip (with attachments) from Bitwarden and extract it before migrating.",
    );
  }
}

/** Parse and validate the root export JSON object. */
export function parseBitwardenExport(data: unknown): BitwardenExportInput {
  assertPlaintextExport(data);

  const result = bitwardenExportSchema.safeParse(data);
  if (!result.success) {
    throw formatExportValidationError(result.error);
  }

  return result.data;
}

/** Map a Zod export-level error to a user-facing message. */
function formatExportValidationError(error: z.ZodError): Error {
  for (const issue of error.issues) {
    if (issue.path[0] === "items") {
      if (issue.path.length === 1 && issue.code === "invalid_type") {
        return new Error('Export is missing required "items" array.');
      }

      const index = issue.path[1];
      if (typeof index === "number") {
        const field = issue.path[2];
        if (field === "type") {
          return new Error(
            `Item at index ${index} is missing required field "type".`,
          );
        }
        if (field === "name") {
          return new Error(
            `Item at index ${index} is missing required field "name".`,
          );
        }
        if (issue.code === "custom") {
          return new Error(issue.message);
        }
      }
    }
  }

  const detail = error.issues.map((i) => i.message).join("; ");
  return new Error(`Invalid Bitwarden export: ${detail}`);
}
