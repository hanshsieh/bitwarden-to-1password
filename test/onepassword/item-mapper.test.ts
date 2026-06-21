import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseExport } from "../../src/bitwarden/export-parser.js";
import {
  BUILTIN_SECTION,
  BUILTIN_SECTION_ID,
  CUSTOM_SECTION,
  CUSTOM_SECTION_ID,
  OnePasswordItemMapper,
  bitwardenUriMatchToAutofillBehavior,
} from "../../src/onepassword/item-mapper.js";
import { attachmentFieldId } from "../../src/utils/attachment-field-id.js";
import { BITWARDEN_URI_MATCH } from "../../src/bitwarden/types.js";
import {
  AutofillBehavior,
  ItemCategory,
  ItemFieldType,
} from "@1password/sdk";

const FIXTURES = join(import.meta.dirname, "../fixtures/exports/personal-vault");

describe("item-mapper", () => {
  const parsed = parseExport(FIXTURES);
  const vaultId = "vault-test";
  const mapper = new OnePasswordItemMapper();

  it("maps login items with websites, TOTP, and custom fields", () => {
    const login = parsed.items.find((i) => i.type === 1)!;
    const mapped = mapper.map(login, parsed, vaultId);

    expect(mapped.params.category).toBe(ItemCategory.Login);
    expect(mapped.params.title).toBe("Example Login");
    expect(mapped.params.notes).toBe("Login notes");
    expect(mapped.params.tags).toEqual(["Work"]);

    const username = mapped.params.fields?.find((f) => f.id === "username");
    expect(username?.value).toBe("user@example.com");
    expect(username?.sectionId).toBeUndefined();

    const password = mapped.params.fields?.find((f) => f.id === "password");
    expect(password?.value).toBe("secret");
    expect(password?.sectionId).toBeUndefined();

    const totp = mapped.params.fields?.find(
      (f) => f.fieldType === ItemFieldType.Totp,
    );
    expect(totp?.value.includes("otpauth://")).toBe(true);
    expect(totp?.sectionId).toBe(CUSTOM_SECTION_ID);

    expect(mapped.params.websites).toHaveLength(2);
    expect(mapped.params.websites?.[0]?.url).toBe("https://example.com");
    expect(mapped.params.websites?.[0]?.autofillBehavior).toBe(
      AutofillBehavior.AnywhereOnWebsite,
    );

    const pin = mapped.params.fields?.find((f) => f.title === "Secret PIN");
    expect(pin?.fieldType).toBe(ItemFieldType.Concealed);
    expect(pin?.id).toBe("cust_1");
    expect(pin?.sectionId).toBe(CUSTOM_SECTION_ID);
    expect(mapped.params.sections).toEqual([CUSTOM_SECTION]);

    expect(
      mapped.params.fields?.some((f) => f.title.includes("Linked field")),
    ).toBe(false);
  });

  it("omits non-ASCII folder names from tags", () => {
    const item = parsed.items.find((i) => i.type === 1)!;
    const exportData = {
      ...parsed,
      folders: new Map([
        ...parsed.folders,
        ["folder-cloud-0001", "雲端空間"],
      ]),
    };
    const mapped = mapper.map(
      { ...item, folderId: "folder-cloud-0001" },
      exportData,
      vaultId,
    );

    expect(mapped.params.tags).toBeUndefined();
    expect(mapped.params.notes).toBe("Login notes");
  });

  it("maps secure note body to notes", () => {
    const note = parsed.items.find((i) => i.type === 2)!;
    const mapped = mapper.map(note, parsed, vaultId);
    expect(mapped.params.category).toBe(ItemCategory.SecureNote);
    expect(mapped.params.notes).toBe("Very secure note body");
  });

  it("maps credit card with MM/YYYY expiry", () => {
    const card = parsed.items.find((i) => i.type === 3)!;
    const mapped = mapper.map(card, parsed, vaultId);

    expect(mapped.params.category).toBe(ItemCategory.CreditCard);
    const expiry = mapped.params.fields?.find((f) => f.id === "expiry");
    expect(expiry?.value).toBe("03/2030");
    expect(expiry?.fieldType).toBe(ItemFieldType.MonthYear);
    expect(expiry?.sectionId).toBe(BUILTIN_SECTION_ID);
    expect(mapped.params.sections).toEqual([BUILTIN_SECTION]);
  });

  it("maps identity with address and extra custom fields", () => {
    const identity = parsed.items.find((i) => i.type === 4)!;
    const mapped = mapper.map(identity, parsed, vaultId);

    expect(mapped.params.category).toBe(ItemCategory.Identity);
    expect(mapper.extractBitwardenUsername(identity)).toBe("jpublic");

    const address = mapped.params.fields?.find((f) => f.id === "address");
    expect(address?.fieldType).toBe(ItemFieldType.Address);
    expect(address?.sectionId).toBe(BUILTIN_SECTION_ID);

    const ssn = mapped.params.fields?.find((f) => f.title === "SSN");
    expect(ssn?.value).toBe("123-45-6789");
    expect(ssn?.id ?? "").toMatch(/^cust_\d+$/);
    expect(ssn?.sectionId).toBe(CUSTOM_SECTION_ID);
    expect(mapped.params.sections).toEqual([BUILTIN_SECTION, CUSTOM_SECTION]);
  });

  it("maps SSH key private key field", () => {
    const ssh = parsed.items.find((i) => i.type === 5)!;
    const mapped = mapper.map(ssh, parsed, vaultId);

    expect(mapped.params.category).toBe(ItemCategory.SshKey);
    const privateKey = mapped.params.fields?.find((f) => f.id === "private_key");
    expect(privateKey?.fieldType).toBe(ItemFieldType.SshKey);
    expect(privateKey?.sectionId).toBe(CUSTOM_SECTION_ID);
    expect(mapped.params.sections).toEqual([CUSTOM_SECTION]);
  });

  it("places custom fields in the custom section and built-ins in the top section", () => {
    const note = parsed.items.find((i) => i.type === 2)!;
    const login = parsed.items.find((i) => i.type === 1)!;
    const mappedNote = mapper.map(note, parsed, vaultId);
    const mappedLogin = mapper.map(login, parsed, vaultId);

    expect(mappedNote.params.sections).toEqual([]);
    expect(mappedLogin.params.sections).toEqual([CUSTOM_SECTION]);

    const customFields =
      mappedLogin.params.fields?.filter((field) => field.id.startsWith("cust_")) ??
      [];
    expect(customFields.length).toBeGreaterThan(0);
    expect(
      customFields.every((field) => field.sectionId === CUSTOM_SECTION_ID),
    ).toBe(true);

    const builtInFields =
      mappedLogin.params.fields?.filter((field) =>
        ["username", "password"].includes(field.id),
      ) ?? [];
    expect(
      builtInFields.every((field) => field.sectionId === undefined),
    ).toBe(true);
  });

  it("maps attachment field IDs for upload", () => {
    const login = parsed.items.find((i) => i.type === 1)!;
    const dir = mkdtempSync(join(tmpdir(), "bw-mapper-"));
    const filePath = join(dir, "readme.txt");
    writeFileSync(filePath, "hello");
    const attachments = [
      {
        attachmentId: "att-1",
        filename: "readme.txt",
        filePath,
      },
    ];
    const mapped = mapper.map(login, parsed, vaultId, attachments);

    expect(mapped.params.sections).toEqual([CUSTOM_SECTION]);
    expect(mapped.attachmentFieldIds.get(filePath)).toBe(
      attachmentFieldId(Buffer.from("hello")),
    );
  });

  it("assigns content-based attachment field IDs for non-ASCII filenames", () => {
    const login = parsed.items.find((i) => i.type === 1)!;
    const dir = mkdtempSync(join(tmpdir(), "bw-mapper-"));
    const frontPath = join(dir, "front.jpg");
    const backPath = join(dir, "back.jpg");
    writeFileSync(frontPath, "front-bytes");
    writeFileSync(backPath, "back-bytes");
    const attachments = [
      {
        attachmentId: null,
        filename: "身分證正面.jpg",
        filePath: frontPath,
      },
      {
        attachmentId: null,
        filename: "身分證背面.jpg",
        filePath: backPath,
      },
    ];
    const mapped = mapper.map(login, parsed, vaultId, attachments);

    expect(mapped.attachmentFieldIds.get(frontPath)).toBe(
      attachmentFieldId(Buffer.from("front-bytes")),
    );
    expect(mapped.attachmentFieldIds.get(backPath)).toBe(
      attachmentFieldId(Buffer.from("back-bytes")),
    );
    expect(mapped.attachmentFieldIds.get(frontPath)).not.toBe(
      mapped.attachmentFieldIds.get(backPath),
    );
  });

  it("maps Bitwarden URI match modes to 1Password autofill behavior", () => {
    expect(
      bitwardenUriMatchToAutofillBehavior(BITWARDEN_URI_MATCH.Domain),
    ).toBe(AutofillBehavior.AnywhereOnWebsite);
    expect(bitwardenUriMatchToAutofillBehavior(BITWARDEN_URI_MATCH.Host)).toBe(
      AutofillBehavior.ExactDomain,
    );
    expect(
      bitwardenUriMatchToAutofillBehavior(BITWARDEN_URI_MATCH.StartsWith),
    ).toBe(AutofillBehavior.AnywhereOnWebsite);
    expect(bitwardenUriMatchToAutofillBehavior(BITWARDEN_URI_MATCH.Exact)).toBe(
      AutofillBehavior.ExactDomain,
    );
    expect(
      bitwardenUriMatchToAutofillBehavior(
        BITWARDEN_URI_MATCH.RegularExpression,
      ),
    ).toBe(AutofillBehavior.Never);
    expect(bitwardenUriMatchToAutofillBehavior(BITWARDEN_URI_MATCH.Never)).toBe(
      AutofillBehavior.Never,
    );
    expect(bitwardenUriMatchToAutofillBehavior(null)).toBe(
      AutofillBehavior.AnywhereOnWebsite,
    );
  });

  it("applies URI match behavior when mapping login websites", () => {
    const login = {
      ...parsed.items.find((i) => i.type === 1)!,
      login: {
        username: "user@example.com",
        password: "secret",
        uris: [
          { uri: "https://host.example.com", match: BITWARDEN_URI_MATCH.Host },
          {
            uri: "^https://.*\\.example\\.com$",
            match: BITWARDEN_URI_MATCH.RegularExpression,
          },
          { uri: "https://blocked.example.com", match: BITWARDEN_URI_MATCH.Never },
        ],
      },
    };
    const mapped = mapper.map(login, parsed, vaultId);

    expect(mapped.params.websites).toHaveLength(3);
    expect(mapped.params.websites?.[0]?.autofillBehavior).toBe(
      AutofillBehavior.ExactDomain,
    );
    expect(mapped.params.websites?.[1]?.autofillBehavior).toBe(
      AutofillBehavior.Never,
    );
    expect(mapped.params.websites?.[2]?.autofillBehavior).toBe(
      AutofillBehavior.Never,
    );
  });
});
