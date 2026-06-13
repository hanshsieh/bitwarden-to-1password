import type { Item } from "@1password/sdk";
import { BitwardenAttachmentScanner } from "../bitwarden/attachment-scanner.js";
import { BitwardenExportParser } from "../bitwarden/export-parser.js";
import type { ParsedBitwardenExport } from "../bitwarden/types.js";
import {
  ATTACHMENTS_SECTION_ID,
  OnePasswordItemMapper,
} from "./item-mapper.js";
import { MergeEngine } from "./merge-engine.js";
import type {
  MappedItem,
  MergeStrategy,
  MigrationSummary,
  OnePasswordClient,
} from "./types.js";

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
 * Each export item is mapped, checked for duplicates, then created or merged.
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

    this.printSummary(summary, options.dryRun);
    return summary;
  }

  /** Process one export cipher: decide action, create/merge/skip, upload files. */
  private async processItem(
    item: ParsedBitwardenExport["items"][number],
    exportData: ParsedBitwardenExport,
    options: MigrateOptions,
    attachmentScanner: BitwardenAttachmentScanner,
    matchIndex: Awaited<ReturnType<MergeEngine["buildIndex"]>>,
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
      this.logDryRunAction(decision.action, item.name, attachments);
      if (decision.action === "create") summary.created++;
      if (decision.action === "merge") summary.merged++;
      return;
    }

    try {
      if (decision.action === "create") {
        await this.createItem(item.name, mapped, attachmentScanner, summary);
      } else if (decision.action === "merge" && decision.targetItemId) {
        await this.mergeItem(
          item.name,
          options.vaultId,
          decision.targetItemId,
          mapped,
          attachmentScanner,
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
    itemName: string,
    mapped: MappedItem,
    attachmentScanner: BitwardenAttachmentScanner,
    summary: MigrationSummary,
  ): Promise<void> {
    const created = await this.client.items.create(mapped.params);
    summary.created++;
    console.log(`created: ${itemName} (${created.id})`);
    await this.uploadAttachments(
      created,
      mapped,
      attachmentScanner,
      summary,
    );
  }

  private async mergeItem(
    itemName: string,
    vaultId: string,
    targetItemId: string,
    mapped: MappedItem,
    attachmentScanner: BitwardenAttachmentScanner,
    summary: MigrationSummary,
  ): Promise<void> {
    const existing = await this.client.items.get(vaultId, targetItemId);
    const updated = MergeEngine.overlay(
      existing,
      mapped.params.fields ?? [],
      mapped.params.notes,
      mapped.params.tags,
      mapped.params.websites,
      mapped.params.sections,
    );
    const saved = await this.client.items.put(updated);
    summary.merged++;
    console.log(`merged: ${itemName} (${saved.id})`);
    await this.uploadAttachments(
      saved,
      mapped,
      attachmentScanner,
      summary,
      MergeEngine.existingAttachmentFieldIds(existing),
    );
  }

  /** Attach export files to a 1Password item, skipping field IDs already present. */
  private async uploadAttachments(
    item: Item,
    mapped: MappedItem,
    attachmentScanner: BitwardenAttachmentScanner,
    summary: MigrationSummary,
    skipFieldIds: Set<string> = new Set(),
  ): Promise<Item> {
    let current = item;

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
    action: "create" | "merge",
    itemName: string,
    attachments: MappedItem["attachments"],
  ): void {
    console.log(`${action}: ${itemName}`);
    if (attachments.length > 0) {
      console.log(
        `  attachments: ${attachments.map((a) => a.filename).join(", ")}`,
      );
    }
  }

  private emptySummary(): MigrationSummary {
    return {
      created: 0,
      merged: 0,
      skipped: 0,
      failed: 0,
      attachmentsUploaded: 0,
      attachmentFailures: 0,
      aborted: false,
    };
  }

  private printSummary(summary: MigrationSummary, dryRun: boolean): void {
    const prefix = dryRun ? "[dry-run] " : "";
    console.log(
      `${prefix}Summary: created=${summary.created} merged=${summary.merged} skipped=${summary.skipped} failed=${summary.failed} attachments=${summary.attachmentsUploaded} attachment_failures=${summary.attachmentFailures}`,
    );
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
