-- What became of the mesos from selling somebody else's coupons, as a decision somebody made.
--
-- Selling a tranche of Bro's coupons out of your own pile leaves you holding his money. Since V56 the
-- card took that figure straight off what he owed you, which is one of the two things that can happen
-- and the app was choosing it. The other is that he wants the mesos: you send them, and his debt to
-- you does not move at all. Which one it is, is between the two of you.
--
-- So the money sits undecided until a row lands here. That is the same rule as V50 for the coupons
-- themselves and V52 for closing a pile: an ACT, never an arithmetic conclusion.
--
-- A RUNNING FIGURE per holder, not a link to a tranche. What is undecided is
-- `sold to them - sum(disposals)`, so a sale entered next week is undecided the moment it lands and
-- nothing has to be re-pointed at it. Storing a tranche id instead would make correcting a mistyped
-- sale a two-step repair, and would leave a disposal pointing at a row that no longer exists.
--
-- `kind` is the whole point of the table, so it is stored and never inferred from a sign:
--
--   OFFSET  it comes off what they owe you. The card's old automatic behaviour, now chosen.
--   PAID    you sent them the mesos. Their debt to you is untouched, and the money has left you.
--
-- Removable, like every other act on this ledger: a decision entered against the wrong person moves
-- two people's figures, and this is the only row that says it happened.

CREATE TABLE vestige_proceeds_disposal (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- vestige_payment's holder shape, kind for kind. The same person is meant. See V39.
    holder_kind    TEXT NOT NULL CHECK (holder_kind IN ('PERSON', 'SELF', 'CHARACTER')),
    person_id      UUID REFERENCES person (id) ON DELETE CASCADE,
    character_name TEXT CHECK (character_name = lower(character_name) AND length(character_name) > 0),

    -- Mesos this act disposed of. Positive: which direction it went is `kind`, and a sign carrying
    -- that as well would be two spellings of one fact and a way for them to disagree.
    amount         BIGINT NOT NULL CHECK (amount >= 1),
    kind           TEXT NOT NULL CHECK (kind IN ('OFFSET', 'PAID')),

    decided_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT vestige_proceeds_disposal_person_ref
        CHECK ((holder_kind = 'PERSON') = (person_id IS NOT NULL)),
    CONSTRAINT vestige_proceeds_disposal_character_ref
        CHECK ((holder_kind = 'CHARACTER') = (character_name IS NOT NULL))
);

CREATE INDEX idx_vestige_proceeds_disposal_user ON vestige_proceeds_disposal (user_id, decided_at);
CREATE INDEX idx_vestige_proceeds_disposal_person ON vestige_proceeds_disposal (user_id, person_id);

COMMENT ON TABLE vestige_proceeds_disposal IS
    'What became of the money from selling somebody else''s coupons: taken off what they owe you, or '
    'sent to them. Undecided until a row lands here, because the app is not entitled to choose.';
