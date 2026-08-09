"use client";

import { DropPicker } from "@/components/drop-picker";
import { LootRow } from "@/components/loot-row";
import { isPieceDrop } from "@/lib/drop-log";
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
  adding,
  isSaving,
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
  /** The picker's own add. Not the rows': one drop being logged does not lock the pool. */
  adding: boolean;
  /** Whether THIS drop's write is in flight, by its id. */
  isSaving: (lootId: string) => boolean;
  onAdd: (body: AddLootBody) => void;
  onSell: (lootId: string, body: SellLootBody) => void;
  onUnsell: (lootId: string) => void;
  onSetPaid: (lootId: string, memberId: string, paid: boolean) => void;
  onDelete: (lootId: string) => void;
}) {
  // The same test the Drop Log divides on, so what the two screens call a coupon cannot drift.
  const coupons = loot.filter((item) => isPieceDrop(item, party, dropTables));
  const sellable = loot.filter((item) => !isPieceDrop(item, party, dropTables));

  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Loot pool</h2>

      <DropPicker
        bossKey={party.bossKey}
        worldType={party.worldType}
        table={dropTables[party.bossKey]}
        difficulty={party.difficulty}
        boss={bossByKey.get(party.bossKey) ?? null}
        busy={adding}
        onAdd={onAdd}
      />

      {loot.length === 0 && <p className="finder-empty">Nothing in the pool yet.</p>}

      {/* Sellable drops first, then the coupons, because they are settled in different places and
          a hammer was easy to lose among them. One sells here for a pot that divides as money; a
          stack of coupons divides by COUNT and is priced on the Drop Log, in tranches.

          Headed only when both kinds are present. A pool of one kind is just the pool. */}
      <LootGroup
        rows={sellable}
        title={sellable.length > 0 && coupons.length > 0 ? "Drops" : null}
        party={party}
        bossByKey={bossByKey}
        isSaving={isSaving}
        onSell={onSell}
        onUnsell={onUnsell}
        onSetPaid={onSetPaid}
        onDelete={onDelete}
      />
      <LootGroup
        rows={coupons}
        title={sellable.length > 0 && coupons.length > 0 ? "Coupons" : null}
        party={party}
        bossByKey={bossByKey}
        isSaving={isSaving}
        onSell={onSell}
        onUnsell={onUnsell}
        onSetPaid={onSetPaid}
        onDelete={onDelete}
      />
    </section>
  );
}

/**
 * One half of a split pool, or the whole of an unsplit one.
 *
 * At module level and not nested in LootPool, which would be a new component type on every render:
 * React would unmount the rows and take a half-typed sale with them.
 */
function LootGroup({
  rows,
  title,
  party,
  bossByKey,
  isSaving,
  onSell,
  onUnsell,
  onSetPaid,
  onDelete,
}: {
  rows: Loot[];
  /** Null when the pool holds one kind, which needs no heading to tell it from the other. */
  title: string | null;
  party: Party;
  bossByKey: Map<string, Boss>;
  isSaving: (lootId: string) => boolean;
  onSell: (lootId: string, body: SellLootBody) => void;
  onUnsell: (lootId: string) => void;
  onSetPaid: (lootId: string, memberId: string, paid: boolean) => void;
  onDelete: (lootId: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      {title && <h3 className="loot-group-title">{title}</h3>}
      <div className="loot-list">
        {rows.map((item) => (
          <LootRow
            key={item.id}
            loot={item}
            party={party}
            boss={item.bossKey ? (bossByKey.get(item.bossKey) ?? null) : null}
            busy={isSaving(item.id)}
            onSell={(body) => onSell(item.id, body)}
            onUnsell={() => onUnsell(item.id)}
            onSetPaid={(memberId, paid) => onSetPaid(item.id, memberId, paid)}
            onDelete={() => onDelete(item.id)}
          />
        ))}
      </div>
    </>
  );
}
