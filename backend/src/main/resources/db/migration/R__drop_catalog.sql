-- GENERATED FROM catalog/drops.yaml. DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__): editing drops.yaml reseeds the drop catalog on the next boot. drop_catalog
-- upserts by drop_key and keeps an existing row's id, which party_loot references. boss_drop is
-- rebuilt outright, so a drop removed from a boss's table really leaves it.

INSERT INTO drop_catalog (id, drop_key, name, icon_ref_key, per_member, worlds, quantity, sort_order)
SELECT COALESCE(existing.id, gen_random_uuid()), v.drop_key, v.name, v.icon_ref_key, v.per_member,
       v.worlds, v.quantity, v.sort_order
FROM (VALUES
    ('whisper-of-the-source', 'Whisper of the Source', 'whisper-of-the-source.png', NULL, NULL, 1, 0),
    ('oath-of-death', 'Oath of Death', 'oath-of-death.png', NULL, NULL, 1, 1),
    ('immortal-legacy', 'Immortal Legacy', 'immortal-legacy.png', NULL, NULL, 1, 2),
    ('blissful-nightmare', 'Blissful Nightmare', NULL, NULL, NULL, 1, 3),
    ('exceptional-hammer-face', 'Exceptional Hammer (Face Acc)', 'exceptional-hammer-face.png', NULL, NULL, 1, 4),
    ('exceptional-hammer-eye', 'Exceptional Hammer (Eye Acc)', 'exceptional-hammer-eye.png', NULL, NULL, 1, 5),
    ('exceptional-hammer-earrings', 'Exceptional Hammer (Earrings)', 'exceptional-hammer-earrings.png', NULL, NULL, 1, 6),
    ('exceptional-hammer-medal', 'Exceptional Hammer (Medal)', 'exceptional-hammer-medal.png', NULL, NULL, 1, 7),
    ('grindstone-of-faith', 'Grindstone of Faith', 'grindstone-of-faith.png', NULL, NULL, 1, 8),
    ('grindstone-of-life', 'Grindstone of Life', 'grindstone-of-life.png', NULL, NULL, 1, 9),
    ('premium-scroll-accessory-coupon', 'Premium Scroll - Accessory Coupon', 'premium-scroll-accessory-coupon.png', NULL, 'INTERACTIVE', 1, 10),
    ('premium-scroll-pet-equipment-coupon', 'Premium Scroll - Pet Equipment Coupon', 'premium-scroll-pet-equipment-coupon.png', NULL, 'INTERACTIVE', 1, 11),
    ('magical-scroll-weapon-coupon', 'Magical Scroll - Weapon Coupon', 'magical-scroll-weapon-coupon.png', NULL, 'INTERACTIVE', 1, 12),
    ('eternal-armor-of-desire-box', 'Eternal Armor of Desire Box', 'eternal-armor-of-desire-box.png', NULL, NULL, 1, 13),
    ('divine-eternal-armor-box', 'Divine Eternal Armor Box', 'divine-eternal-armor-box.png', NULL, NULL, 1, 14),
    ('ferocious-beast-eternal-armor-box', 'Ferocious Beast Eternal Armor Box', 'ferocious-beast-eternal-armor-box.png', NULL, NULL, 1, 15),
    ('ancient-eternal-armor-box', 'Ancient Eternal Armor Box', 'ancient-eternal-armor-box.png', NULL, NULL, 1, 16),
    ('eternal-armor-of-oaths-box', 'Eternal Armor of Oaths Box', 'eternal-armor-of-oaths-box.png', NULL, NULL, 1, 17),
    ('eternal-armor-of-radiance-box', 'Eternal Armor of Radiance Box', NULL, NULL, NULL, 1, 18),
    ('mitras-rage-selection-box', 'Mitra''s Rage Selection Box', 'mitras-rage-selection-box.png', NULL, NULL, 1, 19),
    ('ring-of-restraint-4', 'Ring of Restraint Lv. 4', 'ring-of-restraint-4.png', 'HEROIC', NULL, 1, 20),
    ('continuous-ring-4', 'Continuous Ring Lv. 4', 'continuous-ring-4.png', 'HEROIC', NULL, 1, 21),
    ('vestige-of-erion', 'Vestige of Erion Coupon', 'vestige-of-erion.png', NULL, NULL, 1, 22),
    ('distorted-ambition', 'Distorted Ambition', 'distorted-ambition.png', 'ALWAYS', NULL, 2, 23)
) AS v (drop_key, name, icon_ref_key, per_member, worlds, quantity, sort_order)
LEFT JOIN drop_catalog existing ON existing.drop_key = v.drop_key
ON CONFLICT (drop_key) DO UPDATE SET
    name         = EXCLUDED.name,
    icon_ref_key = EXCLUDED.icon_ref_key,
    per_member = EXCLUDED.per_member,
    worlds     = EXCLUDED.worlds,
    quantity   = EXCLUDED.quantity,
    sort_order = EXCLUDED.sort_order;

DELETE FROM boss_drop;
DELETE FROM boss_drop_amount;

