-- A drop that fell on a run with nobody else, kept on the drop rather than read off the config.
--
-- The Drop Log's own form names no party. It takes a character and a boss, and the pool is worked
-- out from the pair (see logDropRoute), because there is one config per pair and no second pool to
-- open. So a boss run alone landed in the party that character runs it with the rest of the time,
-- and its sale divided by that party's roster: 3.5b halved and handed to somebody who was not in
-- the game.
--
-- Which pool a drop sits in cannot say who was there. This column is the drop saying it, the same
-- way V69 made the drop say the mode it fell at, and for the same reason: a party is a mutable row
-- describing an arrangement, and a night is a fact.
--
-- FALSE is "nothing says it was alone", which is every row written before today and every drop added
-- from a party's own row. Those read the week's roster exactly as they did. Nothing is backfilled:
-- there is no record of which door an old row came through, and guessing is the step this column
-- exists to stop.
ALTER TABLE party_loot
    ADD COLUMN solo BOOLEAN NOT NULL DEFAULT false;
