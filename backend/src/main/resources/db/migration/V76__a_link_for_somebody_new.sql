-- A link for somebody this account has no record of.
--
-- V70's link is addressed to a person: it takes a person_id, and what it carries is read out of the
-- characters and configs the sender already holds for them. That is the whole reason it cannot
-- reach a stranger. Two people who met in a party finder have no row to name each other by, so
-- there is nothing to address and nothing to freeze.
--
-- So the link stops naming anybody, and the recipient supplies what the sender is missing: one
-- character name, which becomes the person the sender now has for them. Each side ends up with a
-- person named after one character of the other's, both carrying linked_user_id, and that is the
-- whole of the introduction. It is enough, because linkedCharactersFor reads a linked ACCOUNT's
-- characters rather than the person_character rows: from then on a seat the sender types binds to
-- their account on its own. See PersonCharacters.kt and V75.
--
-- payload stays NOT NULL and stays InvitePayload. An open link's is one with empty characters,
-- parties and people-but-the-sender, which is a true description of what it hands over: nothing of
-- anybody else's. One stored shape means one decode path and one version check.
ALTER TABLE account_invite ALTER COLUMN person_id DROP NOT NULL;

COMMENT ON COLUMN account_invite.person_id IS
    'Who the link is for, so accept knows which of the sender''s people has now become an account. '
    'NULL is a link for somebody the sender has no record of: there is no person to name yet, and '
    'accept makes one from the character the recipient gives. ON DELETE CASCADE: a person removed '
    'from the list has no invite to speak of.';

-- No index and no unique constraint. One live link per account is what createOpenInvite's delete
-- says, exactly as one live link per person is what the person path's delete says, and a unique
-- index on top of it turns a double-clicked button into a duplicate key error rather than the
-- second link the delete was already going to prevent.
