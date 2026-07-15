-- GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__): editing bosses.yaml reseeds boss_catalog on the next boot. Upserts by
-- boss_key and keeps an existing row's id, which boss_clear references, so it is never churned.

INSERT INTO boss_catalog (id, boss_key, name, reset)
SELECT COALESCE(existing.id, gen_random_uuid()), v.boss_key, v.name, v.reset
FROM (VALUES
    ('lotus', 'Lotus', 'WEEKLY'),
    ('damien', 'Damien', 'WEEKLY'),
    ('guardian-angel-slime', 'Guardian Angel Slime', 'WEEKLY'),
    ('lucid', 'Lucid', 'WEEKLY'),
    ('will', 'Will', 'WEEKLY'),
    ('gloom', 'Gloom', 'WEEKLY'),
    ('verus-hilla', 'Verus Hilla', 'WEEKLY'),
    ('darknell', 'Darknell', 'WEEKLY'),
    ('chosen-seren', 'Chosen Seren', 'WEEKLY'),
    ('kalos-the-guardian', 'Kalos the Guardian', 'WEEKLY'),
    ('first-adversary', 'First Adversary', 'WEEKLY'),
    ('kaling', 'Kaling', 'WEEKLY'),
    ('malefic-star', 'Malefic Star', 'WEEKLY'),
    ('limbo', 'Limbo', 'WEEKLY'),
    ('baldrix', 'Baldrix', 'WEEKLY'),
    ('akechi-mitsuhide', 'Akechi Mitsuhide', 'WEEKLY'),
    ('black-mage', 'Black Mage', 'MONTHLY'),
    ('zakum', 'Zakum', 'DAILY'),
    ('gollux', 'Gollux', 'DAILY')
) AS v (boss_key, name, reset)
LEFT JOIN boss_catalog existing ON existing.boss_key = v.boss_key
ON CONFLICT (boss_key) DO UPDATE SET
    name  = EXCLUDED.name,
    reset = EXCLUDED.reset;
