-- GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__): editing bosses.yaml reseeds boss_catalog on the next boot. Upserts by
-- boss_key and keeps an existing row's id, which boss_clear references, so it is never churned.

INSERT INTO boss_catalog (id, boss_key, name, reset, sort_order, icon_ref_key)
SELECT COALESCE(existing.id, gen_random_uuid()), v.boss_key, v.name, v.reset, v.sort_order,
       v.icon_ref_key
FROM (VALUES
    ('lotus', 'Lotus', 'WEEKLY', 0, 'lotus.png'),
    ('damien', 'Damien', 'WEEKLY', 1, 'damien.png'),
    ('guardian-angel-slime', 'Guardian Angel Slime', 'WEEKLY', 2, 'guardian-angel-slime.png'),
    ('lucid', 'Lucid', 'WEEKLY', 3, 'lucid.png'),
    ('will', 'Will', 'WEEKLY', 4, 'will.png'),
    ('gloom', 'Gloom', 'WEEKLY', 5, 'gloom.png'),
    ('verus-hilla', 'Verus Hilla', 'WEEKLY', 6, 'verus-hilla.png'),
    ('darknell', 'Darknell', 'WEEKLY', 7, 'darknell.png'),
    ('chosen-seren', 'Chosen Seren', 'WEEKLY', 8, 'chosen-seren.png'),
    ('kalos-the-guardian', 'Kalos the Guardian', 'WEEKLY', 9, 'kalos-the-guardian.png'),
    ('first-adversary', 'First Adversary', 'WEEKLY', 10, 'first-adversary.png'),
    ('kaling', 'Kaling', 'WEEKLY', 11, 'kaling.png'),
    ('malefic-star', 'Malefic Star', 'WEEKLY', 12, 'malefic-star.png'),
    ('limbo', 'Limbo', 'WEEKLY', 13, 'limbo.png'),
    ('baldrix', 'Baldrix', 'WEEKLY', 14, 'baldrix.png'),
    ('jupiter', 'Jupiter', 'WEEKLY', 15, 'jupiter.png'),
    ('black-mage', 'Black Mage', 'MONTHLY', 16, 'black-mage.png')
) AS v (boss_key, name, reset, sort_order, icon_ref_key)
LEFT JOIN boss_catalog existing ON existing.boss_key = v.boss_key
ON CONFLICT (boss_key) DO UPDATE SET
    name         = EXCLUDED.name,
    reset        = EXCLUDED.reset,
    sort_order   = EXCLUDED.sort_order,
    icon_ref_key = EXCLUDED.icon_ref_key;
