import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { parseExport } from "../../src/bitwarden/export-parser.js";
import {
  ATTACHMENTS_SECTION_ID,
  SSH_KEYS_SECTION_ID,
  bitwardenUriMatchToAutofillBehavior,
  extractBitwardenUsername,
  mapItem,
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

  it("maps login items with websites, TOTP, and custom fields", () => {
    const login = parsed.items.find((i) => i.type === 1)!;
    const mapped = mapItem(login, parsed, vaultId);

    assert.equal(mapped.params.category, ItemCategory.Login);
    assert.equal(mapped.params.title, "Example Login");
    assert.equal(mapped.params.notes, "Login notes");
    assert.deepEqual(mapped.params.tags, ["Work"]);

    const username = mapped.params.fields?.find((f) => f.id === "username");
    assert.equal(username?.value, "user@example.com");

    const totp = mapped.params.fields?.find(
      (f) => f.fieldType === ItemFieldType.Totp,
    );
    assert.ok(totp?.value.includes("otpauth://"));

    assert.equal(mapped.params.websites?.length, 2);
    assert.equal(mapped.params.websites?.[0]?.url, "https://example.com");
    assert.equal(
      mapped.params.websites?.[0]?.autofillBehavior,
      AutofillBehavior.AnywhereOnWebsite,
    );

    const pin = mapped.params.fields?.find((f) => f.title === "Secret PIN");
    assert.equal(pin?.fieldType, ItemFieldType.Concealed);
    assert.equal(pin?.id, "cust_1");
    assert.equal(pin?.sectionId, undefined);

    assert.ok(
      !mapped.params.fields?.some((f) => f.title.includes("Linked field")),
    );
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
    const mapped = mapItem(
      { ...item, folderId: "folder-cloud-0001" },
      exportData,
      vaultId,
    );

    assert.equal(mapped.params.tags, undefined);
    assert.equal(mapped.params.notes, "Login notes");
  });

  it("maps secure note body to notes", () => {
    const note = parsed.items.find((i) => i.type === 2)!;
    const mapped = mapItem(note, parsed, vaultId);
    assert.equal(mapped.params.category, ItemCategory.SecureNote);
    assert.equal(mapped.params.notes, "Very secure note body");
  });

  it("maps credit card with MM/YYYY expiry", () => {
    const card = parsed.items.find((i) => i.type === 3)!;
    const mapped = mapItem(card, parsed, vaultId);

    assert.equal(mapped.params.category, ItemCategory.CreditCard);
    const expiry = mapped.params.fields?.find((f) => f.id === "expiry");
    assert.equal(expiry?.value, "03/2030");
    assert.equal(expiry?.fieldType, ItemFieldType.MonthYear);
  });

  it("maps identity with address and extra custom fields", () => {
    const identity = parsed.items.find((i) => i.type === 4)!;
    const mapped = mapItem(identity, parsed, vaultId);

    assert.equal(mapped.params.category, ItemCategory.Identity);
    assert.equal(extractBitwardenUsername(identity), "jpublic");

    const address = mapped.params.fields?.find((f) => f.id === "address");
    assert.equal(address?.fieldType, ItemFieldType.Address);

    const ssn = mapped.params.fields?.find((f) => f.title === "SSN");
    assert.equal(ssn?.value, "123-45-6789");
    assert.match(ssn?.id ?? "", /^cust_\d+$/);
    assert.equal(ssn?.sectionId, undefined);
  });

  it("maps SSH key private key field", () => {
    const ssh = parsed.items.find((i) => i.type === 5)!;
    const mapped = mapItem(ssh, parsed, vaultId);

    assert.equal(mapped.params.category, ItemCategory.SshKey);
    const privateKey = mapped.params.fields?.find((f) => f.id === "private_key");
    assert.equal(privateKey?.fieldType, ItemFieldType.SshKey);
    assert.equal(privateKey?.sectionId, SSH_KEYS_SECTION_ID);
  });

  it("adds attachment section placeholders", () => {
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
    const mapped = mapItem(login, parsed, vaultId, attachments);

    assert.ok(
      mapped.params.sections?.some((s) => s.id === ATTACHMENTS_SECTION_ID),
    );
    assert.equal(
      mapped.attachmentFieldIds.get(filePath),
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
    const mapped = mapItem(login, parsed, vaultId, attachments);

    assert.equal(
      mapped.attachmentFieldIds.get(frontPath),
      attachmentFieldId(Buffer.from("front-bytes")),
    );
    assert.equal(
      mapped.attachmentFieldIds.get(backPath),
      attachmentFieldId(Buffer.from("back-bytes")),
    );
    assert.notEqual(
      mapped.attachmentFieldIds.get(frontPath),
      mapped.attachmentFieldIds.get(backPath),
    );
  });

  it("maps Bitwarden URI match modes to 1Password autofill behavior", () => {
    assert.equal(
      bitwardenUriMatchToAutofillBehavior(BITWARDEN_URI_MATCH.Domain),
      AutofillBehavior.AnywhereOnWebsite,
    );
    assert.equal(
      bitwardenUriMatchToAutofillBehavior(BITWARDEN_URI_MATCH.Host),
      AutofillBehavior.ExactDomain,
    );
    assert.equal(
      bitwardenUriMatchToAutofillBehavior(BITWARDEN_URI_MATCH.StartsWith),
      AutofillBehavior.AnywhereOnWebsite,
    );
    assert.equal(
      bitwardenUriMatchToAutofillBehavior(BITWARDEN_URI_MATCH.Exact),
      AutofillBehavior.ExactDomain,
    );
    assert.equal(
      bitwardenUriMatchToAutofillBehavior(
        BITWARDEN_URI_MATCH.RegularExpression,
      ),
      AutofillBehavior.Never,
    );
    assert.equal(
      bitwardenUriMatchToAutofillBehavior(BITWARDEN_URI_MATCH.Never),
      AutofillBehavior.Never,
    );
    assert.equal(
      bitwardenUriMatchToAutofillBehavior(null),
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
    const mapped = mapItem(login, parsed, vaultId);

    assert.equal(mapped.params.websites?.length, 3);
    assert.equal(
      mapped.params.websites?.[0]?.autofillBehavior,
      AutofillBehavior.ExactDomain,
    );
    assert.equal(
      mapped.params.websites?.[1]?.autofillBehavior,
      AutofillBehavior.Never,
    );
    assert.equal(
      mapped.params.websites?.[2]?.autofillBehavior,
      AutofillBehavior.Never,
    );
  });
});
