"use client";

import Link from "next/link";
import { Fragment } from "react";

import { LootRow } from "@/components/loot-row";
import { StackAssign } from "@/components/stack-assign";
import { isPieceDrop, type PieceStatus } from "@/lib/drop-log";
import type { StackDrop } from "@/lib/vestige-stacks";
import type { Loot, SellLootBody } from "@/types/loot";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { Party } from "@/types/party";

/** The nights that can still be handed out, and the write that does it. */
export type StackAssignment = {
  /**
   * What to head the group with while these boxes are under it.
   *
   * Passed in rather than built from the rows: the catalog calls the drop a "Vestige of Erion
   * Coupon", and a heading made of that plus a word would read Coupon Config. The page that knows
   * which drop this is names it, and this stays a group of piece rows.
   */
  title: string;
  drops: StackDrop[];
  behind: Map<string, number>;
  onSave: (lootId: string, bundles: Record<string, number>) => Promise<void>;
};

// The rows of a pool, split into what sells and what settles in coupons. Carried by the party's own
// page and by a row on Party View, the same component in both so the two cannot disagree about
// which side of the split a drop is on, or about what may be done to it.

// A coupon row's status is PASSED IN, never read off the row: a piece drop is PENDING for ever,
// because it settles through the tranche ledger and never through a sale of its own, so the raw
// status said "In the pool" on every vestige stack a party had ever dropped. The answer depends on
// the settlements, which no component here has any business fetching. See pieceStatusByParty.

export function LootList({
  party,
  loot,
  dropTables,
  bossByKey,
  pieceStatus,
  stacks,
  editing,
  isSaving,
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
  pieceStatus?: PieceStatus;
  /**
   * Who picked up which stacks, for the coupon rows that can still be handed out.
   *
   * Absent on the party's own page and on a past week, where the rows are read rather than answered.
   */
  stacks?: StackAssignment;
  /**
   * Whether the panel is in edit mode, which is the only state the stack boxes take typing in.
   *
   * Owned by the card and not by the page: it is the same Edit that swaps the roster strip for its
   * inputs, so one press opens everything on the row that can be answered.
   */
  editing?: boolean;
  /** Whether THIS drop's write is in flight, by its id. */
  isSaving: (lootId: string) => boolean;
  onSell: (lootId: string, body: SellLootBody) => void;
  onUnsell: (lootId: string) => void;
  onSetTaken: (lootId: string, memberId: string | null) => void;
  onSetPaid: (lootId: string, memberId: string, paid: boolean) => void;
  onDelete: (lootId: string) => void;
}) {
  // The same test the Drop Log divides on, so what the two screens call a coupon cannot drift.
  const coupons = loot.filter((item) => isPieceDrop(item, party, dropTables));
  const sellable = loot.filter((item) => !isPieceDrop(item, party, dropTables));
  // Headed only when both kinds are present. A pool of one kind is just the pool.
  const headed = sellable.length > 0 && coupons.length > 0;
  // The coupons are headed by their own NAME when the boxes are under them, because then the group
  // is a block of controls rather than a row: what it is called is the one thing tying the count,
  // the boxes and the Save together. "Coupons" over one row said nothing the row did not.
  const couponTitle = stacks ? stacks.title : headed ? "Coupons" : null;

  return (
    <>
      {/* Sellable drops first, then the coupons, because they are settled in different places and
          a hammer was easy to lose among them. One sells here for a pot that divides as money; a
          stack of coupons divides by COUNT and is priced on the Drop Log, in tranches. */}
      <LootGroup
        rows={sellable}
        title={headed ? "Drops" : null}
        party={party}
        bossByKey={bossByKey}
        isSaving={isSaving}
        onSell={onSell}
        onUnsell={onUnsell}
        onSetTaken={onSetTaken}
        onSetPaid={onSetPaid}
        onDelete={onDelete}
      />
      <LootGroup
        rows={coupons}
        title={couponTitle}
        party={party}
        bossByKey={bossByKey}
        statusOf={pieceStatus}
        pieces
        stacks={stacks}
        editing={editing}
        isSaving={isSaving}
        onSell={onSell}
        onUnsell={onUnsell}
        onSetTaken={onSetTaken}
        onSetPaid={onSetPaid}
        onDelete={onDelete}
      />
    </>
  );
}

