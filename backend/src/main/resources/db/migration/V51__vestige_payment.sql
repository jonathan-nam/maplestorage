-- Mesos that actually arrived, so a settled pile can stop asking.
--
-- The card could say what a holder owed and never that they had paid it. Three of the four facts had
-- a box (they sold N, they kept N, they took N of yours), and what those come to was derived from
-- them. The fourth, that the money came, had nowhere to go, so a pile whose every piece was sold and
-- priced sat at "4.86b due" for good and read exactly like one still waiting.
--
-- RECEIPTS rather than a paid flag on the debt, and the reason is the pro rata in
-- frontend/lib/piece-ledger.ts: it pays a creditor in instalments as the stack goes, deliberately, so
-- that nobody waits on the last piece of a stack that may sit for weeks. A boolean cannot say "4.86b
-- due, 2b received", which is the ordinary state of a pile halfway through.
--
-- No pieces on this row. A payment is money against a holder's whole debt, not against particular
-- coupons: which boss a meso pays for is the queue's business and it already answers that. Tying a
-- receipt to a drop would be storing a derived share, which is what V40 exists to say never to do.
--
-- The holder shape is vestige_tranche's, kind for kind, because it is the same pile being talked
-- about and matching them by anything narrower would split one human's debt in two. See V39.

CREATE TABLE vestige_payment (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        TEXT   NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    holder_kind    TEXT   NOT NULL CHECK (holder_kind IN ('PERSON', 'SELF', 'CHARACTER')),
    person_id      UUID REFERENCES person (id) ON DELETE CASCADE,
    character_name TEXT CHECK (character_name = lower(character_name) AND length(character_name) > 0),

    -- Above zero. A payment of nothing is not an event, it is the absence of one, and recording it
    -- would put a row on screen that says something happened when nothing did.
    amount         BIGINT NOT NULL CHECK (amount >= 1),

    received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The kind and its reference cannot disagree, the same pair of checks V39 puts on a tranche.
    CONSTRAINT vestige_payment_person_ref
        CHECK ((holder_kind = 'PERSON') = (person_id IS NOT NULL)),
    CONSTRAINT vestige_payment_character_ref
        CHECK ((holder_kind = 'CHARACTER') = (character_name IS NOT NULL))
);

CREATE INDEX idx_vestige_payment_user ON vestige_payment (user_id, received_at);
CREATE INDEX idx_vestige_payment_person ON vestige_payment (user_id, person_id);

COMMENT ON TABLE vestige_payment IS
    'Mesos received from a holder against what their pile owes. Rows, not a running total, so a '
    'mistyped receipt can be removed the way a mistyped tranche is. Only the sum matters.';
