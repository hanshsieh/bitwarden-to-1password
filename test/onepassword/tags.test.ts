import { describe, expect, it } from "vitest";
import {
  isAsciiOnlyTag,
  mapBitwardenLabelsForSdk,
  tagsNeedSdkStripping,
} from "../../src/onepassword/tags.js";

describe("tags", () => {
  it("detects non-ASCII tag names", () => {
    expect(isAsciiOnlyTag("Work")).toBe(true);
    expect(isAsciiOnlyTag("雲端空間")).toBe(false);
  });

  it("maps only ASCII labels to SDK tags", () => {
    const tags = mapBitwardenLabelsForSdk([
      { name: "Work", source: "folder" },
      { name: "雲端空間", source: "folder" },
      { name: "Team", source: "collection" },
    ]);

    expect(tags).toEqual(["Work", "Team"]);
  });

  it("detects tags that need SDK stripping", () => {
    expect(tagsNeedSdkStripping(["Work", "Team"])).toBe(false);
    expect(tagsNeedSdkStripping(["Work", "雲端空間"])).toBe(true);
  });
});
