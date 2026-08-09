-- A seat can take no share.
--
-- Some parties agree that one member keeps a boss's drops outright and owes the others nothing:
-- they are there for the clear, or being carried, or paid some other way. There was no way to say
-- it. The floor was one share, so the smallest thing a seat could take was an equal cut of
-- everything, and the nearest expressible arrangement (one member on a bigger share) still owes
-- them a slice every week.
--
-- It also could not be worked around. Three stacks of Limbo between two seats on 3 and 1 shares is
-- 2.25 stacks and 0.75, which nobody can pick up, so the party sat on the Drop Log as a night that
-- would not divide, every week, for as long as the arrangement stood.
--
-- Zero is the arrangement. One share is still the default and still what a blank box means, so
-- nothing changes for a party that has not asked for this.
--
-- The ceiling stays. It is a typo guard, not a rule about bossing.
ALTER TABLE party_member DROP CONSTRAINT party_member_shares_check;

ALTER TABLE party_member ADD CONSTRAINT party_member_shares_check CHECK (shares >= 0 AND shares <= 99);

-- Not relaxed on party_loot_payout. Those rows are what a sale PINNED, written by the app from a
-- split it already made, and a payout of nothing is a row worth nobody's time: the seat is simply
-- left out. See sharesRefusal, which refuses a sale that pays no one at all.
