-- users.world_type becomes a MODE: which world the whole site is answering for.
--
-- It already held one of the two values, and the old "Set all" control kept it in step with the
-- characters, so for most accounts this changes nothing. It changes the meaning: every account-wide
-- read now narrows by it, instead of the app summing across both worlds and deriving "does anybody
-- trade". See users/WorldType.kt.
--
-- No schema change. What needs fixing is the accounts the old control never spoke for: a world set
-- character by character never moved users.world_type, so an account whose characters are all
-- Heroic can be sitting on an INTERACTIVE default. Under a lens that is not a harmless default any
-- more, it is a site with every page empty and nothing saying why.
--
-- Only when they ALL agree. An account with a foot in both worlds has no wrong answer here, and
-- picking one for them would move somebody who never asked to be moved.
UPDATE users u
SET world_type = c.only_world
FROM (SELECT user_id, MIN(world_type) AS only_world
      FROM characters
      GROUP BY user_id
      HAVING COUNT(DISTINCT world_type) = 1) c
WHERE c.user_id = u.id
  AND u.world_type <> c.only_world;
