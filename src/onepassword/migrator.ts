import { readAttachmentFile, scanAttachments } from "../bitwarden/attachments.js";
import { parseExport } from "../bitwarden/parse-export.js";
import type { ParsedBitwardenExport } from "../bitwarden/types.js";
import {
  ATTACHMENTS_SECTION_ID,
  mapItem,
} from "./item-mapper.js";
import {
  buildMatchIndex,
  decideMergeAction,
  existingAttachmentFieldIds,
  findMatches,
  overlayItem,
} from "./merge.js";
import type {
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

/** Run the full Bitwarden → 1Password migration. */
export async function migrate(
  client: OnePasswordClient,
  options: MigrateOptions,
): Promise<MigrationSummary> {
  const exportData = parseExport(options.bwDir);
  const matchIndex = await buildMatchIndex(client, options.vaultId);

  const summary: MigrationSummary = {
    created: 0,
    merged: 0,
    skipped: 0,
    failed: 0,
    attachmentsUploaded: 0,
    attachmentFailures: 0,
    aborted: false,
  };

  console.log(
    `Migrating ${exportData.items.length} item(s) (skipped ${exportData.skippedDeleted} deleted, ${exportData.skippedUnsupported} unsupported).`,
  );

  for (const item of exportData.items) {
    if (summary.aborted) break;

    const attachments = scanAttachments(options.bwDir, item.id);
    const mapped = mapItem(item, exportData, options.vaultId, attachments);
    const matchIds = findMatches(matchIndex, item);
    const decision = decideMergeAction(options.mergeStrategy, matchIds);

    if (decision.warning) {
      console.warn(`"${item.name}": ${decision.warning}`);
    }

    if (decision.action === "abort") {
      console.error(`Aborting migration: duplicate match for "${item.name}".`);
      summary.aborted = true;
      break;
    }

    if (decision.action === "skip") {
      console.log(`skip: ${item.name}`);
      summary.skipped++;
      continue;
    }

    if (options.dryRun) {
      console.log(`${decision.action}: ${item.name}`);
      if (decision.action === "create") summary.created++;
      if (decision.action === "merge") summary.merged++;
      if (attachments.length > 0) {
        console.log(`  attachments: ${attachments.map((a) => a.filename).join(", ")}`);
      }
      continue;
    }

    try {
      if (decision.action === "create") {
        const created = await client.items.create(mapped.params);
        summary.created++;
        console.log(`created: ${item.name} (${created.id})`);
        await uploadAttachments(
          client,
          created,
          mapped,
          options.bwDir,
          summary,
        );
      } else if (decision.action === "merge" && decision.targetItemId) {
        const existing = await client.items.get(
          options.vaultId,
          decision.targetItemId,
        );
        const updated = overlayItem(
          existing,
          mapped.params.fields ?? [],
          mapped.params.notes,
          mapped.params.tags,
          mapped.params.websites,
          mapped.params.sections,
        );
        const saved = await client.items.put(updated);
        summary.merged++;
        console.log(`merged: ${item.name} (${saved.id})`);
        await uploadAttachments(
          client,
          saved,
          mapped,
          options.bwDir,
          summary,
          existingAttachmentFieldIds(existing),
        );
      }
    } catch (error) {
      summary.failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`failed: ${item.name} — ${message}`);
    }
  }

  printSummary(summary, options.dryRun);
  return summary;
}

async function uploadAttachments(
  client: OnePasswordClient,
  item: Awaited<ReturnType<OnePasswordClient["items"]["create"]>>,
  mapped: ReturnType<typeof mapItem>,
  _bwDir: string,
  summary: MigrationSummary,
  skipFieldIds: Set<string> = new Set(),
): Promise<typeof item> {
  let current = item;

  for (const attachment of mapped.attachments) {
    const fieldId =
      mapped.attachmentFieldIds.get(attachment.filePath) ??
      attachment.filename;

    if (skipFieldIds.has(fieldId)) {
      continue;
    }

    try {
      const content = readAttachmentFile(attachment.filePath);
      current = await client.items.files.attach(current, {
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

function printSummary(summary: MigrationSummary, dryRun: boolean): void {
  const prefix = dryRun ? "[dry-run] " : "";
  console.log(
    `${prefix}Summary: created=${summary.created} merged=${summary.merged} skipped=${summary.skipped} failed=${summary.failed} attachments=${summary.attachmentsUploaded} attachment_failures=${summary.attachmentFailures}`,
  );
}

/** Export parse helper for tests. */
export { parseExport };
export type { ParsedBitwardenExport };
