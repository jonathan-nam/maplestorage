-- Register every sprite URL that already existed when V53 landed.
--
-- V53 shipped the cache but only ever registered a URL at the moment a lookup produced one, and a
-- lookup only runs for a name that has no sprite yet. So every URL already in the database was
-- invisible to it: the DTO handed out a proxy path, the route found no row, answered 404, and the
-- image was simply gone. On the dev database that was 14 of 16 party seats, which is every roster
-- except the two characters that happened to get refreshed.
--
-- It reads as "the sprites disappeared", and it is worse than the hotlinking it replaced. The bug
-- this project exists to prevent is a confident wrong number rather than a crash, and a roster that
-- silently drops the people in it is the same failure wearing different clothes.
--
-- Registered with NULL bytes on purpose. That is the state the route redirects to Nexon for, so
-- every one of these resolves immediately (exactly as it did before V53) and gains its own bytes
-- when the daily refresh next reaches it. Backfilling the bytes is not something a migration can
-- do: they come from an outbound call.
--
-- sha256 in SQL rather than in Kotlin so the whole backfill is one statement. It must agree with
-- spriteKey(): lowercase hex of the sha256 of the URL's bytes, which is what encode(..., 'hex')
-- produces. There is a test that pins the two against each other.

INSERT INTO character_sprite (url_sha256, source_url)
SELECT DISTINCT encode(sha256(sprite_img_url::bytea), 'hex'), sprite_img_url
FROM characters
WHERE sprite_img_url IS NOT NULL
ON CONFLICT (url_sha256) DO NOTHING;

INSERT INTO character_sprite (url_sha256, source_url)
SELECT DISTINCT encode(sha256(sprite_img_url::bytea), 'hex'), sprite_img_url
FROM party_member
WHERE sprite_img_url IS NOT NULL
ON CONFLICT (url_sha256) DO NOTHING;
