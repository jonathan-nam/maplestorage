-- Pieces a holder took for themselves that were somebody else's, and paid for.
--
-- V46 gave a holder one way to take pieces off the market: KEPT, no money, out of the sellable pile.
-- It was never bounded by their own share, and it could not be, because the alternative was worse:
-- a holder who redeems 250 of a 390 pile when 195 are theirs has eaten 55 of the creditor's, and
-- refusing to record the 250 leaves those 55 marked sellable, waiting on a sale that is not coming.
--
-- So the 55 were folded into KEPT and priced at the average the holder's OWN sales happened to get.
-- That is an extrapolation, and the thinner the remaining sellable pile the wilder it gets: one
-- unsold piece left, and its price alone set the figure for a 60-piece claim.
--
-- BOUGHT is the same event with the price stated instead of inferred. The pieces leave the pile like
-- a redemption, and the money goes to the creditor directly rather than pro rata, because these
-- pieces were never on the market: the holder bought them off the party at a price somebody agreed.
--
-- What that buys, beyond not guessing: KEPT can now be bounded by the holder's own share, and once
-- it is, every pile's sellable count is at least what the holder owes out of it. So the pro rata in
-- frontend/lib/piece-ledger.ts is always an interpolation and never an extrapolation, which is the
-- structural version of the fix rather than a warning about it.

ALTER TABLE vestige_tranche DROP CONSTRAINT vestige_tranche_disposition_check;

ALTER TABLE vestige_tranche
    ADD CONSTRAINT vestige_tranche_disposition_check
        CHECK (disposition IN ('SOLD', 'KEPT', 'BOUGHT'));

-- Money on everything except a redemption, which is the one kind that realized nothing. Replaces the
-- V46 form, which named SOLD alone and so would have refused every BOUGHT row.
ALTER TABLE vestige_tranche DROP CONSTRAINT vestige_tranche_amount_ref;

ALTER TABLE vestige_tranche
    ADD CONSTRAINT vestige_tranche_amount_ref
        CHECK ((disposition <> 'KEPT') = (amount IS NOT NULL));

COMMENT ON COLUMN vestige_tranche.disposition IS
    'SOLD is a sale on the market, split pro rata. KEPT is pieces redeemed, no amount, and never '
    'more than the holder''s own share. BOUGHT is the creditor''s pieces taken by the holder at an '
    'agreed price, paid to the creditor directly. All three leave the sellable pile.';
