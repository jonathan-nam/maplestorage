"use client";

import { useState } from "react";
import { LootRow } from "@/components/loot-row";
import { apiAssetUrl } from "@/lib/api";
import { dropExistsIn, isPerMember } from "@/lib/world";
import type { AddLootBody, Loot, SellLootBody } from "@/types/loot";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { Party } from "@/types/party";

// The party's loot pool: log a drop, then take it through sold and paid out.
//
// The item comes from the boss's own drop table (catalog/drops.yaml) rather than a text box,
// because a pool full of "grindstone", "Grindstone" and "grindstone of faith" is a pool you cannot
// count. Anything the tables do not list is still typeable.

const OTHER = "__other__";

export function LootPool({
  party,
  loot,
  dropTables,
  bossByKey,
  busy,
  onAdd,
  onSell,
  onUnsell,
  onSetPaid,
  onDelete,
}: {
  party: Party;
  loot: Loot[];
  dropTables: DropTables;
  bossByKey: Map<string, Boss>;
  busy: boolean;
  onAdd: (body: AddLootBody) => void;
  onSell: (lootId: string, body: SellLootBody) => void;
  onUnsell: (lootId: string) => void;
  onSetPaid: (lootId: string, memberId: string, paid: boolean) => void;
  onDelete: (lootId: string) => void;
}) {
  const bossKey = party.bossKey;
  const [dropKey, setDropKey] = useState("");
  const [customName, setCustomName] = useState("");

  // Only what drops where this party plays. The three scroll coupons do not exist in Heroic
  // worlds, and a picker that offers one there is offering to log a drop that cannot happen.
  const table = (dropTables[bossKey] ?? []).filter((d) => dropExistsIn(d.worlds, party.worldType));
  const chosen = table.find((d) => d.dropKey === dropKey);
  const canAdd = !busy && (dropKey === OTHER ? customName.trim() !== "" : dropKey !== "");

  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Loot pool</h2>

      <form
        className="loot-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canAdd) return;
          onAdd({
            bossKey: bossKey || null,
            dropKey: dropKey === OTHER ? null : dropKey,
            customName: dropKey === OTHER ? customName.trim() : null,
          });
          setDropKey("");
          setCustomName("");
        }}
      >
        {bossByKey.get(bossKey)?.iconUrl && (
          <img
            className="boss-portrait"
            src={apiAssetUrl(bossByKey.get(bossKey)!.iconUrl!)}
            alt=""
          />
        )}

        {/* No boss picker: a pool belongs to a config, and a config IS one boss. Choosing again
            here would let a Kalos drop be filed under Limbo in Kalos's own pool. */}
        <select
          className="split-input loot-drop-select"
          value={dropKey}
          onChange={(e) => setDropKey(e.target.value)}
          aria-label="Which drop"
        >
          <option value="">pick a drop</option>
          {table.map((drop) => (
            <option key={drop.dropKey} value={drop.dropKey}>
              {drop.name}
              {isPerMember(drop.perMember, party.worldType) ? " (one each)" : ""}
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

        <button type="submit" className="party-save" disabled={!canAdd}>
          Add drop
        </button>
      </form>

      {/* The "only drops in Interactive worlds" note that used to sit here is gone: the list is
          now narrowed to this party's world, so anything still on it does drop here. */}
      {table.length === 0 && bossKey !== "" && (
        <p className="party-hint">
          No drop table recorded for this boss yet, so pick “something else” and type it.
        </p>
      )}

      {loot.length === 0 ? (
        <p className="finder-empty">Nothing in the pool yet.</p>
      ) : (
        <div className="loot-list">
          {loot.map((item) => (
            <LootRow
              key={item.id}
              loot={item}
              party={party}
              boss={item.bossKey ? (bossByKey.get(item.bossKey) ?? null) : null}
              busy={busy}
              onSell={(body) => onSell(item.id, body)}
              onUnsell={() => onUnsell(item.id)}
              onSetPaid={(memberId, paid) => onSetPaid(item.id, memberId, paid)}
              onDelete={() => onDelete(item.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
