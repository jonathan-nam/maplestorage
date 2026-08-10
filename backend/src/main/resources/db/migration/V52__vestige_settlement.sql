-- Closing the books on a holder's pile, as a decision somebody made.
--
-- Everything else about the card is derived: what they owe follows from what happened to the coupons,
-- and how far through it is follows from the receipts. None of that can ever say "we are done", because
-- the balance a drop is queued on is `entitled - looted`, fixed when the drop was logged. A holder who
-- looted 390 and was owed 195 is short 195 forever, whatever they sold, redeemed or paid. So a pile
-- that was fully accounted for and fully paid stayed on screen with no way off it.
--
-- Deriving the answer instead was tried on paper and does not survive contact: he pays 4.8b against
-- 4.856b, says close enough, and no arithmetic is entitled to call that settled. Only the person owed
-- the money can. So this is an ACT, like a receipt, not a computation.
--
-- It names the DROPS it closes, not a date. A date would retire a drop backfilled from an earlier week
-- afterwards, silently, which is the plausible-wrong-number failure this project exists to prevent.
-- Naming them means next week's clears are not in the set and the card reopens on its own.
--
-- `unpaid` is what was still outstanding when the books closed, recorded because writing off 56m is a
-- decision and a decision gets said. Stored once per ACT and never split across the drops: the split
-- would be a derived share, and V40 is the standing rule against those.

CREATE TABLE vestige_settlement (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- vestige_tranche's holder shape, kind for kind. See V39.
    holder_kind    TEXT NOT NULL CHECK (holder_kind IN ('PERSON', 'SELF', 'CHARACTER')),
    person_id      UUID REFERENCES person (id) ON DELETE CASCADE,
    character_name TEXT CHECK (character_name = lower(character_name) AND length(character_name) > 0),

    -- Mesos still owed at the moment the books closed. Zero is the ordinary case, a pile that balanced.
    -- Never negative: more arriving than was owed is an overpayment, which the card says separately.
    unpaid         BIGINT NOT NULL DEFAULT 0 CHECK (unpaid >= 0),

    settled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT vestige_settlement_person_ref
        CHECK ((holder_kind = 'PERSON') = (person_id IS NOT NULL)),
    CONSTRAINT vestige_settlement_character_ref
        CHECK ((holder_kind = 'CHARACTER') = (character_name IS NOT NULL))
);

-- Which drops it closed. A real foreign key, so deleting a drop takes its closure with it rather than
-- leaving a row that retires nothing.
CREATE TABLE vestige_settlement_loot (
    settlement_id UUID NOT NULL REFERENCES vestige_settlement (id) ON DELETE CASCADE,
    loot_id       UUID NOT NULL REFERENCES party_loot (id) ON DELETE CASCADE,
    PRIMARY KEY (settlement_id, loot_id)
);

CREATE INDEX idx_vestige_settlement_user ON vestige_settlement (user_id, settled_at);
CREATE INDEX idx_vestige_settlement_loot_loot ON vestige_settlement_loot (loot_id);

COMMENT ON TABLE vestige_settlement IS
    'One act of closing a holder''s books: which drops it covered and what was left unpaid. Removable, '
    'so a card closed by mistake comes back with its rows intact.';
