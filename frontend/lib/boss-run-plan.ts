// Ordering a night of bosses so people stay on one character and nobody sits about.
//
// The hard part of a bossing night is not what time to meet, it is what to run and in what order.
// Every person has several characters, and each boss is run with a particular one of them. Put the
// runs in a careless order and everybody relogs between every boss.
//
// So: a run is a boss plus exactly who brings which character. A SWITCH is one person changing
// character between two consecutive runs THEY are in. Somebody sitting out a run does not log off,
// so their run for the night is a subsequence and only the gaps within it can cost anything. A
// person's first run is free, because logging in is not switching.
//
// What is optimised, in order:
//
//   1. the number of runs that fit in the time
//   2. the fullest parties first
//   3. the least waiting around
//   4. the number of switches
//   5. finishing earlier
//
// Count first is deliberate: the point of the night is dead bosses, and a plan that saves two
// relogs by dropping a boss is not obviously better. It is often not much worse either, which is
// why `byCount` hands back the best plan at EVERY length and lets the caller show the trade.
//
// The fullest parties go first because the group only shrinks: someone dropping out at midnight
// takes the six-person boss with them, where a relog costs a minute. That is why party size
// outranks switches and not the run count.
//
// WAITING is a run somebody sits out between two runs they are in. Somebody needed for two of six
// bosses should do them back to back and have the rest of the night free, whichever end that lands
// on. A run at either end costs them nothing, so only the gaps in the middle are counted. It sits
// above switches because a gap is half an hour of sitting there and a switch is a minute. It sits
// below party size, so a person whose two runs are the fullest and the emptiest can still be split
// across the night.

/** One seat in a run: a character, and whose it is. Null means nobody has claimed it. */
export type RunSeat = {
  /** The character's IGN. Identity here is the character, not the class or the level. */
  character: string;
  personId: string | null;
};

/** A boss somebody could run tonight, with the party that would run it. */
export type CandidateRun = {
  id: string;
  bossKey: string;
  bossName: string;
  /** Door to door, in minutes: getting in, the fight, and looting. */
  minutes: number;
  seats: RunSeat[];
};

/** A seat whose owner is known. Every seat of an eligible run has one. */
export type AttributedSeat = { character: string; personId: string };

/** A candidate that survived screening, so it can actually be scheduled. */
export type EligibleRun = Omit<CandidateRun, "seats"> & { seats: AttributedSeat[] };

/**
 * Why a candidate cannot be scheduled.
 *
 * `person-twice` is the one that is a mistake in the data rather than a fact about tonight: one
 * person cannot play two characters at once, so a party holding two of somebody's characters is
 * not a party that can be formed. It is reported rather than dropped, because a config that
 * silently vanishes reads as one that was considered and not chosen.
 */
export type RejectionReason = "person-twice" | "person-unavailable" | "unattributed-seat";

export type Rejection = {
  run: CandidateRun;
  reason: RejectionReason;
  /** Who or what caused it, named so the UI can say more than "excluded". */
  detail: string[];
};

export type Screening = {
  eligible: EligibleRun[];
  rejected: Rejection[];
};

/**
 * The candidates that can run tonight, and why the others cannot.
 *
 * Order of checks matters for the message, not the outcome: a party that double-books somebody is
 * broken whether or not they turned up, so that is reported ahead of availability.
 */
