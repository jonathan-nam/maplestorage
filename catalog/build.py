"""Generate everything an item needs from catalog/items.yaml.

    python catalog/build.py            regenerate
    python catalog/build.py --check    fail if anything is out of sync

An item used to be added by hand in four places: the vision template, the backend's
icon asset, the seed migration, and the vision_key mapping. Nothing checked that the
four agreed, and they didn't -- the parser emitted `kalos-token` while the lookup
matched `Kalos's Residual Determination`, so every count was dropped in silence.

The fix is not "remember to update all four". It is to make disagreement impossible:
one manifest, everything else generated or verified against it.

What this emits:

  backend/src/main/resources/db/migration/R__token_catalog.sql

Flyway *repeatable* migration, deliberately: it re-applies whenever its checksum
changes, so editing the manifest reseeds the catalog on the next boot with no new
versioned migration to write. Versioned migrations are immutable once applied; a seed
that changes is exactly what R__ is for.

What this verifies (and will not generate, because these are art):

  vision/app/cv/templates/token-<key>.png     the matcher's template
  backend/.../seed-assets/tokens/<key>.png    the icon the UI shows

Both must exist for every item, and be named from the key. Cutting a template from a
screenshot is what build_icons.py is for.
"""

import argparse
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "catalog" / "items.yaml"
TEMPLATES = ROOT / "vision" / "app" / "cv" / "templates"
ICONS = ROOT / "backend" / "src" / "main" / "resources" / "seed-assets" / "tokens"
SQL_OUT = ROOT / "backend" / "src" / "main" / "resources" / "db" / "migration" / "R__token_catalog.sql"

KEY_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789-")


CATEGORIES = {"REDEMPTION_TOKEN", "CONSUMABLE"}


def load() -> list[dict]:
    items = yaml.safe_load(MANIFEST.read_text())["items"]

    seen: set[str] = set()
    for it in items:
        key = it["key"]
        if set(key) - KEY_CHARS:
            sys.exit(f"key {key!r} must be lowercase kebab-case -- it becomes a filename and a DB value")
        if key in seen:
            sys.exit(f"duplicate key {key!r}")
        seen.add(key)

        if it.get("sort") is None:
            sys.exit(f"{key}: needs a sort -- it decides the order within its section")

        grp = it.get("group")
        if not grp:
            sys.exit(f"{key}: needs a group -- it decides which section of the UI it appears in")

        cat = it.get("category")
        if cat not in CATEGORIES:
            sys.exit(f"{key}: category must be one of {sorted(CATEGORIES)}, got {cat!r}")

        # A redemption token is a thing you collect N of and trade in. A consumable is a
        # thing you drink. Giving a consumable a threshold would have the UI report
        # "7 / 10 toward an Eternal set" on a potion -- confident and meaningless.
        has = "redeem_threshold" in it
        if cat == "REDEMPTION_TOKEN" and not has:
            sys.exit(f"{key}: a REDEMPTION_TOKEN needs a redeem_threshold")
        if cat == "CONSUMABLE" and has:
            sys.exit(f"{key}: a CONSUMABLE must not have a redeem_threshold -- you drink it")

        # What the token actually BUYS. The two sets do not overlap -- Kalos/Kaling/Adversary/
        # Star pieces make a Hat, Top, Bottom or Shoulder; Limbo/Baldrix pieces make a Cape,
        # Glove or Shoe -- so ten of one and ten of the other are not "twenty pieces". A
        # redeemable token without this is a token whose progress bar means nothing.
        slots = it.get("redeem_slots")
        if cat == "REDEMPTION_TOKEN" and not slots:
            sys.exit(f"{key}: a REDEMPTION_TOKEN needs redeem_slots -- what does it buy?")
        if cat != "REDEMPTION_TOKEN" and slots:
            sys.exit(f"{key}: only a REDEMPTION_TOKEN can have redeem_slots")
    return items


