-- A shared party is ONE row, and being in it is having a seat in it.
--
-- V70 made a shared party two rows, one per account, mirrored by accept and joined by
-- party.group_id. Two rows is two keyboards, and the pool each carries is its own, so the same
-- night logged on both sides doubles the count with nothing on screen saying so. That is the
-- failure this repo exists to prevent.
--
-- Worse than the double count, though, is what the mirror does to the CONFIG. Each copy carries its
-- own difficulty, and difficulty is not decorative: V69 joins boss_drop_amount on it and #548 is the
-- report of 540 coupons ceasing to be divisible pieces because a pool was read against a mode that
-- did not describe it. Two rows describing one party can disagree about the mode, and one of them is
-- then wrong about what fell.
--
-- So the mirror goes. The seat is the membership: a seat naming a character on somebody's own
-- account IS that person's place in the party, and the account reaches the party by owning that
-- character. That is also a better authorisation rule than a shared id, because it is the same fact
-- the roster already states.
ALTER TABLE party_member
    ADD COLUMN linked_character_id UUID
        REFERENCES characters (id) ON DELETE SET NULL;

-- The read is "which parties is one of my characters seated in", so it goes the other way.
CREATE INDEX party_member_linked_character_idx ON party_member (linked_character_id);

-- Never one of the party owner's own: that is character_id, which four readers take to mean "this
-- seat is MINE", the coupon ledger among them (lib/vestige-ledger.ts returns SELF on it). A seat
-- cannot be both, and saying so here is cheaper than finding out from a wrong payout.
ALTER TABLE party_member
    ADD CONSTRAINT party_member_linked_is_not_own
        CHECK (linked_character_id IS NULL OR character_id IS NULL);

-- group_id goes with the mirroring that wrote it. Nothing outside the invite code ever read it.
--
-- Refusing rather than guessing: a row still carrying one is a mirrored config somebody accepted
-- before this, and what should happen to it is a decision, not something a migration should make on
-- its own. Dev holds none. If a deploy stops here, that is this question being asked out loud.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM party WHERE group_id IS NOT NULL) THEN
        RAISE EXCEPTION
            'party.group_id still names mirrored configs. Decide what happens to them before '
            'dropping the column: the seats they duplicate now carry the membership.';
    END IF;
END $$;

ALTER TABLE party DROP COLUMN group_id;
