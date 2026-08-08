-- A tranche belongs to a PERSON, not to a character.
--
-- V38 keyed the tally by looter name, on the grounds that pieces sit in one character's inventory
-- and cannot be moved between them. True of the coupons, and the wrong unit for the ledger: one
-- human runs three characters, and the ledger's question is what that human owes, not which of
-- their inventories a piece happened to land in. Keying by character asked the same person to enter
-- their sales twice and told you they were two debtors.
--
-- Mesos are fungible where coupons are not, so the pile is per person and the queue is spent across
-- every boss any of their characters looted, oldest cleared first. Which character looted a boss is
-- still shown, it is just not what the tally is filed under.
--
-- Three kinds of holder, because there are three kinds of looter and only one of them is a row in
-- `person`:
--
--   PERSON     someone on your people list, by id, so renaming them does not orphan their sales.
--   SELF       you. Your own characters are not in `person` at all, and a debt between two of them
--              is you owing yourself, which nets to nothing.
--   CHARACTER  a looter attributed to nobody yet. The name is the only identity there is. Attribute
--              them later and the pile moves; see the read-side note in VestigeRoutes.kt.
--
-- `holder_kind` is carried rather than inferred from which column is null, so the third state is a
-- value somebody wrote and not the absence of the other two.
--
-- Dropped, not migrated: the table is empty (checked 2026-08-08), and a rename would have had to
-- guess which kind every existing key was.

ALTER TABLE vestige_tranche DROP COLUMN looter_name;

ALTER TABLE vestige_tranche
    ADD COLUMN holder_kind    TEXT NOT NULL CHECK (holder_kind IN ('PERSON', 'SELF', 'CHARACTER')),
    ADD COLUMN person_id      UUID REFERENCES person(id) ON DELETE CASCADE,
    -- Lowercased, as looter_name was: it is an identity, and seats are matched by name everywhere
    -- else in this schema.
    ADD COLUMN character_name TEXT CHECK (character_name = lower(character_name) AND length(character_name) > 0),

    -- The kind and the reference cannot disagree. Without these a PERSON row with no person_id
    -- reads as a pile belonging to nobody, and every boss it covers prices at nothing.
    ADD CONSTRAINT vestige_tranche_person_ref CHECK ((holder_kind = 'PERSON') = (person_id IS NOT NULL)),
    ADD CONSTRAINT vestige_tranche_character_ref CHECK ((holder_kind = 'CHARACTER') = (character_name IS NOT NULL));

-- One person's whole pile is read at once, oldest first, the same as the account-wide read.
CREATE INDEX idx_vestige_tranche_person ON vestige_tranche(user_id, person_id);
