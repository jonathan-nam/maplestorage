# Web UI Spec — MapleStorage

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
MapleStorage                  Upload | Characters | Items          [user email ▾]
───────────────────────────────────────────────────────────────────────────────
```

No hero sections, no sidebar *inside the authenticated app* — Upload is the landing page after login. The one exception is the pre-login marketing/explainer page (see below), which deliberately breaks from this for a different reason.

## Page: Landing (pre-login, new 2026-07-08)

**Why this page exists**: repeated attempts to explain the core upload → extract-inventory loop *inside* the Upload page (an intro sentence, then more detail added twice) kept feeling insufficient — the diagnosis is that the Craigslist-minimalist density that makes the working tool good is the wrong mode for teaching the concept to someone who's never seen it. Rather than keep cramming explanation into the functional page, a separate pre-login page carries that job instead, freeing the authenticated Upload page to stay minimal.

**Layout**: still monochrome (no color introduced purely for decoration — that stays a firm rule), but more spacious/hero-style than the rest of the app: a centered hero (one-sentence value prop + a `Sign in to get started` CTA — styled as a plain bordered box, not a filled/gradient button, keeping the "borders instead of shadows" rule even here), a plain 3-step "how it works" row, and a concrete before/after example — the actual `untradeables sample.png` reference screenshot next to a table of what gets extracted from it.

**The before/after example uses real, previously-validated data, not fabricated numbers**: the extracted-item counts shown (Distorted Ambition: 10, Blissful Fantasy Shard: 6, Echo of Ancient Resolve: 6, Ferocious Beast Entanglement Ring: 9, Kalos's Residual Determination: 21) are the actual manually-verified counts from the earliest vision-feasibility check in this project (see `PLAN.md`), not a mockup — consistent with this project's preference for validating claims rather than asserting them.

**"See it in action"**: a text link below the example replays the extraction with the same `Detecting…` → resolved-rows pacing used on the real Upload page, so a first-time visitor can watch the input → output transformation happen rather than just read a static table. This is the interactive complement to the static before/after image, addressing the same "explain the core loop" problem from a different angle — showing it happening, not just describing it.

## Page: Upload (the main event)

Covers the flow: finish bossing on one character, snip the inventory screen, drag it in.

**Two friction points identified (2026-07-08)**, both addressed below: (1) new users don't understand how the upload/character-matching relationship works, and (2) the average user may not know how to take a screenshot at all — this isn't a niche gap, it's a real onboarding blocker.

**Layout**: a plain instructional line at the top explaining the flow ("drag a screenshot in, we'll auto-detect the character"), then a two-column layout — a narrow **character pin panel** on the left (sprite + name per character, click to pin one; a `+ add item`-style `+ add character` link at the bottom), and the dropzone + upload row list on the right, same width as before.

**Auto-detect via HUD is the primary path, pinning is an optional convenience, not a required step** (revised 2026-07-08, after considering the failure mode directly): pinning a character was originally the encouraged first step, but that makes manual selection error a real risk — forget to switch the pin between characters, or misclick, and a screenshot could get silently recorded under the wrong character. Since the HUD is read from every screenshot regardless of whether one is pinned, a pin is treated as a claim to verify, not a fact to trust: if the detected character doesn't match the pin, the row shows a **mismatch** status (`Mismatch — pinned to Bubbling, but this screenshot looks like Squishy`) instead of silently accepting either source, with `[change]` defaulting to the HUD-detected character as the one-click fix. Pinning still changes the dropzone's label (`Drag {name}'s screenshot here…`) and skips the guessing UI for the common case, so it's still a real convenience — just not one that's trusted blindly.

**Screenshot-literacy help**: a `Show me how` link next to the intro copy expands an OS-detected instruction panel (Windows: Win+Shift+S then paste directly into the page; Mac: Cmd+Shift+4, which saves a file, then drag it in). This is deliberately kept as a plain expandable text panel, not a modal or video — consistent with the rest of the design language — but it's a real gap being papered over rather than solved; see the note below on further options.

