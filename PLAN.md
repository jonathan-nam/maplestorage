# MapleStory Companion App — Inventory & Token Tracker

## Context

You're a long-time GMS MapleStory player running 15+ characters, and lack any unified view of how much of each item — Eternal-set boss tokens, consumable potions, enhancement scrolls, Etc-tab drop materials — you've accumulated *across* all characters. Today that means logging into every character individually — this app replaces that with screenshot uploads parsed by a vision-capable LLM into a unified item dashboard. Future scope also includes more advanced processing (e.g. video uploads to track item expirations) — the backend needs to be built assuming more processing-heavy features arrive over time, not just today's one.

GMS has no official Nexon data API (confirmed — only KMS/TMS/MSEA do), so screenshot vision-parsing is the only viable data source, not a shortcut around one. This project started fully greenfield.

**Scope note (pivoted 2026-07-07)**: this project originally also tracked weekly/monthly/daily boss-clear status per character — that's been dropped, inventory/item tracking is the entire scope. It also originally covered *only* the 7 untradeable Eternal-set boss tokens; that's since broadened (same day) to a general, user-curated item catalog spanning consumables (potions, scrolls) and Etc-tab drop items too, not just character-bound "untradeable" items — see "Item catalog & icon references" below. Boss names still appear in the token list only as origin/flavor for token-category items, not as something the app tracks independently.

**Stack decision**: you're a mobile engineer with strong Kotlin/Compose expertise, not a JS/TS background. The backend and future native iOS/Android apps should play to that strength via Kotlin Multiplatform. The web frontend, however, stays on Next.js/React rather than Compose Multiplatform for Web, because Compose Web is still Beta and — critically — **does not yet officially support drag-and-drop**, which lands directly on this app's bulk-upload feature (dragging 15+ screenshots at once). Splitting the stack this way puts each piece on its strongest footing: Kotlin where it's your expertise and where Kotlin Multiplatform's shared-code story is real (backend ↔ future mobile), and the most battle-tested option (Next.js) for the web layer you're shipping first and that needs mature file-upload/drag-and-drop UX.

You're also explicitly using this project to build resume-relevant AWS skills, which is why several choices below favor the more resume-weighty AWS-native option over a simpler/cheaper alternative, with real recurring cost (~$25-45/month for backend infra) accepted deliberately.

Sample screenshots in `reference-images/` were used to ground this plan:
- `untradeables sample.png` — a plain inventory grid (icons + stack-count numbers, no item names visible)
- `untradebles description sample.png` — hover tooltips confirming the exact reward template: *"[flavor text]. Collect 10 and double-click to obtain one [slots] from the Eternal set."*
- `inventory sample.png` — the actual in-game inventory panel, showing the real tab structure (`Equip | Use | Etc. | Set-up | Cash | Dec.`) that `ItemCatalog.category` now mirrors directly (see "Item catalog & icon references" below)
- `character selection screen.png` — the in-game character-select screen (sprite + name-plate per character), which the Characters page's tile-grid layout is modeled on (see `WEB-UI-SPEC.md`)

Confirmed token catalog so far (Grandis-tier bosses only — this is the current top gear tier):
| Boss | Token | Redeems for |
|---|---|---|
| Limbo | Distorted Ambition | Shoes, Gloves, or Cape |
| Malefic Star | Blissful Fantasy Shard | Hat, Top, Bottom, or Shoulder Accessory |
| First Adversary | Echo of Ancient Resolve | Hat, Top, Bottom, or Shoulder Accessory |
| Kaling | Ferocious Beast Entanglement Ring | Hat, Top, Bottom, or Shoulder Accessory |
| Kalos the Guardian | Kalos's Residual Determination | Hat, Top, Bottom, or Shoulder Accessory |
| Baldrix | Trace of Eternal Loyalty (+ bonus "Eternal Armor of Oaths Box" in Hard) | Shoe, Glove, or Cape |
| Akechi Mitsuhide | *(unconfirmed exact name — confirmed Grandis/Eternal-relevant by user)* | TBD |

