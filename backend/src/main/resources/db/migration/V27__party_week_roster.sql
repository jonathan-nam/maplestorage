-- Who actually ran, in one week.
--
-- A party is a STANDING arrangement and most weeks are simply it. A week where somebody is out and
-- somebody else is in gets rows here naming the seats that ran. A week with NO rows is the standing
-- roster, which is what makes going back to normal a deletion rather than a second kind of edit,
-- and what makes next week revert without being told to.

-- Whether this seat is in the party's usual roster. A guest is a seat like any other, because a
-- payout points at a seat: false only says they are not there every week.
ALTER TABLE party_member ADD COLUMN standing BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE party_week_seat (
    party_id   UUID NOT NULL REFERENCES party(id) ON DELETE CASCADE,
    -- The Thursday the week opens, the same boundary the week picker steps and a clear is filed
    -- against. See BossPeriod.kt.
    week_start DATE NOT NULL,
    -- CASCADE for the one case party_loot_payout cascades for: the party being deleted whole. A
    -- seat this table names is never deleted on its own, it is retired (standing = false), because
    -- deleting it would rewrite a week that has already happened. See retireOrDelete.
    member_id  UUID NOT NULL REFERENCES party_member(id) ON DELETE CASCADE,
    PRIMARY KEY (party_id, week_start, member_id)
);

CREATE INDEX idx_party_week_seat_member_id ON party_week_seat(member_id);
