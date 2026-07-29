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
// above switches because a gap is a whole boss of sitting there and a switch is a moment at the
// login screen. It sits below party size, so a person whose two runs are the fullest and the
// emptiest can still be split across the night.
//
// A switch is counted and ordered on, never billed to the clock. The night is measured in whole
// runs, so at the default half hour a run the schedule reads 0:00, 0:30, 1:00. Charging a relog
// against an estimate that coarse only bought a finishing time that looked precise and was not.

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
  /** The mode the config says it runs. Null for a hand-typed run, which is not asked for one. */
  difficulty: string | null;
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
 * not a party that can be formed.
 *
 * NOTHING DRAWS THIS. Run Order used to list the rejections under "Can't be scheduled" and no
 * longer does, so a config refused here now vanishes from the page with nothing said. Screening
 * still classifies, and these tests still pin it, because the classification is what produces
 * `eligible`. Read a UI for it back off `rejected`; do not re-derive the reasons.
 */
export type RejectionReason = "person-twice" | "person-unavailable" | "unattributed-seat";

export type Rejection = {
  run: CandidateRun;
  reason: RejectionReason;
  /** Who or what caused it, named well enough to say more than "excluded" if anything ever does. */
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

export type PlanOptions = {
  /** The window, in minutes. */
  minutes: number;
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
  /** Minutes from the start of the night: the runs before this one, and nothing else. */
  startsAt: number;
};

export type Plan = {
  runs: PlannedRun[];
  switches: number;
  /** Minutes the whole plan occupies: the runs added up, and nothing else. */
  minutes: number;
};

export const EMPTY_PLAN: Plan = { runs: [], switches: 0, minutes: 0 };

// A state is copied once per candidate, and there are hundreds of thousands of candidates, so it is
// built out of fixed-length arrays indexed by a number worked out up front. The string-keyed Maps
// and Sets this replaced were three quarters of the search's time at 30 runs: copying four of them
// per candidate, then sorting two back into a key.
//
// One array of scheduled runs rather than three kept index-aligned. The parallel version
// typechecked and was one off-by-one away from attributing a switch to the wrong run.
type State = {
  order: PlannedRun[];
  /** One bit per run. */
  taken: number[];
  /** Where each person is parked right now, by person. Undefined means they have not logged in yet. */
  parked: (string | undefined)[];
  /** One bit per character-and-boss pair. A character clears a boss once a period, so never twice a night. */
  spent: number[];
  /**
   * Party sizes in run order, one fixed-width field each, so a plain string compare IS the
   * lexicographic compare of the sequence. Safe because states are only ever compared at equal
   * length: every round of the beam appends exactly one run.
   */
  parties: string;
  /** Which run each person was last in, by person. -1 means they have not been in one yet. */
  lastRunAt: number[];
  /** Runs people sit out between two of their own, summed over everybody. See WAITING. */
  waiting: number;
  minutes: number;
  switches: number;
  /** Filled in by planKey on first use, which only happens on a tie. */
  orderKey: string | null;
};

// 30 bits to the word, so a word stays a small signed integer and the shifts stay in range.
const WORD = 30;

function noBits(count: number): number[] {
  return new Array(Math.max(1, Math.ceil(count / WORD))).fill(0);
}

function hasBit(bits: number[], at: number): boolean {
  return ((bits[(at / WORD) | 0] as number) & (1 << (at % WORD))) !== 0;
}

function setBit(bits: number[], at: number): void {
  const word = (at / WORD) | 0;
  bits[word] = (bits[word] as number) | (1 << (at % WORD));
}

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
  if (state.orderKey === null) {
    state.orderKey = state.order.map((planned) => planned.run.id).join();
  }
  return state.orderKey;
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
  const beamWidth = options.beamWidth ?? 1000;

  // Everything a run needs during the search, numbered once. The inner loop then never touches an
  // IGN or a boss key, only indices into these.
  const personAt = new Map<string, number>();
  const pairAt = new Map<string, number>();
  const prepared = runs.map((run, index) => {
    const persons: number[] = [];
    const pairs: number[] = [];
    for (const seat of run.seats) {
      let person = personAt.get(seat.personId);
      if (person === undefined) personAt.set(seat.personId, (person = personAt.size));
      persons.push(person);

      const name = `${seat.character}::${run.bossKey}`;
      let pair = pairAt.get(name);
      if (pair === undefined) pairAt.set(name, (pair = pairAt.size));
      pairs.push(pair);
    }
    return { run, index, persons, pairs, size: sizeField(run.seats.length) };
  });

  const people = personAt.size;

  const start: State = {
    order: [],
    taken: noBits(runs.length),
    parked: new Array(people).fill(undefined),
    spent: noBits(pairAt.size),
    parties: "",
    lastRunAt: new Array(people).fill(-1),
    waiting: 0,
    minutes: 0,
    switches: 0,
    orderKey: null,
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
      for (const { run, index, persons, pairs, size } of prepared) {
        if (hasBit(state.taken, index)) continue;

        const startsAt = state.minutes;
        const minutes = startsAt + run.minutes;
        if (minutes > options.minutes) continue;

        let clashes = false;
        for (const pair of pairs) {
          if (hasBit(state.spent, pair)) {
            clashes = true;
            break;
          }
        }
        if (clashes) continue;

        const seats = run.seats;

        // In seat order, because that is the order the marks are drawn in.
        const switched: string[] = [];
        for (let s = 0; s < seats.length; s++) {
          const seat = seats[s] as AttributedSeat;
          const wasOn = state.parked[persons[s] as number];
          if (wasOn !== undefined && wasOn !== seat.character) switched.push(seat.personId);
        }

        const at = state.order.length;
        const parked = state.parked.slice();
        const lastRunAt = state.lastRunAt.slice();
        const spent = state.spent.slice();
        let waiting = state.waiting;
        for (let s = 0; s < seats.length; s++) {
          const person = persons[s] as number;
          const before = state.lastRunAt[person] as number;
          if (before >= 0) waiting += at - before - 1;
          parked[person] = (seats[s] as AttributedSeat).character;
          lastRunAt[person] = at;
          setBit(spent, pairs[s] as number);
        }

        const taken = state.taken.slice();
        setBit(taken, index);

        const candidate: State = {
          order: [...state.order, { run, switched, startsAt }],
          taken,
          parked,
          spent,
          parties: state.parties + size,
          lastRunAt,
          waiting,
          minutes,
          switches: state.switches + switched.length,
          orderKey: null,
        };

        // Only ever compared for equality, so the shape is free: the taken words, then everyone who
        // has logged in, in person order.
        let key = taken.join();
        for (let person = 0; person < people; person++) {
          const on = parked[person];
          if (on !== undefined) key += `|${person}>${on}@${lastRunAt[person]}`;
        }

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
