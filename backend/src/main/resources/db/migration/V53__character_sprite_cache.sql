-- The bytes behind a character sprite, so drawing a roster does not hotlink Nexon once per row.
--
-- Measured 2026-08-11 against a live sprite URL: Nexon answers with content-type, date and
-- content-length and NOTHING else. No cache-control, no etag, no last-modified. With nothing to
-- compute freshness from a browser cannot reuse the image across a reload, so every visit to a
-- party page refetched every sprite, and an outage or a block on their side left the roster drawn
-- as broken images.
--
-- Keyed by a hash of the URL rather than by character, because the URL IS the art: it is an opaque
-- blob encoding the character's equipment, so a new outfit means a new URL and never new bytes at
-- an old one. Two consequences worth having. The entry never needs invalidating, which is what lets
-- the route serve it `immutable`, and two seats wearing the same thing share one row.

CREATE TABLE character_sprite (
    url_sha256 CHAR(64) PRIMARY KEY CHECK (url_sha256 = lower(url_sha256)),
    source_url TEXT NOT NULL,

    -- Null means registered but not fetched: the URL is known and the bytes are not, either because
    -- the warm has not run yet or because it failed. The route redirects to source_url in that
    -- state, which is exactly the behaviour that predates this table, so a failed warm costs
    -- caching and never an image.
    image      BYTEA,
    fetched_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT character_sprite_fetched_together CHECK ((image IS NULL) = (fetched_at IS NULL))
);

COMMENT ON TABLE character_sprite IS
    'Cached Nexon character sprite bytes, keyed by sha256 of the source URL. Rows are disposable: '
    'anything still referenced is re-fetchable from source_url.';

-- When the daily refresh last ASKED Nexon about this character, as opposed to sprite_refreshed_at,
-- which is when it last got an answer.
--
-- The split is what stops a retry loop. A character who has been renamed or deleted stops ranking,
-- so the lookup returns nothing and sprite_refreshed_at is deliberately left alone (a transient
-- failure must not blank out good data). Selecting the next batch on THAT column would hand back
-- the same unresolvable names every tick, forever.
ALTER TABLE characters ADD COLUMN sprite_checked_at TIMESTAMPTZ;

-- Existing rows: the last answer is also the last time anybody asked. Without this every character
-- in the table is due at once on the first tick after deploy.
UPDATE characters SET sprite_checked_at = sprite_refreshed_at;
