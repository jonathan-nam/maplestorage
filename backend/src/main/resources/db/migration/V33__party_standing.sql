-- A config you no longer run, kept because its pool is a record. Mirrors db/Tables.kt
-- column-for-column (this file is the schema source of truth).
--
-- Deleting a config took its pool with it: party_loot cascades off party_id, and party_loot_payout
-- off that. So deleting was refused outright the moment a party had ever held a drop, which left a
-- settled pool pinning a config to the list forever with no way to take it off.
--
-- The same problem was already solved one level down. A SEAT a payout points at is retired rather
-- than deleted (party_member.standing, see retireOrDelete), because deleting it would erase a debt
-- in the same breath as an ordinary roster edit. This is that rule applied to the config itself,
-- and it borrows the column name on purpose.
--
--   standing = true    on Party View, and on every list that asks what a character runs
--   standing = false   off those lists, pool and payouts untouched
--
-- The wallet and the Drop Log read the loot rows, not the list, so both keep answering for a
-- retired config. They are handed retired configs explicitly (partiesFor's includeRetired), because
-- both drop a pool whose config they cannot find: buildDropLog skips it and buildWallet counts it
-- unreadable, and a debt that quietly stops being owed is exactly the wrong number this repo
-- exists to prevent.
--
-- NOT a second config for the pair. idx_party_character_boss stays, so running the boss again
-- revives this row rather than making another one, the way a spent one-off is re-armed. That keeps
-- partyIdFor answering with one config, and keeps a drop in the pool it landed in. See
-- takeOverParty.

ALTER TABLE party ADD COLUMN standing BOOLEAN NOT NULL DEFAULT true;

-- Only the standing ones are ever listed, and every such query filters on it alongside user_id.
CREATE INDEX idx_party_standing ON party (user_id, standing);
