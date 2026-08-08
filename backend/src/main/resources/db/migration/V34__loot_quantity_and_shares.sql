-- Two things a drop that stacks needs: how many of it fell, and who takes what fraction of the pot.
--
-- Vestige of Erion Coupons are the case. A boss drops them in bundles (Extreme Kalos gives 180 in
-- six of 30), they are tradeable exactly once, so one member loots the lot and sells it, and what
-- comes back is one sale to divide. Six rows of "Vestige of Erion" is the same drop typed six times.
--
-- Shares are still not computed money: a share COUNT is what a party agreed, entered by hand like
-- the price and the method beside it. The arithmetic stays in frontend/lib/drop-split.ts and stays
-- the only copy of itself.

-- How many the row holds. 1 for every drop that is one item, which is every drop logged so far.
ALTER TABLE party_loot
    ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 1000000);

-- The seller's own share count, pinned when the drop sold, like the payout roster and for the same
-- reason: what the party agreed that night is not what they may agree next month.
ALTER TABLE party_loot ADD COLUMN seller_shares INTEGER CHECK (seller_shares >= 1 AND seller_shares <= 99);

-- Every sale so far was an even one, so its seller took one share.
UPDATE party_loot SET seller_shares = 1 WHERE sold_at IS NOT NULL;

-- seller_shares joins the all-or-nothing set. A share count without a sale is a figure nothing can
-- be read from, and a sale without one cannot be split at all.
ALTER TABLE party_loot DROP CONSTRAINT party_loot_sale_complete;
ALTER TABLE party_loot
    ADD CONSTRAINT party_loot_sale_complete CHECK (
        (sold_at IS NULL AND sale_amount IS NULL AND amount_basis IS NULL
             AND split_method IS NULL AND seller_member_id IS NULL AND seller_shares IS NULL)
        OR (sold_at IS NOT NULL AND sale_amount IS NOT NULL AND amount_basis IS NOT NULL
             AND split_method IS NOT NULL AND seller_member_id IS NOT NULL AND seller_shares IS NOT NULL)
    );

-- What each owed member takes. NOT NULL because a payout row only exists on a sold drop, and
-- existing rows were all even splits.
ALTER TABLE party_loot_payout
    ADD COLUMN shares INTEGER NOT NULL DEFAULT 1 CHECK (shares >= 1 AND shares <= 99);

-- The standing weight: what this seat usually takes. Copied onto a sale as its default rather than
-- read by the split, so changing it later cannot rewrite a night that has already been settled.
ALTER TABLE party_member
    ADD COLUMN shares INTEGER NOT NULL DEFAULT 1 CHECK (shares >= 1 AND shares <= 99);
