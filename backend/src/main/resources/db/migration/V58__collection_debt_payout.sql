-- Which shares an offset discharged.
--
-- V57 let an entered adjustment run negative, so a share you owe could be taken off what somebody
-- owes you rather than paid in mesos. What it could not say is WHICH share: the act marked the
-- payouts paid and wrote a figure, and the two ends had nothing joining them. A month later the row
-- reads "-139,548,023, offset against Bro" and the night behind it is not recoverable from here.
--
-- The same shape as vestige_settlement_loot (V52), and for the same reason: an act that closes
-- something names what it closed, rather than being matched back to it by amount or by timestamp.
--
-- The PAYOUT, not the drop. A share is (loot, member), because one drop owes several people and only
-- one of those shares is the one this offset covered. V52 could name drops alone because closing a
-- pile closes it for that holder entirely.
--
-- Empty for a hand-entered debt, which is most of them: somebody typing "he owes me 1.5b" is naming
-- no shares at all. So this is not a required half of a debt, it is what an OFFSET adds to one.

CREATE TABLE collection_debt_payout (
    debt_id   UUID NOT NULL REFERENCES collection_debt (id) ON DELETE CASCADE,
    loot_id   UUID NOT NULL REFERENCES party_loot (id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES party_member (id) ON DELETE CASCADE,

    PRIMARY KEY (debt_id, loot_id, member_id)
);

CREATE INDEX idx_collection_debt_payout_debt ON collection_debt_payout (debt_id);

COMMENT ON TABLE collection_debt_payout IS
    'The shares an offset discharged, as (loot, member) pairs. Empty on a hand-entered debt. Cascades '
    'with the debt, because a share of an adjustment that no longer exists is a share of nothing.';
