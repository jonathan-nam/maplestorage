-- Pieces a holder redeemed rather than sold.
--
-- The ledger priced a debt pro rata over the holder's WHOLE pile, so the creditor was paid the same
-- fraction of their claim as the fraction of the pile that happened to sell. Keep half your pile and
-- the creditor sits at half of what they are owed, permanently, with the holder holding the lever
-- and nothing on screen saying so. Issue #281.
--
-- Pro rata is only right if the pile fully liquidates. Vestige coupons are single-trade, so a holder
-- who redeems their own share cannot hand the creditor sellable pieces: the receiver would get
-- something they cannot list. Only the holder can turn the creditor's share into mesos, which is
-- exactly the arrangement that came out wrong.
--
-- So a redeemed piece is recorded, and comes out of the denominator every price is derived from.
-- frontend/lib/piece-ledger.ts holds that arithmetic and stays the only copy of it.
--
-- A DISPOSITION on the tranche, not a table of its own. A KEPT row is the same shape as a sale minus
-- the money: whose pile, how many pieces, when it was recorded. It names no boss for the same reason
-- a sale does not, and it is the stronger reason here: a coupon in an inventory has no boss written
-- on it, so asking which clear a redeemed piece came from is asking for a guess. Which drops the
-- pieces come off is worked out on read, from the NEWEST end of the queue, so recording a redemption
-- can never un-price a boss that has already paid an instalment.
--
-- Rows rather than one running count, so a redemption entered by mistake can be removed the same way
-- a mistyped sale is. Only the sum matters, so their order does not.

ALTER TABLE vestige_tranche
    -- DEFAULT is for the rows already here, every one of which is a sale. Dropped again below: which
    -- kind a tranche is has to be a value somebody wrote, the same argument as holder_kind in V39.
    ADD COLUMN disposition TEXT NOT NULL DEFAULT 'SOLD'
        CHECK (disposition IN ('SOLD', 'KEPT'));

ALTER TABLE vestige_tranche ALTER COLUMN disposition DROP DEFAULT;

-- A redemption has no money in it, and a sale cannot be missing its money. Without this a KEPT row
-- carrying an amount would price the pieces it exists to say were never priced.
ALTER TABLE vestige_tranche ALTER COLUMN amount DROP NOT NULL;

ALTER TABLE vestige_tranche
    ADD CONSTRAINT vestige_tranche_amount_ref
        CHECK ((disposition = 'SOLD') = (amount IS NOT NULL));

COMMENT ON COLUMN vestige_tranche.disposition IS
    'SOLD is a sale with an amount. KEPT is pieces redeemed, no amount, out of the sellable pile.';
