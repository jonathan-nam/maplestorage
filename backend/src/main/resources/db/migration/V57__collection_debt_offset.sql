-- An entered adjustment may run either way, so a debt of yours can be taken OFF what they owe you.
--
-- V56 said "positive is always what they owe you", and left the other direction to arrive by netting
-- and be said rather than entered. That is right for a debt you are still carrying, and wrong for one
-- you have discharged.
--
-- The case it could not express: you owe somebody 139,548,023 from a split, they owe you 254b, and
-- rather than send them the smaller sum you agree it comes off the larger. That IS a settlement, and
-- the app had no way to record it. Marking the share paid instead said the money had moved, which
-- took it out of the netting and put what they owe you back UP, the opposite of what happened. It
-- caught the same person three times.
--
-- So the amount is signed: positive is theirs to pay, negative is yours coming off it. Zero is still
-- refused, because an adjustment of nothing is the absence of one.
--
-- No backfill. Every existing row was entered under the positive-only rule and means exactly what it
-- meant then.

ALTER TABLE collection_debt DROP CONSTRAINT collection_debt_amount_check;

ALTER TABLE collection_debt
    ADD CONSTRAINT collection_debt_amount_check CHECK (amount <> 0);

COMMENT ON COLUMN collection_debt.amount IS
    'Signed. Positive is what they owe you; negative is a debt of yours discharged against it, which '
    'is how a share you owe is settled without money moving. Never zero.';
