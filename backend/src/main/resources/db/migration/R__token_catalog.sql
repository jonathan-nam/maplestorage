-- GENERATED FROM catalog/items.yaml -- DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__) on purpose: Flyway re-applies it whenever its checksum changes, so
-- adding an item to the manifest reseeds the catalog on the next boot. A versioned
-- migration is immutable once applied and is the wrong tool for a seed that evolves.
--
-- Upserts rather than replaces: token_catalog.id is referenced by character_token_count,
-- so deleting and reinserting would take every user's counts with it.

INSERT INTO token_catalog (id, vision_key, name, source_boss_name, icon_ref_key)
SELECT
    COALESCE(existing.id, gen_random_uuid()),
    v.vision_key, v.name, v.boss, v.icon
FROM (VALUES
    ('blissful-fantasy-shard', 'Blissful Fantasy Shard', 'Malefic Star', 'blissful-fantasy-shard.png'),
    ('distorted-ambition', 'Distorted Ambition', 'Limbo', 'distorted-ambition.png'),
    ('echo-ancient-resolve', 'Echo of Ancient Resolve', 'First Adversary', 'echo-ancient-resolve.png'),
    ('ferocious-beast-ring', 'Ferocious Beast Entanglement Ring', 'Kaling', 'ferocious-beast-ring.png'),
    ('kalos-token', 'Kalos''s Residual Determination', 'Kalos the Guardian', 'kalos-token.png'),
    ('trace-eternal-loyalty', 'Trace of Eternal Loyalty', 'Baldrix', 'trace-eternal-loyalty.png'),
    ('sayram-elixir', 'Sayram''s Elixir', 'The Collector', 'sayram-elixir.png'),
    ('aurelia-elixir', 'Aurelia''s Elixir', 'The Collector', 'aurelia-elixir.png'),
    ('honorable-elixir', 'Honorable Elixir', 'The Collector', 'honorable-elixir.png'),
    ('collector-elixir', 'Collector''s Elixir', 'The Collector', 'collector-elixir.png'),
    ('extreme-red-potion', 'Extreme Red Potion', 'Monster Park', 'extreme-red-potion.png'),
    ('extreme-blue-potion', 'Extreme Blue Potion', 'Monster Park', 'extreme-blue-potion.png'),
    ('extreme-green-potion', 'Extreme Green Potion', 'Monster Park', 'extreme-green-potion.png'),
    ('arcane-vanishing-journey', 'Arcane Symbol: Vanishing Journey Coupon', 'Daily', 'arcane-vanishing-journey.png'),
    ('arcane-chu-chu-island', 'Arcane Symbol: Chu Chu Island Coupon', 'Daily', 'arcane-chu-chu-island.png'),
    ('arcane-lachelein', 'Arcane Symbol: Lachelein Coupon', 'Daily', 'arcane-lachelein.png'),
    ('arcane-arcana', 'Arcane Symbol: Arcana Coupon', 'Daily', 'arcane-arcana.png'),
    ('arcane-morass', 'Arcane Symbol: Morass Coupon', 'Daily', 'arcane-morass.png'),
    ('arcane-esfera', 'Arcane Symbol: Esfera Coupon', 'Daily', 'arcane-esfera.png'),
    ('sacred-cernium', 'Sacred Symbol: Cernium Coupon', 'Daily', 'sacred-cernium.png'),
    ('sacred-hotel-arcus', 'Sacred Symbol: Hotel Arcus Coupon', 'Daily', 'sacred-hotel-arcus.png'),
    ('sacred-odium', 'Sacred Symbol: Odium Coupon', 'Daily', 'sacred-odium.png'),
    ('sacred-shangri-la', 'Sacred Symbol: Shangri-La Coupon', 'Daily', 'sacred-shangri-la.png'),
    ('sacred-arteria', 'Sacred Symbol: Arteria Coupon', 'Daily', 'sacred-arteria.png'),
    ('sacred-carcion', 'Sacred Symbol: Carcion Coupon', 'Daily', 'sacred-carcion.png'),
    ('sacred-tallahart', 'Sacred Symbol: Tallahart Coupon', 'Daily', 'sacred-tallahart.png')
) AS v (vision_key, name, boss, icon)
LEFT JOIN token_catalog existing ON existing.vision_key = v.vision_key
ON CONFLICT (vision_key) DO UPDATE SET
    name             = EXCLUDED.name,
    source_boss_name = EXCLUDED.source_boss_name,
    icon_ref_key     = EXCLUDED.icon_ref_key;

-- An item is redeemable if a rule exists for it -- there is no flag to keep in step with
-- the fields it governs. So a manifest entry that stops being a REDEMPTION_TOKEN must have
-- its rule removed, not merely have its threshold nulled.
DELETE FROM redemption_rule
WHERE item_id IN (
    SELECT id FROM token_catalog
    WHERE vision_key NOT IN ('blissful-fantasy-shard', 'distorted-ambition', 'echo-ancient-resolve', 'ferocious-beast-ring', 'kalos-token', 'trace-eternal-loyalty')
);

INSERT INTO redemption_rule (item_id, redeem_threshold)
SELECT c.id, v.redeem_threshold
FROM (VALUES
    ('blissful-fantasy-shard', 10),
    ('distorted-ambition', 10),
    ('echo-ancient-resolve', 10),
    ('ferocious-beast-ring', 10),
    ('kalos-token', 10),
    ('trace-eternal-loyalty', 10)
) AS v (vision_key, redeem_threshold)
JOIN token_catalog c ON c.vision_key = v.vision_key
ON CONFLICT (item_id) DO UPDATE SET
    redeem_threshold = EXCLUDED.redeem_threshold;
