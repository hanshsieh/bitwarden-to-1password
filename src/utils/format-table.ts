/** One label/count row in a terminal summary table. */
export interface CountTableRow {
  label: string;
  value: number;
}

/**
 * Render label/count rows as a bordered ASCII table for CLI output.
 */
export function formatCountTable(
  title: string,
  rows: readonly CountTableRow[],
): string {
  const labelWidth = Math.max(
    "Metric".length,
    ...rows.map((row) => row.label.length),
  );
  const valueWidth = Math.max(
    "Count".length,
    ...rows.map((row) => String(row.value).length),
  );

  const border = (
    left: string,
    middle: string,
    right: string,
    fill: string,
  ): string =>
    `${left}${fill.repeat(labelWidth + 2)}${middle}${fill.repeat(valueWidth + 2)}${right}`;

  const row = (label: string, value: string): string =>
    `│ ${label.padEnd(labelWidth)} │ ${value.padStart(valueWidth)} │`;

  return [
    title,
    border("┌", "┬", "┐", "─"),
    row("Metric", "Count"),
    border("├", "┼", "┤", "─"),
    ...rows.map(({ label, value }) => row(label, String(value))),
    border("└", "┴", "┘", "─"),
  ].join("\n");
}
