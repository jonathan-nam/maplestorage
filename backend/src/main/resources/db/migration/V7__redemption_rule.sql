-- The catalog was built for redemption tokens. It now has to hold consumables too, and
-- eventually general inventory items.
--
-- `redeem_threshold NOT NULL DEFAULT 10` says "collect 10 of these and trade them for an
-- Eternal set". True of Kalos's Residual Determination. Nonsense for Sayram's Elixir, which
-- you buy for 2m mesos and drink. Left alone, the UI would tell you that you are "7 / 10
-- toward an Eternal set" on a potion: a confident, meaningless number, which is the exact
-- failure this project keeps having to design out.
--
-- The first attempt at this added a `category` column and made redeem_threshold nullable.
-- That works, but it is the weaker shape: it leaves redemption-only fields sitting nullable
-- on every row of a table that is heading for thousands of potions and scrolls, and it makes
-- "is this redeemable?" a flag that has to be kept in step with the fields it governs.
--
-- An item is an item. Redemption is a RULE that some items have. So it gets its own table,
-- and "is this redeemable?" stops being a flag at all -- it is whether a rule exists.

CREATE TABLE redemption_rule (
    item_id          UUID PRIMARY KEY REFERENCES token_catalog (id) ON DELETE CASCADE,
    redeem_threshold INTEGER NOT NULL CHECK (redeem_threshold > 0),
    bonus_item_name  TEXT,
    slot_group       TEXT[]
);

COMMENT ON TABLE redemption_rule IS
    'Items you collect N of and trade in. Absence of a row means the item is simply counted.';

-- Move the six tokens' rules across. Every existing row is a redemption token, since that is
-- all the catalog has ever held.
INSERT INTO redemption_rule (item_id, redeem_threshold, bonus_item_name, slot_group)
SELECT id, redeem_threshold, bonus_item_name, slot_group
FROM token_catalog;

-- And take the redemption-only columns off the item table, where they were only ever
-- meaningful for a subset.
ALTER TABLE token_catalog DROP COLUMN redeem_threshold;
ALTER TABLE token_catalog DROP COLUMN bonus_item_name;
ALTER TABLE token_catalog DROP COLUMN slot_group;

-- source_boss_name stays: every item comes from somewhere, and for the new ones that is
-- "The Collector" or "Monster Park". It wants renaming to source_name, along with
-- token_catalog -> item_catalog. Names that outlive the thing they describe are how the
-- vision_key bug hid for days, so this is a real follow-up and not a nicety -- but it touches
-- every query and DTO, and it is not riding along on this migration.
