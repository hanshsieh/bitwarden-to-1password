import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCountTable } from "../../src/utils/format-table.js";

describe("formatCountTable", () => {
  it("renders a bordered table with aligned columns", () => {
    const table = formatCountTable("Summary", [
      { label: "Created", value: 1 },
      { label: "Updated", value: 0 },
    ]);

    assert.match(table, /^Summary\n/);
    assert.match(table, /│ Created\s+│\s+1 │/);
    assert.match(table, /│ Updated\s+│\s+0 │/);
    assert.match(table, /└/);
  });
});
