-- A party member's sprite, for the seats that are NOT one of this account's characters.
--
-- Seats that are linked to a character read the sprite off `characters` instead (it is refreshed
-- there, and copying it would give the party a portrait that stops matching the roster). This
-- column is only for the other players in the party, looked up by name through the same Nexon
-- ranking endpoint that fills a character's sprite in.
--
-- Null is ordinary, not an error: a typo, a name in a world the lookup does not cover, or a
-- character too new to rank all leave it null, and the UI draws initials.

ALTER TABLE party_member ADD COLUMN sprite_img_url TEXT;

-- When the lookup last ran, so a name that resolves to nothing is not retried on every save.
ALTER TABLE party_member ADD COLUMN sprite_refreshed_at TIMESTAMPTZ;