Confirmed **not** included: Chosen Seren (no longer drops Eternal material — drops "Jet Black" accessories instead). Black Mage and the pre-Grandis weekly bosses (Lotus, Damien, Guardian Angel Slime, Lucid, Will, Gloom, Verus Hilla, Darknell) belong to a separate older reward chain (Genesis Weapon traces), not Eternal — excluded from the token catalog entirely.

**Broadened scope — item catalog beyond tokens (2026-07-07)**: alongside the 7 Eternal-set tokens above, the catalog should also cover consumable potions, scrolls, and Etc-tab drop items — categories the user actually wants tracked, not just untradeable items. Rather than requiring every item to be hand-curated (which would restrict users to whatever's been manually added), the catalog is backed by a real external item database — see "Item catalog & icon references" below for how this changes the data model and the vision-matching approach.

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Backend | **Ktor (Kotlin)** | JetBrains' lightweight, coroutine-native server framework — plays directly to your Kotlin expertise, and its HTTP client half (Ktor Client) is genuinely multiplatform, reusable as-is in a future Android/iOS shared module. |
| Backend hosting | **AWS ECS on Fargate**, behind an **Application Load Balancer**, inside a **VPC** | Chosen deliberately over the simpler AWS App Runner: this is where the resume-relevant depth actually lives — task definitions, security groups, ALB target groups, IAM roles. Ktor's Docker image is pushed to **Amazon ECR** and deployed as an ECS service. Real fixed cost to know about: ~$25-30/month baseline (mostly the ALB) even at hobby traffic. |
| Web frontend | **Next.js 15 (App Router) + TypeScript**, hosted on **Vercel** | Now a pure API client of the Ktor backend (no shared server code with it) — chosen over Compose Multiplatform for Web specifically because Compose Web is Beta and lacks official drag-and-drop support, which this app's bulk-upload screen needs on day one. Left on Vercel rather than moved to AWS — the "full AWS stack" scope was backend/storage/database, not frontend hosting. |
| Database | **Amazon RDS for PostgreSQL** (`db.t3.micro`) | Chosen over Aurora Serverless v2 specifically for cost: Aurora has a hard ~$43-45/month floor with no free tier, while RDS is free for 12 months (~$15/month after) and is arguably the more universally-expected AWS database skill. Sits in the same VPC as the ECS tasks, in a private subnet not exposed to the public internet — only the ALB faces outward. |
| DB access (Kotlin) | **Exposed** (JetBrains' Kotlin SQL library) + **Flyway** for migrations | Kotlin-native equivalent of Prisma's query layer — unaffected by the RDS vs. Neon choice, since both are plain Postgres over JDBC. Note the one real DX gap: Prisma bundles migrations, Exposed doesn't — Flyway (plain versioned `.sql` files) fills that gap, just a bit more manual. |
| Auth | **Clerk** | Free to 10k MAU. Web uses Clerk's Next.js SDK; a future mobile app uses Clerk's native Android SDK (GA) / iOS SDK (v1). Ktor needs **no Clerk-specific SDK at all** — Clerk issues standard JWTs verifiable via its public JWKS endpoint, which plugs directly into Ktor's built-in `Authentication` + `jwt {}` provider. |
| Object storage | **Amazon S3** | Chosen over Cloudflare R2 specifically for AWS-native resume value (S3 + IAM policies is close to a required skill) — the tradeoff being S3's egress isn't free like R2's, though at this app's small screenshot volume the dollar difference is negligible. Storage is kept behind a thin abstraction either way, so this stays swappable. |
| Vision LLM | **Claude API**, called via **Ktor Client** (plain HTTP) | No official Kotlin SDK exists, so call the REST API directly with a forced tool-use JSON schema; validate the response with `kotlinx.serialization` before any DB write. Reference the model via config/env, not hardcoded, so it's easy to bump versions. |
| Mobile (future) | **Kotlin Multiplatform + Compose Multiplatform** (native iOS/Android, not Web) | The real payoff of the Kotlin-first choice — a shared Kotlin module (data models, Ktor Client-based API client, business logic) usable by both the backend (JVM target) and native mobile apps, not just similar code in two languages. |

Two deployables instead of one (Ktor service + Next.js site) means CORS configuration and running two dev servers locally. Going full-AWS on the backend adds real infrastructure surface beyond that: a VPC with public/private subnets, security groups, an ECR repo, and IAM roles all need to exist before the first deploy — provision these via an IaC tool (**Terraform** is the pragmatic default, being cloud-agnostic and the most broadly recognized on resumes) rather than clicking through the AWS console by hand. This is real added complexity over a simpler PaaS's git-push simplicity — accepted deliberately here since building that infrastructure knowledge is the point.

Compress screenshots client-side (canvas resize to ~1600px wide, JPEG/WebP q≈80) before upload — the samples are 2.8-3.2MB PNGs, far larger than needed.

## Project structure

A dedicated monorepo (this repo), not loose files in a general workspace:

```
maplestory-companion/
  backend/        # Ktor project (Exposed, Flyway, Dockerfile)
  frontend/       # Next.js project (Vercel deploys from this subdir)
  infra/          # Terraform: VPC, ECS, ALB, ECR, RDS
  reference-images/   # the sample screenshots used to ground prompt/schema design
```

## Data model (Exposed table objects, illustrative)

```
Users             (id [=Clerk userId], email, createdAt)
Characters        (id, userId FK, name, level, jobName?, worldName?, spriteImgUrl?,
                    spriteRefreshedAt?, createdAt, updatedAt)
                  // level/jobName/worldName/spriteImgUrl are auto-populated at creation time
                  // via the Nexon character lookup (see below) — manual entry is the fallback
                  // when a name can't be found there, not the primary source

ItemCatalog       (id, name, category: EQUIP|USE|ETC|SETUP|CASH|DEC,
                    sourceItemId?: int, iconRefKey?: string, needsCategoryReview: boolean,
                    redemptionTracked: boolean, sourceBossName?, slotGroup?: string[],
                    redeemThreshold?: int, bonusItemName?, confirmed: boolean)
                  // category mirrors the real in-game inventory tabs 1:1 (see "Item catalog
                  // & icon references" below) instead of an app-invented scheme; exactly one
                  // of sourceItemId (imported from maplestory.io, icon fetched live from
                  // there at prompt-build time) or iconRefKey (S3 key, for manually-added
                  // items with no maplestory.io match) is set; needsCategoryReview=true when
                  // maplestory.io returned an unclassified "Unknown" category, requiring a
                  // human to assign the real category before the item is fully usable;
                  // redemptionTracked=true marks an item as a "collect N, redeem for X" token
                  // (the 7 known Eternal tokens, seeded manually with confirmed=false for
                  // Akechi, since none are reliably in maplestory.io yet) — this is an
                  // orthogonal flag, not a category, since in-game these are just ordinary
                  // Etc-tab items; redemption fields (sourceBossName/slotGroup/redeemThreshold/
                  // bonusItemName) only apply when redemptionTracked=true and stay null otherwise

CharacterItemCount    (characterId FK, itemCatalogId FK, quantity: int,
                        capturedAt, sourceScreenshotId FK?)  // unique (characterId, itemCatalogId)

Screenshots       (id, userId, characterId?, type: INVENTORY|UNRECOGNIZED,
                    storageKey, uploadedAt, parseStatus: PENDING|SUCCESS|FAILED|NEEDS_REVIEW,
                    rawModelResponse: jsonb, detectedCharacterName?, detectedLevel?)
```

`CharacterItemCount` is a **latest-snapshot upsert**, not an append-only history log — the dashboard only needs "what's true right now." Counts don't invalidate on a timer, so freshness is just an "as of [date]" label per contributing character, not a stale/fresh binary.

**Noted for later (not in scope now)**: a 2026-07-08 survey of inventory-management tools (Sortly, general small-business WMS, game-collection trackers) turned up two real gaps against this plan — every other common feature (centralized cross-location view, real taxonomy, low-manual-entry capture, freshness signals) this app already does or has a deliberate reason not to:

- **Low-stock / redemption-proximity alerting**: an optional per-`ItemCatalog`-row threshold (e.g. "notify below N" for consumables, "notify at N-1 of redeemThreshold" for tokens) that triggers a notification rather than requiring the user to go check.
- **Proactive data-freshness discipline**: today's "as of [date]" freshness label (above) is passive — you only see it if you go look at that character. A more disciplined version would actively nudge (e.g. "Bubbling hasn't been re-scanned in 2 weeks") instead of relying on the user to notice staleness themselves.

## Character creation & the Nexon avatar lookup

**Default flow is manual-add-by-name, not screenshot-derived.** Adding a character means typing the in-game name; screenshots are only ever used afterward to *match* boss-clear/inventory data to an already-known character, never to create one. This was validated directly against a real endpoint during planning (2026-07-06):

- `GET https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na?type=world&id={worldId}&page_index=1&character_name={name}` — no API key required, filters to the named character (confirmed via `character_name=Kraane` returning `totalCount: 1`). Returns `level`, `jobName`, `worldID`, `exp`, and `characterImgURL`.
- `characterImgURL` points to `https://msavatar1.nexon.net/Character/{encoded}.png` — Nexon's own avatar-rendering CDN (the same one mapleranks proxies). Confirmed directly fetchable with no auth/hotlink-referrer restriction, returns a real ~96x96 character sprite PNG.
- This is an **undocumented endpoint the nexon.com website itself uses**, not the official versioned OpenAPI (which is KMS-only and requires a key) — treat it as unofficial and add a fallback path (manual level entry, no sprite) for when a name isn't found or the endpoint changes/breaks.
- Ktor calls this server-side when a character is added, storing `level`/`jobName`/`worldName`/`spriteImgUrl` directly on the `Characters` row. Re-fetch on demand (e.g. a "refresh" action) rather than on a schedule — gear/level changes don't need to be real-time here, screenshots remain the source of truth for item state.

## Item catalog & icon references

**Bulk-import backed, not hand-curated.** MapleStory has a finite item set, and the goal is to not restrict users to whatever's been manually added one at a time. `maplestory.io` (community-run, unofficial — same trust tier as the Nexon avatar lookup below) was validated live during planning (2026-07-08) as a real item database for GMS:

- `GET https://maplestory.io/api/GMS/{version}/item?searchFor={name}` — search by name, returns `id`, `name`, `desc`, and a `typeInfo` taxonomy (`overallCategory`: Equip/Use/Etc/Cash/Setup, plus finer-grained `category`/`subCategory`) that maps directly onto `ItemCatalog.category` — confirmed against the real in-game inventory tabs (`inventory sample.png`: Equip, Use, Etc., Set-up, Cash, Dec.), so `ItemCatalog.category` adopts these tab names directly rather than an app-invented scheme (see below).
- `GET https://maplestory.io/api/GMS/{version}/item/{id}/icon` — returns a real icon PNG for that item id, confirmed working on multiple items (a common potion, a Monster Park daily box).
- Confirmed solid for **established/older game content**: potions, monster-drop Etc materials, farming consumables (Wealth Acquisition Potion, Sunday's Growth Box, etc.) all came back fully categorized with working icons.
- Confirmed **patchy for the newest content** — the exact thing this app started with: only 2 of the 6 known Grandis-tier Eternal tokens are in the dataset at all (both with a placeholder `category: "Unknown"` — crawled but never classified), the other 4 aren't there even at adjacent item IDs. This isn't a clean version cutoff, just an incomplete community crawl of recent patches. Treat "newest boss-drop content" as **not reliably covered**, indefinitely, not just as a temporary gap.
- Confirmed **duplicate names across distinct item ids** happen (e.g. "Wealth Acquisition Potion" returned 3 different ids with identical name/description) — the add-item search UX must show the icon per candidate so the user can visually disambiguate, not assume name uniquely identifies an item.

**Add-item flow mirrors the Nexon character lookup** (live external call at add-time, not a batch ETL job): user types a name, Ktor calls maplestory.io's search endpoint server-side, returns candidates (name + category + icon) for the user to pick from. Selecting one creates an `ItemCatalog` row with `sourceItemId` set (icon fetched live from maplestory.io whenever needed — e.g. building a vision prompt — not re-hosted in our own S3). If the selected item came back `category: "Unknown"`, set `needsCategoryReview=true` and require the user to pick the real category by hand before the row is usable. If search finds nothing (the confirmed newest-content gap), fall back to full manual entry: name + category + an icon cropped by the user from their own screenshot, stored in S3 as `iconRefKey`.

**Redemption tracking is a flag, not a category** (revised 2026-07-08, prompted by comparing against the real in-game tab structure): a "collect N, redeem for X" item like the Eternal tokens is, in-game, just an ordinary item sitting in the `Etc` tab — there's no separate "Token" tab. So `redemptionTracked` plus its nullable fields (`sourceBossName`, `slotGroup`, `redeemThreshold`, `bonusItemName`) can apply to any catalog row regardless of `category`, and the UI shows a small "collect N →" badge on that row wherever it's grouped, instead of pulling it into its own section.

**Real technical risk carried forward**: the original icon-matching spike validated ~7 icons in one vision prompt. A catalog that grows past that means the prompt eventually carries many more reference crops at once — untested territory (prompt size, matching accuracy at that reference-set size). Re-run the M6-style spike at a larger simulated catalog size before assuming the 7-icon result generalizes.

## Screenshot ingestion & vision-parsing pipeline

- **Upload transport**: Next.js requests a presigned S3 upload URL from Ktor, client uploads the file directly to S3 (avoids routing 15-20 multi-MB images through the Ktor request body), then Next.js calls a Ktor endpoint with the resulting object keys to kick off parsing.
- **No manual screenshot-type selector** — one drag-and-drop zone accepts anything. One Claude call per image using a discriminated JSON schema (forced via tool-use):
  ```json
  {
    "screenshot_type": "inventory" | "unrecognized",
    "character_hud": { "name": string|null, "level": number|null } | null,
    "inventory_items": [{ "item_name": string, "quantity": number }] | null
  }
  ```
  Validate with `kotlinx.serialization`, persist `rawModelResponse` regardless of outcome, show a "detected as: X" badge with manual override + re-parse button per image.
- **Item/icon matching**: build the reference portion of the vision prompt dynamically from every confirmed `ItemCatalog` row's icon ("this icon = Distorted Ambition", etc.) — fetched live from `sourceItemId` via maplestory.io, or from the S3-stored `iconRefKey` for manually-added rows — so the model matches icon→catalog entry and reads the stack-count badge directly off a plain inventory screenshot, no per-item tooltip screenshots needed at request time. This was validated at ~7 icons; matching accuracy at a much larger catalog (see "Item catalog & icon references") is the real open risk — re-validate before the catalog grows much past that.
- **Concurrency**: Kotlin coroutines, fanned out with `async`/`awaitAll` inside a `supervisorScope` (so one image's failure doesn't cancel the batch), capped at ~5 concurrent Claude calls via a `Semaphore(5)`. No external queue (Redis/etc.) needed at this scale (15-20 images/week). Partial failures mark just that screenshot `FAILED` with a per-image retry button.
- **Character match, not character creation**: use `character_hud.name` (case-insensitive) to match an existing `Character` — screenshots never create a new `Character` row, since manual-add-by-name (enriched via the Nexon lookup above) is the only creation path. A HUD name with no matching existing character is flagged `NEEDS_REVIEW` with a manual character picker, same as when the HUD isn't visible at all (tightly-cropped upload, as happened with one of the samples) — both are the same fallback UI, just a different reason for landing there.

## Build order

1. **M0 — Scaffold both services + AWS infrastructure**: provision the VPC (public subnet for the ALB, private subnets for ECS tasks + RDS), security groups, ECR repo, RDS instance, and ECS cluster/service/task definition via Terraform. Ktor project (routing skeleton, `Authentication`/`jwt` wired to Clerk's JWKS, Exposed+Flyway pointed at RDS), Next.js project (Clerk web SDK, calling one Ktor health-check endpoint through the ALB). Deploy both (ECS Fargate + Vercel) and confirm an authenticated round-trip end-to-end before building features. This milestone is the heaviest lift in the whole plan given the infrastructure involved — budget real time for it.
2. **M1 — Data model + catalog seed**: Exposed tables above; Flyway migration + a seed script for the 6 confirmed `redemptionTracked=true` `ItemCatalog` rows (+ Akechi placeholder), categorized `ETC`.
3. **M2 — Character CRUD + Nexon lookup**: Ktor endpoints + Next.js pages for add/edit/delete, where "add" is name-only and triggers the Nexon no-auth ranking lookup server-side to populate level/jobName/worldName/spriteImgUrl; manual level entry as the fallback when the lookup finds nothing. Nothing downstream has anything to attach to without this milestone.
4. **M3 — Item catalog management**: Ktor endpoint that searches `maplestory.io` live when adding an item (mirroring the Nexon character lookup), returning candidates (name/category/icon) for the user to pick from — handles the duplicate-name case by showing icons side by side. Picking a candidate creates an `ItemCatalog` row against `sourceItemId`; a returned `category: "Unknown"` requires the user to assign the real category manually (`needsCategoryReview`). No match found (expected for newest boss-drop content) falls back to full manual entry — name, category, and an icon crop uploaded to S3 as `iconRefKey`. What makes the catalog genuinely growable beyond the initial token seed — needed before the vision pipeline can match against anything the user adds later.
5. **M4 — Single-image inventory upload + per-character view**: S3 upload flow, Ktor endpoint calling Claude scoped to the inventory schema, `CharacterItemCount` upsert, per-character list in Next.js. Validate parse accuracy directly against `untradeables sample.png` before moving on.
6. **M5 — Bulk upload + auto-classification + HUD matching**: multi-file drag-and-drop in Next.js, discriminated schema in Ktor, coroutine fan-out with the semaphore cap, HUD-name matching against already-existing characters (never creating new ones — see M2), a batch review screen (per-image status, editable).
7. **M6 — Item icon-matching spike + cross-character item dashboard**: reference-icon-crop prompt technique (validate first against `untradeables sample.png` at the original ~7-icon scale, then again at a larger simulated catalog size per the risk noted above), aggregate view grouped by the real in-game tabs (Equip/Use/Etc/Set-up/Cash/Dec) — `redemptionTracked` rows get an inline "progress toward next set" badge, everything else just shows a plain running total with freshness labels.
8. **M7 — Polish**: retry/error UX, manual correction without re-upload, responsive/mobile-friendly CSS (stopgap before a native app exists), screenshot history management, a simple per-user daily upload/API-cost guardrail.
9. **M8 (future, out of MVP scope) — Kotlin Multiplatform mobile**: extract the shared data models + Ktor Client-based API client from the backend project into a shared Gradle module; build native Android/iOS apps with Compose Multiplatform consuming it. Also where the video-upload/expiration-tracking idea would land, as an extension of the existing vision-parsing pipeline rather than a new architecture.

## Critical files (to be created)

- `infra/` — Terraform config for the VPC, subnets, security groups, ECR repo, RDS instance, and ECS cluster/service/task definition
- `backend/Dockerfile` — container image definition for the Ktor service, built and pushed to ECR
- `backend/src/main/kotlin/.../Routing.kt` — Ktor route definitions
- `backend/src/main/kotlin/.../Tables.kt` — Exposed table objects (full data model in one place)
- `backend/src/main/resources/db/migration/` — Flyway migration scripts
- `backend/src/main/kotlin/.../ScreenshotProcessing.kt` — the vision fan-out pipeline; highest-risk piece of the system
- `frontend/app/...` — Next.js pages/components calling the Ktor API
- Reference: `reference-images/untradeables sample.png`, `untradebles description sample.png`, `inventory sample.png`, `character selection screen.png` — ground truth for prompt/schema design, catalog seeding, and category/UI grouping

## Verification

- After M0: confirm the ECS Fargate service is healthy behind the ALB, the Vercel (Next.js) deploy is live, and a signed-in user's request round-trips — Next.js attaches a Clerk JWT, the ALB routes it to Ktor, Ktor validates it via JWKS and returns data from RDS.
- After M4: run the inventory parser against `untradeables sample.png` and manually check the parsed JSON matches what's visible in the image (correct item names, correct stack counts).
- After M6 spike: run the icon-matching prompt against `untradeables sample.png` and manually verify each of the ~7 token quantities read off matches the visible stack-count numbers, then repeat at a larger simulated catalog size before building the full milestone on top of it.
- Before considering the MVP done: log in as a test user, add 2-3 characters, bulk-upload a batch of inventory screenshots, and confirm the item dashboard reflects reality without manual data entry.
