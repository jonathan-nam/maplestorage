# Web UI Spec — MapleStory Companion

Frontend design spec, kept separate from `PLAN.md` since UI iteration moves faster than the backend/infra/data-model plan there.

## Design language

Craigslist-inspired minimalism, translated as **information density with zero decoration**, not "less stuff":

- Plain tables/rows instead of cards, text links instead of buttons where possible, borders instead of shadows
- No rounded corners, no gradients, no decorative icons
- Small, tight type (system font stack, ~13-14px base)
- Inline expansion instead of modals (e.g. "+ add character" expands a form in place, like Craigslist's reply/posting flow)
- Tables wherever data is tabular (boss dashboard, token dashboard)

**True monochrome, dark-mode-first** (decided 2026-07-06, supersedes an earlier open question about keeping some color): near-black background, light grey/white text, dark grey borders as the only structural element. Status is conveyed through words, weight, and italics — not color. **Text-only for now, with one exception**: no token/boss icon art yet — deferred until M5's icon-matching spike needs real icon crops, at which point this monochrome rule should be revisited for at least those icons. Character sprite thumbnails (Characters page) are the one piece of full-color content shipped from the start — see below.

## Global layout

Plain header, app name as a text link (no logo image), thin bottom border, plain nav links:

```
MapleStory Companion          Upload | Characters | Tokens          [user email ▾]
────────────────────────────────────────────────────────────────────────────────
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

This single page covers both single-image and bulk-upload milestones from `PLAN.md` (M3/M4) — no separate "review screen" route; the live-updating row list *is* the review screen.

## Page: Characters

Plain table, `+ add character` as a text link that expands an inline form — **name only**. Submitting it triggers the Nexon avatar-lookup (see `PLAN.md`) server-side, which auto-populates level/job/sprite; a manual level field only appears as a fallback if that lookup can't find the name:

```
+ add character

        Name       Level   Job          Last updated
[img]   Bubbling   285     Hoyoung      2 hours ago        [edit] [delete] [refresh]
[img]   Squishy    271     Bow Master   3 days ago         [edit] [delete] [refresh]
```

`[refresh]` re-runs the Nexon lookup on demand (no automatic polling — see `PLAN.md`). The character sprite thumbnail is the one deliberate exception to the text-only/no-icons rule above: it's the actual content the user asked to see, not decorative UI chrome, so it renders as-is (full color) inside an otherwise monochrome row.

## Page: Tokens

```
Token                          Redeems for              Total   Progress
Distorted Ambition             Shoes/Gloves/Cape         23      2 sets + 3
Blissful Fantasy Shard         Hat/Top/Bottom/Shoulder   14      1 set + 4
```

Click a row to expand inline showing the per-character breakdown with freshness labels (e.g. `Bubbling: 8, as of today`).

## Open questions (unresolved)

- Auto-group same-session screenshots by upload-batch timestamp (simplest) vs. letting the user manually tag "this is a bossing session for character X" before dropping — relevant to the no-HUD-visible fallback case in `PLAN.md`.

## Prototype status

A throwaway, dependency-free HTML/CSS/JS prototype of the Upload page lives at `prototypes/web-ui/` — real drag-and-drop via native browser APIs, fake/simulated classification (no backend), used to validate layout and interaction feel before the real Next.js build (`frontend/`, per `PLAN.md` M0).
