-- A person whose Collection Ledger card stays whatever it says.
--
-- A card is drawn for somebody who owes you something or is owed something, and vanishes when the
-- two of you are square. That is right for a debt you settled once and will not see again, and wrong
-- for the three people you run every boss with: their card comes and goes week to week, so the place
-- you enter what they owe is somewhere you have to make appear first.
--
-- On the PERSON rather than in a table of its own. It is one flag about a human, not a row about an
-- event, and every other ledger table exists because it records something that happened.
--
-- Default false, so nothing is pinned until somebody says so. A ledger that decided for itself which
-- relationships mattered would be guessing, and it has no way to know.

ALTER TABLE person ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN person.pinned IS
    'Keep this person''s Collection Ledger card drawn even with nothing outstanding. Set by hand; '
    'nothing derives it.';
