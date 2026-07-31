"use client";

import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { OTHER, addDropBody, dropOptionLabel, pickableDrops } from "@/lib/drop-picker";
import type { Boss } from "@/types/boss";
import type { BossDrop } from "@/types/drop";
import type { AddLootBody } from "@/types/loot";
import type { Party } from "@/types/party";

// Log a drop. Carried by the party's loot pool and by a row on Party View, the same component in
// both so the two cannot offer different drops for the same boss.
//
// The item comes from the boss's own drop table (catalog/drops.yaml) rather than a text box,
// because a pool full of "grindstone", "Grindstone" and "grindstone of faith" is a pool you cannot
// count. Anything the tables do not list is still typeable.

export function DropPicker({
  party,
  table,
  boss,
  busy,
  onAdd,
}: {
  party: Party;
  /** This boss's whole table. Narrowing to the party's world is pickableDrops' job, not a caller's. */
  table: BossDrop[] | undefined;
  /** Leads the form where the surrounding screen does not already say which boss this is. */
  boss?: Boss | null;
  busy: boolean;
  /**
   * Rejecting keeps what was picked on screen, so a failed save can be retried without choosing
   * again. Callers that report the failure themselves reject; the loot pool handles its own and
   * does not.
   */
  onAdd: (body: AddLootBody) => void | Promise<void>;
}) {
  const bossKey = party.bossKey;
  const [dropKey, setDropKey] = useState("");
  const [customName, setCustomName] = useState("");

  const drops = pickableDrops(table, party.worldType);
  const chosen = drops.find((d) => d.dropKey === dropKey);
  const body = addDropBody(bossKey, dropKey, customName);

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
        }}
      >
        {boss?.iconUrl && <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />}

        {/* No boss picker: a pool belongs to a config, and a config IS one boss. Choosing again
            here would let a Kalos drop be filed under Limbo in Kalos's own pool. */}
        <select
          className="split-input loot-drop-select"
          value={dropKey}
          onChange={(e) => setDropKey(e.target.value)}
          aria-label="Which drop"
        >
          <option value="">pick a drop</option>
          {drops.map((drop) => (
            <option key={drop.dropKey} value={drop.dropKey}>
              {dropOptionLabel(drop, party.worldType)}
            </option>
          ))}
          <option value={OTHER}>something else...</option>
        </select>

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

        {chosen?.iconUrl && <img className="loot-icon" src={apiAssetUrl(chosen.iconUrl)} alt="" />}

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
