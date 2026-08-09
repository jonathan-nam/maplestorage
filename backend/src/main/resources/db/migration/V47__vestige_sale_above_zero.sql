-- A sale needs money in it. A stack that fetched nothing is KEPT.
--
-- V38 allowed `amount = 0` and documented it as how a stack handed over rather than sold was
-- recorded. That prices those pieces at nothing and folds the nothing into the pro rata average, so
-- the creditor absorbs their share of a loss the holder chose. Issue #290.
--
-- V46 gave the same event a home with the incidence the right way round: KEPT pieces leave the
-- sellable pile and come off the holder's OWN entitlement first, so giving a stack away costs the
-- person who gave it away and nobody else. The two dispositions disagreed about who pays, and the
-- one that was wrong was the one with no label on it: nothing said what typing zero meant.
--
-- Any positive amount is still fine, so a nominal sale is untouched. Zero rows to migrate, checked
-- against the dev database on 2026-08-09.

ALTER TABLE vestige_tranche DROP CONSTRAINT vestige_tranche_amount_check;

ALTER TABLE vestige_tranche
    ADD CONSTRAINT vestige_tranche_amount_check CHECK (amount IS NULL OR amount >= 1);

COMMENT ON COLUMN vestige_tranche.amount IS
    'Mesos for the whole tranche, at least 1. NULL on a KEPT row, which has no sale and no price.';
