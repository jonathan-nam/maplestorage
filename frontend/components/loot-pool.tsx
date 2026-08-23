"use client";

import { useState } from "react";
import { DropPicker } from "@/components/drop-picker";
import { LootList, type StackAssignment } from "@/components/loot-list";
import type { PieceStatus } from "@/lib/drop-log";
import { takenTally } from "@/lib/loot";
import { canTrade } from "@/lib/world";
import type { AddLootBody, Loot, SellLootBody } from "@/types/loot";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { Party } from "@/types/party";

// The party's loot pool: log a drop, then take it through sold and paid out. The form is
// DropPicker and the rows are LootList, both shared with the row on Party View.

export function LootPool({
  party,
  loot,
  dropTables,
  bossByKey,
  pieceStatus,
  stacks,
  adding,
  isSaving,
  onAdd,
  onSell,
  onUnsell,
  onSetTaken,
  onSetPaid,
  onDelete,
}: {
  party: Party;
  loot: Loot[];
  dropTables: DropTables;
  bossByKey: Map<string, Boss>;
  /** What a coupon row says it is. See PieceStatus. */
  pieceStatus?: PieceStatus;
  /**
   * What each seat was entitled to out of a night's coupons, and what they picked up.
   *
   * A gap between the two is a debt, and a debt with nothing on screen behind it is one the other
   * side argues with. The night's pickup is correctable here (see the Edit below); the standing
   * split is not, because it is the party's rather than this pool's and arrives with no onSave.
   */
  stacks?: StackAssignment;
  /** The picker's own add. Not the rows': one drop being logged does not lock the pool. */
  adding: boolean;
  /** Whether THIS drop's write is in flight, by its id. */
  isSaving: (lootId: string) => boolean;
  onAdd: (body: AddLootBody) => void;
  onSell: (lootId: string, body: SellLootBody) => void;
  onUnsell: (lootId: string) => void;
  onSetTaken: (lootId: string, memberId: string | null) => void;
  onSetPaid: (lootId: string, memberId: string, paid: boolean) => void;
  onDelete: (lootId: string) => void;
}) {
  /**
   * Whether the night's stack boxes take typing. Party View's own model, and for its own reason.
   *
   * Not always-on. An unanswered night's boxes OPEN on a guess (a named looter, or the balanced
   * split), so leaving them out would draw a pickup nobody entered as though it had happened. At
   * rest the night states what was recorded and nothing else. See StackPickup.
   */
  const [editing, setEditing] = useState(false);
  // Offered only where something can actually be answered. A pool whose coupon nights have all
  // settled is history, and an Edit over it is a button that opens nothing.
  const correctable = Boolean(
    stacks?.pickup.onSave &&
    stacks.pickup.drops.some((drop) => !stacks.pickup.locked?.has(drop.lootId)),
  );

  return (
    <section className="loot-pool">
      <div className="loot-pool-head">
        <h2 className="loot-pool-title">Loot pool</h2>
        {correctable && (
          <button
            type="button"
            className="party-cancel"
            onClick={() => setEditing((open) => !open)}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        )}
      </div>

      <DropPicker
        bossKey={party.bossKey}
        worldType={party.worldType}
        table={dropTables[party.bossKey]}
        difficulty={party.difficulty}
        busy={adding}
        onAdd={onAdd}
      />

      {loot.length === 0 && <p className="finder-empty">Nothing in the pool yet.</p>}

      {/* The running count, in a world where nothing sells. Not shown where drops become mesos:
          there the pot divides and who physically held the item is not what makes it fair.
          A solo pool has one seat, so there is nobody to be even with. */}
      {!canTrade(party.worldType) && !party.solo && loot.length > 0 && (
        <ul className="loot-tally">
          {takenTally(loot, party.seats).map((seat) => (
            <li key={seat.memberId} className={seat.up ? "is-up" : undefined}>
              <span className="loot-tally-name">{seat.name}</span>
              <span className="loot-tally-count">{seat.taken}</span>
            </li>
          ))}
        </ul>
      )}

      <LootList
        party={party}
        loot={loot}
        dropTables={dropTables}
        bossByKey={bossByKey}
        pieceStatus={pieceStatus}
        stacks={stacks}
        editing={editing}
        isSaving={isSaving}
        onSell={onSell}
        onUnsell={onUnsell}
        onSetTaken={onSetTaken}
        onSetPaid={onSetPaid}
        onDelete={onDelete}
      />
    </section>
  );
}
