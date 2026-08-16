// Typing what a character holds, and working out what that changes.
//
// The count is ABSOLUTE, the same thing a screenshot parse used to write. "What do you hold" has
// one answer, and re-typing it corrects a mistake completely, where a running total assembled from
// adjustments is a number nobody has ever checked against the game. The stepper on the box is how
// "+2 after a run" gets typed; what it sends is still the total it arrived at.
//
// The arithmetic is here rather than in the component for the usual reason: which rows get WRITTEN
// is the part that can be quietly wrong, and a component cannot be asked about it.

/** One row of the editor: the item, and what is stored for it now. */
export type CountRow = {
  tokenCatalogId: string;
  name: string;
  iconUrl: string | null;
  itemGroup: string | null;
  /** What the character holds today. Zero for an item they have never picked up. */
  stored: number;
};

/** The most anybody can hold of one item. Mirrors MAX_QUANTITY in CharacterTokenWrites.kt. */
export const MAX_COUNT = 1_000_000;

/**
 * A typed box as a number, or null when it is not an answer.
 *
 * Blank is null rather than zero, and that distinction is the whole point: a blank box is one
 * nobody has touched, and reading it as zero would clear every item on the screen the first time
 * somebody saved after editing one of them.
 */
export function parseCount(input: string): number | null {
  const cleaned = input.trim();
  if (cleaned === "" || !/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n >= 0 && n <= MAX_COUNT ? n : null;
}

/** What the boxes open on: what is stored, as text, keyed by item. */
export function openingValues(rows: CountRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.tokenCatalogId, String(row.stored)]));
}

export type CountChange = { tokenCatalogId: string; quantity: number };

/**
 * The rows to write, which is only the ones that actually differ.
 *
 * Unchanged rows are left alone rather than rewritten with the same figure: every write stamps
 * capturedAt, so re-sending an untouched count would age-stamp the whole inventory as freshly
 * answered for and lose which figures are actually current.
 *
 * An unreadable box is skipped, not guessed at. It is refused at the Save button too (see
 * `unreadable`), so this is the second half of the same rule rather than the only one.
 */
export function changedCounts(rows: CountRow[], typed: Record<string, string>): CountChange[] {
  const out: CountChange[] = [];
  for (const row of rows) {
    const value = parseCount(typed[row.tokenCatalogId] ?? "");
    if (value === null || value === row.stored) continue;
    out.push({ tokenCatalogId: row.tokenCatalogId, quantity: value });
  }
  return out;
}

/** The boxes that hold something unreadable, so Save can refuse rather than drop them silently. */
export function unreadable(typed: Record<string, string>): string[] {
  return Object.entries(typed)
    .filter(([, value]) => parseCount(value) === null)
    .map(([id]) => id);
}
