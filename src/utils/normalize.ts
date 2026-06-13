/**
 * String normalization helpers shared by merge matching and field ID generation.
 */
export class StringNormalizer {
  /**
   * Normalize usernames for duplicate detection.
   * Trims whitespace and lowercases so `User@Example.com` matches `user@example.com`.
   */
  static normalizeUsername(username: string | null | undefined): string {
    return (username ?? "").trim().toLowerCase();
  }

  /**
   * Convert arbitrary text into a stable 1Password field ID segment.
   * Non-alphanumeric characters become underscores; result is capped at 64 chars.
   */
  static slugify(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64) || "attachment"
    );
  }
}

export const normalizeUsername = StringNormalizer.normalizeUsername;
export const slugify = StringNormalizer.slugify;
