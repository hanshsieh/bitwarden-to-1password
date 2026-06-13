import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseExport } from "../../src/bitwarden/export-parser.js";
import {
  ATTACHMENTS_SECTION_ID,
  CUSTOM_FIELDS_SECTION_ID,
  SSH_KEYS_SECTION_ID,
  bitwardenUriMatchToAutofillBehavior,
  extractBitwardenUsername,
  mapItem,
} from "../../src/onepassword/item-mapper.js";
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
    assert.equal(pin?.sectionId, CUSTOM_FIELDS_SECTION_ID);

    assert.ok(
      !mapped.params.fields?.some((f) => f.title.includes("Linked field")),
    );
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
    const attachments = [
      {
        attachmentId: "att-1",
        filename: "readme.txt",
        filePath: "/tmp/readme.txt",
      },
    ];
    const mapped = mapItem(login, parsed, vaultId, attachments);

    assert.ok(
      mapped.params.sections?.some((s) => s.id === ATTACHMENTS_SECTION_ID),
    );
    assert.ok(mapped.attachmentFieldIds.get("/tmp/readme.txt"));
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
