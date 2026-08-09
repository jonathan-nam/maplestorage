-- The stacks a piece drop falls in, and which seat picked each of them up.
--
-- A stack is indivisible. Hard Baldrix gives 120 coupons in 3 stacks of 40, so a duo cannot split
-- it by looting however they agree: one of them walks away holding 20 that are not theirs. Seven of
-- the eleven vestige rows fall in 3 stacks, so this is the ordinary night, not the exception.
--
-- Two facts, and only one of them can be worked out:
--
--   boss_drop_amount.bundles   how many stacks it falls in. A game fact per (boss, difficulty),
--                              the same however many people turn up. Seeded from catalog/drops.yaml.
--   party_loot_bundle          which seat picked up how many. NOT derivable. Everyone takes
--                              floor(bundles / seats) and the remainder goes to somebody; which
--                              somebody is a thing that happened in the map and nowhere else.
--
-- Deriving that second one is the whole reason this table exists rather than a default. The best
-- guess is whoever is furthest behind, which reads off the running balance, which moves whenever an
-- earlier week is edited. A derived assignment would therefore rewrite who owed what on nights
-- already settled. Suggest it on screen, store what was actually done.
--
-- ABSENT rather than zero, in both. No bundle count is a drop nobody has counted, which does not
-- claim it falls in one stack. No rows here is nobody having said how it was picked up, which does
-- not claim it divided evenly.

ALTER TABLE boss_drop_amount
    ADD COLUMN bundles INTEGER
        CHECK (bundles >= 1 AND pieces % bundles = 0);

-- Stacks are equal and whole, so a count that does not divide the total means one of the two
-- numbers is wrong. catalog/build.py refuses the same pair, and this is the other end of it.
COMMENT ON COLUMN boss_drop_amount.bundles IS
    'How many equal stacks the pieces fall in. NULL is uncounted, not one.';

CREATE TABLE party_loot_bundle (
    loot_id   UUID    NOT NULL REFERENCES party_loot(id) ON DELETE CASCADE,
    member_id UUID    NOT NULL REFERENCES party_member(id) ON DELETE CASCADE,

    -- How many whole stacks this seat picked up. At least one: a party cannot exceed the cap that
    -- sets the bundle count, so bundles >= seats and nobody is ever assigned none. A seat that was
    -- not there has no row rather than a zero.
    bundles   INTEGER NOT NULL CHECK (bundles >= 1),

    PRIMARY KEY (loot_id, member_id)
);

-- Read per drop when the ledger builds a holder's queue.
CREATE INDEX party_loot_bundle_loot_idx ON party_loot_bundle (loot_id);
