-- Explicit ordering for the character carousel (the move buttons). The list was implicitly
-- ordered by created_at; a user-chosen order needs a column of its own.

ALTER TABLE characters ADD COLUMN position INTEGER;

-- Backfill each user's existing characters in their current created_at order, so the carousel
-- looks unchanged until someone reorders. position is 0-based and dense per user.
UPDATE characters c
SET position = ranked.rn
FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) - 1 AS rn
    FROM characters
) ranked
WHERE c.id = ranked.id;

ALTER TABLE characters ALTER COLUMN position SET NOT NULL;

-- The carousel read filters by user and sorts by position; this serves it directly and,
-- being left-most on user_id, also covers the plain per-user lookups (V1's idx_characters_user_id
-- is now redundant but harmless, left in place to avoid touching an applied migration's intent).
CREATE INDEX idx_characters_user_id_position ON characters(user_id, position);
