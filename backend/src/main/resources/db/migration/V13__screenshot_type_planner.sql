-- Let screenshots.type hold PLANNER.
--
-- V1 constrained this column to INVENTORY/UNRECOGNIZED. Adding PLANNER to the ScreenshotType enum
-- does not fail at compile time, at startup, or in any test that does not touch the table: it
-- fails on the FIRST PLANNER UPLOAD, at the INSERT, as a 500 on a capture the vision service had
-- just read perfectly. Found by BossClearsTest inserting a PLANNER screenshot row.
--
-- The column has been nullable since V3 (a FAILED parse never got classified). A CHECK on NULL
-- evaluates to NULL and passes, so nullability is unchanged here.
ALTER TABLE screenshots DROP CONSTRAINT IF EXISTS screenshots_type_check;

ALTER TABLE screenshots ADD CONSTRAINT screenshots_type_check
    CHECK (type IN ('INVENTORY', 'PLANNER', 'UNRECOGNIZED'));
