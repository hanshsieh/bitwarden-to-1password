/** Trim and lowercase for case-insensitive username matching. */
export function normalizeUsername(username: string | null | undefined): string {
  return (username ?? "").trim().toLowerCase();
}

/** Slugify a string for use as a 1Password field ID. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "attachment";
}
