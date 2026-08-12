-- Two facts that give a coupon debt a price, on the one side where a price is knowable.
--
-- A piece debt is deliberately unpriced (see V51 and #354): coupons are single-trade, so only the
-- holder can sell them, and asking what somebody ELSE got is asking for a figure nobody can see.
--
-- That argument holds in one direction only. When YOU loot the lot, the pieces you owe are in your
-- own inventory, and when you sell them the price is one you typed. So a sale out of your own pile
-- may now say how many of its pieces were somebody else's, and that person's share of the proceeds
-- follows from the tranche's own amount.
--
-- PIECES on the share row, never mesos. The money is derived on read as `pieces * amount / tranche
-- pieces`, exact within one sale because a tranche is one price for one lot. Storing the meso figure
-- would be storing a derived share, which V40 exists to say never to do: correcting the tranche's
-- amount has to move it.

CREATE TABLE vestige_tranche_share (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Cascades, because a share of a sale that no longer exists is a share of nothing. Removing a
    -- mistyped tranche has always been how one is corrected, and its attribution goes with it.
    tranche_id     UUID   NOT NULL REFERENCES vestige_tranche (id) ON DELETE CASCADE,

    -- WHOSE pieces these were, in vestige_tranche's own holder shape. See V39.
    holder_kind    TEXT   NOT NULL CHECK (holder_kind IN ('PERSON', 'SELF', 'CHARACTER')),
    person_id      UUID REFERENCES person (id) ON DELETE CASCADE,
    character_name TEXT CHECK (character_name = lower(character_name) AND length(character_name) > 0),

    -- Above zero, and never more than the tranche's own count. The ceiling is the route's to enforce:
    -- it needs the parent row, and a check constraint cannot read one.
    pieces         INT    NOT NULL CHECK (pieces >= 1),

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT vestige_tranche_share_person_ref
        CHECK ((holder_kind = 'PERSON') = (person_id IS NOT NULL)),
    CONSTRAINT vestige_tranche_share_character_ref
        CHECK ((holder_kind = 'CHARACTER') = (character_name IS NOT NULL))
);

CREATE INDEX idx_vestige_tranche_share_tranche ON vestige_tranche_share (tranche_id);

COMMENT ON TABLE vestige_tranche_share IS
    'How many pieces of one sale belonged to somebody else. Their share of the money is derived from '
    'the tranche amount on read, never stored: correcting the amount has to move it.';

-- What somebody owes you that no drop accounts for.
--
-- The Collection Ledger could only ever state debts it derived: a share of a sale, or a count of
-- pieces. A debt from anywhere else (a loan, last month's split settled off the books, a deal made in
-- game) had nowhere to go, so the one place that adds up what a person owes you was structurally
-- incapable of holding the ordinary case.
--
-- ROWS rather than a running total, the same shape and the same reason as V51: only the sum matters,
-- and a mistyped one has to be removable the way a mistyped tranche is.
--
-- One direction. A positive amount is what THEY owe YOU, which is what this ledger is for. The other
-- direction arrives on its own, when the sales and the receipts net past it, and it is said rather
-- than entered.

CREATE TABLE collection_debt (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        TEXT   NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    holder_kind    TEXT   NOT NULL CHECK (holder_kind IN ('PERSON', 'SELF', 'CHARACTER')),
    person_id      UUID REFERENCES person (id) ON DELETE CASCADE,
    character_name TEXT CHECK (character_name = lower(character_name) AND length(character_name) > 0),

    amount         BIGINT NOT NULL CHECK (amount >= 1),

    -- What it was for, as the person entering it would say it. Optional, and the one piece of free
    -- text on this table: a balance with no source is a number nobody can check a month later.
    note           TEXT CHECK (note IS NULL OR (length(note) > 0 AND length(note) <= 120)),

    incurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT collection_debt_person_ref
        CHECK ((holder_kind = 'PERSON') = (person_id IS NOT NULL)),
    CONSTRAINT collection_debt_character_ref
        CHECK ((holder_kind = 'CHARACTER') = (character_name IS NOT NULL))
);

CREATE INDEX idx_collection_debt_user ON collection_debt (user_id, incurred_at);
CREATE INDEX idx_collection_debt_person ON collection_debt (user_id, person_id);

COMMENT ON TABLE collection_debt IS
    'Mesos somebody owes you that no drop accounts for. Rows, not a running total, so a mistyped one '
    'can be removed. Positive is always what they owe you.';
