// The party grid as the editor holds it, and how it turns back into a save.
//
// The shape is the sheet this replaces (test-fixtures/occluded/boss matrix.png): a column per
// person, a row per party, and the character they bring in the cell. Cells are keyed by person, so
// adding, renaming or reordering a column never moves anybody else's characters.
//
// Everything here is pure. The component owns the draft and does nothing to it that this file
// cannot be tested doing.

import type { PartyGrid, SaveGridBody } from "@/types/party";

/** Six seats, the game's own party limit. Mirrors MAX_PARTY_SIZE in PartyQueries.kt. */
export const MAX_PARTY = 6;

export type DraftCell = {
  /** What the cell says: a character, or a label for one ("2nd mech"). */
  label: string;
  /** Who that is, when the label is not the name. Empty means the label is already the IGN. */
  ign: string;
};

export type DraftPerson = {
  /** Stable within the editing session. An existing person's id, or a made-up key for a new one. */
  key: string;
  id?: string;
  name: string;
  mvp: boolean;
};

export type DraftRow = {
  key: string;
  id?: string;
  name: string;
  bossKeys: string[];
  /** person key -> cell. An absent or blank-labelled cell means that person is not in this party. */
  cells: Record<string, DraftCell>;
};

export type Draft = {
  people: DraftPerson[];
  rows: DraftRow[];
};

/** The server's grid as an editable draft. Existing ids double as keys, so a save can match them up. */
export function toDraft(grid: PartyGrid): Draft {
  return {
    people: grid.people.map((p) => ({ key: p.id, id: p.id, name: p.name, mvp: p.mvp })),
    rows: grid.parties.map((party) => ({
      key: party.id,
      id: party.id,
      name: party.name ?? "",
      bossKeys: party.bossKeys,
      cells: Object.fromEntries(
        party.members.map((m) => [m.personId, { label: m.name, ign: m.ign ?? "" }]),
      ),
    })),
  };
}

/** A filled cell is one with a label. Blank cells are how the grid says "not in this party". */
export function filledCells(row: DraftRow): [string, DraftCell][] {
  return Object.entries(row.cells).filter(([, cell]) => cell.label.trim() !== "");
}

/**
 * The draft as the API takes it.
 *
 * Blank cells are dropped rather than sent as empty seats: the server refuses a seat with no
 * character, and an empty cell is not an attempt to add one.
 */
export function toSaveBody(draft: Draft): SaveGridBody {
  return {
    people: draft.people.map((p) => ({
      key: p.key,
      ...(p.id ? { id: p.id } : {}),
      name: p.name.trim(),
      mvp: p.mvp,
    })),
    parties: draft.rows.map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      name: row.name.trim() === "" ? null : row.name.trim(),
      bossKeys: row.bossKeys,
      seats: filledCells(row).map(([personKey, cell]) => ({
        personKey,
        characterName: cell.label.trim(),
        ign: cell.ign.trim() === "" ? null : cell.ign.trim(),
      })),
    })),
  };
}

/**
 * The IGN this person has already given that label elsewhere in the grid.
 *
 * "lynn" is acornacorn in every row it appears in, so typing it a second time should not mean
 * typing the IGN a second time. Returns an empty string when nothing is known, which leaves the
 * label to stand as the name.
 */
export function knownIgn(draft: Draft, personKey: string, label: string): string {
  const wanted = label.trim().toLowerCase();
  if (wanted === "") return "";
  for (const row of draft.rows) {
    const cell = row.cells[personKey];
    if (cell && cell.label.trim().toLowerCase() === wanted && cell.ign.trim() !== "") {
      return cell.ign.trim();
    }
  }
  return "";
}

/**
 * Why this draft cannot be saved, or null.
 *
 * Deliberately the same rules the server applies, in the same words where they match, so the
 * client's refusal and the server's cannot say different things about the same grid. The server
 * still checks: this only saves the round trip.
 */
export function draftProblem(draft: Draft): string | null {
  const names = draft.people.map((p) => p.name.trim());
  if (names.some((n) => n === "")) return "a person needs a name";
  const lowered = names.map((n) => n.toLowerCase());
  if (new Set(lowered).size !== lowered.length) return "two people share a name";

  for (const row of draft.rows) {
    const filled = filledCells(row);
    if (filled.length === 0) return "a party needs at least one member";
    if (filled.length > MAX_PARTY) return `a party holds at most ${MAX_PARTY} members`;
  }
  return null;
}

/** A key for a row or column that has never been saved. Unique within the session. */
export function newKey(prefix: string, existing: { key: string }[]): string {
  let n = existing.length + 1;
  const taken = new Set(existing.map((e) => e.key));
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}
