-- A link that starts somebody else's account from your side of the parties you share.
--
-- You already hold, for every person you boss with, their characters (person_character) and the
-- configs those characters sit in. That is most of what their own account would say, written from
-- the other end: your config "mechyfechy runs Kalos with CreedBratton" is their config
-- "CreedBratton runs Kalos with mechyfechy". The link hands that over so a new account is not a
-- roster somebody re-types from memory.
--
-- The payload is FROZEN at create time rather than read at accept.
--
-- Three reasons, and the first is the one that matters: what the sender saw before sending is what
-- the recipient gets, so the link cannot quietly change under a config edited in between. The
-- second is that accept becomes a function of one JSON document, testable without standing up a
-- second account's worth of rows. The third is that a config deleted between send and accept then
-- still lands, which is the harmless outcome; the alternative is a link that silently shrinks.
-- Staleness is bounded by expires_at.

CREATE TABLE account_invite
(
    id          UUID PRIMARY KEY,
    user_id     TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    person_id   UUID        NOT NULL REFERENCES person (id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL UNIQUE,
    sender_name TEXT        NOT NULL,
    payload     JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by TEXT REFERENCES users (id) ON DELETE SET NULL
);

COMMENT ON COLUMN account_invite.token_hash IS
    'sha256 of the token, hex. The token itself is in the URL and is never stored: a link is a '
    'bearer credential, so a database that holds it holds every unaccepted invite outright.';

COMMENT ON COLUMN account_invite.person_id IS
    'Who the link is for, so accept knows which of the sender''s people has now become an account. '
    'ON DELETE CASCADE: a person removed from the list has no invite to speak of.';

COMMENT ON COLUMN account_invite.payload IS
    'The characters, people and configs this link creates, frozen at create time. Shape is '
    'InvitePayload in InviteDtos.kt, versioned so an old unaccepted link can be refused rather '
    'than half-read.';

-- Unaccepted links for one person, which is what the People board asks for. Accepted ones are kept
-- (accepted_by is the only record of which account came from which link) and are not offered again.
CREATE INDEX idx_account_invite_person ON account_invite (person_id) WHERE accepted_at IS NULL;

-- Which account this person turned out to be.
--
-- Nothing reads it yet. It is written the moment an invite is accepted, from both ends: your Bro
-- names his account, and his copy of you names yours. Recorded now because it can only be known
-- now, at the one moment the two accounts are in the same transaction, and a shared boss list
-- asked for later would otherwise have to guess it back out of character names.
ALTER TABLE person ADD COLUMN linked_user_id TEXT REFERENCES users (id) ON DELETE SET NULL;

COMMENT ON COLUMN person.linked_user_id IS
    'The account this person signs in as, when they have one. Written by invite accept, never by '
    'hand. NULL is the ordinary case: most people you run with do not use the app.';

-- The real-world party two accounts' configs are both describing.
--
-- Your "mechyfechy runs Kalos with CreedBratton" and his "CreedBratton runs Kalos with mechyfechy"
-- are one Thursday run recorded twice, and nothing else in the schema says so: configs are per
-- account and seats are matched by character name, which cannot tell a shared run from a
-- coincidence of names.
--
-- The reason to want it is the looter. Interactive parties settle on one member looting everything
-- because the bookkeeping is a burden nobody wants twice, and the way out is for the pool to be
-- one thing several accounts can write to, rather than one account's private record. That needs a
-- key both sides already agree on. This is it.
--
-- NOT unique, and not a foreign key to anything: it is an identity two rows share, and the second
-- row is on somebody else's account. Two configs with the same group_id are the same party. NULL,
-- which is nearly all of them, is a config nobody has ever linked.
ALTER TABLE party ADD COLUMN group_id UUID;

COMMENT ON COLUMN party.group_id IS
    'Shared by the configs on two accounts that describe the same real party. Written by invite '
    'accept. NULL is unlinked, which is the default and most rows.';

CREATE INDEX idx_party_group ON party (group_id) WHERE group_id IS NOT NULL;