def check_art(items: list[dict]) -> list[str]:
    """Every item needs a template and an icon, both named from its key."""
    problems = []
    for it in items:
        key = it["key"]
        tpl = TEMPLATES / f"token-{key}.png"
        icon = ICONS / f"{key}.png"
        if not tpl.exists():
            problems.append(f"missing vision template: {tpl.relative_to(ROOT)}  (cut one with vision/app/cv/build_icons.py)")
        if not icon.exists():
            problems.append(f"missing icon asset:     {icon.relative_to(ROOT)}")

    # And nothing may exist that the manifest does not know about -- an orphan template
    # is an item the parser can detect but the app cannot name, which is the same class
    # of silent mismatch this file exists to prevent.
    known = {it["key"] for it in items}
    for tpl in sorted(TEMPLATES.glob("token-*.png")):
        key = tpl.stem.removeprefix("token-")
        if key not in known:
            problems.append(f"template not in the manifest: {tpl.relative_to(ROOT)}")
    return problems


def sql(items: list[dict]) -> str:
    def q(s: str) -> str:
        return "'" + s.replace("'", "''") + "'"

    rows = ",\n".join(
        f"    ({q(it['key'])}, {q(it['name'])}, {q(it['boss'])}, {q(it['key'] + '.png')}, "
        f"{q(it['group'])}, {int(it['sort'])})"
        for it in items
    )
    redeemable = [it for it in items if it["category"] == "REDEMPTION_TOKEN"]
    def arr(slots):
        return "ARRAY[" + ", ".join(q(x) for x in slots) + "]::TEXT[]"

    rules = ",\n".join(
        f"    ({q(it['key'])}, {int(it['redeem_threshold'])}, {arr(it['redeem_slots'])})"
        for it in redeemable
    )
    return f"""-- GENERATED FROM catalog/items.yaml -- DO NOT EDIT BY HAND.
-- Regenerate with:  python catalog/build.py
--
-- Repeatable (R__) on purpose: Flyway re-applies it whenever its checksum changes, so
-- adding an item to the manifest reseeds the catalog on the next boot. A versioned
-- migration is immutable once applied and is the wrong tool for a seed that evolves.
--
-- Upserts rather than replaces: token_catalog.id is referenced by character_token_count,
-- so deleting and reinserting would take every user's counts with it.

INSERT INTO token_catalog (id, vision_key, name, source_boss_name, icon_ref_key, item_group, sort_order)
SELECT
    COALESCE(existing.id, gen_random_uuid()),
    v.vision_key, v.name, v.boss, v.icon, v.item_group, v.sort_order
FROM (VALUES
{rows}
) AS v (vision_key, name, boss, icon, item_group, sort_order)
LEFT JOIN token_catalog existing ON existing.vision_key = v.vision_key
ON CONFLICT (vision_key) DO UPDATE SET
    name             = EXCLUDED.name,
    source_boss_name = EXCLUDED.source_boss_name,
    icon_ref_key     = EXCLUDED.icon_ref_key,
    item_group       = EXCLUDED.item_group,
    sort_order       = EXCLUDED.sort_order;

-- An item is redeemable if a rule exists for it -- there is no flag to keep in step with
-- the fields it governs. So a manifest entry that stops being a REDEMPTION_TOKEN must have
-- its rule removed, not merely have its threshold nulled.
DELETE FROM redemption_rule
WHERE item_id IN (
    SELECT id FROM token_catalog
    WHERE vision_key NOT IN ({", ".join(q(it["key"]) for it in redeemable) or "NULL"})
);

INSERT INTO redemption_rule (item_id, redeem_threshold, slot_group)
SELECT c.id, v.redeem_threshold, v.slot_group
FROM (VALUES
{rules}
) AS v (vision_key, redeem_threshold, slot_group)
JOIN token_catalog c ON c.vision_key = v.vision_key
ON CONFLICT (item_id) DO UPDATE SET
    redeem_threshold = EXCLUDED.redeem_threshold,
    slot_group       = EXCLUDED.slot_group;
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail if generated output is stale")
    args = ap.parse_args()

    items = load()

    problems = check_art(items)
    if problems:
        print("catalog is inconsistent with its art:\n", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        sys.exit(1)

    want = sql(items)
    have = SQL_OUT.read_text() if SQL_OUT.exists() else ""

    if args.check:
        if want != have:
            sys.exit(f"{SQL_OUT.relative_to(ROOT)} is stale -- run: python catalog/build.py")
        print(f"catalog is in sync ({len(items)} items)")
        return

    SQL_OUT.write_text(want)
    print(f"wrote {SQL_OUT.relative_to(ROOT)} ({len(items)} items)")


if __name__ == "__main__":
    main()
