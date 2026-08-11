"use client";

import { useState } from "react";
import { holderKey, holderOf } from "@/lib/vestige-ledger";
import {
  type StackDrop,
  assignedStacks,
  openingCounts,
  pieceDrift,
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
  busy,
  onSave,
}: {
  drop: StackDrop;
  party: Party;
  /** Each holder's position across what is already recorded, so the odd stack rotates. */
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
  const drift = adds ? pieceDrift(drop, whole) : null;

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
          const owed = drift?.get(holderKey(holderOf(seat))) ?? 0;
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
              {/* The pieces that many stacks is, and then what it leaves them owed. Never both: the
                  count is the fact, and the debt is only worth saying when there is one. */}
              <span className="config-share-stacks">
                {owed === 0 ? piecesLabel((parsed[seat.id] ?? 0) * drop.size) : driftLabel(owed)}
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

/** What that many stacks comes to. Zero is said in words: "0 pieces" reads as a figure to act on. */
function piecesLabel(pieces: number): string {
  return pieces === 0 ? "none" : `${pieces}`;
}

/** What this member is holding beyond their share, or short of it, in pieces. */
function driftLabel(owed: number): string {
  return owed > 0 ? `+${owed} to pay out` : `${-owed} owed to them`;
}
