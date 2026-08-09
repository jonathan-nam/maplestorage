-- Who took this drop, in a world where nobody can sell it.
--
-- A Heroic pool had no product. Every fairness mechanism in this app is denominated in mesos (the
-- sale, the split, the payout rows, the Wallet), so with trading gone the only thing a Heroic drop
-- row could offer was Remove. The party still has to answer "who takes this one", and had nowhere
-- to write it down.
--
-- This is that answer, and it is the Heroic axis of the same question `sold_at` is the Interactive
-- one: a drop is outstanding until somebody has it. What it buys is the tally, which is the actual
-- product: with a running count per seat, the next contested drop has an obvious claimant.
--
-- Not a share and not a payout. Nothing is owed here and nothing divides, because the item cannot
-- move again. A seat's count is how many items they have taken, no more.
--
-- Distinct from party.looter_member_id (V36), which is a STANDING arrangement about who picks
-- things up so a stack stays in one inventory. This is one drop, decided once, and the two answer
-- different questions: a party can have a looter and still take turns on what is worth keeping.
--
-- SET NULL rather than CASCADE, the same reasoning V36 gives: if the seat goes, the designation
-- lapses. Taking the drop out of the pool with it would delete a record of what fell.
ALTER TABLE party_loot ADD COLUMN taken_by_member_id UUID REFERENCES party_member(id) ON DELETE SET NULL;

-- A drop cannot be both sold and taken. They are the same fact under two economies: in a world that
-- trades it becomes mesos to split, and in one that does not it becomes somebody's item. Allowing
-- both would make `status` ambiguous, and the tally would count an item the party sold.
ALTER TABLE party_loot
    ADD CONSTRAINT party_loot_sold_or_taken
        CHECK (taken_by_member_id IS NULL OR sold_at IS NULL);
