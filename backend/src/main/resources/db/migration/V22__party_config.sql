-- A party is one of YOUR characters, on one boss, with the people that character runs it with.
--
-- It used to be a roster with a set of bosses hanging off it. That is not how the thing is
-- thought about: you think "what does mechyfechy run Kalos with", and the answer is a config for
-- that character and that boss. A boss your character solos has no config at all, which is why
-- solo runs simply do not appear.
--
-- Five "Limbo carry" rows in a hand-kept sheet are five different characters of yours running
-- Limbo, not five configs for one character, hence the unique index.

ALTER TABLE party ADD COLUMN character_id UUID REFERENCES characters(id) ON DELETE CASCADE;
ALTER TABLE party ADD COLUMN boss_catalog_id UUID REFERENCES boss_catalog(id);

-- Carry over what can be carried: a party's own character (a seat linked to your roster) and its
-- first boss. Anything else has no character or no boss to be a config OF, and is deleted below
-- rather than left as a row the new shape cannot express.
UPDATE party p
SET character_id = seat.character_id
FROM (
    SELECT DISTINCT ON (party_id) party_id, character_id
    FROM party_member
    WHERE character_id IS NOT NULL
    ORDER BY party_id, position
) seat
WHERE seat.party_id = p.id;

-- The first of the party's bosses in progression order. party_boss carries no order of its own,
-- so the catalog's is the only one there is.
UPDATE party p
SET boss_catalog_id = pb.boss_catalog_id
FROM (
    SELECT DISTINCT ON (pb.party_id) pb.party_id, pb.boss_catalog_id
    FROM party_boss pb
    JOIN boss_catalog bc ON bc.id = pb.boss_catalog_id
    ORDER BY pb.party_id, bc.sort_order
) pb
WHERE pb.party_id = p.id;

DELETE FROM party WHERE character_id IS NULL OR boss_catalog_id IS NULL;

ALTER TABLE party ALTER COLUMN character_id SET NOT NULL;
ALTER TABLE party ALTER COLUMN boss_catalog_id SET NOT NULL;

-- One config per character per boss. Two would be two answers to the same question.
CREATE UNIQUE INDEX idx_party_character_boss ON party(character_id, boss_catalog_id);
CREATE INDEX idx_party_boss_catalog_id ON party(boss_catalog_id);

-- The set of bosses per party is gone: a party has exactly one now.
DROP TABLE party_boss;

-- A seat is a character somebody else brought. Who that somebody is comes from person_character,
-- looked up by name, so it is stated once per character rather than once per seat.
ALTER TABLE party_member DROP COLUMN mvp;
