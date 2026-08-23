-- Move everything one account owns onto a different user id.
--
-- Written for the move off Clerk: the id in `users` was Clerk's, signing in with Discord mints a
-- new one, and without this the old account's characters, parties and ledger stay attached to an id
-- nobody can sign in as any more.
--
--   ./scripts/reassign-user.sh <old-id> <new-id>
--
-- The child tables are read from the CATALOG, never listed here. A hand-written list is one a
-- future table quietly falls off, and the failure is the worst kind this repo has: the move reports
-- success and some of the account is silently left behind. Ten tables reference users today and
-- this does not know that number.
--
-- `users.id` cannot simply be UPDATEd: every foreign key to it is ON UPDATE NO ACTION, so Postgres
-- rejects it while children exist. Hence copy, repoint, delete, in one transaction.

\set ON_ERROR_STOP on

BEGIN;

-- Through session settings, not straight into the block below: psql does not substitute :'vars'
-- inside a dollar-quoted body, and the failure is a syntax error rather than an empty value, which
-- is at least loud.
-- Output redirected only so the two result tables do not bury the NOTICEs below, which are the
-- part worth reading. NOTICEs go to stderr and are unaffected.
\o /dev/null
SELECT set_config('reassign.old_id', :'old_id', true);
SELECT set_config('reassign.new_id', :'new_id', true);
\o

DO $$
DECLARE
    old_id  TEXT := current_setting('reassign.old_id');
    new_id  TEXT := current_setting('reassign.new_id');
    fk      RECORD;
    moved   BIGINT;
    total   BIGINT := 0;
BEGIN
    IF old_id = new_id THEN
        RAISE EXCEPTION 'old and new id are the same (%)', old_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE id = old_id) THEN
        RAISE EXCEPTION 'no user %, nothing to move', old_id;
    END IF;

    -- The new row usually already exists: signing in creates it before anybody notices the account
    -- looks empty. Its settings are first-sign-in defaults, so the old row's are carried over.
    IF EXISTS (SELECT 1 FROM users WHERE id = new_id) THEN
        UPDATE users AS n
        SET world_type        = o.world_type,
            main_character_id = o.main_character_id,
            created_at        = LEAST(n.created_at, o.created_at)
        FROM users AS o
        WHERE n.id = new_id AND o.id = old_id;
        RAISE NOTICE 'kept the existing % row, carried over its world and main character', new_id;
    ELSE
        INSERT INTO users (id, email, created_at, world_type, main_character_id)
        SELECT new_id, email, created_at, world_type, main_character_id
        FROM users WHERE id = old_id;
        RAISE NOTICE 'created % as a copy of %', new_id, old_id;
    END IF;

    -- Cleared first: it points at a character that is about to change hands, and the old row has to
    -- be deletable at the end.
    UPDATE users SET main_character_id = NULL WHERE id = old_id;

    FOR fk IN
        SELECT tc.table_name AS child_table, kcu.column_name AS child_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'users'
          AND ccu.column_name = 'id'
        ORDER BY tc.table_name
    LOOP
        EXECUTE format(
            'UPDATE %I SET %I = $1 WHERE %I = $2',
            fk.child_table, fk.child_column, fk.child_column
        ) USING new_id, old_id;
        GET DIAGNOSTICS moved = ROW_COUNT;
        total := total + moved;
        RAISE NOTICE '  % . % : % rows', fk.child_table, fk.child_column, moved;
    END LOOP;

    DELETE FROM users WHERE id = old_id;

    RAISE NOTICE 'moved % rows from % to %', total, old_id, new_id;
END $$;

COMMIT;
