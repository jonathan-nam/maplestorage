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

import type { CandidateRun, Plan } from "./boss-run-plan";

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

/**
 * The plan as plain text, for pasting where the party actually talks.
 *
 * Built from the Plan it is given, never restated by hand, so it cannot drift from what the page
 * is showing. The same rule explainSplit() follows.
 */
export function planAsText(plan: Plan, roster: NightPerson[]): string {
  const nameOf = (id: string) => roster.find((p) => p.id === id)?.name ?? id;

  const lines = plan.runs.map((planned, i) => {
    const seats = planned.run.seats
      .map((seat) => `${seat.character} (${nameOf(seat.personId)})`)
      .join(", ");
    const swap =
      planned.switched.length === 0 ? "" : ` [swap: ${planned.switched.map(nameOf).join(", ")}]`;
    return `${i + 1}. ${formatDuration(planned.startsAt)} ${planned.run.bossName} - ${seats}${swap}`;
  });

  const summary =
    `${plan.runs.length} ${plan.runs.length === 1 ? "boss" : "bosses"}, ` +
    `${formatDuration(plan.minutes)}, ` +
    `${plan.switches} ${plan.switches === 1 ? "switch" : "switches"}`;

  return [summary, ...lines].join("\n");
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
