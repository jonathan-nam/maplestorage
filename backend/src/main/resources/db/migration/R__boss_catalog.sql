-- GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__): editing bosses.yaml reseeds boss_catalog on the next boot. Upserts by
-- boss_key and keeps an existing row's id, which boss_clear references, so it is never churned.

INSERT INTO boss_catalog (id, boss_key, name, reset, sort_order, icon_ref_key, difficulties)
SELECT COALESCE(existing.id, gen_random_uuid()), v.boss_key, v.name, v.reset, v.sort_order,
       v.icon_ref_key, v.difficulties
FROM (VALUES
    ('lotus', 'Lotus', 'WEEKLY', 0, 'lotus.png', ARRAY['NORMAL', 'HARD', 'EXTREME']::TEXT[]),
    ('damien', 'Damien', 'WEEKLY', 1, 'damien.png', ARRAY['NORMAL', 'HARD']::TEXT[]),
    ('guardian-angel-slime', 'Guardian Angel Slime', 'WEEKLY', 2, 'guardian-angel-slime.png', ARRAY['NORMAL', 'CHAOS']::TEXT[]),
    ('lucid', 'Lucid', 'WEEKLY', 3, 'lucid.png', ARRAY['EASY', 'NORMAL', 'HARD']::TEXT[]),
    ('will', 'Will', 'WEEKLY', 4, 'will.png', ARRAY['EASY', 'NORMAL', 'HARD']::TEXT[]),
    ('gloom', 'Gloom', 'WEEKLY', 5, 'gloom.png', ARRAY['NORMAL', 'CHAOS']::TEXT[]),
    ('verus-hilla', 'Verus Hilla', 'WEEKLY', 6, 'verus-hilla.png', ARRAY['NORMAL', 'HARD']::TEXT[]),
    ('darknell', 'Darknell', 'WEEKLY', 7, 'darknell.png', ARRAY['NORMAL', 'HARD']::TEXT[]),
    ('chosen-seren', 'Chosen Seren', 'WEEKLY', 8, 'chosen-seren.png', ARRAY['NORMAL', 'HARD', 'EXTREME']::TEXT[]),
    ('kalos-the-guardian', 'Kalos the Guardian', 'WEEKLY', 9, 'kalos-the-guardian.png', ARRAY['EASY', 'NORMAL', 'CHAOS', 'EXTREME']::TEXT[]),
    ('first-adversary', 'First Adversary', 'WEEKLY', 10, 'first-adversary.png', ARRAY['EASY', 'NORMAL', 'HARD', 'EXTREME']::TEXT[]),
    ('kaling', 'Kaling', 'WEEKLY', 11, 'kaling.png', ARRAY['EASY', 'NORMAL', 'HARD', 'EXTREME']::TEXT[]),
    ('malefic-star', 'Malefic Star', 'WEEKLY', 12, 'malefic-star.png', ARRAY['NORMAL', 'HARD']::TEXT[]),
    ('limbo', 'Limbo', 'WEEKLY', 13, 'limbo.png', ARRAY['NORMAL', 'HARD']::TEXT[]),
    ('baldrix', 'Baldrix', 'WEEKLY', 14, 'baldrix.png', ARRAY['NORMAL', 'HARD']::TEXT[]),
    ('jupiter', 'Jupiter', 'WEEKLY', 15, 'jupiter.png', ARRAY['NORMAL', 'HARD']::TEXT[]),
    ('black-mage', 'Black Mage', 'MONTHLY', 16, 'black-mage.png', ARRAY['HARD', 'EXTREME']::TEXT[])
) AS v (boss_key, name, reset, sort_order, icon_ref_key, difficulties)
LEFT JOIN boss_catalog existing ON existing.boss_key = v.boss_key
ON CONFLICT (boss_key) DO UPDATE SET
    name         = EXCLUDED.name,
    reset        = EXCLUDED.reset,
    sort_order   = EXCLUDED.sort_order,
    icon_ref_key = EXCLUDED.icon_ref_key,
    difficulties = EXCLUDED.difficulties;
