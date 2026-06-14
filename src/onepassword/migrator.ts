import type { Item } from "@1password/sdk";
import { BitwardenAttachmentScanner } from "../bitwarden/attachment-scanner.js";
import { BitwardenExportParser } from "../bitwarden/export-parser.js";
import type { ParsedBitwardenExport } from "../bitwarden/types.js";
import {
  hasFido2Credentials,
  hasLinkedCustomFields,
  hasRegexLoginUri,
  isArchivedItem,
} from "../bitwarden/types.js";
import {
  hasNonAsciiBitwardenLabels,
} from "./tags.js";
import {
  ATTACHMENTS_SECTION_ID,
  OnePasswordItemMapper,
} from "./item-mapper.js";
import { MergeEngine, type MatchIndex } from "./merge-engine.js";
import type {
  MappedItem,
  MergeStrategy,
  MigrationSummary,
  OnePasswordClient,
} from "./types.js";
import { formatCountTable } from "../utils/format-table.js";

export interface MigrateOptions {
  bwDir: string;
  vaultId: string;
  mergeStrategy: MergeStrategy;
  dryRun: boolean;
}

/**
 * Orchestrates a full Bitwarden export → 1Password vault migration.
 *
 * Composes an export parser, item mapper, attachment scanner, and merge engine.
 * Each export item is mapped, checked for duplicates, then created or synced.
 * Attachments are uploaded after the parent item exists in 1Password.
 */
export class Migrator {
  private readonly exportParser: BitwardenExportParser;
  private readonly itemMapper: OnePasswordItemMapper;
  private readonly mergeEngine: MergeEngine;

  constructor(
    private readonly client: OnePasswordClient,
    deps?: {
      exportParser?: BitwardenExportParser;
      itemMapper?: OnePasswordItemMapper;
    },
  ) {
    this.exportParser = deps?.exportParser ?? new BitwardenExportParser();
    this.itemMapper = deps?.itemMapper ?? new OnePasswordItemMapper();
    this.mergeEngine = new MergeEngine(client, this.itemMapper);
  }

  /**
   * Run migration for all items in the export directory.
   *
   * @returns Summary counters and whether the run was aborted (abort strategy).
   */
  async migrate(options: MigrateOptions): Promise<MigrationSummary> {
    const exportData = this.exportParser.parse(options.bwDir);
    const attachmentScanner = new BitwardenAttachmentScanner(options.bwDir);
    const matchIndex = await this.mergeEngine.buildIndex(options.vaultId);

    const summary = this.emptySummary();

    console.log(
      `Migrating ${exportData.items.length} item(s) (skipped ${exportData.skippedDeleted} deleted, ${exportData.skippedUnsupported} unsupported).`,
    );

    for (const item of exportData.items) {
      if (summary.aborted) break;

      await this.processItem(
        item,
        exportData,
        options,
        attachmentScanner,
        matchIndex,
        summary,
      );
    }

    summary.fidoCredentialsSkipped = this.collectFidoCredentialSkippedItems(
      exportData.items,
    );
    summary.linkedFieldsSkipped = this.collectLinkedFieldSkippedItems(
      exportData.items,
    );
    summary.regexUrlItems = this.collectRegexUrlItems(exportData.items);
    this.printSummary(summary, options.dryRun);
    return summary;
  }

