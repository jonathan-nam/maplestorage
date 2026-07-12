-- Deleting a character crashed with a 500.
--
-- Both tables that reference `characters` did so with ON DELETE NO ACTION, so the
-- moment a character had any data -- which is to say, the moment it was useful -- the
-- delete violated a foreign key and the request failed. You could only delete a
-- character you had never used.
--
-- The two references want different answers, and lumping them together would lose data:

-- 1. A character's token counts are meaningless without the character. They are that
--    character's inventory, not an independent record. CASCADE.
ALTER TABLE character_token_count
    DROP CONSTRAINT character_token_count_character_id_fkey,
    ADD CONSTRAINT character_token_count_character_id_fkey
        FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE;

-- 2. A screenshot is a record of something the user actually uploaded, and it outlives
--    the attribution. Deleting a character should orphan the screenshot, not destroy
--    it -- otherwise removing a mis-OCR'd character (say, one created as "acornacorm")
--    would also erase the upload that produced it, and with it any chance of working
--    out what went wrong. SET NULL.
ALTER TABLE screenshots
    DROP CONSTRAINT screenshots_character_id_fkey,
    ADD CONSTRAINT screenshots_character_id_fkey
        FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE SET NULL;
