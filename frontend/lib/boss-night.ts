// Turning what the account knows into a night the planner can order.
//
// Two ways in, one shape out. Signed in, the runs come from your party configs: a config already
// IS "this character, this boss, with these people", which is exactly a candidate run. Signed out,
// you type the same thing by hand. Both land on CandidateRun, so the ordering has one
// implementation and the standalone tool is not a lesser copy of the real one.
//
// See boss-run-plan.ts for what is then done with them.

import type { Boss } from "@/types/boss";
import type { Party, PartyMember } from "@/types/party";

import { BOSS_SHORT_NAMES } from "./boss-art";
import { bossLabel } from "./boss-difficulty";
import { runMinutes } from "./boss-minutes";

import type { CandidateRun, Plan, PlannedRun } from "./boss-run-plan";

/**
 * You, as a person the schedule has to keep on one character.
 *
 * The people list holds the OTHERS, so the account owner has no row in it and needs an id from
 * somewhere. A literal is safe against collision because every real person id is a UUID.
 */
export const YOU = "you";

export type NightPerson = { id: string; name: string };

/**
 * Whose character a seat is, or null when nobody has said.
 *
 * `characterId` wins over `personId`: it is set by the backend only when the seat IS one of your
 * roster characters, which is proof, where the person link is a name match that a stray entry on
 * the People page could have made.
 */
export function ownerOf(member: PartyMember): string | null {
  if (member.characterId !== null) return YOU;
  return member.personId;
}

/**
 * Everyone who could be on tonight, you first and the rest by name.
 *
 * Drawn from the configs rather than from /api/people, so it lists the people you actually run
 * with instead of everyone you have ever named. Seats nobody has been attributed to contribute
 * nobody, which is why their runs cannot be scheduled and now simply do not appear. See
 * RejectionReason.
 */
