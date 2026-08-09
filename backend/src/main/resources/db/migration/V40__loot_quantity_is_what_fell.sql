-- A clear's row records WHAT FELL, not a share of it.
--
-- V37 stored a share: the whole drop when one member looted, otherwise the whole divided by who
-- ran. Both inputs are edited long after the clear was ticked, and the stored number did not
-- follow. On the dev account one Hard Limbo row read 60 while its party was an even three-way
-- split of a 60-piece drop, so the Drop Log counted three times what that character got, silently
-- and with nothing on screen to disagree with.
--
-- A share is now worked out on every read, from the party as it stands, which is the only version
-- that cannot go stale. See lib/drop-log.ts.
--
-- This resets the rows the app filed itself to the catalog's amount for their boss and difficulty.
-- Safe because the app put them there and the catalog is where it got them: no human typed these,
-- and every one of them is either already the amount or a share of it.
--
-- NOT touched, and the reason the WHERE clause is this narrow:
--
--   from_clear = false   somebody typed it because they saw it fall. Whatever they wrote is the
--                        record, and correcting it from a catalog they were not reading is how you
--                        overwrite an observation with an assumption.
--   sold_at IS NOT NULL  a sale is pinned to the count it was made against. Changing the count
--                        under a settled payout would re-cut money somebody has already sent.

UPDATE party_loot l
SET quantity = a.pieces,
    updated_at = now()
FROM party p, boss_drop_amount a
WHERE l.party_id = p.id
  AND l.from_clear
  AND l.sold_at IS NULL
  AND l.boss_catalog_id = a.boss_catalog_id
  AND l.drop_catalog_id = a.drop_catalog_id
  AND p.difficulty = a.difficulty
  AND l.quantity <> a.pieces;
