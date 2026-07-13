-- GENERATED FROM catalog/items.yaml -- DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__) on purpose: Flyway re-applies it whenever its checksum changes, so
-- adding an item to the manifest reseeds the catalog on the next boot. A versioned
-- migration is immutable once applied and is the wrong tool for a seed that evolves.
--
-- Upserts rather than replaces: token_catalog.id is referenced by character_token_count,
-- so deleting and reinserting would take every user's counts with it.

INSERT INTO token_catalog (id, vision_key, name, source_boss_name, icon_ref_key, item_group, sort_order)
SELECT
    COALESCE(existing.id, gen_random_uuid()),
    v.vision_key, v.name, v.boss, v.icon, v.item_group, v.sort_order
FROM (VALUES
    ('blissful-fantasy-shard', 'Blissful Fantasy Shard', 'Malefic Star', 'blissful-fantasy-shard.png', 'Eternal Pieces', 13),
    ('distorted-ambition', 'Distorted Ambition', 'Limbo', 'distorted-ambition.png', 'Eternal Pieces', 14),
    ('echo-ancient-resolve', 'Echo of Ancient Resolve', 'First Adversary', 'echo-ancient-resolve.png', 'Eternal Pieces', 12),
    ('ferocious-beast-ring', 'Ferocious Beast Entanglement Ring', 'Kaling', 'ferocious-beast-ring.png', 'Eternal Pieces', 11),
    ('kalos-token', 'Kalos''s Residual Determination', 'Kalos the Guardian', 'kalos-token.png', 'Eternal Pieces', 10),
    ('trace-eternal-loyalty', 'Trace of Eternal Loyalty', 'Baldrix', 'trace-eternal-loyalty.png', 'Eternal Pieces', 15),
    ('sayram-elixir', 'Sayram''s Elixir', 'The Collector', 'sayram-elixir.png', 'Consumables', 40),
    ('aurelia-elixir', 'Aurelia''s Elixir', 'The Collector', 'aurelia-elixir.png', 'Consumables', 41),
    ('honorable-elixir', 'Honorable Elixir', 'The Collector', 'honorable-elixir.png', 'Consumables', 42),
    ('collector-elixir', 'Collector''s Elixir', 'The Collector', 'collector-elixir.png', 'Consumables', 43),
    ('extreme-red-potion', 'Extreme Red Potion', 'Monster Park', 'extreme-red-potion.png', 'Consumables', 50),
    ('extreme-blue-potion', 'Extreme Blue Potion', 'Monster Park', 'extreme-blue-potion.png', 'Consumables', 51),
    ('extreme-green-potion', 'Extreme Green Potion', 'Monster Park', 'extreme-green-potion.png', 'Consumables', 52),
    ('arcane-vanishing-journey', 'Arcane Symbol: Vanishing Journey Coupon', 'Daily', 'arcane-vanishing-journey.png', 'Symbols', 20),
    ('arcane-chu-chu-island', 'Arcane Symbol: Chu Chu Island Coupon', 'Daily', 'arcane-chu-chu-island.png', 'Symbols', 21),
    ('arcane-lachelein', 'Arcane Symbol: Lachelein Coupon', 'Daily', 'arcane-lachelein.png', 'Symbols', 22),
    ('arcane-arcana', 'Arcane Symbol: Arcana Coupon', 'Daily', 'arcane-arcana.png', 'Symbols', 23),
    ('arcane-morass', 'Arcane Symbol: Morass Coupon', 'Daily', 'arcane-morass.png', 'Symbols', 24),
    ('arcane-esfera', 'Arcane Symbol: Esfera Coupon', 'Daily', 'arcane-esfera.png', 'Symbols', 25),
    ('sacred-cernium', 'Sacred Symbol: Cernium Coupon', 'Daily', 'sacred-cernium.png', 'Symbols', 30),
    ('sacred-hotel-arcus', 'Sacred Symbol: Hotel Arcus Coupon', 'Daily', 'sacred-hotel-arcus.png', 'Symbols', 31),
    ('sacred-odium', 'Sacred Symbol: Odium Coupon', 'Daily', 'sacred-odium.png', 'Symbols', 32),
    ('sacred-shangri-la', 'Sacred Symbol: Shangri-La Coupon', 'Daily', 'sacred-shangri-la.png', 'Symbols', 33),
    ('sacred-arteria', 'Sacred Symbol: Arteria Coupon', 'Daily', 'sacred-arteria.png', 'Symbols', 34),
    ('sacred-carcion', 'Sacred Symbol: Carcion Coupon', 'Daily', 'sacred-carcion.png', 'Symbols', 35),
    ('sacred-tallahart', 'Sacred Symbol: Tallahart Coupon', 'Daily', 'sacred-tallahart.png', 'Symbols', 36)
) AS v (vision_key, name, boss, icon, item_group, sort_order)
LEFT JOIN token_catalog existing ON existing.vision_key = v.vision_key
ON CONFLICT (vision_key) DO UPDATE SET
    name             = EXCLUDED.name,
    source_boss_name = EXCLUDED.source_boss_name,
    icon_ref_key     = EXCLUDED.icon_ref_key,
    item_group       = EXCLUDED.item_group,
    sort_order       = EXCLUDED.sort_order;

-- An item is redeemable if a rule exists for it -- there is no flag to keep in step with
-- the fields it governs. So a manifest entry that stops being a REDEMPTION_TOKEN must have
-- its rule removed, not merely have its threshold nulled.
DELETE FROM redemption_rule
WHERE item_id IN (
    SELECT id FROM token_catalog
    WHERE vision_key NOT IN ('blissful-fantasy-shard', 'distorted-ambition', 'echo-ancient-resolve', 'ferocious-beast-ring', 'kalos-token', 'trace-eternal-loyalty')
);

INSERT INTO redemption_rule (item_id, redeem_threshold, slot_group)
SELECT c.id, v.redeem_threshold, v.slot_group
FROM (VALUES
    ('blissful-fantasy-shard', 10, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('distorted-ambition', 10, ARRAY['Cape', 'Glove', 'Shoe']::TEXT[]),
    ('echo-ancient-resolve', 10, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('ferocious-beast-ring', 10, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('kalos-token', 10, ARRAY['Hat', 'Top', 'Bottom', 'Shoulder']::TEXT[]),
    ('trace-eternal-loyalty', 10, ARRAY['Cape', 'Glove', 'Shoe']::TEXT[])
) AS v (vision_key, redeem_threshold, slot_group)
JOIN token_catalog c ON c.vision_key = v.vision_key
ON CONFLICT (item_id) DO UPDATE SET
    redeem_threshold = EXCLUDED.redeem_threshold,
    slot_group       = EXCLUDED.slot_group;
