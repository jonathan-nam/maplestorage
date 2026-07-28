-- Bosses a character does not run. Mirrors db/Tables.kt column-for-column (this file is the
-- schema source of truth).
--
-- This is the difference between "hasn't run it yet" and "never runs it". Both looked identical
-- before: boss_clear simply had no row, and the matrix drew one dash for the two of them.
--
-- No period column, and that is the point. A clear is an answer about one week; "only my main runs
-- Jupiter" is a standing fact about the character, and re-stating it every Thursday is the reason
-- it was never stated at all.
--
-- An EXCLUSION list, not a routine. A character with no rows here is exactly as it was, so nothing
-- is backfilled and no absence is read as an answer. The alternative, storing the bosses a
-- character DOES run, needs every routine entered before any of it can be trusted, and neither
-- seed available is complete: party configs miss solo runs by design (V22), and capture history
-- misses anything not photographed yet.
--
-- Deliberately not inferred from planner captures. A capture that stops short looks much like one
-- that reached the end (vision's reached_list_end is best-effort, see cv/planner.py), so inferring
-- would let a truncated capture mark half a list "doesn't run" and then dim those rows as done.

CREATE TABLE character_boss_skip (
    character_id    UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    boss_catalog_id UUID NOT NULL REFERENCES boss_catalog(id),
    -- When it was said, so a mark can be told from a row that has always been there. Nothing
    -- reads it yet; it costs a column and is unrecoverable after the fact.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (character_id, boss_catalog_id)
);

-- Postgres does not auto-index FK columns; the leftmost PK column already covers character_id.
CREATE INDEX idx_character_boss_skip_boss_catalog_id ON character_boss_skip(boss_catalog_id);
