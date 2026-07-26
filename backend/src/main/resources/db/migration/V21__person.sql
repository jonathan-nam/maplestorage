-- The people you run with, as distinct from the characters they bring.
--
-- Parties were seats holding a character name, so "Jared on Premial" and "Jared on Lynn" were two
-- unrelated strings. They are one person bringing a different character to a different boss, which
-- is exactly how the roster is kept by hand today (test-fixtures/occluded/boss matrix.png: one
-- COLUMN per person, one ROW per party, and the character in the cell). Without the person there
-- is no answer to "what is Jared owed", only "what is Premial owed".
--
-- A person is a human, including you: your own seats point at a person too, and the character they
-- bring is linked to your roster when the name matches (party_member.character_id).

CREATE TABLE person (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL REFERENCES users(id),
    name       TEXT NOT NULL,
    -- The Auction House tier, which belongs to the PERSON, not to a seat: it is who they are, not
    -- who they brought. It was on party_member and is moved here below, which also means it stops
    -- being possible for one person to be MVP in one party and not in another.
    mvp        BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One row per name per account: the grid's columns are these, and two columns with the same
    -- name would be two people nobody could tell apart.
    UNIQUE (user_id, name)
);

CREATE INDEX idx_person_user_id ON person(user_id);

ALTER TABLE party_member ADD COLUMN person_id UUID REFERENCES person(id);

-- Backfill: every existing seat name becomes a person on that account. bool_or keeps MVP if any
-- seat said so, which is the reading that does not silently downgrade somebody's fee.
INSERT INTO person (user_id, name, mvp)
SELECT p.user_id, pm.name, bool_or(pm.mvp)
FROM party_member pm
JOIN party p ON p.id = pm.party_id
GROUP BY p.user_id, pm.name;

UPDATE party_member pm
SET person_id = pe.id
FROM party p, person pe
WHERE pm.party_id = p.id
  AND pe.user_id = p.user_id
  AND pe.name = pm.name;

-- Every seat has a person from here on. A seat without one would be a cell in no column.
ALTER TABLE party_member ALTER COLUMN person_id SET NOT NULL;

-- MVP now lives on person. Two copies would let a split use the stale one.
ALTER TABLE party_member DROP COLUMN mvp;

CREATE INDEX idx_party_member_person_id ON party_member(person_id);
