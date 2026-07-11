-- Tables in FK dependency order. Mirrors db/Tables.kt column-for-column --
-- this migration is the actual schema source of truth; Tables.kt exists
-- purely for compile-time-checked query building against it.

CREATE TABLE users (
    id         TEXT PRIMARY KEY, -- Clerk userId, e.g. "user_2abc..." -- not a UUID
    email      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE characters (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             TEXT NOT NULL REFERENCES users(id),
    name                TEXT NOT NULL,
    level               INTEGER,
    job_name            TEXT,
    world_name          TEXT,
    sprite_img_url      TEXT,
    sprite_refreshed_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE token_catalog (
    -- No default -- the 6 rows get fixed UUID literals from V2, not
    -- randomly generated ones, so this fixed catalog has stable,
    -- referenceable IDs across re-seeds.
    id                UUID PRIMARY KEY,
    name              TEXT NOT NULL UNIQUE,
    source_boss_name  TEXT,
    slot_group        TEXT[],
    redeem_threshold  INTEGER NOT NULL DEFAULT 10,
    bonus_item_name   TEXT,
    icon_ref_key      TEXT
);

CREATE TABLE screenshots (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  TEXT NOT NULL REFERENCES users(id),
    character_id             UUID REFERENCES characters(id),
    type                     TEXT NOT NULL CHECK (type IN ('INVENTORY', 'UNRECOGNIZED')),
    storage_key              TEXT NOT NULL,
    uploaded_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    parse_status             TEXT NOT NULL DEFAULT 'PENDING'
                                 CHECK (parse_status IN ('PENDING', 'SUCCESS', 'FAILED', 'NEEDS_REVIEW')),
    raw_model_response       JSONB,
    detected_character_name  TEXT,
    detected_level           INTEGER
);

CREATE TABLE character_token_count (
    character_id          UUID NOT NULL REFERENCES characters(id),
    token_catalog_id       UUID NOT NULL REFERENCES token_catalog(id),
    quantity               INTEGER NOT NULL,
    captured_at             TIMESTAMPTZ NOT NULL,
    source_screenshot_id    UUID REFERENCES screenshots(id),
    -- Composite PK directly gives "unique per character+token" and matches
    -- the latest-snapshot upsert pattern (INSERT ... ON CONFLICT (...) DO UPDATE).
    PRIMARY KEY (character_id, token_catalog_id)
);

CREATE TABLE usage_ledger (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             TEXT NOT NULL REFERENCES users(id),
    screenshot_id       UUID REFERENCES screenshots(id),
    input_tokens        INTEGER NOT NULL,
    output_tokens       INTEGER NOT NULL,
    estimated_cost_usd  NUMERIC(10, 6) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
