-- Fixed, hand-curated catalog -- exactly these 6 rows, never grown by users.
-- UUIDs are fixed literals (not gen_random_uuid()) so re-running this
-- migration path against a fresh database always produces the same,
-- stable, referenceable IDs.
--
-- icon_ref_key values double as both the local classpath-resource path
-- (backend/src/main/resources/seed-assets/tokens/{key}) today and the
-- literal S3 object key later, so the eventual S3 cutover is "upload these
-- same files," not a data migration.

INSERT INTO token_catalog (id, name, source_boss_name, slot_group, redeem_threshold, bonus_item_name, icon_ref_key)
VALUES
    ('c5943af9-ab55-4eb2-b878-2e035923a047', 'Distorted Ambition', 'Limbo',
     ARRAY['Shoes', 'Gloves', 'Cape'], 10, NULL, 'distorted-ambition.png'),

    ('43addaeb-8d03-45f1-9d6d-9c999e8bd1dc', 'Blissful Fantasy Shard', 'Malefic Star',
     ARRAY['Hat', 'Top', 'Bottom', 'Shoulder Accessory'], 10, NULL, 'blissful-fantasy-shard.png'),

    ('e28e46ed-bb5e-4203-84cf-0a86e071c34a', 'Echo of Ancient Resolve', 'First Adversary',
     ARRAY['Hat', 'Top', 'Bottom', 'Shoulder Accessory'], 10, NULL, 'echo-ancient-resolve.png'),

    ('5d9bf8f4-79d8-42a1-8e89-c4f88431978b', 'Ferocious Beast Entanglement Ring', 'Kaling',
     ARRAY['Hat', 'Top', 'Bottom', 'Shoulder Accessory'], 10, NULL, 'ferocious-beast-ring.png'),

    ('4e2ebeff-84f6-4f1f-9c36-4e08a3c516bd', 'Kalos''s Residual Determination', 'Kalos the Guardian',
     ARRAY['Hat', 'Top', 'Bottom', 'Shoulder Accessory'], 10, NULL, 'kalos-residual-determination.png'),

    ('bc2843b3-3816-4910-bbea-447a13eef773', 'Trace of Eternal Loyalty', 'Baldrix',
     ARRAY['Shoe', 'Glove', 'Cape'], 10, 'Eternal Armor of Oaths Box', 'trace-eternal-loyalty.png');
