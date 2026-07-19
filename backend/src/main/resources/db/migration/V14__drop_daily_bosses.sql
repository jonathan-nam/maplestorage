-- The tracker no longer keeps daily bosses (Zakum, Gollux). A once-a-day capture cannot say
-- anything durable about a boss that resets daily: the column reports one arbitrary moment.
--
-- They stay in catalog/bosses.yaml marked `tracked: false`, because their rows are still on the
-- planner and the reader must still be able to name them. Only the tracked bosses are seeded, so
-- this drops what the old seed already put in.
--
-- Destructive and deliberate: recorded daily clears are deleted, not archived. Nothing else reads
-- boss_clear, and a daily clear from a past day was never actionable. R__boss_catalog.sql reseeds
-- the remaining 17 immediately after this runs (Flyway: versioned before repeatable).

DELETE FROM boss_clear
WHERE boss_catalog_id IN (SELECT id FROM boss_catalog WHERE reset = 'DAILY');

DELETE FROM boss_catalog WHERE reset = 'DAILY';
