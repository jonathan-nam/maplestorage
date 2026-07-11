-- M4: images are parsed synchronously and discarded, never persisted to
-- object storage (see PLAN.md's M4 note) -- storage_key has nothing to hold.
ALTER TABLE screenshots DROP COLUMN storage_key;

-- A screenshot where the Claude call itself failed (network/rate-limit/etc.)
-- never gets classified by Claude at all, so V1's NOT NULL was too strict --
-- FAILED rows have no type.
ALTER TABLE screenshots ALTER COLUMN type DROP NOT NULL;

-- IGNORED lets a user dismiss a NEEDS_REVIEW row (mismatch / new-character /
-- unresolvable / unrecognized) without resolving it. The other four values
-- are unchanged from V1.
ALTER TABLE screenshots DROP CONSTRAINT screenshots_parse_status_check;
ALTER TABLE screenshots ADD CONSTRAINT screenshots_parse_status_check
    CHECK (parse_status IN ('PENDING', 'SUCCESS', 'FAILED', 'NEEDS_REVIEW', 'IGNORED'));
