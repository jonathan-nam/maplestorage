-- Give the catalog an explicit key the screenshot parser can be matched on.
--
-- Until now `upsertTokenCounts` matched the parser's token name against
-- `token_catalog.name` lowercased -- i.e. against the *display* name, which is
-- prose ("Kalos's Residual Determination", "Ferocious Beast Entanglement Ring").
-- That only ever worked because the vision model was prompted to echo those exact
-- strings back. The OpenCV parser identifies a token by which template matched,
-- and its templates are named as slugs ("kalos-token", "ferocious-beast-ring").
--
-- Nothing matched. And the lookup's fallback was `?: continue` -- written to
-- forgive a model returning a slightly-off name -- so every token was skipped in
-- silence and NO counts were ever written, even for a perfectly attributed
-- screenshot. Loud failure would have caught this in a minute; a forgiving one
-- hid it completely.
--
-- The fix is to stop inferring the join and store it. A display name is for
-- humans and can be reworded freely; vision_key is an identifier and must not
-- change without also renaming the template file it refers to.

ALTER TABLE token_catalog ADD COLUMN vision_key TEXT;

UPDATE token_catalog SET vision_key = 'distorted-ambition'    WHERE name = 'Distorted Ambition';
UPDATE token_catalog SET vision_key = 'blissful-fantasy-shard' WHERE name = 'Blissful Fantasy Shard';
UPDATE token_catalog SET vision_key = 'echo-ancient-resolve'  WHERE name = 'Echo of Ancient Resolve';
UPDATE token_catalog SET vision_key = 'ferocious-beast-ring'  WHERE name = 'Ferocious Beast Entanglement Ring';
UPDATE token_catalog SET vision_key = 'kalos-token'           WHERE name = 'Kalos''s Residual Determination';
UPDATE token_catalog SET vision_key = 'trace-eternal-loyalty' WHERE name = 'Trace of Eternal Loyalty';

-- Every row must have one, and no two rows may share one: this is the join key
-- the parser's output lands on, so a null or a duplicate is a silently dropped
-- count.
ALTER TABLE token_catalog ALTER COLUMN vision_key SET NOT NULL;
ALTER TABLE token_catalog ADD CONSTRAINT token_catalog_vision_key_unique UNIQUE (vision_key);
