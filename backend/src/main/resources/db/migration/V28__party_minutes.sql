-- How long this party takes on its boss, door to door.
--
-- On the config rather than on the boss, because the boss is not what decides it. The same Hard
-- Lucid is twenty minutes for one party and five for a stronger one, so a number keyed on (boss,
-- difficulty) would be an average of parties that have nothing to do with each other. A config is
-- already "this character, this boss, these people", which is the thing that has a pace.
--
-- Nullable, and NOT backfilled, for the same reason as difficulty (V24): every config predates the
-- column, so a default here would be this app writing down a time nobody measured. Run Order falls
-- back to its flat estimate for these and says on screen that it did.
--
-- Zero is allowed. A boss a party walks through is a real thing to say, and it is the caller's job
-- to honour it rather than treat it as unset. The upper bound is only a typo guard: 600 is ten
-- hours, longer than any night, so nothing real is refused by it.

ALTER TABLE party ADD COLUMN minutes INTEGER
    CHECK (minutes >= 0 AND minutes <= 600);
