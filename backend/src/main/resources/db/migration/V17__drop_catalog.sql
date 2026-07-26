-- What each boss can drop. Mirrors db/Tables.kt column-for-column (this file is the schema source
-- of truth). Rows come from R__drop_catalog.sql, generated from catalog/drops.yaml.
--
-- Separate from token_catalog on purpose. That table is what the parser COUNTS in an inventory;
-- this one is what a boss can drop, most of which is never counted (hammers, coupons, rings). The
-- two overlap by exactly one item today (Distorted Ambition), and merging them would mean every
-- drop needed a vision template it will never have.

CREATE TABLE drop_catalog (
    -- No default: R__drop_catalog.sql assigns and keeps a stable id per drop_key across re-seeds,
    -- because party_loot references it. Churn one and somebody's loot history is orphaned.
    id         UUID PRIMARY KEY,
    drop_key   TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    -- The icon file under seed-assets/drops, served at /drop-icons (same shape as token_catalog's
    -- icon_ref_key). NULL for a drop the pinned maplestory.io dataset does not carry: the UI
    -- draws it without art rather than requesting a file that is not there.
    icon_ref_key TEXT,
    -- Set when every member gets their own copy: ALWAYS, or HEROIC when it is one drop for the
    -- party in Interactive worlds and one each in Heroic/Reboot. The loot pool shows it, because
    -- splitting a per-member drop six ways pays everybody a sixth of what they already hold.
    per_member TEXT CHECK (per_member IN ('ALWAYS', 'HEROIC')),
    -- Where the drop exists at all. NULL means everywhere; INTERACTIVE marks the coupons that do
    -- not drop in Reboot.
    worlds     TEXT CHECK (worlds IN ('INTERACTIVE', 'HEROIC')),
    quantity   INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL
);

CREATE TABLE boss_drop (
    boss_catalog_id UUID NOT NULL REFERENCES boss_catalog(id),
    drop_catalog_id UUID NOT NULL REFERENCES drop_catalog(id),
    -- Manifest position within that boss's table, so the picker lists drops the way the manifest
    -- does rather than alphabetically.
    sort_order      INTEGER NOT NULL,
    PRIMARY KEY (boss_catalog_id, drop_catalog_id)
);

CREATE INDEX idx_boss_drop_drop_catalog_id ON boss_drop(drop_catalog_id);
