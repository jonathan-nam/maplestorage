-- A party for one period rather than every one. Mirrors db/Tables.kt column-for-column (this file
-- is the schema source of truth).
--
-- A config is a STANDING arrangement: it is on this week and every week after, which is what makes
-- Party View answer "what does this character owe" without anything being re-entered. A night
-- somebody talks you into Kaling is not that. It ran once, and next Thursday it should be gone
-- without being told to.
--
-- So a config now has a default and a set of exceptions to it, and V31 gained a twin:
--   one_off = false   on, except in the periods party_period_skip names
--   one_off = true    off, except in the periods party_period_run names
-- Both exceptions are rows whose absence is the answer, so undoing either is a deletion.
--
-- Two tables rather than one with a boolean in it. A single table would have to be read against
-- party.one_off to know whether a row meant on or off, and a list that quietly inverts is exactly
-- the confidently wrong screen this repo exists to prevent.
--
-- NOT a second config for the pair. idx_party_character_boss stays, and running the same boss
-- again in a later week arms this row for that period instead of making another one. That keeps
-- partyIdFor answering with one config, and keeps the pool a drop landed in the pool it stays in.

ALTER TABLE party ADD COLUMN one_off BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE party_period_run (
    party_id     UUID NOT NULL REFERENCES party(id) ON DELETE CASCADE,
    -- The start of the period the boss is answered for: a Thursday for a weekly boss, the 1st for a
    -- monthly one. The same reckoning V31 uses. See BossPeriod.periodStartFor.
    period_start DATE NOT NULL,
    -- When it was said, so a mark can be told from a row that has always been there. Matches
    -- party_period_skip and character_boss_skip.
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (party_id, period_start)
);

-- Kept, rather than deleted when the period passes: it is what a past week is drawn from, and what
-- keeps a drop that fell on a one-off attached to the night it fell on.

-- No index for party_id: it is the leftmost PK column, which already covers the only FK here.
