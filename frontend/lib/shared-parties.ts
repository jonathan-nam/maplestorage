import { cellState, clearOfCell } from "./boss-clears";
import type { SeatedParty } from "@/types/party";

/**
 * Whether YOUR character has cleared a shared party's boss, for the period being shown.
 *
 * Your own account's answer, not the owner's. `boss_clear` is keyed on a CHARACTER, so the tick a
 * party carries is about the owner's character and answers "have they run it", where the question
 * on a shared card is "have I". Both accounts record the same night, once each, because the run is
 * one run and each captures their own planner.
 *
 * Read through cellState and clearOfCell, which is the same reading Party View and the Boss Clears
 * table use. A second way to read a tick is how two screens come to disagree about it.
 *
 * Null where this account cannot answer: your seat has no character bound to it, which is every
 * seat until an invite is accepted. Null is also what "no capture has mentioned it" reads as, and
 * the two are the same thing to a reader, which is nothing claimed either way.
 */
export function yourClear(
  party: SeatedParty,
  clearsByCharacter: Map<string, Map<string, boolean>>,
): boolean | null {
  const mine = party.seats.find((seat) => party.mySeatIds.includes(seat.id));
  if (!mine?.linkedCharacterId) return null;
  return clearOfCell(cellState(clearsByCharacter.get(mine.linkedCharacterId), party.bossKey));
}
