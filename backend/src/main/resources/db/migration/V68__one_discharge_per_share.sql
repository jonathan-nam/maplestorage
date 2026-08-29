-- A share is discharged ONCE.
--
-- V58 stores which shares an offset covered, keyed (debt, loot, member), so nothing stopped two
-- entries naming the same share. That was theoretical until #516 made splitting an old offset
-- automatic: the guard deciding whether to split read the debts the browser had last fetched, a
-- remount re-ran it against that same stale list, and the second pass could not see the rows the
-- first had already written. One night was recorded twice, 1,109,227,872 came off a debt once more
-- than it had happened, and every figure on the card was plausible.
--
-- The client guard is worth keeping and cannot be the thing this rests on. It reads state that goes
-- stale by definition, and two tabs never see each other at all. This is the one place that knows
-- every entry at once.
--
-- Loot and member are already scoped to an account through the party that owns them, so a global
-- index is per-user without saying so.
CREATE UNIQUE INDEX idx_settlement_debt_payout_one_discharge
    ON settlement_debt_payout (loot_id, member_id);

COMMENT ON INDEX idx_settlement_debt_payout_one_discharge IS
    'One entry per share. Two adjustments discharging one payout is a share paid off twice, which '
    'reads as an ordinary figure on the card and is wrong by exactly that share.';
