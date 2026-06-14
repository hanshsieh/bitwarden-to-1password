import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAsciiOnlyTag,
  mapBitwardenLabelsForSdk,
  tagsNeedSdkStripping,
} from "../../src/onepassword/tags.js";

describe("tags", () => {
  it("detects non-ASCII tag names", () => {
    assert.equal(isAsciiOnlyTag("Work"), true);
    assert.equal(isAsciiOnlyTag("雲端空間"), false);
  });

  it("maps only ASCII labels to SDK tags", () => {
    const tags = mapBitwardenLabelsForSdk([
      { name: "Work", source: "folder" },
      { name: "雲端空間", source: "folder" },
      { name: "Team", source: "collection" },
    ]);

    assert.deepEqual(tags, ["Work", "Team"]);
  });

  it("detects tags that need SDK stripping", () => {
    assert.equal(tagsNeedSdkStripping(["Work", "Team"]), false);
    assert.equal(tagsNeedSdkStripping(["Work", "雲端空間"]), true);
  });
});
