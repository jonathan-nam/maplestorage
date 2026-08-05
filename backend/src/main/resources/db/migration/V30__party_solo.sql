-- A pool for a boss nobody else was there for.
--
-- A drop hangs off a config, and a config was your character plus at least one other person. That
-- left every boss you solo with nowhere to log what fell, which is most of Individual View. A solo
-- config is the same row with one seat, so its drops go through the same splitOf() a party's do,
-- with no shares to pay.
--
-- It is still not a party, and nothing that lists parties lists it: partiesFor() leaves these out
-- unless asked, so Party View, Run Order and People are unchanged. The unique index on
-- (character_id, boss_catalog_id) is what makes "log a drop for this character on this boss" find
-- the pool it already has rather than open a second one.
--
-- Adding the people you run it with turns the row into an ordinary party, and pins the weeks its
-- existing drops fell in as solo weeks first. See adoptSoloParty.

ALTER TABLE party ADD COLUMN solo BOOLEAN NOT NULL DEFAULT false;
