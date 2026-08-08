-- How many pieces a boss drops, per difficulty.
--
-- The first number in these tables that is per (boss, difficulty) rather than per item: Extreme
-- Kalos gives 180 vestige coupons and Extreme Kaling 480, so it could not sit on the drop. It fills
-- the count when a drop is logged, which is the difference between a number somebody corrects and a
-- number they have to remember.
--
-- Only the combinations that actually drop them have a row. A difficulty with none is ABSENT rather
-- than zero: nothing to fill is what an empty box already says, and a pre-filled zero would be a
-- claim that the drop table does not make.
--
-- Rebuilt from catalog/drops.yaml on every boot, exactly like boss_drop and for the same reason:
-- pure join data with nothing pointing at it, so an amount that changes has to actually change.

CREATE TABLE boss_drop_amount (
    boss_catalog_id UUID NOT NULL REFERENCES boss_catalog(id) ON DELETE CASCADE,
    drop_catalog_id UUID NOT NULL REFERENCES drop_catalog(id) ON DELETE CASCADE,
    difficulty      TEXT NOT NULL,
    pieces          INTEGER NOT NULL CHECK (pieces >= 1),

    PRIMARY KEY (boss_catalog_id, drop_catalog_id, difficulty)
);
