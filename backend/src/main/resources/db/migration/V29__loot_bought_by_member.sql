-- A third reading of party_loot.sale_amount: a party member bought the drop off the party.
--
-- Nothing was listed, so the Auction House took nothing off the top and the entered figure is the
-- whole pot, exactly as RECEIVED is. It is a separate value because RECEIVED claims a sale that
-- did not happen, and because LISTED on such a row would deduct a fee nobody paid.
--
-- seller_member_id is then the buyer. Same role either way: the seat holding the value and owing
-- everyone else their share, which is why the payouts, the split and the wallet are untouched.
-- The payout hops are still taxed, so LAZY and FAIR mean what they always did.

ALTER TABLE party_loot DROP CONSTRAINT party_loot_amount_basis_check;
ALTER TABLE party_loot
    ADD CONSTRAINT party_loot_amount_basis_check
    CHECK (amount_basis IN ('LISTED', 'RECEIVED', 'BOUGHT'));
