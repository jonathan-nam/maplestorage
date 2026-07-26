-- Parties: who a character actually runs a boss with. Mirrors db/Tables.kt column-for-column
-- (this file is the schema source of truth).
--
-- A party is a ROSTER, not a record of kills. It says who runs together and which bosses they run.
-- Whether a boss died stays in boss_clear, which is read off the planner, so nothing here can
-- claim a clear that no capture saw.

CREATE TABLE party (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL REFERENCES users(id),
    -- Optional. An unnamed party is drawn from its own members ("Rune + Steve"), which is what
    -- people call these anyway. Storing that label would be a second copy of the roster, and the
    -- copy is the one that goes stale when a member leaves.
    name       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE party_member (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id     UUID NOT NULL REFERENCES party(id) ON DELETE CASCADE,
    -- The IGN as the user knows it, stored for their own characters too. SET NULL below then
    -- leaves a deleted character's seat readable ("Rune, no longer tracked") instead of a hole in
    -- a party whose loot was already split six ways.
    name         TEXT NOT NULL,
    -- Set when the seat is one of this account's characters. This link is the whole answer to
    -- "which parties is this character in".
    character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
    -- Whether this member pays the MVP Auction House rate. The status, not the rate: the rates
    -- are the game's and already live in one place (frontend/lib/drop-split.ts). A 0.03 copied
    -- into a column here is a second one to keep in step.
    mvp          BOOLEAN NOT NULL DEFAULT false,
    -- Display order within the party, 0-based and dense, assigned from the order the seats were
    -- submitted in.
    position     INTEGER NOT NULL
);

-- The 6-seat cap is enforced in the route, not here: a CHECK cannot count sibling rows, so the
-- DB version of it would be a trigger. See PartyRoutes.kt.
--
-- Not unique on (party_id, position), matching characters.position (V11): a save rewrites every
-- seat's position in one pass, and a unique index would collide halfway through a swap.
CREATE INDEX idx_party_member_slot ON party_member(party_id, position);
CREATE INDEX idx_party_member_character_id ON party_member(character_id);

-- Which bosses this party is for. One party covers several bosses (the same duo runs Baldrix,
-- First Adversary and Kalos), and one boss can have a different party per character, so neither
-- side is a single column on the other.
CREATE TABLE party_boss (
    party_id        UUID NOT NULL REFERENCES party(id) ON DELETE CASCADE,
    boss_catalog_id UUID NOT NULL REFERENCES boss_catalog(id),
    PRIMARY KEY (party_id, boss_catalog_id)
);

-- Postgres does not auto-index FK columns; these are the ones the reads filter and join on.
CREATE INDEX idx_party_user_id ON party(user_id);
CREATE INDEX idx_party_boss_boss_catalog_id ON party_boss(boss_catalog_id);