export function screenRuns(runs: CandidateRun[], availablePersonIds: Iterable<string>): Screening {
  const available = new Set(availablePersonIds);
  const eligible: EligibleRun[] = [];
  const rejected: Rejection[] = [];

  for (const run of runs) {
    const seenPersons = new Map<string, string[]>();
    for (const seat of run.seats) {
      if (seat.personId === null) continue;
      const characters = seenPersons.get(seat.personId);
      if (characters) characters.push(seat.character);
      else seenPersons.set(seat.personId, [seat.character]);
    }

    const doubled = [...seenPersons.entries()].filter(([, characters]) => characters.length > 1);
    if (doubled.length > 0) {
      rejected.push({
        run,
        reason: "person-twice",
        detail: doubled.flatMap(([, characters]) => characters),
      });
      continue;
    }

    // An unclaimed seat is not evidence of absence. We simply cannot say whether whoever plays it
    // is here, and scheduling a run on that assumption is how a plan comes out confidently wrong.
    const unattributed = run.seats.filter((seat) => seat.personId === null);
    if (unattributed.length > 0) {
      rejected.push({
        run,
        reason: "unattributed-seat",
        detail: unattributed.map((seat) => seat.character),
      });
      continue;
    }

    const missing = run.seats.filter((seat) => !available.has(seat.personId as string));
    if (missing.length > 0) {
      rejected.push({
        run,
        reason: "person-unavailable",
        detail: missing.map((seat) => seat.personId as string),
      });
      continue;
    }

    eligible.push({ ...run, seats: run.seats as AttributedSeat[] });
  }

  return { eligible, rejected };
}

/**
 * Real minutes a character change costs: quit to the login screen, pick, load in, walk to the door.
 *
 * Charged to the schedule, not just counted, because a budget that ignores it packs a night that
 * cannot happen. Rough, and deliberately not precise to the second, but zero is the one value it
 * is definitely not.
 */
export const SWITCH_MINUTES = 1;

export type PlanOptions = {
  /** The window, in minutes. */
  minutes: number;
  /** What one character change costs the clock. See SWITCH_MINUTES. */
  switchMinutes?: number;
  /**
   * How many partial plans stay alive per step. The search is a beam, not an exhaustive one: the
   * orderings of even fifteen runs do not fit in a browser tab. Wider is slower and no worse.
   */
  beamWidth?: number;
};

export type PlannedRun = {
  run: EligibleRun;
  /** Who changed character to start this run, in seat order. Empty for most runs, and that is the point. */
  switched: string[];
  /** Minutes from the start of the night, switches included. */
  startsAt: number;
};

export type Plan = {
  runs: PlannedRun[];
  switches: number;
  /** Minutes the whole plan occupies, switch time included. */
  minutes: number;
};

export const EMPTY_PLAN: Plan = { runs: [], switches: 0, minutes: 0 };

// One array of scheduled runs rather than three kept index-aligned. The parallel version
// typechecked and was one off-by-one away from attributing a switch to the wrong run.
type State = {
  order: PlannedRun[];
  taken: Set<string>;
  /** Where each person is parked right now. Absent means they have not logged in yet. */
  lastCharacter: Map<string, string>;
  /** `character::bossKey` already spent. A character clears a boss once a period, so never twice a night. */
  spent: Set<string>;
  /**
   * Party sizes in run order, one fixed-width field each, so a plain string compare IS the
   * lexicographic compare of the sequence. Safe because states are only ever compared at equal
   * length: every round of the beam appends exactly one run.
   */
  parties: string;
  /** Which run each person was last in, by index. Absent means they have not been in one yet. */
  lastRun: Map<string, number>;
  /** Runs people sit out between two of their own, summed over everybody. See WAITING. */
  waiting: number;
  minutes: number;
  switches: number;
};

/** A party size as a comparison field. Two digits, because a party is six people and never 100. */
function sizeField(size: number): string {
  return String(Math.min(size, 99)).padStart(2, "0");
}

function betterState(a: State, b: State): number {
  // Bigger parties earlier. Greater string, not lesser, so this is descending.
  if (a.parties !== b.parties) return a.parties < b.parties ? 1 : -1;
  if (a.waiting !== b.waiting) return a.waiting - b.waiting;
  if (a.switches !== b.switches) return a.switches - b.switches;
  if (a.minutes !== b.minutes) return a.minutes - b.minutes;
  // Deterministic last resort, so the same input always gives the same plan back.
  return planKey(a).localeCompare(planKey(b));
}

function planKey(state: State): string {
  return state.order.map((planned) => planned.run.id).join();
}

