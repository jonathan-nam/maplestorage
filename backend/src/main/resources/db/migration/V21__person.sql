-- The people you run with, and which characters are theirs.
--
-- Two separate facts, deliberately. A party names CHARACTERS, because that is what you type and
-- what the game knows. Who plays one is an account-wide association you make once: CreedBratton is
-- Chris's, wherever it turns up. Putting the person on the seat instead would mean saying so again
-- in every config that character appears in, and the copies would drift.

CREATE TABLE person (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL REFERENCES users(id),
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One row per name per account: two people you cannot tell apart are one person with a typo.
    UNIQUE (user_id, name)
);

-- A character somebody else plays. Not your roster: yours live in `characters`, with levels and
-- sprites the Nexon lookup keeps fresh.
CREATE TABLE person_character (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    -- Denormalised from person so the unique index below can exist at all. A character name is
    -- unique in a world, so claiming one for two people is a mistake worth refusing.
    user_id   TEXT NOT NULL REFERENCES users(id),
    name      TEXT NOT NULL,
    UNIQUE (user_id, name)
);

CREATE INDEX idx_person_user_id ON person(user_id);
CREATE INDEX idx_person_character_person_id ON person_character(person_id);
