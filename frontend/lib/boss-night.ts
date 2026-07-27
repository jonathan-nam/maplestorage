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
 * nobody, which is why their runs cannot be scheduled. See RejectionReason.
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
 * Every config becomes one, including the ones that turn out to be unschedulable: screening says
 * why, and a config that never reached screening could not be explained at all.
 */
export function runsFromParties(
  parties: Party[],
  bosses: Boss[],
  minutesFor: (bossKey: string) => number,
): CandidateRun[] {
  const nameFor = new Map(bosses.map((boss) => [boss.bossKey, boss.name]));

  return parties.map((party) => ({
    id: party.id,
    bossKey: party.bossKey,
    bossName: nameFor.get(party.bossKey) ?? party.bossKey,
    difficulty: party.difficulty,
    minutes: minutesFor(party.bossKey),
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
 * the same stated reason a real unattributed seat is. A seat with no character named is dropped:
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

/** Names as a person would say them: "Dave", "Dave and Erin", "Dave, Erin and Chris". */
function andList(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * One run as a line: the boss, and the characters that turn up to it.
 *
 * A character stands for its owner, so naming both on every seat says the same thing twice. The
 * name appears only where something moved, which is the whole reason to read the line twice. Who
 * arrived and who left is then said in words, because a reader scrolling a chat cannot compare
 * this line against the one above it the way they can glance up a column on screen.
 */
function runLine(
  planned: PlannedRun,
  before: PlannedRun | undefined,
  number: number,
  nameOf: (id: string) => string,
): string {
  const switched = new Set(planned.switched);
  const seats = planned.run.seats
    .map((seat) =>
      switched.has(seat.personId)
        ? `${seat.character} (${nameOf(seat.personId)}, swap)`
        : seat.character,
    )
    .join(", ");

  // What the party calls it, which is what they will scroll past looking for their own run. The
  // mode goes in front of it: "Chaos Kalos" is the whole name of what is being run.
  const boss = bossLabel(
    BOSS_SHORT_NAMES[planned.run.bossKey] ?? planned.run.bossName,
    planned.run.difficulty,
  );
  const line = `${number}. ${boss}: ${seats}`;
  if (!before) return line;

  const here = new Set(planned.run.seats.map((seat) => seat.personId));
  const was = new Set(before.run.seats.map((seat) => seat.personId));
  const joined = planned.run.seats
    .filter((seat) => !was.has(seat.personId))
    .map((seat) => nameOf(seat.personId));
  const left = before.run.seats
    .filter((seat) => !here.has(seat.personId))
    .map((seat) => nameOf(seat.personId));

  // One out, one in, is a swap of people rather than two separate facts, and reads as one.
  if (joined.length === 1 && left.length === 1) return `${line}. ${joined[0]} in for ${left[0]}.`;

  const changes = [
    joined.length > 0 ? `${andList(joined)} in.` : null,
    left.length > 0 ? `${andList(left)} out.` : null,
  ].filter((change): change is string => change !== null);

  return changes.length > 0 ? `${line}. ${changes.join(" ")}` : line;
}

/** Run numbers as a person would write them: "1-3", "1, 3", "1-2, 5". */
function runRanges(numbers: number[]): string {
  const parts: string[] = [];
  let start: number | undefined;
  let end: number | undefined;

  for (const n of numbers) {
    if (start === undefined || end === undefined) {
      start = n;
      end = n;
    } else if (n === end + 1) {
      end = n;
    } else {
      parts.push(start === end ? `${start}` : `${start}-${end}`);
      start = n;
      end = n;
    }
  }
  if (start !== undefined && end !== undefined) {
    parts.push(start === end ? `${start}` : `${start}-${end}`);
  }

  return parts.join(", ");
}

/**
 * What one person is on, across the whole night.
 *
 * Their runs collapse into stretches on one character, which is the shape the ordering was chosen
 * to produce, so this is the line where the work shows. Somebody in every run on one character is
 * told so in words rather than handed the numbers 1 to 6 to check off.
 */
function personLine(person: NightPerson, plan: Plan): { name: string; text: string } | null {
  const appearances = plan.runs.flatMap((planned, i) => {
    const seat = planned.run.seats.find((s) => s.personId === person.id);
    return seat ? [{ at: i + 1, character: seat.character }] : [];
  });
  if (appearances.length === 0) return null;

  const stretches: { character: string; at: number[] }[] = [];
  for (const appearance of appearances) {
    const last = stretches[stretches.length - 1];
    if (last && last.character === appearance.character) last.at.push(appearance.at);
    else stretches.push({ character: appearance.character, at: [appearance.at] });
  }

  const everyRun = appearances.length === plan.runs.length;
  const only = stretches.length === 1 ? stretches[0] : undefined;

  const text =
    only && everyRun
      ? `${only.character} the whole way`
      : stretches
          .map((stretch) => `${stretch.character} for ${runRanges(stretch.at)}`)
          .join(", then ");

  return { name: person.name, text };
}

/**
 * The plan as plain text, for pasting where the party actually talks.
 *
 * Two passes over the same night, because a reader arrives with two questions. The rows are the
 * ones on screen: the boss, the characters in it, and what moved since the last one. The lines
 * under them answer "which character am I on tonight" without making anybody read four rows to
 * work it out, and they are where a character is tied to its owner.
 *
 * No leading spaces or column alignment: chat clients render this proportionally, and anything
 * lined up in a monospace editor arrives crooked.
 *
 * Built from the Plan it is given, never restated by hand, so it cannot drift from what the page
 * is showing. The same rule explainSplit() follows.
 */
export function planAsText(plan: Plan, roster: NightPerson[]): string {
  if (plan.runs.length === 0) return "No bosses fit in the time.";

  const switches =
    plan.switches === 0
      ? "no character switches"
      : `${plan.switches} character ${plan.switches === 1 ? "switch" : "switches"}`;

  // "about", because the clock is built on a flat half-hour placeholder. See boss-minutes.ts.
  const headline =
    `${plan.runs.length} ${plan.runs.length === 1 ? "boss" : "bosses"} · ` +
    `about ${formatDuration(plan.minutes)} · ${switches}`;

  const nameOf = (id: string) => roster.find((person) => person.id === id)?.name ?? id;
  const order = plan.runs.map((planned, i) => runLine(planned, plan.runs[i - 1], i + 1, nameOf));

  const who = roster
    .map((person) => personLine(person, plan))
    .filter((line): line is { name: string; text: string } => line !== null)
    .map((line) => `${line.name}: ${line.text}`);

  return [headline, "", ...order, "", ...who].join("\n");
}

/** Why a run could not be scheduled, in words, given the roster to name people from. */
export function explainRejection(
  reason: "person-twice" | "person-unavailable" | "unattributed-seat",
  detail: string[],
  roster: NightPerson[],
): string {
  const nameOf = (id: string) => roster.find((p) => p.id === id)?.name ?? id;
  switch (reason) {
    case "person-twice":
      return `One person is down for ${detail.join(" and ")}, and nobody plays two characters at once.`;
    case "person-unavailable":
      return `${detail.map(nameOf).join(", ")} is not on tonight.`;
    case "unattributed-seat":
      return `Nobody is named as playing ${detail.join(", ")}, so we cannot tell if they are on.`;
  }
}
