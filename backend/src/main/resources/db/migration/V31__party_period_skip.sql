-- A period this party is not running its boss. Mirrors db/Tables.kt column-for-column (this file
-- is the schema source of truth).
--
-- The config stays. "We are not doing Lucid this week" is a statement about one week, and saying it
-- by deleting the config would take the party, its seats and its pool with it, then need retyping
-- next Thursday. A period with no row here runs as usual, so putting it back is a deletion and the
-- next one reverts without being told to. The same reasoning as V27__party_week_roster.sql.
--
-- period_start, not week_start. This mark is the counterpart to boss_clear, which files against the
-- boss's OWN cadence, so a skipped Black Mage is a skipped month. party_week_seat keeps Thursday
-- weeks because a roster is a roster; a period is what the boss is answered for.
--
-- Not character_boss_skip, which is a standing fact with no period and refuses to sit beside a
-- config at all (see V25 and RoutineRefusal.HasParty). This is the opposite case: the party stands,
-- and this period is the exception to it.

CREATE TABLE party_period_skip (
    party_id     UUID NOT NULL REFERENCES party(id) ON DELETE CASCADE,
    -- The start of the period the boss is answered for: a Thursday for a weekly boss, the 1st for a
    -- monthly one. See BossPeriod.periodStartFor.
    period_start DATE NOT NULL,
    -- When it was said, so a mark can be told from a row that has always been there. Matches
    -- character_boss_skip; nothing reads it yet and it is unrecoverable after the fact.
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (party_id, period_start)
);

-- No index for party_id: it is the leftmost PK column, which already covers the only FK here.
