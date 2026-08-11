// One week's Grandis nights, as a sheet to fill in.
//
// A pool answers "what has this party dropped", over months. This answers "what did I run this
// week, and with whom", which is the question somebody who keeps no set parties actually has: the
// roster is different every Thursday, and the coupons divide against the one that ran that night.
//
// NOT a list of things that are wrong. A boss genuinely run alone is a row with nobody in it and
// nothing to do, which is why this is not folded into unanswered(): that card is a refusal, and a
// refusal that lists every solo night would be asking eight questions a week that have no answer.
//
// The stacks are here too, and this is the ONLY place they can be said. They used to be reachable
// only through unanswered(), which lists a night solely when the app cannot work it out, so a night
// that divides evenly, or whose party names a looter, or that was already answered wrongly, had no
// control at all: you could correct the app's guess but never state what happened. A drop is a fact
// somebody watched, so saying it must not depend on the app being stuck.

import { foldSeats, ranSeats, suggestArrangement } from "./vestige-ledger";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/** One night: what fell, and who was there for it. */
export type WeekRun = {
  lootId: string;
  partyId: string;
  characterId: string;
  bossKey: string;
  weekStart: string;
  /** What FELL, never a share. See V40. */
  quantity: number;
  /** How many equal stacks it fell in, or null when nobody has counted them. */
  bundles: number | null;
  /** The seats that ran that week, the config's own character among them. */
  seats: PartyMember[];
  /**
   * The others, as names to type over. Empty is a night nobody has said anything about, which is
   * a boss run alone until somebody says otherwise.
   */
  others: string[];
  /**
   * What has already happened to it, or null while it is still in the pool.
   *
   * A sold drop pinned its payouts from the roster as it stood, and a taken one names a seat, so
   * neither week can be re-answered. The same rule the server enforces (see payoutsPinnedIn), read
   * here so the row can say what happened rather than offer a control that would be refused.
   */
  locked: "sold" | "taken" | null;
  /**
   * How many PEOPLE the night divides between, seats folded to holders.
   *
   * Fewer than two is nothing to allocate: one person's three characters took three stacks and all
   * three are still theirs. Folded rather than counted as seats for exactly that reason.
   */
  holders: number;
  /** The arrangement already saved, by seat id, or null when nobody has said. */
  recorded: Record<string, number> | null;
  /**
   * The seat the party agreed loots the lot, when that seat ran this week.
   *
   * What the chips open on when nothing is recorded. It is only what was AGREED, so it is a
   * starting position and never an answer: `bundlesBy` is what happened, and beats it. See #289.
   */
  looterMemberId: string | null;
};

/**
 * Every week this coupon has dropped in, newest first. What the sheet steps through.
 *
 * The same test weekRuns() admits a row on, `bossKey` included: a week offered here that turns out
 * to hold nothing would land the reader on an empty card with no way to tell it from a bug.
 */
export function runWeeks(pools: PartyLootPool[], dropKey: string): string[] {
  const weeks = new Set<string>();
  for (const pool of pools) {
    for (const loot of pool.loot) {
      if (isRun(loot, dropKey)) weeks.add(loot.weekStart);
    }
  }
  return [...weeks].sort().reverse();
}

/**
 * Whether this row is a night the sheet can answer for.
 *
 * A pool is one character and one boss, so a row with no boss cannot be made into a party: there is
 * no pair to take over. Nothing a clear files is ever missing one.
 */
function isRun(loot: Loot, dropKey: string): loot is Loot & { bossKey: string } {
  return loot.dropKey === dropKey && loot.quantity >= 1 && loot.bossKey !== null;
}

/**
 * The nights of one week, in roster order and then catalog order.
 *
 * Both orders are the page's own, so a character sits in the same place here as on every other
 * screen and two bosses cleared the same night never swap places between reloads.
 *
 * Retired configs are in. The drop fell, the week is still answerable, and leaving it out would be
 * a night that dropped 180 coupons with nowhere to say who was there.
 */
