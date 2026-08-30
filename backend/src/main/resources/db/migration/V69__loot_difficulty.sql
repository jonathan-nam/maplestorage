-- The mode a drop FELL at, kept on the drop rather than read off the config.
--
-- party.difficulty is one mutable column describing an arrangement, and every pooled drop was
-- attributed through it. So editing a config's mode rewrote the past: a Kalos pool holding three
-- 180-coupon stacks logged at Extreme was flipped to Chaos by a one-off, and the stacks came back
-- as Chaos drops, which drops no vestiges at all.
--
-- Worse than a wrong label. pieceLootIds and lootWithCatalog join boss_drop_amount on the config's
-- mode, and there is no Chaos row for the coupon, so 540 coupons stopped matching and stopped being
-- divisible pieces. Nothing said so.
--
-- This is the rule V27 already keeps for the roster (party_week_seat pins the seats a written week
-- was played with). The mode is the same kind of fact and was the one part of a night still being
-- read off the template.
--
-- NULL means "not said", exactly as it does on party: a drop that predates this and could not be
-- placed keeps reading through the config, which is what the code did for every row before today.
ALTER TABLE party_loot
    ADD COLUMN difficulty TEXT
        CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD', 'CHAOS', 'EXTREME'));

-- Backfill only where the count IDENTIFIES the mode, and stay silent everywhere else.
--
-- boss_drop_amount holds the pieces a boss gives per (drop, difficulty, world). Where exactly one
-- difficulty in this drop's own world gives the number this row actually holds, that is the mode it
-- fell at and nothing else could have produced it: a 180 coupon stack is Extreme Kalos, because no
-- other Kalos mode drops the coupon at all.
--
-- Where two modes could give the same count, or the count matches none of them, this writes
-- nothing. Guessing from the config's current mode is the exact step that caused the bug, and a
-- backfill is not the place to repeat it: a NULL reads as "not said" and behaves as before.
UPDATE party_loot l
SET difficulty = a.difficulty
FROM party p
    JOIN characters c ON c.id = p.character_id
    JOIN boss_drop_amount a ON a.world = c.world_type
WHERE l.party_id = p.id
  AND a.boss_catalog_id = l.boss_catalog_id
  AND a.drop_catalog_id = l.drop_catalog_id
  AND a.pieces = l.quantity
  AND (
      SELECT count(*)
      FROM boss_drop_amount a2
      WHERE a2.boss_catalog_id = l.boss_catalog_id
        AND a2.drop_catalog_id = l.drop_catalog_id
        AND a2.world = c.world_type
        AND a2.pieces = l.quantity
  ) = 1;