export function rosterFrom(parties: Party[]): NightPerson[] {
  const others = new Map<string, string>();
  let includesYou = false;

  for (const party of parties) {
    for (const member of party.members) {
      const owner = ownerOf(member);
      if (owner === YOU) includesYou = true;
      else if (owner !== null) others.set(owner, member.personName ?? member.name);
    }
  }

  const sorted = [...others.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return includesYou ? [{ id: YOU, name: "You" }, ...sorted] : sorted;
}

/**
 * Your configs as candidate runs.
 *
 * Every config becomes one, including the ones that turn out to be unschedulable. Screening is
 * what decides that, and a config that never reached screening could not be refused for a reason
 * at all. The reason is no longer shown, see RejectionReason.
 *
 * The run time comes off the config rather than the boss: two of your characters can run the same
 * Hard Lucid at different speeds, so there is no per-boss answer to take.
 */
export function runsFromParties(parties: Party[], bosses: Boss[]): CandidateRun[] {
  const nameFor = new Map(bosses.map((boss) => [boss.bossKey, boss.name]));

  return parties.map((party) => ({
    id: party.id,
    bossKey: party.bossKey,
    bossName: nameFor.get(party.bossKey) ?? party.bossKey,
    difficulty: party.difficulty,
    // The config's own time, or the flat fallback said out loud. A party that has been timed and
    // one that happens to fall on thirty minutes are not the same claim, so the night marks which
    // is which rather than presenting both as measured.
    minutes: runMinutes(party.minutes),
    assumed: party.minutes === null,
    seats: party.members.map((member) => ({
      character: member.name,
      personId: ownerOf(member),
    })),
  }));
}

// --- The standalone side -------------------------------------------------------------------

/** A run typed in by hand. People are identified by the name you type, because there is no account. */
export type DraftRun = {
  id: string;
  bossKey: string;
  bossName: string;
  minutes: number;
  seats: { character: string; person: string }[];
};

/** Case and padding are typing, not identity: "Chris" and "chris " are one person. */
export function personKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Hand-typed runs as candidates.
 *
 * A seat with no person named is left unattributed rather than guessed at, so it is refused for
 * the same reason a real unattributed seat is. A seat with no character named is dropped:
 * it is a half-filled row of a form, not a claim about the night.
 */
export function runsFromDrafts(drafts: DraftRun[]): CandidateRun[] {
  return drafts.map((draft) => ({
    id: draft.id,
    bossKey: draft.bossKey,
    bossName: draft.bossName,
    // A hand-typed run has no config behind it, so there is nothing to say. Not guessed at.
    difficulty: null,
    minutes: draft.minutes,
    seats: draft.seats
      .filter((seat) => seat.character.trim() !== "")
      .map((seat) => ({
        character: seat.character.trim(),
        personId: seat.person.trim() === "" ? null : personKey(seat.person),
      })),
  }));
}

/** Everyone named across hand-typed runs, in the spelling they were first given. */
export function rosterFromDrafts(drafts: DraftRun[]): NightPerson[] {
  const people = new Map<string, string>();
  for (const draft of drafts) {
    for (const seat of draft.seats) {
      const name = seat.person.trim();
      if (name !== "" && !people.has(personKey(name))) people.set(personKey(name), name);
    }
  }
  return [...people.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- Saying it out loud --------------------------------------------------------------------

/** Minutes as a person would say them: "45m", "1h", "2h 15m". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

// The marks the pasted table uses. ASCII on purpose: the screen draws these as glyphs, and a
// glyph in a code fence is a monospace font's guess at how wide it is, which is how a lined-up
// table arrives crooked.
const SITTING_OUT = "X";
const SWITCH_MARK = "*";

/** One person's place in one run. */
export type GridCell = {
  /** The character they bring, or null when they sit this one out. */
  character: string | null;
  /** They changed character to be here, the one thing the ordering is trying to avoid. */
  switched: boolean;
};

export type GridRow = { planned: PlannedRun; cells: GridCell[] };

/**
 * The night with a column per person.
 *
 * A party is six seats and a group is often more people than that, so who is NOT in a run is half
 * the plan and a per-run list of seats cannot show it. A column can: it is one person all night,
 * and the gaps in it are theirs.
 *
 * Only people the plan uses get a column. Somebody whose runs all fell out is not sitting through
 * the night, they are absent from this plan entirely, and the leftovers name them and their boss.
 */
export function planGrid(
  plan: Plan,
  roster: NightPerson[],
): { people: NightPerson[]; rows: GridRow[] } {
  const inPlan = new Set(
    plan.runs.flatMap((planned) => planned.run.seats.map((seat) => seat.personId)),
  );
  const people = roster.filter((person) => inPlan.has(person.id));

  const rows = plan.runs.map((planned) => {
    const switched = new Set(planned.switched);
    return {
      planned,
      cells: people.map((person) => {
        const seat = planned.run.seats.find((s) => s.personId === person.id);
        return {
          character: seat ? seat.character : null,
          switched: seat !== undefined && switched.has(person.id),
        };
      }),
    };
  });

  return { people, rows };
}

/** What the party calls a boss, with its mode: "Chaos Kalos" is the whole name of what is run. */
function bossHeading(planned: PlannedRun): string {
  return bossLabel(
    BOSS_SHORT_NAMES[planned.run.bossKey] ?? planned.run.bossName,
    planned.run.difficulty,
  );
}

/** A field with nothing in it that can break a row: a tab separates the columns now. */
function cell(value: string): string {
  return value.replace(/[\t\n\r]+/g, " ").trim();
}

/** Rows of fields, one tab between columns, so each column starts at a tab stop. */
function tabTable(rows: string[][]): string[] {
  return rows.map((row) => row.join("\t").trimEnd());
}

/**
 * The plan as text, for pasting where the party actually talks.
 *
 * The table and nothing else: bosses down, people across, and an X where somebody sits one out.
 * It is fenced because the columns only line up in a monospace font, and a chat client renders
 * everything outside a code block proportionally.
 *
 * It used to carry a headline above and a key below, and the corner cell said "Boss". All three
 * were dropped: what gets pasted is a table people read off during the night, and a count, a
 * duration and a glyph key are three lines of talking around it.
 *
 * The count, the duration and the switches are still on the page, beside the controls that set
 * them. The X is not explained anywhere a reader of the paste can see, and that is the cost of
 * dropping the key rather than an oversight: it is a bare X in a table, and the party reading it
 * ran the night. Put the key back if that stops being true.
 *
 * The corner is empty, so the header's first character is the tab that pushes the names over their
 * columns. Every field is otherwise flush left, which is what a tab stop gives for free and what
 * padding to the widest name did not.
 *
 * Built from the Plan it is given, never restated by hand, so it cannot drift from what the page
 * is showing. The same rule explainSplit() follows.
 */
export function planAsText(plan: Plan, roster: NightPerson[]): string {
  if (plan.runs.length === 0) return "No bosses fit in the time.";

  const { people, rows } = planGrid(plan, roster);

  const header = ["", ...people.map((person) => cell(person.name))];
  const body = rows.map(({ planned, cells }) => [
    cell(bossHeading(planned)),
    ...cells.map((c) =>
      c.character === null ? SITTING_OUT : cell(c.character + (c.switched ? SWITCH_MARK : "")),
    ),
  ]);

  return ["```", ...tabTable([header, ...body]), "```"].join("\n");
}
