-- A config on Party View that names nobody else is a run alone wearing a party's clothes.
--
-- validateMembers has always refused a roster with nobody in it ("a party needs somebody else in
-- it"), and the two places that empty one on purpose both set solo = true in the same breath, which
-- takes the config off Party View and into the Drop Log's pools where a run alone belongs. So the
-- app does not produce this state.
--
-- One row reached it anyway, by hand: a seat was deleted in production to undo a split that had
-- been credited to somebody who was not there, and nothing re-asked afterwards whether what was
-- left was still a party. This is that question, asked of every config.
--
-- The config becomes the solo pool it now is, which is what soloAgain writes: on every period
-- (a pool is not a night), standing, and off every list of parties. Its drops stay exactly where
-- they are, and so do the weeks it WAS a party, because those weeks name their own roster and
-- nothing here touches party_week_seat. Adding the boss on Party View again takes the config back
-- over, pool and all. See takeOverParty.
UPDATE party p
SET solo = true,
    one_off = false,
    standing = true
WHERE NOT p.solo
  -- Nobody else in the roster it keeps.
  AND NOT EXISTS (
      SELECT 1 FROM party_member m
      WHERE m.party_id = p.id
        AND m.standing
        AND m.character_id IS DISTINCT FROM p.character_id
  )
  -- And nobody else on any night it is armed for, which is where a one-off's people are written.
  AND NOT EXISTS (
      SELECT 1
      FROM party_period_run r
      JOIN party_week_seat s
        ON s.party_id = p.id
       AND s.week_start = r.period_start - ((EXTRACT(ISODOW FROM r.period_start)::int - 4 + 7) % 7)
      JOIN party_member m ON m.id = s.member_id
      WHERE r.party_id = p.id
        AND m.character_id IS DISTINCT FROM p.character_id
  );