**Paste-to-upload**: the page listens for a clipboard paste (Ctrl/Cmd+V) anywhere on it and treats a pasted image exactly like a dropped file. This matters specifically because Windows' native screenshot tool (Win+Shift+S) copies to the clipboard, not to a file — pairing it with paste support means a user never has to save a file or find it in a folder at all, just screenshot-then-paste, a flow already familiar to anyone who's shared a screenshot in Discord (which this app's audience near-certainly already uses).

**On drop (or paste)**, each file becomes a compact row appended below the dropzone — closer to an email inbox line than a card:

```
[thumb]  inventory-snip.png        Detecting…
[thumb]  weird-crop.png            Detecting…
```

Rows update in place as parsing resolves:

```
[thumb]  inventory-snip.png      Inventory — 7 tokens read, Bubbling          [change]
[thumb]  weird-crop.png          Unrecognized — needs review                  [change] [retry]
[thumb]  new-char-snip.png       New character detected: Nightwolf — not in your roster    [add Nightwolf] [pick existing character] [ignore]
```

- `[change]` expands an inline panel below the row (not a modal): override detected type, override character, trigger re-parse.
- **A detected name that matches no existing character never auto-creates one** (added 2026-07-08) — same reasoning as rejecting auto-discovered item catalog entries: a single unverified vision read becoming a permanent roster entry, with nothing to cross-check it against, is too risky (a misread, or someone uploading a screenshot that isn't even their own character). Instead the row offers `[add {name}]` (one click, runs the same Nexon-lookup enrichment manual add does, then re-attributes the screenshot), `[pick existing character]` (covers the "new" name actually being a misread of someone already tracked), or `[ignore]`.
- Rows resolving to the same character auto-group visually (thin rule + character sub-header), so a multi-character bossing marathon reads as clusters, not a flat list.
- Below the current batch, a collapsed running log of past uploads (`Today`, `Yesterday`, …) in the same row format — an archive, not a separate history page.

This single page covers both single-image and bulk-upload milestones from `PLAN.md` (M4/M5) — no separate "review screen" route; the live-updating row list *is* the review screen.

**Tooltip capture (hover-capture, added 2026-07-08, generalized 2026-07-09)**: some item data only ever renders in the per-item hover tooltip, for two different reasons — (1) expiration dates: a per-instance timestamp signaled only by a small clock badge on the icon in the plain grid (see `reference-images/expiring.png`), and (2) icon-ambiguous items: items this user tracks that look identical to another tracked item, so the grid pass can't safely read a count for them at all (see `PLAN.md`'s "Item catalog & icon references" — `identifiableByIcon=false`). Rather than a separate screenshot per item, a `[capture item details]` text link near the dropzone (same plain-link style as the rest of the page, renamed 2026-07-09 from `[record expiring items]` since it's no longer expiration-only) starts a browser screen-capture recording of a mouse pass over the inventory — see `PLAN.md`'s "Tooltip capture (video hover-capture pipeline)" for the full client-side keyframe-extraction design.

- **Requires a pinned character first** — unlike normal drag-drop, a hover-capture session has no per-frame HUD to cross-check against, so it's inherently single-character. If none is pinned when `[capture item details]` is clicked, a plain inline prompt asks the user to pick one before recording can start.
- Clicking it triggers the browser's own capture-permission prompt (an OS-level window/screen picker — MapleStory must be running windowed or borderless-windowed, not exclusive fullscreen, to be selectable there), then the link becomes a plain status line: `Recording… move naturally across each item, then click to stop`. Deliberately not "pause on each item" — the sampling rate is tuned to catch a natural glide, not a stop-and-wait.
- After stopping, the extracted keyframe candidates resolve through the **same row-list UI** as normal uploads, just labeled by what kind of tooltip read they resolved to:
  ```
  [thumb]  frame-03.png    Expiration — Kalos's Residual Determination, expires 9/9/2026    [change]
  [thumb]  frame-05.png    Wealth Acquisition Potion (variant B) — qty 12                    [change]
  [thumb]  frame-07.png    Expiration — tooltip not detected, discarded
  ```
  The second row is the icon-ambiguous case — both identity and quantity come from this single frame, since an `identifiableByIcon=false` item is never touched by the grid pass at all, so this is its *only* source of data, not a supplement.
- A discarded frame isn't an error state — it's an expected false-positive from the client-side stability heuristic guessing a frame was a settled tooltip when it wasn't. No `[retry]` needed for these; the surviving rows already cover every item the pass actually captured.

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

**Expiration annotation (added 2026-07-08)**: a row with `expiresAt` set gets a plain "expires in N days" text annotation next to its quantity — text only, no color/urgency-coding, consistent with the monochrome status-via-weight/italics convention used elsewhere. A row with `expirationNeedsReview=true` (conflicting dates detected for the same item) shows a `[resolve]` link instead, mirroring how `MISMATCH` rows are handled on Upload.

**Icon-ambiguous item annotation (added 2026-07-09)**: a row for an item flagged `identifiableByIcon=false` (see `PLAN.md`'s "Item catalog & icon references") shows a plain `via hover-capture` annotation next to its freshness label instead of the usual as-of-date. This item's count is never touched by a normal screenshot upload, so its freshness is tied to the last hover-capture pass specifically — worth stating plainly rather than letting the row look like an ordinary one that simply hasn't been re-scanned recently.

## Page: Items

Plain table grouped by category — the **real in-game inventory tabs** (`Equip | Use | Etc. | Set-up | Cash | Dec.`, per `reference-images/inventory sample.png`), not an app-invented scheme (revised 2026-07-08). Only tabs with at least one tracked item render a header — an empty `Dec.` section just doesn't show up. `+ add item` is a text link that expands an inline form — name, category select, an icon-crop upload.

**Not empty on first login (added 2026-07-09)**: a new user's `Etc.` section already shows the default Grandis token set (see `PLAN.md`'s "New user default tracking") with a plain `not yet scanned` label in place of a quantity — the page has real, familiar rows from the moment someone signs in, rather than a blank state with nothing to anchor to before their first upload.

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

**Expiration annotation (added 2026-07-08)**: same as Character detail — a per-character breakdown row with `expiresAt` set gets a plain "expires in N days" annotation (text only, no color-coding); `expirationNeedsReview` rows show a `[resolve]` link instead. See `PLAN.md`'s "Tooltip capture (video hover-capture pipeline)" for how these values are captured.

**Icon-ambiguous item annotation (added 2026-07-09)**: same as Character detail — a `identifiableByIcon=false` item shows `via hover-capture` next to its freshness label instead of an as-of-date, since it's never updated by a normal screenshot upload. `+ add item` also runs the icon-collision check at save time (see `PLAN.md`'s "Item catalog & icon references") — if the new item's icon matches one already tracked, the confirmation shows a plain statement, not a warning: `{item} looks the same as {other item} you already track — both will be updated via hover-capture instead of screenshots`.

**Discovery worklist (added 2026-07-09)**: a quiet text line below the category tables, only rendered once there's something to show — `14 unidentified items spotted — browse` — for icons seen in uploads that don't match anything currently tracked (see `PLAN.md`'s `unmatched_items`/`UnidentifiedItemSighting`). Deliberately not a badge, banner, or anything competing visually with the main table — this is opportunistic, not urgent. Expanding it lists one row per apparent item (sightings already grouped), each with its cropped thumbnail and a rough total:

```
14 unidentified items spotted — browse

[thumb]  spotted 12× across your uploads    ~23 total, possibly Etc    [identify]
[thumb]  spotted 3× across your uploads     ~5 total, possibly Use     [identify]
```

`[identify]` expands the same inline add-item search form used by `+ add item`, with the crop shown alongside search results as a visual reference rather than pre-filling a guessed name — the model never claims to know what an unmatched icon *is*, only that it's there (see `likelyCategory` in `PLAN.md`, a display hint, not a claim). Confirming a match immediately backfills quantities already captured across every character the item was spotted on — no re-upload needed — and the item joins the normal tracked tables above on the next render.

## Open questions (unresolved)

- ~~Auto-group same-session screenshots by upload-batch timestamp vs. letting the user manually tag "this is a bossing session for character X" before dropping~~ — resolved 2026-07-08: the Upload page's character selector *is* the manual-tag option, addressing this and the no-HUD-visible fallback case together.
- Should the Items page render the item icon crop as a thumbnail (color, like character sprites) or stay text-only-with-name? The icon image exists either way (needed for the vision prompt), so this is purely a UI call, not a data-availability question.
- **Screenshot-literacy gap beyond in-app instructions (2026-07-08)**: the OS-detected help panel and paste-to-upload support reduce friction but don't eliminate the underlying problem — plenty of users still won't know to look for a "Show me how" link, or won't have a MapleStory window arranged in a way that makes a clean screenshot easy. Bigger, not-yet-built options worth weighing later: (a) a small companion capture tool (browser extension or lightweight desktop utility) that captures the game window and uploads directly, skipping manual screenshot/save/drag entirely — real fix, real engineering investment; (b) accepting a phone photo of the screen as a fallback input, which requires zero screenshot literacy at all but likely hurts vision-parsing accuracy (glare, angle, moiré) and hasn't been tested. Neither is built — worth validating whether screenshot literacy is actually a significant drop-off point with real users before investing in either.
- **What counts as "expires soon" (2026-07-08)**: the Items/Character-detail "expires in N days" annotation doesn't yet have a threshold for extra emphasis (3 days? 7 days?) — not deciding now, flag for validation once real expiring-item data exists.

## Prototype status

A throwaway, dependency-free HTML/CSS/JS prototype lives at `prototypes/web-ui/` — no backend, fake/simulated data throughout, used to validate layout and interaction feel before the real Next.js build (`frontend/`, per `PLAN.md` M0). Covers five pages: Landing (pre-login explainer with a real before/after example and an interactive "see it in action" replay), Upload (real drag-and-drop, HUD auto-detect + optional pin with mismatch safety net, new-character one-click-confirm), Characters (tile grid + add-character flow), Character detail, and Items (catalog search/add flow + the aggregate dashboard with per-item totals, redemption progress, and click-to-expand per-character breakdowns).
