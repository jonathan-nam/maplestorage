"use client";

import { DropPicker } from "@/components/drop-picker";
import { LootRow } from "@/components/loot-row";
import type { AddLootBody, Loot, SellLootBody } from "@/types/loot";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { Party } from "@/types/party";

// The party's loot pool: log a drop, then take it through sold and paid out. The form is
// DropPicker, shared with the row on Party View.

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
  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Loot pool</h2>

      <DropPicker
        party={party}
        table={dropTables[party.bossKey]}
        boss={bossByKey.get(party.bossKey) ?? null}
        busy={busy}
        onAdd={onAdd}
      />

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
