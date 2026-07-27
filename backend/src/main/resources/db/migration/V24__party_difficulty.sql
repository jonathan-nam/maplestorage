-- What difficulty a party runs its boss at.
--
-- Part of the config, not of the clear. A clear is (boss, cleared) read off a planner capture, and
-- the planner's own difficulty badge is ignored on purpose: a player sets it independent of what
-- they actually kill. What difficulty you AGREED to run is something you say here.

-- The modes each boss offers, lowest first. Seeded from catalog/bosses.yaml by R__boss_catalog.sql,
-- which Flyway runs after this. Empty until then, and empty means no mode can be picked, which is
-- the safe direction to fail in.
ALTER TABLE boss_catalog ADD COLUMN difficulties TEXT[] NOT NULL DEFAULT '{}';

-- Nullable, and NOT backfilled. Every config predates the column, so a default would be this app
-- writing down a difficulty nobody chose.
--
-- The CHECK is the ladder, not the boss's own list: whether NORMAL is a mode THIS boss has needs
-- the catalog row, so the route checks it (PartyValidation.kt). Both are needed, one keeps
-- nonsense out of the column and the other keeps Normal Black Mage out of a config.
ALTER TABLE party ADD COLUMN difficulty TEXT
    CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD', 'CHAOS', 'EXTREME'));
