-- An account that has not said which world it plays in can now say so.
--
-- V26 gave users.world_type NOT NULL DEFAULT 'INTERACTIVE', which was harmless while the column
-- only decided what the menu offered. V48 made it the lens every account-wide read narrows by, and
-- said so in its own comment: an account sitting on the default it never chose is "a site with
-- every page empty and nothing saying why". V48 fixed that for the accounts that already existed,
-- by reading their characters. It could do nothing for the next one to sign up, which still starts
-- Interactive without being asked, and a Heroic player is then shown Interactive drop pools, piece
-- counts joined on the wrong world, and a Sale Ledger for a world that does not trade.
--
-- The fix is a state for "not answered". Dropping the default is what creates it: unanswered and
-- INTERACTIVE were the same value, so no screen could tell them apart and no screen could ask.
--
-- Only users. characters.world_type keeps its default and its NOT NULL: a character IS in exactly
-- one world, the Nexon lookup says which, and there is nothing to ask.
ALTER TABLE users
    ALTER COLUMN world_type DROP DEFAULT,
    ALTER COLUMN world_type DROP NOT NULL;

-- Nobody who already answered is asked again. Every existing row holds one of the two values, and
-- this migration deliberately does not try to tell which of those were chosen and which were the
-- default: V48 already reconciled them against the characters, and re-deriving it here would move
-- accounts that have since toggled on purpose.