/**
 * One half of a split pool, or the whole of an unsplit one.
 *
 * At module level and not nested in LootList, which would be a new component type on every render:
 * React would unmount the rows and take a half-typed sale with them.
 */
function LootGroup({
  rows,
  title,
  party,
  bossByKey,
  statusOf,
  stacks,
  editing,
  pieces,
  isSaving,
  onSell,
  onUnsell,
  onSetTaken,
  onSetPaid,
  onDelete,
}: {
  rows: Loot[];
  /** Null when the pool holds one kind, which needs no heading to tell it from the other. */
  title: string | null;
  party: Party;
  bossByKey: Map<string, Boss>;
  /** What a coupon row says it is, and how much of it is yours. Absent for the sellable group. */
  statusOf?: PieceStatus;
  /** Who picked up which stacks, drawn under the row it is about. */
  stacks?: StackAssignment;
  /** Whether those boxes take typing. See LootList. */
  editing?: boolean;
  /** These rows are stacks of pieces, which do not sell here. See LootRow's `pieces`. */
  pieces?: boolean;
  isSaving: (lootId: string) => boolean;
  onSell: (lootId: string, body: SellLootBody) => void;
  onUnsell: (lootId: string) => void;
  onSetTaken: (lootId: string, memberId: string | null) => void;
  onSetPaid: (lootId: string, memberId: string, paid: boolean) => void;
  onDelete: (lootId: string) => void;
}) {
  if (rows.length === 0) return null;
  // The config is ONE object: a heading, what fell, and the boxes that hand it out. Framed like a
  // pile on the Sale Ledger rather than left as three things stacked loose in the panel, which is
  // what it looked like beside the picker and the roster. Only when the boxes are there: the other
  // groups are lists to scan, and a border round a list of bordered rows is a box in a box.
  const Frame = stacks ? "div" : Fragment;
  const frameProps = stacks ? { className: "loot-config-card" } : {};
  return (
    <Frame {...frameProps}>
      {/* Lighter when it heads the boxes, and not a link: it names the block under it rather than
          pointing somewhere, and an underline said it went to the Drop Log. See .is-config. */}
      {title && (
        <h3 className={stacks ? "loot-group-title is-config" : "loot-group-title"}>
          {/* The coupon heading links to where they are priced, rather than a sentence saying so. The
              row has no sale of its own, and one word already on screen can carry that. */}
          {pieces && !stacks ? <Link href="/bosses/drops">{title}</Link> : title}
        </h3>
      )}
      <div className="loot-list">
        {rows.map((item) => {
          // The night this row is, when it can still be handed out. Under the row rather than
          // beside it: the row says what fell, and this says where it went.
          const drop = stacks?.drops.find((d) => d.lootId === item.id);
          return (
            <Fragment key={item.id}>
              <LootRow
                loot={item}
                party={party}
                boss={item.bossKey ? (bossByKey.get(item.bossKey) ?? null) : null}
                status={statusOf?.get(item.id)?.status ?? null}
                yours={statusOf?.get(item.id)?.yours ?? null}
                pieces={pieces}
                busy={isSaving(item.id)}
                onSell={(body) => onSell(item.id, body)}
                onUnsell={() => onUnsell(item.id)}
                onSetTaken={(memberId) => onSetTaken(item.id, memberId)}
                onSetPaid={(memberId, paid) => onSetPaid(item.id, memberId, paid)}
                onDelete={() => onDelete(item.id)}
              />
              {drop && stacks && (
                <StackAssign
                  drop={drop}
                  party={party}
                  behind={stacks.behind}
                  editing={editing ?? false}
                  busy={isSaving(item.id)}
                  onSave={stacks.onSave}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    </Frame>
  );
}
