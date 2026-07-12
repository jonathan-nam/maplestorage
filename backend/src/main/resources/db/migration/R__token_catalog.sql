-- GENERATED FROM catalog/items.yaml -- DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__) on purpose: Flyway re-applies it whenever its checksum changes, so
-- adding an item to the manifest reseeds the catalog on the next boot. A versioned
-- migration is immutable once applied and is the wrong tool for a seed that evolves.
--
-- Upserts rather than replaces: token_catalog.id is referenced by character_token_count,
-- so deleting and reinserting would take every user's counts with it.

INSERT INTO token_catalog (id, vision_key, name, source_boss_name, redeem_threshold, icon_ref_key)
SELECT
    COALESCE(existing.id, gen_random_uuid()),
    v.vision_key, v.name, v.boss, v.redeem_threshold, v.icon
FROM (VALUES
    ('blissful-fantasy-shard', 'Blissful Fantasy Shard', 'Malefic Star', 10, 'blissful-fantasy-shard.png'),
    ('distorted-ambition', 'Distorted Ambition', 'Limbo', 10, 'distorted-ambition.png'),
    ('echo-ancient-resolve', 'Echo of Ancient Resolve', 'First Adversary', 10, 'echo-ancient-resolve.png'),
    ('ferocious-beast-ring', 'Ferocious Beast Entanglement Ring', 'Kaling', 10, 'ferocious-beast-ring.png'),
    ('kalos-token', 'Kalos''s Residual Determination', 'Kalos the Guardian', 10, 'kalos-token.png'),
    ('trace-eternal-loyalty', 'Trace of Eternal Loyalty', 'Baldrix', 10, 'trace-eternal-loyalty.png')
) AS v (vision_key, name, boss, redeem_threshold, icon)
LEFT JOIN token_catalog existing ON existing.vision_key = v.vision_key
ON CONFLICT (vision_key) DO UPDATE SET
    name             = EXCLUDED.name,
    source_boss_name = EXCLUDED.source_boss_name,
    redeem_threshold = EXCLUDED.redeem_threshold,
    icon_ref_key     = EXCLUDED.icon_ref_key;