function toPlan(state: State): Plan {
  return { runs: state.order, switches: state.switches, minutes: state.minutes };
}

/**
 * The best order to run tonight's bosses in.
 *
 * `best` is the longest plan that fits, broken to fewest switches. `byCount` holds the best plan of
 * every length from 1 up, so a caller can offer "one fewer boss, three fewer relogs" without
 * running the search again.
 */
export function planNight(
  runs: EligibleRun[],
  options: PlanOptions,
): { best: Plan; byCount: Plan[] } {
  const switchMinutes = options.switchMinutes ?? SWITCH_MINUTES;
  const beamWidth = options.beamWidth ?? 1000;

  const start: State = {
    order: [],
    taken: new Set(),
    lastCharacter: new Map(),
    spent: new Set(),
    parties: "",
    lastRun: new Map(),
    waiting: 0,
    minutes: 0,
    switches: 0,
  };

  const byCount: Plan[] = [];
  let beam: State[] = [start];

  while (beam.length > 0) {
    // Keyed on what the future actually depends on: which runs are gone, where everyone is parked,
    // and how long ago each person last played. Two states agreeing on all three are the same
    // problem from here, so only the cheaper one is worth carrying. The third is there because
    // waiting is counted: two states can park everybody identically and still owe a different gap
    // to whoever comes back next.
    const next = new Map<string, State>();

    for (const state of beam) {
      for (const run of runs) {
        if (state.taken.has(run.id)) continue;
        if (run.seats.some((seat) => state.spent.has(`${seat.character}::${run.bossKey}`)))
          continue;

        const switched = run.seats
          .filter((seat) => {
            const parked = state.lastCharacter.get(seat.personId);
            return parked !== undefined && parked !== seat.character;
          })
          .map((seat) => seat.personId);

        const startsAt = state.minutes + switched.length * switchMinutes;
        const minutes = startsAt + run.minutes;
        if (minutes > options.minutes) continue;

        const at = state.order.length;
        const lastCharacter = new Map(state.lastCharacter);
        const lastRun = new Map(state.lastRun);
        const spent = new Set(state.spent);
        let waiting = state.waiting;
        for (const seat of run.seats) {
          const before = state.lastRun.get(seat.personId);
          if (before !== undefined) waiting += at - before - 1;
          lastCharacter.set(seat.personId, seat.character);
          lastRun.set(seat.personId, at);
          spent.add(`${seat.character}::${run.bossKey}`);
        }

        const candidate: State = {
          order: [...state.order, { run, switched, startsAt }],
          taken: new Set(state.taken).add(run.id),
          lastCharacter,
          spent,
          parties: state.parties + sizeField(run.seats.length),
          lastRun,
          waiting,
          minutes,
          switches: state.switches + switched.length,
        };

        const key = [
          [...candidate.taken].sort().join(),
          [...lastCharacter.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([p, c]) => `${p}>${c}@${lastRun.get(p)}`)
            .join(),
        ].join("|");

        const held = next.get(key);
        if (!held || betterState(candidate, held) < 0) next.set(key, candidate);
      }
    }

    beam = [...next.values()].sort(betterState).slice(0, beamWidth);
    const leader = beam[0];
    if (!leader) break;
    byCount.push(toPlan(leader));
  }

  return { best: byCount[byCount.length - 1] ?? EMPTY_PLAN, byCount };
}

/**
 * The plans actually worth choosing between, longest first.
 *
 * Out of `byCount`, the ones that buy something: a shorter plan earns its place only by costing
 * strictly fewer switches than every longer one. Dropping a boss to save nothing is not an option
 * anybody wants offered, and listing all of them would bury the two that matter.
 */
export function tradeOffs(byCount: Plan[]): Plan[] {
  const worthwhile: Plan[] = [];
  let fewest = Infinity;

  for (let i = byCount.length - 1; i >= 0; i--) {
    const plan = byCount[i];
    if (plan && plan.switches < fewest) {
      worthwhile.push(plan);
      fewest = plan.switches;
    }
  }

  return worthwhile;
}
