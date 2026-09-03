-- A one-off's people ran one night, so they are written onto that week and stand nowhere else.
--
-- They were written as STANDING seats, which is the roster every week that spells out no other one
-- falls back to (see rostersFor). A one-off is armed for a single period, so every week after it is
-- such a week: a boss run alone a fortnight later divided with a guest who was not there, named them
-- in the payout, and was marked paid. That is the silent wrong number this repo exists to prevent,
-- reached through the ordinary Add Drop button.
--
-- The write side is writeNightRoster. This is the same statement made about the nights already
-- recorded, and it is made in the order that changes no split: the night is spelled out FIRST, from
-- the roster it reads today, and only then do the guests come off the standing roster.

-- Every week a one-off actually ran, that does not already name its own roster.
--
-- The armed period's week, which for a WEEKLY boss (all of them but three) is the period itself.
-- Plus, for the one MONTHLY boss, each week its drops fell in: a month is four weeks and a roster is
-- keyed by week, so the period start alone would pin the wrong one.
WITH night AS (
    SELECT r.party_id,
           -- The Thursday on or before, which is how weekOf keys every roster.
           r.period_start - ((EXTRACT(ISODOW FROM r.period_start)::int - 4 + 7) % 7) AS week_start
    FROM party_period_run r
    JOIN party p ON p.id = r.party_id
    WHERE p.one_off
    UNION
    SELECT l.party_id,
           l.dropped_on - ((EXTRACT(ISODOW FROM l.dropped_on)::int - 4 + 7) % 7)
    FROM party_loot l
    JOIN party p ON p.id = l.party_id
    JOIN boss_catalog b ON b.id = p.boss_catalog_id
    JOIN party_period_run r ON r.party_id = p.id
    WHERE p.one_off
      AND b.reset = 'MONTHLY'
      AND date_trunc('month', l.dropped_on)::date = r.period_start
)
INSERT INTO party_week_seat (party_id, week_start, member_id, shares)
SELECT n.party_id, n.week_start, m.id, NULL
FROM night n
JOIN party_member m ON m.party_id = n.party_id AND m.standing
-- A week that already names a roster is a night somebody answered for, and is not this to rewrite.
WHERE NOT EXISTS (
    SELECT 1 FROM party_week_seat s
    WHERE s.party_id = n.party_id AND s.week_start = n.week_start
);

-- NULL shares above, not a copy of the seat's: that is what a live week carries, and it reads
-- through to party_member.shares, so the split is the one it already was. See V55.

-- Now the guests stop standing. Your own character's seat stays: it is what the config IS, and a
-- pool whose later weeks name nobody has no seat for a drop to be sold by.
UPDATE party_member m
SET standing = false
FROM party p
WHERE p.id = m.party_id
  AND p.one_off
  AND m.character_id IS DISTINCT FROM p.character_id;
