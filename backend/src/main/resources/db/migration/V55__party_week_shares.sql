-- What a seat's share was, in one week.
--
-- `party_member.shares` is a STANDING arrangement and one value. Every unsold drop's entitlement is
-- derived from it on read (see foldSeats and entitlements), so changing the deal today silently
-- moved what people were owed for every week already recorded: agree a new split in August and
-- July's outstanding coupons quietly re-divide by it. Nobody is told, and the figure they were
-- shown last week is not the figure they are shown now.
--
-- So a week can name its own shares, exactly as it can already name its own roster. This is a
-- column on that same row, because the row already says "this member, in this week", and the two
-- facts are one answer: who ran, and on what share.
--
-- NULL is the seat's standing value. That keeps the rule V27 set up: a week with no rows is simply
-- the party, and going back to normal stays a deletion rather than a second thing to keep in step.
-- Every row that exists today gets NULL, so nothing that has already happened moves.
--
-- The whole point is the direction it protects. Changing the deal pins the OLD value onto every
-- earlier week that already holds a drop, and then writes the new one on the seat. Past weeks keep
-- what they were owed; this week and every week after take the new deal. Same guard, same reason,
-- as pinWeeksAlreadyDropped.
ALTER TABLE party_week_seat ADD COLUMN shares INTEGER;

-- The same range party_member.shares takes, and for the same reasons: zero is a real arrangement
-- (a seat that takes none, see V44), and the ceiling is a typo guard rather than a rule about
-- bossing. NULL passes, which is what "no answer for this week" has to be.
ALTER TABLE party_week_seat
    ADD CONSTRAINT party_week_seat_shares_check
        CHECK (shares IS NULL OR (shares >= 0 AND shares <= 99));

COMMENT ON COLUMN party_week_seat.shares IS
    'This seat''s share of a split in this week. NULL is the standing party_member.shares.';
