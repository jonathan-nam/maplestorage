-- The tracker no longer keeps Akechi Mitsuhide.
--
-- It stays in catalog/bosses.yaml marked `tracked: false`, because its row is still on the
-- planner and the reader must still be able to name it. Only tracked bosses are seeded, so this
-- drops what the old seed already put in. Same shape as V14__drop_daily_bosses.sql.
--
-- Destructive and deliberate: recorded clears for it are deleted, not archived.

DELETE FROM boss_clear
WHERE boss_catalog_id IN (SELECT id FROM boss_catalog WHERE boss_key = 'akechi-mitsuhide');

DELETE FROM boss_catalog WHERE boss_key = 'akechi-mitsuhide';
