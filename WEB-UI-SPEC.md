# Web UI Spec — MapleStory Companion

Frontend design spec, kept separate from `PLAN.md` since UI iteration moves faster than the backend/infra/data-model plan there.

## Design language

Craigslist-inspired minimalism, translated as **information density with zero decoration**, not "less stuff":

- Plain tables/rows instead of cards, text links instead of buttons where possible, borders instead of shadows
- No rounded corners, no gradients, no decorative icons
- Small, tight type (system font stack, ~13-14px base)
- Inline expansion instead of modals (e.g. "+ add character" expands a form in place, like Craigslist's reply/posting flow)
- Tables wherever data is tabular (item dashboard)

**True monochrome, dark-mode-first** (decided 2026-07-06, supersedes an earlier open question about keeping some color): near-black background, light grey/white text, dark grey borders as the only structural element. Status is conveyed through words, weight, and italics — not color. **Text-only for now, with one exception**: item icon crops are now a real stored asset (`iconRefKey`, uploaded per catalog entry — see `PLAN.md`'s "Item catalog & icon references") used to build the vision-matching prompt, but whether the Items page itself should *render* those icons (color, like character sprites) or stay text-only is an open question — see below. Character sprite thumbnails (Characters page) are the one piece of full-color content shipped from the start.

## Global layout

Plain header, app name as a text link (no logo image), thin bottom border, plain nav links:

```
MapleStory Companion          Upload | Characters | Items          [user email ▾]
───────────────────────────────────────────────────────────────────────────────
```

No hero sections, no sidebar. Upload is the landing page after login.

## Page: Upload (the main event)

Covers the flow: finish bossing on one character, snip the inventory screen, drag it in.

**Layout**: one large dashed-border dropzone taking most of the viewport, plain instruction text inside (`Drag screenshots here, or click to browse`), also clickable to open a file picker.

**On drop**, each file becomes a compact row appended below the dropzone — closer to an email inbox line than a card:

```
[thumb]  inventory-snip.png        Detecting…
[thumb]  weird-crop.png            Detecting…
```

Rows update in place as parsing resolves:

```
[thumb]  inventory-snip.png      Inventory — 7 tokens read, Bubbling          [change]
[thumb]  weird-crop.png          Unrecognized — needs review                  [change] [retry]
```

- `[change]` expands an inline panel below the row (not a modal): override detected type, override character, trigger re-parse.
- Rows resolving to the same character auto-group visually (thin rule + character sub-header), so a multi-character bossing marathon reads as clusters, not a flat list.
- Below the current batch, a collapsed running log of past uploads (`Today`, `Yesterday`, …) in the same row format — an archive, not a separate history page.

This single page covers both single-image and bulk-upload milestones from `PLAN.md` (M4/M5) — no separate "review screen" route; the live-updating row list *is* the review screen.

## Page: Characters

**Tile grid, not a table** (revised 2026-07-08) — modeled on MapleStory's own character-selection screen (see `reference-images/character selection screen.png`): each character is a tile with its sprite, a bordered name-plate (name + level, echoing the game's own plate), job, and a small **mini-inventory strip** of icon+quantity for that character's highest-priority items (e.g. tokens closest to a redemption threshold, low-stock potions — exact selection rule still open, see below):

```
+-------------------+   +-------------------+   +-------------------+
|     [sprite]      |   |     [sprite]       |   |     [sprite]      |
|-------------------|   |-------------------|   |-------------------|
| Bubbling  Lv.285  |   | Squishy   Lv.271  |   | Nightshade Lv.299 |
| Hoyoung           |   | Bow Master        |   | Hero              |
|-------------------|   |-------------------|   |-------------------|
| [icon 7][icon 12] |   | [icon 1][icon 45] |   | [icon 10][icon 5] |
| [icon 2]          |   |                   |   | [icon 3]          |
|-------------------|   |-------------------|   |-------------------|
| updated 2hr ago   |   | updated 3d ago    |   | updated 5d ago    |
| [edit][refresh]   |   | [edit][refresh]   |   | [edit][refresh]   |
| [delete]          |   | [delete]          |   | [delete]          |
+-------------------+   +-------------------+   +-------------------+
```

`+ add character` still expands an inline form — **name only** — the same as before; submitting it triggers the Nexon avatar-lookup (see `PLAN.md`) server-side to auto-populate level/job/sprite, with a manual level field as the fallback if that lookup finds nothing. `[refresh]` re-runs the lookup on demand.

**Clicking anywhere on a tile (the sprite, plate, or mini-inventory) navigates to that character's detail page** — a full per-character inventory table (all tracked items, grouped by category, with quantities), not just the mini-inventory preview. The `[edit]`/`[refresh]`/`[delete]` actions sit outside that click target so they don't trigger navigation.

Both the character sprite and the mini-inventory icons are full color — the same deliberate exception to the text-only/monochrome rule as before (real content the user asked to see, not decorative chrome), inside an otherwise plain-bordered, no-shadow, no-rounded-corner tile.

**Open**: is this tile grid meant to replace Upload as the post-login landing page, or does Upload stay the landing page with Characters reached via nav as before? Not yet decided.

## Page: Character detail (new)

Reached by clicking a character tile. Header: sprite (larger, ~96px) + name + level + job, in the same plain-bordered style as the tile. Below it, a single table of every item tracked for that character, grouped by the real in-game tabs (`Equip | Use | Etc. | Set-up | Cash | Dec.`) with an icon, name, and quantity column — `redemptionTracked` rows carry their "collect N →" badge inline within whichever tab they belong to, same as the Items page. The same category-grouped table pattern, just scoped to one character instead of aggregated across all of them. A `« back to characters` link returns to the grid.

## Page: Items

Plain table grouped by category — the **real in-game inventory tabs** (`Equip | Use | Etc. | Set-up | Cash | Dec.`, per `reference-images/inventory sample.png`), not an app-invented scheme (revised 2026-07-08). Only tabs with at least one tracked item render a header — an empty `Dec.` section just doesn't show up. `+ add item` is a text link that expands an inline form — name, category select, an icon-crop upload.

`redemptionTracked` items (the Eternal tokens) aren't a separate tab — they show up grouped under `Etc.` like any other item, with an inline "collect N →" badge and progress column on just that row, rather than a wholly separate table shape:

```
+ add item

USE
Item                           Total
White Potion                   340
Wealth Acquisition Potion      12

ETC
Item                           Total   
Distorted Ambition             23      → collect 10: 2 sets + 3
Kalos's Residual Determination 21      → collect 10: 2 sets + 1
Mysterious Fragment            87
```

Click a row to expand inline showing the per-character breakdown with freshness labels (e.g. `Bubbling: 8, as of today`). Item catalog entries are added once (name + category + icon crop) and reused forever after — same pattern as adding a character — see `PLAN.md`'s "Item catalog & icon references".

## Open questions (unresolved)

- Auto-group same-session screenshots by upload-batch timestamp (simplest) vs. letting the user manually tag "this is a bossing session for character X" before dropping — relevant to the no-HUD-visible fallback case in `PLAN.md`.
- Should the Items page render the item icon crop as a thumbnail (color, like character sprites) or stay text-only-with-name? The icon image exists either way (needed for the vision prompt), so this is purely a UI call, not a data-availability question.

## Prototype status

A throwaway, dependency-free HTML/CSS/JS prototype of the Upload page lives at `prototypes/web-ui/` — real drag-and-drop via native browser APIs, fake/simulated classification (no backend), used to validate layout and interaction feel before the real Next.js build (`frontend/`, per `PLAN.md` M0).
