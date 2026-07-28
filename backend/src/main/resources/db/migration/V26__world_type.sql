-- Which kind of world you play in. Mirrors db/Tables.kt column-for-column.
--
-- Heroic (Reboot) worlds have no trading, so everything downstream of a sale is Interactive-only:
-- the Auction House cut, the fair/lazy split, and the Wallet's "what do I send you". The drop log
-- itself is not, a Heroic player still wants to know what fell.
--
-- Same vocabulary as drop_catalog.worlds (V17), deliberately, so "does this drop exist here" is a
-- direct comparison rather than a mapping between two spellings of the same two worlds.
--
-- Two columns, not one. The character's is the truth (a character is in exactly one world) and
-- every party hangs off a character, so loot reads the world without a new join. The account's
-- decides what the menu offers, which has no character in hand to ask. Today the UI keeps them in
-- step; the day an account has characters in both, only the UI changes.

ALTER TABLE users
    ADD COLUMN world_type TEXT NOT NULL DEFAULT 'INTERACTIVE'
        CHECK (world_type IN ('INTERACTIVE', 'HEROIC'));

-- Not world_name: that column is a display name ("Kronos") the Nexon lookup has never populated,
-- and one is not derivable from the other without a list of every world that must be kept current.
ALTER TABLE characters
    ADD COLUMN world_type TEXT NOT NULL DEFAULT 'INTERACTIVE'
        CHECK (world_type IN ('INTERACTIVE', 'HEROIC'));
