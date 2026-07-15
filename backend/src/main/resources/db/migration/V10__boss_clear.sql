-- Boss-clear tracking. Mirrors db/Tables.kt column-for-column (this file is the schema
-- source of truth). Seeded rows for boss_catalog come from R__boss_catalog.sql, generated
-- from catalog/bosses.yaml, the same manifest that feeds the vision reader's name list.

CREATE TABLE boss_catalog (
    -- No default: R__boss_catalog.sql assigns and keeps a stable id per boss_key across
    -- re-seeds (the id is referenced by boss_clear, so churning it would orphan clears).
    id        UUID PRIMARY KEY,
    boss_key  TEXT NOT NULL UNIQUE,   -- the vision reader's key, matches catalog/bosses.yaml
    name      TEXT NOT NULL,          -- prose for humans; the planner OCR is matched to it
    -- The boss's own reset cadence. It decides which period a clear counts against, and it is a
    -- game fact, not difficulty. Difficulty is deliberately not stored: a player sets a planner
    -- difficulty independent of what they actually clear, so it is not trustworthy.
    reset     TEXT NOT NULL CHECK (reset IN ('WEEKLY', 'DAILY', 'MONTHLY'))
);

CREATE TABLE boss_clear (
    character_id          UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    boss_catalog_id       UUID NOT NULL REFERENCES boss_catalog(id),
    -- The reset period this row belongs to, as the period's start date (the weekly reset day,
    -- the day for a daily boss, the month start for a monthly one). Reset is a QUERY BOUNDARY,
    -- not a scheduled job: a new period simply has no rows yet, so everything reads uncleared
    -- until the next capture stamps it. The period is computed per boss from its reset cadence.
    period_start          DATE NOT NULL,
    -- Stored for pending rows too, not only clears. A planner capture shows every boss the
    -- character runs with its state, so a row per (boss, period) with cleared=false IS the
    -- character's routine for that period; without it "pending" would be unknowable.
    cleared               BOOLEAN NOT NULL,
    captured_at           TIMESTAMPTZ NOT NULL,
    source_screenshot_id  UUID REFERENCES screenshots(id),
    -- One row per character+boss+period, which is exactly the latest-capture upsert key
    -- (INSERT ... ON CONFLICT (character_id, boss_catalog_id, period_start) DO UPDATE). The
    -- leftmost column also serves character_id-only lookups, so no separate index is needed there.
    PRIMARY KEY (character_id, boss_catalog_id, period_start)
);

-- Postgres does not auto-index FK columns; these are the ones joins and cascades filter on.
CREATE INDEX idx_boss_clear_boss_catalog_id ON boss_clear(boss_catalog_id);
CREATE INDEX idx_boss_clear_source_screenshot_id ON boss_clear(source_screenshot_id);
