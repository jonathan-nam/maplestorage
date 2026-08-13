-- The Collection Ledger is the Settlement Ledger.
--
-- A rename, and only a rename. No column changes, no data movement, so nothing here can produce a
-- different number than the day before.
--
-- Constraints and indexes are renamed too. Postgres carries the old names through ALTER TABLE
-- RENAME, and a violation on settlement_debt reporting collection_debt_amount_check is a name from a
-- vocabulary that no longer exists anywhere else.

ALTER TABLE collection_debt RENAME TO settlement_debt;
ALTER TABLE collection_debt_payout RENAME TO settlement_debt_payout;

ALTER TABLE settlement_debt RENAME CONSTRAINT collection_debt_pkey TO settlement_debt_pkey;
ALTER TABLE settlement_debt RENAME CONSTRAINT collection_debt_amount_check
    TO settlement_debt_amount_check;
ALTER TABLE settlement_debt RENAME CONSTRAINT collection_debt_character_name_check
    TO settlement_debt_character_name_check;
ALTER TABLE settlement_debt RENAME CONSTRAINT collection_debt_character_ref
    TO settlement_debt_character_ref;
ALTER TABLE settlement_debt RENAME CONSTRAINT collection_debt_holder_kind_check
    TO settlement_debt_holder_kind_check;
ALTER TABLE settlement_debt RENAME CONSTRAINT collection_debt_note_check
    TO settlement_debt_note_check;
ALTER TABLE settlement_debt RENAME CONSTRAINT collection_debt_person_id_fkey
    TO settlement_debt_person_id_fkey;
ALTER TABLE settlement_debt RENAME CONSTRAINT collection_debt_person_ref
    TO settlement_debt_person_ref;
ALTER TABLE settlement_debt RENAME CONSTRAINT collection_debt_user_id_fkey
    TO settlement_debt_user_id_fkey;

ALTER TABLE settlement_debt_payout RENAME CONSTRAINT collection_debt_payout_pkey
    TO settlement_debt_payout_pkey;
ALTER TABLE settlement_debt_payout RENAME CONSTRAINT collection_debt_payout_debt_id_fkey
    TO settlement_debt_payout_debt_id_fkey;
ALTER TABLE settlement_debt_payout RENAME CONSTRAINT collection_debt_payout_loot_id_fkey
    TO settlement_debt_payout_loot_id_fkey;
ALTER TABLE settlement_debt_payout RENAME CONSTRAINT collection_debt_payout_member_id_fkey
    TO settlement_debt_payout_member_id_fkey;

ALTER INDEX idx_collection_debt_user RENAME TO idx_settlement_debt_user;
ALTER INDEX idx_collection_debt_person RENAME TO idx_settlement_debt_person;
ALTER INDEX idx_collection_debt_payout_debt RENAME TO idx_settlement_debt_payout_debt;

-- The table and column COMMENTs from V56 to V58 are left alone. Postgres attaches them to the
-- object, not to the name, so they survive the rename, and restating them here is a second copy to
-- drift.