export function weekRuns(
  parties: Party[],
  pools: PartyLootPool[],
  dropKey: string,
  week: string,
  characterOrder: string[],
  bossOrder: Map<string, number>,
): WeekRun[] {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const runs: WeekRun[] = [];

  for (const pool of pools) {
    const party = partyById.get(pool.partyId);
    if (!party) continue;

    for (const loot of pool.loot) {
      if (!isRun(loot, dropKey) || loot.weekStart !== week) continue;

      const seats = ranSeats(loot, party);
      const recorded = Object.fromEntries(loot.bundlesBy.map((b) => [b.memberId, b.bundles]));
      runs.push({
        lootId: loot.id,
        partyId: pool.partyId,
        characterId: party.characterId,
        bossKey: loot.bossKey,
        weekStart: loot.weekStart,
        quantity: loot.quantity,
        bundles: loot.bundles ?? null,
        seats,
        others: seats.filter((s) => s.characterId !== party.characterId).map((s) => s.name),
        locked: loot.soldAt !== null ? "sold" : loot.takenByMemberId !== null ? "taken" : null,
        holders: foldSeats(seats).length,
        // Empty means nobody has said, which is NOT an even split. Null keeps the two apart, so the
        // chips can open on the looter rather than on an arrangement that was never entered.
        recorded: loot.bundlesBy.length > 0 ? recorded : null,
        // Only when that seat was there. A looter who sat the week out cannot have picked anything
        // up, and opening the chips on them would suggest a night that did not happen.
        looterMemberId:
          seats.some((s) => s.id === party.looterMemberId) && party.looterMemberId !== null
            ? party.looterMemberId
            : null,
      });
    }
  }

  const characterAt = new Map(characterOrder.map((id, i) => [id, i]));
  const at = (run: WeekRun) => characterAt.get(run.characterId) ?? Number.MAX_SAFE_INTEGER;
  return runs.sort(
    (a, b) =>
      at(a) - at(b) ||
      (bossOrder.get(a.bossKey) ?? Number.MAX_SAFE_INTEGER) -
        (bossOrder.get(b.bossKey) ?? Number.MAX_SAFE_INTEGER) ||
      a.lootId.localeCompare(b.lootId),
  );
}

/**
 * The arrangement already recorded, one entry per stack, or null when it cannot be drawn.
 *
 * Null when the stacks do not add up against the seats that ran, which happens when a week's roster
 * is edited after its stacks were said: the arrangement names somebody the week no longer has. What
 * was recorded cannot be shown against this roster, so the night reads as unsaid and has to be said
 * again. Padding it out instead would draw an arrangement nobody entered and call it theirs.
 */
export function recordedArrangement(run: WeekRun): string[] | null {
  const recorded = run.recorded;
  if (recorded === null) return null;
  const owners = run.seats.flatMap((s) => Array<string>(recorded[s.id] ?? 0).fill(s.id));
  return owners.length === run.bundles ? owners : null;
}

/**
 * Where the chips open when nothing readable is recorded.
 *
 * The agreed looter holding the lot, else the balanced split with the odd stack going to whoever is
 * furthest behind. Both are only ever SUGGESTIONS: the looter is what was agreed rather than what
 * happened (see #289), and the balance moves when an earlier week is edited, so storing either
 * without somebody saying so would rewrite nights already settled.
 */
export function suggestedArrangement(run: WeekRun, behind: Map<string, number>): string[] {
  const bundles = run.bundles ?? 0;
  if (run.looterMemberId !== null) return Array<string>(bundles).fill(run.looterMemberId);
  const suggested = suggestArrangement(bundles, run.seats, behind);
  return run.seats.flatMap((s) => Array<string>(suggested.get(s.id) ?? 0).fill(s.id));
}

/**
 * How many stacks each seat holds, as one comparable string.
 *
 * Sorted by seat, so two chip rows holding the same arrangement in a different order compare equal.
 * Comparing the objects would turn on key insertion order, which cycling a chip changes, and Save
 * would light up for a move that put everything back where it started.
 */
export function countKey(owners: string[]): string {
  return [...stacksBySeat(owners)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => `${id}:${n}`)
    .join("|");
}

/**
 * The chips as the server takes them: how many stacks each seat picked up.
 *
 * A seat with none is absent rather than zero. The server refuses a zero, because somebody who did
 * not bend down is not present with none, and counting only what is on a chip is what leaves them
 * out.
 */
export function stacksBySeat(owners: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of owners) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
