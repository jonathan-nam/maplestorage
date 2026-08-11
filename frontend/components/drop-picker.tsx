"use client";

import { useState, type ReactNode } from "react";
import { DropSelect } from "@/components/drop-select";
import { OTHER, addDropBody, defaultQuantity, pickableDrops } from "@/lib/drop-picker";
import type { WorldType } from "@/lib/world";
import type { BossDrop } from "@/types/drop";
import type { AddLootBody } from "@/types/loot";

// Log a drop. Carried by the party's loot pool, by a row on Party View and by the Drop Log's own
// form, the same component in all three so no two can offer different drops for the same boss.
//
// The item comes from the boss's own drop table (catalog/drops.yaml) rather than a text box,
// because a pool full of "grindstone", "Grindstone" and "grindstone of faith" is a pool you cannot
// count. Anything the tables do not list is still typeable.
//
// The boss is not a control here: a pool belongs to a config, and a config IS one boss. A caller
// that has to ask which boss (the Drop Log does, since it covers all of them) asks in `lead`, and
// the answer arrives as `bossKey`. Nor is it drawn: every screen carrying this form already names
// the boss above it.

export function DropPicker({
  bossKey,
  worldType,
  table,
  busy,
  lead,
  difficulty,
  onAdd,
}: {
  /** Which boss this drop is for. Empty until a caller that asks has an answer. */
  bossKey: string;
  /**
   * The mode this party runs, which decides how many pieces a stacking drop arrives in. Absent, or
   * null where nobody has said, fills nothing: see defaultQuantity.
   */
  difficulty?: string | null;
  /** Whose world the drop fell in. Narrowing the table to it is pickableDrops' job, not a caller's. */
  worldType: WorldType;
  /** This boss's whole table. */
  table: BossDrop[] | undefined;
  busy: boolean;
  /** Controls the caller needs answered first, inside this form so there is one submit. */
  lead?: ReactNode;
  /**
   * Rejecting keeps what was picked on screen, so a failed save can be retried without choosing
   * again. Callers that report the failure themselves reject; the loot pool handles its own and
   * does not.
   */
  onAdd: (body: AddLootBody) => void | Promise<void>;
}) {
  const [dropKey, setDropKey] = useState("");
  const [customName, setCustomName] = useState("");
  const [quantity, setQuantity] = useState("");

  const drops = pickableDrops(table, worldType);
  const body = addDropBody(bossKey, dropKey, customName, quantity);

  return (
    <>
      <form
        className="loot-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body || busy) return;
          try {
            await onAdd(body);
          } catch {
            return;
          }
          setDropKey("");
          setCustomName("");
          setQuantity("");
        }}
      >
        {lead}

        <DropSelect
          drops={drops}
          worldType={worldType}
          value={dropKey}
          label="Which drop"
          onChange={(picked) => {
            setDropKey(picked);
            // Filled from the catalog on every change of drop, including back to nothing, so the
            // count belongs to what is currently picked. Typing over it stands: nothing refills a
            // box after this, which is what makes it a default rather than a value.
            setQuantity(
              defaultQuantity(
                drops.find((d) => d.dropKey === picked),
                difficulty,
              ),
            );
          }}
        />

        {dropKey === OTHER && (
          <input
            className="split-input"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="what dropped"
            aria-label="Item name"
            maxLength={80}
          />
        )}

        {dropKey !== "" && (
          <input
            className="split-input loot-count-input"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="1"
            aria-label="How many"
            inputMode="numeric"
            maxLength={7}
          />
        )}

        <button type="submit" className="party-save" disabled={busy || !body}>
          Add drop
        </button>
      </form>

      {/* The "only drops in Interactive worlds" note that used to sit here is gone: the list is
          now narrowed to this party's world, so anything still on it does drop here. */}
      {drops.length === 0 && bossKey !== "" && (
        <p className="party-hint">
          No drop table recorded for this boss yet, so pick “something else” and type it.
        </p>
      )}
    </>
  );
}
