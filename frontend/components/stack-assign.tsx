"use client";

import { useState } from "react";
import { holderKey, holderOf } from "@/lib/vestige-ledger";
import {
  type StackDrop,
  assignedStacks,
  openingCounts,
  pieceTallies,
  stacksToSave,
} from "@/lib/vestige-stacks";
import type { Party } from "@/types/party";

// Who picked up which stacks of this week's coupons, under the boss row that dropped them.
//
// One box per member, holding STACKS. The pieces are under the box because the pieces are what
// people say to each other, and the stack is what can actually be handed over: a stack is
// indivisible, so a box that took pieces could be typed into a number nobody could pick up.
//
// The same grid the party config uses for shares, and for the same reason: it is the shape for
// "a number per member", and this page already has one.
//
// Save is refused until the boxes come to the stacks that fell. An arrangement that does not add up
// looks answered and measures a debt against stacks nobody accounted for, which is the wrong number
// this whole feature exists to avoid.

export function StackAssign({
  drop,
  party,
  behind,
  editing,
  busy,
  onSave,
}: {
  drop: StackDrop;
  party: Party;
  /** Each holder's position across what is already recorded, so the odd stack rotates. */
  behind: Map<string, number>;
  /** Whether the boxes take typing, which is the panel's own Edit. See LootList. */
  editing: boolean;
  busy: boolean;
  onSave: (lootId: string, bundles: Record<string, number>) => Promise<void>;
}) {
  // Read-only until Edit, and then only what was RECORDED. The boxes open on a looter or a balanced
  // guess when nothing has been said, and drawing that here would put a split nobody entered on
  // screen as though it had happened. What is known unasked is what each of them is due.
  if (!editing) return <StackSummary drop={drop} />;
  return <StackBoxes drop={drop} party={party} behind={behind} busy={busy} onSave={onSave} />;
}

/** What the config says when nobody is editing it: what fell, and where it went if that was said. */
function StackSummary({ drop }: { drop: StackDrop }) {
  // Against the recorded arrangement, or against nothing. `due` does not depend on the counts, so
  // the second still carries every seat's entitlement and simply has nobody taking anything.
  const tallies = pieceTallies(drop, drop.recorded ? drop.counts : {});
  return (
    <div className="config-vestige">
      <span className="config-share-drop">
        {drop.quantity} in {drop.bundles} stacks of {drop.size}
      </span>
      <div className="config-shares">
        {drop.seats.map((seat) => {
          const tally = tallies.get(holderKey(holderOf(seat))) ?? { took: 0, due: 0 };
          return (
            <span className="config-share" key={seat.id}>
              {seat.name}
              {/* Only what is known. With nothing recorded, what anybody took is exactly what this
                  screen cannot say, and what they are due is true either way. */}
              <span className="config-share-stacks">
                {drop.recorded ? `${tally.took} took, ${tally.due} due` : `${tally.due} due`}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function StackBoxes({
  drop,
  party,
  behind,
  busy,
  onSave,
}: {
  drop: StackDrop;
  party: Party;
  behind: Map<string, number>;
  busy: boolean;
  onSave: (lootId: string, bundles: Record<string, number>) => Promise<void>;
}) {
  // Keyed on what is recorded, so a save redraws from what the server wrote. Text rather than
  // numbers, so a half-typed box is refused at Save instead of snapping to something nobody meant.
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(openingCounts(drop, party, behind)).map(([id, n]) => [id, String(n)]),
    ),
  );
  const [refusal, setRefusal] = useState<string | null>(null);

  const parsed = Object.fromEntries(drop.seats.map((s) => [s.id, parseStacks(counts[s.id] ?? "")]));
  const readable = drop.seats.every((s) => parsed[s.id] !== null);
  const whole = Object.fromEntries(drop.seats.map((s) => [s.id, parsed[s.id] ?? 0]));
  const assigned = assignedStacks(whole);
  const adds = readable && assigned === drop.bundles;
  // Only once the boxes add up. Half-placed stacks make everybody look short, which is a debt that
  // is not real yet, against an arrangement nobody has finished saying.
  const tallies = adds ? pieceTallies(drop, whole) : null;

  async function save() {
    setRefusal(null);
    try {
      await onSave(drop.lootId, stacksToSave(whole));
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <div className="config-vestige">
      {/* What there is to hand out, ahead of the boxes rather than after them. Trailing the row it
          reads as the last member's figure. */}
      <span className="config-share-drop">
        {drop.quantity} in {drop.bundles} stacks of {drop.size}
      </span>

      <div className="config-shares">
        {drop.seats.map((seat) => {
          const tally = tallies?.get(holderKey(holderOf(seat))) ?? null;
          return (
            <label className="config-share" key={seat.id}>
              {seat.name}
              <input
                className="split-input"
                value={counts[seat.id] ?? ""}
                onChange={(e) => setCounts({ ...counts, [seat.id]: e.target.value })}
                placeholder="0"
                inputMode="numeric"
                aria-label={`Stacks ${seat.name} picked up`}
                disabled={busy}
              />
              {/* BOTH numbers, because neither can be worked out from the other: what this many
                  stacks comes to, and what they were owed out of what fell. Until the boxes add up
                  there is no honest entitlement to show, so it is the pieces alone. */}
              <span className="config-share-stacks">
                {tally
                  ? `${tally.took} took, ${tally.due} due`
                  : `${(parsed[seat.id] ?? 0) * drop.size}`}
              </span>
            </label>
          );
        })}
      </div>

      <div className="loot-actions">
        <button
          type="button"
          className="party-save"
          disabled={busy || !adds}
          onClick={() => void save()}
        >
          Save
        </button>
        {/* Only the arithmetic, and only while it is wrong. What is left to place is the one thing
            the boxes cannot show, and it is what the button is waiting for. */}
        {readable && !adds && (
          <span className="split-error">
            {assigned} of {drop.bundles} stacks placed
          </span>
        )}
        {!readable && <span className="split-error">whole stacks only</span>}
      </div>

      {refusal && <p className="split-error">{refusal}</p>}
    </div>
  );
}

/** A box's value as stacks, or null when it is not a count. Blank is none, which is a real answer. */
function parseStacks(value: string): number | null {
  const text = value.trim();
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}
