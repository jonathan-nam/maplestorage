-- The boss's own planner portrait, as a seed asset. Mirrors token_catalog.icon_ref_key: the
-- column holds a bare filename under seed-assets/bosses, served at /boss-icons.
--
-- The art is cut from a real planner capture by vision/app/cv/build_boss_portraits.py, not
-- downloaded: maplestory.io renders no mob art for First Adversary, Malefic Star or Gloom, and
-- the planner already draws the portrait the game itself uses for every boss.

ALTER TABLE boss_catalog ADD COLUMN icon_ref_key TEXT;
