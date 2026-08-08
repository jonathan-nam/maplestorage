-- A looter's sales, one tranche at a time.
--
-- The single input the whole ledger runs on: "sold 50 pieces for 1.2b". Nobody names a boss. The
-- pieces are spent on the oldest uncovered boss first and each is priced by the tranches that
-- actually covered it, which is frontend/lib/piece-ledger.ts and stays the only copy of itself.
--
-- Keyed by LOOTER NAME, not by party and not by account. Pieces sit in one character's inventory and
-- a coupon can only be traded once, so they cannot be moved between characters: one character's pile
-- is one tally, spanning every boss and week they loot for. And the looter is not always yours, which
-- is the arrangement a duo running a character that is not on your account settles into. Your
-- partner's figures are what they reported; you enter them on their behalf.
--
-- AMOUNT, not price-each. What a partner reports is "1.2b for the 60", and dividing that by hand is
-- the arithmetic this exists to remove. The per-piece figure is derived on every read.
--
-- No computed money here either: pieces and a total are what a human entered, exactly as the sale on
-- party_loot is.

CREATE TABLE vestige_tranche (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Lowercased, because it is an identity and not a label: seats are matched by name everywhere
    -- else in this schema (see writeMembers), and "Husky" and "husky" are one inventory.
    looter_name TEXT NOT NULL CHECK (looter_name = lower(looter_name) AND length(looter_name) > 0),

    pieces      INTEGER NOT NULL CHECK (pieces >= 1),
    -- Mesos for the whole tranche. BIGINT: a stack of these goes past 2^31 routinely.
    amount      BIGINT NOT NULL CHECK (amount >= 0),

    sold_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The read is always "every tranche this account has, oldest first", because the queue is spent in
-- the order the pieces were sold.
CREATE INDEX idx_vestige_tranche_user_sold ON vestige_tranche(user_id, sold_at);
