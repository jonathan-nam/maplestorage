-- How many pieces a boss drops is per WORLD as well as per difficulty.
--
-- Two facts were being kept as one. `drop_catalog.per_member` already said whether the party gets
-- one pile or a copy each, and that is genuinely world-dependent (HEROIC). But the COUNT is a
-- second, independent number: Chaos Kalos gives 5 pieces to the whole party on Interactive and 2
-- to each member on Heroic, and Extreme gives 14 against 3.
--
-- None of those is a multiple of the other, so neither world can be derived from the other. Extreme
-- Kaling happens to come out at 18 either way, which is exactly the coincidence that would make a
-- derivation rule look right while being wrong everywhere else.
--
-- Every existing row is a vestige coupon count, which has only ever been stated once and read
-- whatever world the party was in. That is preserved rather than reinterpreted: the seed now writes
-- one row per world with the same number, so the claim on screen is what it always was.
--
-- Rebuilt from catalog/drops.yaml on every boot, so the default below only carries the ALTER.

ALTER TABLE boss_drop_amount DROP CONSTRAINT boss_drop_amount_pkey;

ALTER TABLE boss_drop_amount
    ADD COLUMN world TEXT NOT NULL DEFAULT 'INTERACTIVE'
        CHECK (world IN ('INTERACTIVE', 'HEROIC'));

ALTER TABLE boss_drop_amount ALTER COLUMN world DROP DEFAULT;

ALTER TABLE boss_drop_amount
    ADD PRIMARY KEY (boss_catalog_id, drop_catalog_id, difficulty, world);
