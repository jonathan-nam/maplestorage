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
// The stacks are still stack-arrangement.tsx's. This says who was there; who bent down for which
// stack is the next question and already has a card, which gains the row the moment this one makes
// the night divisible.

import { ranSeats } from "./vestige-ledger";
import type { PartyLootPool } from "@/types/loot";
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
};

/** Every week this coupon has dropped in, newest first. What the sheet steps through. */
export function runWeeks(pools: PartyLootPool[], dropKey: string): string[] {
  const weeks = new Set<string>();
  for (const pool of pools) {
    for (const loot of pool.loot) {
      if (loot.dropKey === dropKey && loot.quantity >= 1) weeks.add(loot.weekStart);
    }
  }
  return [...weeks].sort().reverse();
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
      if (loot.dropKey !== dropKey || loot.weekStart !== week || loot.quantity < 1) continue;
      // A pool is one character and one boss, so a row with no boss cannot be adopted into a party:
      // there is no pair to take over. Nothing the clear files is ever missing one.
      if (loot.bossKey === null) continue;

      const seats = ranSeats(loot, party);
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