  /** Process one export cipher: decide action, create/merge/skip, upload files. */
  private async processItem(
    item: ParsedBitwardenExport["items"][number],
    exportData: ParsedBitwardenExport,
    options: MigrateOptions,
    attachmentScanner: BitwardenAttachmentScanner,
    matchIndex: MatchIndex,
    summary: MigrationSummary,
  ): Promise<void> {
    const attachments = attachmentScanner.scanForItem(item.id);
    const mapped = this.itemMapper.map(
      item,
      exportData,
      options.vaultId,
      attachments,
    );
    const matchIds = this.mergeEngine.findMatches(matchIndex, item);
    const decision = MergeEngine.decide(options.mergeStrategy, matchIds);

    if (decision.warning) {
      console.warn(`"${item.name}": ${decision.warning}`);
    }

    if (decision.action === "abort") {
      console.error(`Aborting migration: duplicate match for "${item.name}".`);
      summary.aborted = true;
      return;
    }

    if (decision.action === "skip") {
      console.log(`skip: ${item.name}`);
      summary.skipped++;
      return;
    }

    if (options.dryRun) {
      this.logDryRunAction(decision.action, item, attachments);
      if (decision.action === "create") {
        summary.created++;
        this.recordNonAsciiTagsSkippedForExport(item, exportData, summary);
      }
      if (decision.action === "update") summary.updated++;
      return;
    }

    try {
      if (decision.action === "create") {
        await this.createItem(
          item,
          exportData,
          mapped,
          options.vaultId,
          attachmentScanner,
          summary,
        );
      } else if (decision.action === "update" && decision.targetItemId) {
        await this.updateItem(
          item,
          exportData,
          options.vaultId,
          decision.targetItemId,
          mapped,
          attachmentScanner,
          matchIndex,
          summary,
        );
      }
    } catch (error) {
      summary.failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`failed: ${item.name} — ${message}`);
    }
  }

  private async createItem(
    sourceItem: ParsedBitwardenExport["items"][number],
    exportData: ParsedBitwardenExport,
    mapped: MappedItem,
    vaultId: string,
    attachmentScanner: BitwardenAttachmentScanner,
    summary: MigrationSummary,
  ): Promise<void> {
    const created = await this.client.items.create(mapped.params);
    summary.created++;
    this.recordNonAsciiTagsSkippedForExport(sourceItem, exportData, summary);
    console.log(`created: ${sourceItem.name} (${created.id})`);
    const withAttachments = await this.uploadAttachments(
      created,
      mapped,
      attachmentScanner,
      summary,
    );
    await this.applyArchivedState(
      vaultId,
      withAttachments.id,
      sourceItem,
      summary,
    );
  }

  private async updateItem(
    sourceItem: ParsedBitwardenExport["items"][number],
    exportData: ParsedBitwardenExport,
    vaultId: string,
    targetItemId: string,
    mapped: MappedItem,
    attachmentScanner: BitwardenAttachmentScanner,
    matchIndex: MatchIndex,
    summary: MigrationSummary,
  ): Promise<void> {
    const existing = MergeEngine.getCachedItem(matchIndex, targetItemId);
    const expectedFiles = MergeEngine.expectedFilesFromMapped(mapped);
    const desired = MergeEngine.buildDesiredItem(
      existing,
      mapped.params,
      expectedFiles,
    );

    let current = existing;
    const fieldContentMatches = MergeEngine.itemContentMatchesDesired(
      existing,
      desired,
    );
    const filesMatch = MergeEngine.filesMatchExpected(
      existing.files,
      expectedFiles,
    );
    const needsUpdate = !fieldContentMatches || !filesMatch;

    if (!fieldContentMatches) {
      if (hasNonAsciiBitwardenLabels(sourceItem, exportData)) {
        this.recordNonAsciiTagsSkipped(summary, sourceItem.name);
      }
      const toWrite = MergeEngine.applyDesiredContent(
        structuredClone(existing),
        desired,
      );
      current = await this.client.items.put(toWrite);
      MergeEngine.setCachedItem(matchIndex, current);
    }

    if (!filesMatch) {
      current = await this.syncAttachments(
        current,
        mapped,
        attachmentScanner,
        summary,
      );
      MergeEngine.setCachedItem(matchIndex, current);
    }

    if (needsUpdate) {
      summary.updated++;
      console.log(`updated: ${sourceItem.name} (${current.id})`);
    } else {
      summary.unchanged++;
      console.log(`unchanged: ${sourceItem.name} (${existing.id})`);
    }

    await this.applyArchivedState(
      vaultId,
      current.id,
      sourceItem,
      summary,
    );
  }

  /**
   * Move a migrated item to the 1Password Archive when Bitwarden had archived it.
   * Active export items are left active (1Password has no "unarchive" step here).
   */
  private async applyArchivedState(
    vaultId: string,
    itemId: string,
    sourceItem: ParsedBitwardenExport["items"][number],
    summary: MigrationSummary,
  ): Promise<void> {
    if (!isArchivedItem(sourceItem)) {
      return;
    }

    try {
      await this.client.items.archive(vaultId, itemId);
      summary.archived++;
      console.log(`archived: ${sourceItem.name} (${itemId})`);
    } catch (error) {
      summary.archiveFailures++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `archive failed: ${sourceItem.name} (${itemId}) — ${message}`,
      );
    }
  }

  /**
   * Replace item attachments with the export: remove all existing files,
   * then attach every file from the export.
   */
  private async syncAttachments(
    item: Item,
    mapped: MappedItem,
    attachmentScanner: BitwardenAttachmentScanner,
    summary: MigrationSummary,
  ): Promise<Item> {
    let current = item;

    for (const file of [...current.files]) {
      try {
        current = await this.client.items.files.delete(
          current,
          file.sectionId,
          file.fieldId,
        );
      } catch (error) {
        summary.attachmentFailures++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `attachment delete failed: ${file.attributes.name} on "${item.title}" — ${message}`,
        );
      }
    }

    for (const attachment of mapped.attachments) {
      const fieldId =
        mapped.attachmentFieldIds.get(attachment.filePath) ??
        attachment.filename;

      try {
        const content = attachmentScanner.readFile(attachment);
        current = await this.client.items.files.attach(current, {
          name: attachment.filename,
          content,
          sectionId: ATTACHMENTS_SECTION_ID,
          fieldId,
        });
        summary.attachmentsUploaded++;
      } catch (error) {
        summary.attachmentFailures++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `attachment failed: ${attachment.filename} on "${item.title}" — ${message}`,
        );
      }
    }

    return current;
  }

  /** Attach all export files to a newly created item. */
  private async uploadAttachments(
    item: Item,
    mapped: MappedItem,
    attachmentScanner: BitwardenAttachmentScanner,
    summary: MigrationSummary,
  ): Promise<Item> {
    let current = item;
    const skipFieldIds = MergeEngine.existingAttachmentFieldIds(current);

    for (const attachment of mapped.attachments) {
      const fieldId =
        mapped.attachmentFieldIds.get(attachment.filePath) ??
        attachment.filename;

      if (skipFieldIds.has(fieldId)) {
        continue;
      }

      try {
        const content = attachmentScanner.readFile(attachment);
        current = await this.client.items.files.attach(current, {
          name: attachment.filename,
          content,
          sectionId: ATTACHMENTS_SECTION_ID,
          fieldId,
        });
        skipFieldIds.add(fieldId);
        summary.attachmentsUploaded++;
      } catch (error) {
        summary.attachmentFailures++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `attachment failed: ${attachment.filename} on "${item.title}" — ${message}`,
        );
      }
    }

    return current;
  }

  private logDryRunAction(
    action: "create" | "update",
    item: ParsedBitwardenExport["items"][number],
    attachments: MappedItem["attachments"],
  ): void {
    const archivedSuffix = isArchivedItem(item) ? " (will archive)" : "";
    console.log(`${action}: ${item.name}${archivedSuffix}`);
    if (attachments.length > 0) {
      console.log(
        `  attachments: ${attachments.map((a) => a.filename).join(", ")}`,
      );
    }
  }

  private collectFidoCredentialSkippedItems(
    items: ParsedBitwardenExport["items"],
  ): string[] {
    return items.filter(hasFido2Credentials).map((item) => item.name);
  }

  private collectLinkedFieldSkippedItems(
    items: ParsedBitwardenExport["items"],
  ): string[] {
    return items.filter(hasLinkedCustomFields).map((item) => item.name);
  }

  private recordNonAsciiTagsSkippedForExport(
    item: ParsedBitwardenExport["items"][number],
    exportData: ParsedBitwardenExport,
    summary: MigrationSummary,
  ): void {
    if (hasNonAsciiBitwardenLabels(item, exportData)) {
      this.recordNonAsciiTagsSkipped(summary, item.name);
    }
  }

  private recordNonAsciiTagsSkipped(
    summary: MigrationSummary,
    itemName: string,
  ): void {
    if (!summary.nonAsciiTagsSkipped.includes(itemName)) {
      summary.nonAsciiTagsSkipped.push(itemName);
    }
  }

  private collectRegexUrlItems(
    items: ParsedBitwardenExport["items"],
  ): string[] {
    return items.filter(hasRegexLoginUri).map((item) => item.name);
  }

  private emptySummary(): MigrationSummary {
    return {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      attachmentsUploaded: 0,
      attachmentFailures: 0,
      archived: 0,
      archiveFailures: 0,
      fidoCredentialsSkipped: [],
      linkedFieldsSkipped: [],
      nonAsciiTagsSkipped: [],
      regexUrlItems: [],
      aborted: false,
    };
  }

  private printSummary(summary: MigrationSummary, dryRun: boolean): void {
    const prefix = dryRun ? "[dry-run] " : "";
    console.log(
      formatCountTable(`${prefix}Summary`, [
        { label: "Created", value: summary.created },
        { label: "Updated", value: summary.updated },
        { label: "Unchanged", value: summary.unchanged },
        { label: "Skipped", value: summary.skipped },
        { label: "Failed", value: summary.failed },
        { label: "Archived", value: summary.archived },
        { label: "Archive failures", value: summary.archiveFailures },
        { label: "Attachments", value: summary.attachmentsUploaded },
        { label: "Attachment failures", value: summary.attachmentFailures },
        {
          label: "FIDO2 credentials skipped",
          value: summary.fidoCredentialsSkipped.length,
        },
        {
          label: "Linked fields skipped",
          value: summary.linkedFieldsSkipped.length,
        },
        {
          label: "Non-ASCII tags skipped",
          value: summary.nonAsciiTagsSkipped.length,
        },
        { label: "Regex URL items", value: summary.regexUrlItems.length },
      ]),
    );

    if (summary.fidoCredentialsSkipped.length > 0) {
      console.log(
        `${prefix}FIDO2 credentials not migrated (1Password SDK does not support passkeys):`,
      );
      for (const name of summary.fidoCredentialsSkipped) {
        console.log(`  - ${name}`);
      }
    }

    if (summary.linkedFieldsSkipped.length > 0) {
      console.log(
        `${prefix}Linked custom fields not migrated (1Password has no linked field type):`,
      );
      for (const name of summary.linkedFieldsSkipped) {
        console.log(`  - ${name}`);
      }
    }

    if (summary.nonAsciiTagsSkipped.length > 0) {
      console.log(
        `${prefix}Non-ASCII tags omitted (SDK tags must be ASCII):`,
      );
      for (const name of summary.nonAsciiTagsSkipped) {
        console.log(`  - ${name}`);
      }
    }

    if (summary.regexUrlItems.length > 0) {
      console.log(
        `${prefix}Regex URLs mapped to Never autofill (review and update manually):`,
      );
      for (const name of summary.regexUrlItems) {
        console.log(`  - ${name}`);
      }
    }
  }
}

/** Convenience wrapper using a default migrator instance. */
export async function migrate(
  client: OnePasswordClient,
  options: MigrateOptions,
): Promise<MigrationSummary> {
  return new Migrator(client).migrate(options);
}

export { BitwardenExportParser, parseExport } from "../bitwarden/export-parser.js";
export type { ParsedBitwardenExport };
