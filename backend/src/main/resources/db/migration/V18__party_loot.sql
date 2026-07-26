-- A party's loot pool: what dropped, whether it sold, and who has been paid. Mirrors db/Tables.kt
-- column-for-column (this file is the schema source of truth).
--
-- NO COMPUTED MONEY IS STORED. Not a share, not a payout, not a fee. The split arithmetic has one
-- implementation (frontend/lib/drop-split.ts, 64 tests) and a second copy in SQL or Kotlin is how
-- two answers to "what do I send you" end up on one screen. What is stored is what a human
-- entered: the price, which end of the sale it was, which method the party agreed on, and who has
-- actually been paid.

CREATE TABLE party_loot (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id        UUID NOT NULL REFERENCES party(id) ON DELETE CASCADE,
    -- Exactly one of these names the item. A catalog drop keeps its link (so the icon and the
    -- per-member warning follow it); anything not in a boss table is free text.
    drop_catalog_id UUID REFERENCES drop_catalog(id),
    custom_name     TEXT,
    -- Which boss it came off. Optional: a party runs several, and you may not remember.
    boss_catalog_id UUID REFERENCES boss_catalog(id),
    dropped_on      DATE NOT NULL,

    -- The sale, all of it or none of it. NULL sold_at is a drop still sitting in the pool.
    sold_at         TIMESTAMPTZ,
    -- Mesos, as entered. BIGINT because a drop goes past 2^31 mesos routinely.
    sale_amount     BIGINT CHECK (sale_amount IS NULL OR sale_amount >= 0),
    -- Which end of the sale sale_amount is: the listed price, or what landed in the seller's
    -- inventory after the Auction House took its cut. See AmountBasis in lib/drop-split.ts.
    amount_basis    TEXT CHECK (amount_basis IN ('LISTED', 'RECEIVED')),
    split_method    TEXT CHECK (split_method IN ('LAZY', 'FAIR')),
    -- Whose inventory the mesos are in. One of the party's seats, which may be one of yours.
    -- CASCADE for one case only: deleting the whole party. A seat that sold something cannot be
    -- removed on its own (the save route refuses it), so this never quietly discards a sale.
    -- Without the cascade, deleting a party fails outright: party_member goes with it, and the
    -- NO ACTION default is checked before the loot rows on the other side of the party have gone.
    seller_member_id UUID REFERENCES party_member(id) ON DELETE CASCADE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT party_loot_named_once CHECK ((drop_catalog_id IS NULL) <> (custom_name IS NULL)),
    -- A sale is complete or absent. Half a sale (a price with no basis) would be a row the split
    -- cannot be computed from, shown as if it could.
    CONSTRAINT party_loot_sale_complete CHECK (
        (sold_at IS NULL AND sale_amount IS NULL AND amount_basis IS NULL
             AND split_method IS NULL AND seller_member_id IS NULL)
        OR (sold_at IS NOT NULL AND sale_amount IS NOT NULL AND amount_basis IS NOT NULL
             AND split_method IS NOT NULL AND seller_member_id IS NOT NULL)
    )
);

-- Who is owed for a sale, pinned at the moment it sold.
--
-- Rows are written when the loot is marked sold, one per seat except the seller's, and never
-- re-derived from the party afterwards. That is the point: adding a member next week must not
-- create a debt on a drop they were not there for, and removing one must not erase that they were
-- paid. A seat with payout rows cannot be removed from the party (the route refuses it), so this
-- record cannot be cut out from under itself.
CREATE TABLE party_loot_payout (
    loot_id   UUID NOT NULL REFERENCES party_loot(id) ON DELETE CASCADE,
    -- CASCADE for the same single case as party_loot.seller_member_id: the party being deleted.
    member_id UUID NOT NULL REFERENCES party_member(id) ON DELETE CASCADE,
    paid      BOOLEAN NOT NULL DEFAULT false,
    paid_at   TIMESTAMPTZ,
    PRIMARY KEY (loot_id, member_id)
);

CREATE INDEX idx_party_loot_party_id ON party_loot(party_id);
CREATE INDEX idx_party_loot_drop_catalog_id ON party_loot(drop_catalog_id);
CREATE INDEX idx_party_loot_boss_catalog_id ON party_loot(boss_catalog_id);
CREATE INDEX idx_party_loot_seller_member_id ON party_loot(seller_member_id);
CREATE INDEX idx_party_loot_payout_member_id ON party_loot_payout(member_id);