INSERT INTO boss_drop (boss_catalog_id, drop_catalog_id, sort_order)
SELECT b.id, d.id, v.sort_order
FROM (VALUES
    ('limbo', 'whisper-of-the-source', 0),
    ('limbo', 'grindstone-of-faith', 1),
    ('limbo', 'premium-scroll-accessory-coupon', 2),
    ('limbo', 'premium-scroll-pet-equipment-coupon', 3),
    ('limbo', 'magical-scroll-weapon-coupon', 4),
    ('limbo', 'distorted-ambition', 5),
    ('limbo', 'eternal-armor-of-desire-box', 6),
    ('limbo', 'ring-of-restraint-4', 7),
    ('limbo', 'continuous-ring-4', 8),
    ('limbo', 'vestige-of-erion', 9),
    ('chosen-seren', 'exceptional-hammer-face', 0),
    ('chosen-seren', 'premium-scroll-accessory-coupon', 1),
    ('chosen-seren', 'premium-scroll-pet-equipment-coupon', 2),
    ('chosen-seren', 'magical-scroll-weapon-coupon', 3),
    ('chosen-seren', 'mitras-rage-selection-box', 4),
    ('chosen-seren', 'ring-of-restraint-4', 5),
    ('chosen-seren', 'continuous-ring-4', 6),
    ('chosen-seren', 'vestige-of-erion', 7),
    ('kalos-the-guardian', 'exceptional-hammer-eye', 0),
    ('kalos-the-guardian', 'grindstone-of-life', 1),
    ('kalos-the-guardian', 'premium-scroll-accessory-coupon', 2),
    ('kalos-the-guardian', 'premium-scroll-pet-equipment-coupon', 3),
    ('kalos-the-guardian', 'magical-scroll-weapon-coupon', 4),
    ('kalos-the-guardian', 'divine-eternal-armor-box', 5),
    ('kalos-the-guardian', 'ring-of-restraint-4', 6),
    ('kalos-the-guardian', 'continuous-ring-4', 7),
    ('kalos-the-guardian', 'vestige-of-erion', 8),
    ('kaling', 'exceptional-hammer-earrings', 0),
    ('kaling', 'grindstone-of-faith', 1),
    ('kaling', 'premium-scroll-accessory-coupon', 2),
    ('kaling', 'premium-scroll-pet-equipment-coupon', 3),
    ('kaling', 'magical-scroll-weapon-coupon', 4),
    ('kaling', 'ferocious-beast-eternal-armor-box', 5),
    ('kaling', 'ring-of-restraint-4', 6),
    ('kaling', 'continuous-ring-4', 7),
    ('kaling', 'vestige-of-erion', 8),
    ('first-adversary', 'immortal-legacy', 0),
    ('first-adversary', 'exceptional-hammer-medal', 1),
    ('first-adversary', 'grindstone-of-life', 2),
    ('first-adversary', 'premium-scroll-accessory-coupon', 3),
    ('first-adversary', 'premium-scroll-pet-equipment-coupon', 4),
    ('first-adversary', 'magical-scroll-weapon-coupon', 5),
    ('first-adversary', 'ancient-eternal-armor-box', 6),
    ('first-adversary', 'ring-of-restraint-4', 7),
    ('first-adversary', 'continuous-ring-4', 8),
    ('first-adversary', 'vestige-of-erion', 9),
    ('malefic-star', 'blissful-nightmare', 0),
    ('malefic-star', 'grindstone-of-faith', 1),
    ('malefic-star', 'premium-scroll-accessory-coupon', 2),
    ('malefic-star', 'premium-scroll-pet-equipment-coupon', 3),
    ('malefic-star', 'magical-scroll-weapon-coupon', 4),
    ('malefic-star', 'eternal-armor-of-radiance-box', 5),
    ('malefic-star', 'ring-of-restraint-4', 6),
    ('malefic-star', 'continuous-ring-4', 7),
    ('malefic-star', 'vestige-of-erion', 8),
    ('jupiter', 'vestige-of-erion', 0),
    ('baldrix', 'oath-of-death', 0),
    ('baldrix', 'grindstone-of-faith', 1),
    ('baldrix', 'premium-scroll-accessory-coupon', 2),
    ('baldrix', 'premium-scroll-pet-equipment-coupon', 3),
    ('baldrix', 'magical-scroll-weapon-coupon', 4),
    ('baldrix', 'eternal-armor-of-oaths-box', 5),
    ('baldrix', 'ring-of-restraint-4', 6),
    ('baldrix', 'continuous-ring-4', 7),
    ('baldrix', 'vestige-of-erion', 8)
) AS v (boss_key, drop_key, sort_order)
JOIN boss_catalog b ON b.boss_key = v.boss_key
JOIN drop_catalog d ON d.drop_key = v.drop_key;

INSERT INTO boss_drop_amount (boss_catalog_id, drop_catalog_id, difficulty, pieces, bundles)
SELECT b.id, d.id, v.difficulty, v.pieces, v.bundles
FROM (VALUES
    ('limbo', 'vestige-of-erion', 'HARD', 60, 3),
    ('chosen-seren', 'vestige-of-erion', 'EXTREME', 30, 6),
    ('kalos-the-guardian', 'vestige-of-erion', 'EXTREME', 180, 6),
    ('kaling', 'vestige-of-erion', 'HARD', 60, 6),
    ('kaling', 'vestige-of-erion', 'EXTREME', 480, 6),
    ('first-adversary', 'vestige-of-erion', 'HARD', 30, 3),
    ('first-adversary', 'vestige-of-erion', 'EXTREME', 240, 3),
    ('malefic-star', 'vestige-of-erion', 'HARD', 90, 3),
    ('jupiter', 'vestige-of-erion', 'NORMAL', 45, 3),
    ('jupiter', 'vestige-of-erion', 'HARD', 360, 3),
    ('baldrix', 'vestige-of-erion', 'HARD', 120, 3)
) AS v (boss_key, drop_key, difficulty, pieces, bundles)
JOIN boss_catalog b ON b.boss_key = v.boss_key
JOIN drop_catalog d ON d.drop_key = v.drop_key;
