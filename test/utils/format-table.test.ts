import { describe, expect, it } from "vitest";
import { formatCountTable } from "../../src/utils/format-table.js";

describe("formatCountTable", () => {
  it("renders a bordered table with aligned columns", () => {
    const table = formatCountTable("Summary", [
      { label: "Created", value: 1 },
      { label: "Updated", value: 0 },
    ]);

    expect(table).toMatch(/^Summary\n/);
    expect(table).toMatch(/│ Created\s+│\s+1 │/);
    expect(table).toMatch(/│ Updated\s+│\s+0 │/);
    expect(table).toMatch(/└/);
  });
});
