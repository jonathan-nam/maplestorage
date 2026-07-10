# MapleStorage — Grandis Token Tracker

## Context

You're a long-time GMS MapleStory player who runs weekly bosses across multiple geared characters — farming the same boss on several "mules" for extra drops is standard endgame practice — and have no unified view of how close you are to a full redemption set for each Eternal-set boss token, across all of them. Today that means logging into every character individually and manually tallying — this app replaces that with screenshot uploads parsed by a vision-capable LLM into a single cross-character progress view.

GMS has no official Nexon data API (confirmed — only KMS/TMS/MSEA do), so screenshot vision-parsing is the only viable data source, not a shortcut around one. This project started fully greenfield.

**Be precise about what problem this solves (revised 2026-07-10)**: Nexon's forums have a running complaint thread ("Unclog our inventories") about untradeable-item clutter, and players have explicitly proposed an account-wide storage/consolidation system as the fix — a request only Nexon can build, since it requires moving items between characters server-side, which no third-party tool can do. **This app doesn't solve that.** It solves a narrower, adjacent problem that happens to share the same root frustration: not being able to see your total redemption progress across characters without checking each one individually. That's a real value, but a different one from freeing up inventory slots — the project's earlier framing conflated the two, worth correcting rather than carrying forward. Critically, the real third-party tools players already use (MapleHub, MapleTools, MS Tracker) are all boss-clear/EXP/HEXA/ranking trackers built on the Nexon Open API, and confirmed via research: **that API does not expose inventory/item contents in any region that has it** — so while this app doesn't solve inventory overflow, cross-character redemption-progress visibility specifically is still unaddressed by any existing tool.

**Scope note (narrowed back down 2026-07-10)**: this project briefly broadened (2026-07-07) from the 6 untradeable Eternal-set boss tokens to a general, user-curated item catalog spanning consumables and Etc-tab drop items. That broader version surfaced real problems on closer design work — a growable, per-user item catalog needed active curation (search/add flows, icon-collision handling, an open-ended "discovery worklist" for unidentified items) and dragged in a video-based tooltip-capture pipeline to read expiration dates on items that, on inspection, weren't even part of the original 6 tokens. None of that scope is worth the complexity for a use case validated at the *token* level, not the general-inventory level — the token catalog is fixed, small, and every one of the open risks the broader version carried (icon-matching accuracy at 50-150 items/user, expiration-tracking UX, discovery-worklist clustering) simply don't apply at a fixed set of 6. Scope is back to tokens only.

**Stack decision**: you're a mobile engineer with strong Kotlin/Compose expertise, not a JS/TS background. The backend and future native iOS/Android apps should play to that strength via Kotlin Multiplatform. The web frontend, however, stays on Next.js/React rather than Compose Multiplatform for Web, because Compose Web is still Beta and — critically — **does not yet officially support drag-and-drop**, which lands directly on this app's bulk-upload feature (dragging 15+ screenshots at once). Splitting the stack this way puts each piece on its strongest footing: Kotlin where it's your expertise and where Kotlin Multiplatform's shared-code story is real (backend ↔ future mobile), and the most battle-tested option (Next.js) for the web layer you're shipping first and that needs mature file-upload/drag-and-drop UX.

You're also explicitly using this project to build resume-relevant AWS skills, which is why several choices below favor the more resume-weighty AWS-native option over a simpler/cheaper alternative, with real recurring cost (~$25-45/month for backend infra) accepted deliberately.

Sample screenshots in `reference-images/` were used to ground this plan:
- `untradeables sample.png` — a plain inventory grid (icons + stack-count numbers, no item names visible)
- `untradebles description sample.png` — hover tooltips confirming the exact reward template: *"[flavor text]. Collect 10 and double-click to obtain one [slots] from the Eternal set."*
- `character selection screen.png` — the in-game character-select screen (sprite + name-plate per character), which the Characters page's tile-grid layout is modeled on (see `WEB-UI-SPEC.md`)

Confirmed token catalog — this *is* the full scope of the app, not a seed of something larger. Six Grandis-tier bosses drop Eternal-set tokens (the current top gear tier — confirmed 2026-07-11, no unconfirmed/placeholder rows):
| Boss | Token | Redeems for |
|---|---|---|
| Limbo | Distorted Ambition | Shoes, Gloves, or Cape |
| Malefic Star | Blissful Fantasy Shard | Hat, Top, Bottom, or Shoulder Accessory |
| First Adversary | Echo of Ancient Resolve | Hat, Top, Bottom, or Shoulder Accessory |
| Kaling | Ferocious Beast Entanglement Ring | Hat, Top, Bottom, or Shoulder Accessory |
| Kalos the Guardian | Kalos's Residual Determination | Hat, Top, Bottom, or Shoulder Accessory |
| Baldrix | Trace of Eternal Loyalty (+ bonus "Eternal Armor of Oaths Box" in Hard) | Shoe, Glove, or Cape |

Confirmed **not** included: Chosen Seren (no longer drops Eternal material — drops "Jet Black" accessories instead). Black Mage and the pre-Grandis weekly bosses (Lotus, Damien, Guardian Angel Slime, Lucid, Will, Gloom, Verus Hilla, Darknell) belong to a separate older reward chain (Genesis Weapon traces), not Eternal — excluded from the token catalog entirely. None of these 6 tokens expire — they're plain collect-and-redeem `Etc`-tab items, not time-limited event rewards, so expiration tracking is out of scope, not deferred.

**Multi-user, possibly monetized (2026-07-08)**: this was originally a personal tool; the intent now is for other people to use it too, and possibly to charge for it — pricing model not decided yet. Per-user usage needs to be tracked from the start regardless of pricing model, so a quota or billing layer can be bolted on later without re-architecting, and the screenshot-processing pipeline needs to hold up under many users' upload activity clustering around the same weekly reset window, not just one person's. Note this is a narrower bet than a general product — the validated audience is players who farm Grandis bosses across multiple characters specifically, not MapleStory players broadly; treated as a deliberate, legible starting slice rather than an attempt at wide appeal (see the "Screenshot ingestion" section's Batches API note for the multi-user upload-clustering angle).

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

TokenCatalog      (id, name, sourceBossName?, slotGroup?: string[], redeemThreshold: int,
                    bonusItemName?, iconRefKey?: string)
                  // renamed from ItemCatalog 2026-07-10 — fixed at the 6 rows in the Context
                  // table above, seeded once via migration, never grown by users. No category
                  // field (every row is an Etc-tab redemption token by definition), no
                  // needsCategoryReview (nothing is imported/classified live), no expirable
                  // flag (none of these expire), no per-user opt-in table (every user tracks
                  // every row, full stop — see "Token catalog" below for how icons are
                  // sourced). No confirmed flag either (removed 2026-07-11) — that only ever
                  // existed to carry Akechi Mitsuhide's placeholder row, which turned out not
                  // to be a real Grandis token at all (corrected by user 2026-07-11: exactly
                  // 6 bosses drop Eternal-set tokens); with no placeholder left, every row is
                  // simply usable from the moment the seed migration runs

CharacterTokenCount  (characterId FK, tokenCatalogId FK, quantity: int,
                       capturedAt, sourceScreenshotId FK?)
                  // renamed from CharacterItemCount 2026-07-10 — unique (characterId,
                  // tokenCatalogId), latest-snapshot upsert, not an append-only history log.
                  // No expiresAt/expirationNeedsReview — tokens don't expire, so that whole
                  // concern doesn't apply here

UsageLedger       (id, userId FK, screenshotId FK?, inputTokens: int, outputTokens: int,
                    estimatedCostUsd: decimal, createdAt)
                  // one row per Claude call, written regardless of pricing model — added
                  // 2026-07-08 so usage data exists before a monetization model is chosen;
                  // no quota/cap enforcement logic yet, this is just the ledger a future
                  // free-tier limit or metered-billing feature would read from

Screenshots       (id, userId, characterId?, type: INVENTORY|UNRECOGNIZED,
                    storageKey, uploadedAt, parseStatus: PENDING|SUCCESS|FAILED|NEEDS_REVIEW,
                    rawModelResponse: jsonb, detectedCharacterName?, detectedLevel?)
                  // no TOOLTIP type — that existed only for expiration dates and
                  // icon-ambiguous items, neither of which apply to a fixed 6-token catalog
```

`CharacterTokenCount` is a **latest-snapshot upsert**, not an append-only history log — the dashboard only needs "what's true right now." Counts don't invalidate on a timer, so freshness is just an "as of [date]" label per contributing character, not a stale/fresh binary.

**Noted for later (not in scope now)**: a 2026-07-08 survey of inventory-management tools (Sortly, general small-business WMS, game-collection trackers) turned up one real gap against this plan — every other common feature (centralized cross-location view, real taxonomy, low-manual-entry capture, freshness signals) this app already does or has a deliberate reason not to:

- **Proactive data-freshness discipline**: today's "as of [date]" freshness label is passive — you only see it if you go look at that character. A more disciplined version would actively nudge (e.g. "Bubbling hasn't been re-scanned in 2 weeks") instead of relying on the user to notice staleness themselves. Not built — would need a notification mechanism this app doesn't have yet.

## Character creation & the Nexon avatar lookup

**Default flow is manual-add-by-name, not screenshot-derived.** Adding a character means typing the in-game name; screenshots are only ever used afterward to *match* inventory data to an already-known character, never to create one. This was validated directly against a real endpoint during planning (2026-07-06):

- `GET https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na?type=world&id={worldId}&page_index=1&character_name={name}` — no API key required, filters to the named character (confirmed via `character_name=Kraane` returning `totalCount: 1`). Returns `level`, `jobName`, `worldID`, `exp`, and `characterImgURL`.
- `characterImgURL` points to `https://msavatar1.nexon.net/Character/{encoded}.png` — Nexon's own avatar-rendering CDN (the same one mapleranks proxies). Confirmed directly fetchable with no auth/hotlink-referrer restriction, returns a real ~96x96 character sprite PNG.
- This is an **undocumented endpoint the nexon.com website itself uses**, not the official versioned OpenAPI (which is KMS-only and requires a key) — treat it as unofficial and add a fallback path (manual level entry, no sprite) for when a name isn't found or the endpoint changes/breaks.
- Ktor calls this server-side when a character is added, storing `level`/`jobName`/`worldName`/`spriteImgUrl` directly on the `Characters` row. Re-fetch on demand (e.g. a "refresh" action) rather than on a schedule — gear/level changes don't need to be real-time here, screenshots remain the source of truth for token counts.

## Token catalog

**Fixed and hand-curated, not bulk-imported (revised 2026-07-10).** The catalog is exactly the 6 rows in the Context table above — no search, no user-driven add flow, no growth over time. This removes the open-ended-catalog risks the broader design carried: icon-matching accuracy at scale (the old plan's real unresolved risk was "50-150 items per user"; here it's permanently 6, already validated), duplicate-name disambiguation, category classification, and discovery of unknown items — none of these apply to a closed set curated once by the developer.

**Icon sourcing is a one-time seeding task, not a live feature.** `maplestory.io` (community-run, unofficial — same trust tier as the Nexon avatar lookup above) was validated live during planning (2026-07-08) as a real item database for GMS, confirmed solid for established content but **patchy for the newest content — the exact thing this catalog is made of**: only 2 of the 6 known Grandis-tier Eternal tokens are in the dataset at all. So icon sourcing is mixed at seed time, per row:
- `GET https://maplestory.io/api/GMS/{version}/item/{id}/icon` for the ~2 tokens `maplestory.io` has.
- A manually-cropped icon, stored in S3 as `iconRefKey`, for the rest (cropped once from `untradeables sample.png` or a fresh screenshot, by the developer during the M1 migration/seed — not an end-user action).

Both paths land in the same `TokenCatalog.iconRefKey` field either way — the vision prompt doesn't care which source an icon came from, only that every row has one before the app can match against it.

## Screenshot ingestion & vision-parsing pipeline

- **Upload transport**: Next.js requests a presigned S3 upload URL from Ktor, client uploads the file directly to S3 (avoids routing 15-20 multi-MB images through the Ktor request body), then Next.js calls a Ktor endpoint with the resulting object keys — plus an optional `characterId` if the user pre-selected one via the Upload page's character selector (added 2026-07-08, see `WEB-UI-SPEC.md`) — to kick off parsing.
- **No manual screenshot-type selector** — one drag-and-drop zone accepts anything. One Claude call per image using a discriminated JSON schema (forced via tool-use):
  ```json
  {
    "screenshot_type": "inventory" | "unrecognized",
    "character_hud": { "name": string|null, "level": number|null } | null,
    "token_counts": [{ "token_name": string, "quantity": number }] | null
  }
  ```
  Validate with `kotlinx.serialization`, persist `rawModelResponse` regardless of outcome, show a "detected as: X" badge with manual override + re-parse button per image.
- **Token/icon matching**: build the reference portion of the vision prompt from every `TokenCatalog` row — a fixed, global list of 6 labeled icons ("this icon = Distorted Ambition," etc.), identical for every user and every request, not built dynamically per-user. The model matches icon→token and reads the stack-count badge directly off a plain inventory screenshot. Already validated at roughly this scale (~7 icons in the original spike, now 6) — there's no larger-catalog risk left to re-validate, since the catalog can't grow.
- **Concurrency (single-image)**: Kotlin coroutines, fanned out with `async`/`awaitAll` inside a `supervisorScope` (so one image's failure doesn't cancel the batch), capped at ~5 concurrent synchronous Claude calls via a `Semaphore(5)`. This stays the path for small drops, since the "watch it resolve live" row-list UX (`WEB-UI-SPEC.md`'s Upload page) depends on a near-immediate response.
- **Bulk uploads route through the Batches API instead** (added 2026-07-08, multi-user planning): a drop above some threshold (e.g. 5+ images at once) submits as a Message Batch rather than N synchronous calls — 50% cheaper, and draws from a separate rate-limit pool from the synchronous path, which matters once many users' upload activity can cluster around the same weekly reset window. Tradeoff: batches typically complete within an hour (not seconds), so the row list shows a "processing…" state and the frontend polls for batch completion rather than getting a near-immediate per-row resolution — an acceptable UX cost for a bulk drop that wasn't instant anyway, but a real regression if applied to single-image uploads, which is why the threshold exists rather than routing everything through Batches unconditionally.
- **Usage tracking**: every Claude call (synchronous or batched) writes a `UsageLedger` row — input/output tokens and estimated cost, keyed to the requesting user. No quota or billing logic reads this yet (monetization model isn't decided — see the Context section), but the data needs to exist before any free-tier cap or metered-billing feature can be built on top of it.
- **Character match, not silent character creation**: `character_hud.name` (case-insensitive) is always parsed and matched against an existing `Character`, regardless of whether the upload carries an optional pinned `characterId` from the Upload page — since trusting a pin without verifying it against the screenshot creates a real failure mode (forget to switch the pin, or misclick, and data gets silently recorded under the wrong character). If both are present and agree, proceed normally. If they disagree, flag `MISMATCH` rather than silently trusting either source, surfaced in the UI as "pinned to X, but this screenshot looks like Y" with a one-click fix defaulting to the HUD-detected character. No HUD visible at all (tightly-cropped upload, as happened with one of the samples) is flagged `NEEDS_REVIEW` with a manual character picker, same as before.
- **Detected name with no roster match → one-click confirm, not auto-create** (added 2026-07-08): flagging every unrecognized name as generic `NEEDS_REVIEW` was real friction, but silently auto-creating a `Character` straight from a single vision read was rejected as too risky — no existing record to cross-check the read against, so a misread (or someone accidentally uploading a screenshot that isn't even their own character) becomes a permanent, unreviewed roster entry. The middle ground: the row surfaces "New character detected: {name} — not in your roster" with three actions — confirm-add (runs the same Nexon-lookup enrichment as manual add, then re-attributes the screenshot), pick an existing character instead (covers the name being a misread of someone already tracked), or ignore. This keeps a deliberate human checkpoint while cutting the friction down to one click for the common case.

## Build order

1. **M0 — Scaffold both services + AWS infrastructure**: provision the VPC (public subnet for the ALB, private subnets for ECS tasks + RDS), security groups, ECR repo, RDS instance, and ECS cluster/service/task definition via Terraform. Ktor project (routing skeleton, `Authentication`/`jwt` wired to Clerk's JWKS, Exposed+Flyway pointed at RDS), Next.js project (Clerk web SDK, calling one Ktor health-check endpoint through the ALB). Deploy both (ECS Fargate + Vercel) and confirm an authenticated round-trip end-to-end before building features. This milestone is the heaviest lift in the whole plan given the infrastructure involved — budget real time for it.
2. **M1 — Data model + token catalog seed**: Exposed tables above; Flyway migration seeding all 6 `TokenCatalog` rows, including the one-time icon sourcing described in "Token catalog" above (fetch the ~2 available from `maplestory.io`, manually crop and upload the rest to S3 as `iconRefKey`). No per-user tracking table to wire up — every user sees every row by definition.
3. **M2 — Character CRUD + Nexon lookup**: Ktor endpoints + Next.js pages for add/edit/delete, where "add" is name-only and triggers the Nexon no-auth ranking lookup server-side to populate level/jobName/worldName/spriteImgUrl; manual level entry as the fallback when the lookup finds nothing. Nothing downstream has anything to attach to without this milestone.
4. **M3 — Usage ledger**: every Claude call (from M4 onward) writes a `UsageLedger` row. No quota or billing enforcement yet — just making sure per-user usage data exists before a pricing model is chosen.
5. **M4 — Single-image inventory upload + per-character view**: S3 upload flow, Ktor endpoint calling Claude scoped to the token-count schema, `CharacterTokenCount` upsert, per-character list in Next.js. Validate parse accuracy directly against `untradeables sample.png` before moving on.
6. **M5 — Bulk upload + HUD matching**: multi-file drag-and-drop in Next.js, coroutine fan-out with the semaphore cap for small drops, Batches API for larger ones (see "Screenshot ingestion" above), HUD-name matching against already-existing characters (never creating new ones — see M2), a batch review screen (per-image status, editable).
7. **M6 — Token icon-matching validation + cross-character dashboard**: run the reference-icon-crop prompt technique against `untradeables sample.png` and manually verify all 6 token quantities read off match the visible stack-count numbers — this is now the *only* scale that ever needs validating, not a spike against a moving target. Aggregate view grouped by boss/token, with an inline "progress toward next set" badge per row and freshness labels.
8. **M7 — Polish**: retry/error UX, manual correction without re-upload, responsive/mobile-friendly CSS (stopgap before a native app exists), screenshot history management.
9. **M8 (future, out of MVP scope) — Kotlin Multiplatform mobile**: extract the shared data models + Ktor Client-based API client from the backend project into a shared Gradle module; build native Android/iOS apps with Compose Multiplatform consuming it.
10. **M9 (future, blocked on a pricing decision) — Monetization**: Stripe integration, plan tiers, and actual quota/billing enforcement built on top of the `UsageLedger` from M3. Deliberately not scoped further until the pricing model (freemium / usage-based / flat subscription) is decided.

## Critical files (to be created)

- `infra/` — Terraform config for the VPC, subnets, security groups, ECR repo, RDS instance, and ECS cluster/service/task definition
- `backend/Dockerfile` — container image definition for the Ktor service, built and pushed to ECR
- `backend/src/main/kotlin/.../Routing.kt` — Ktor route definitions
- `backend/src/main/kotlin/.../Tables.kt` — Exposed table objects (full data model in one place)
- `backend/src/main/resources/db/migration/` — Flyway migration scripts, including the M1 token-catalog seed
- `backend/src/main/kotlin/.../ScreenshotProcessing.kt` — the vision fan-out pipeline; highest-risk piece of the system
- `frontend/app/...` — Next.js pages/components calling the Ktor API
- Reference: `reference-images/untradeables sample.png`, `untradebles description sample.png`, `character selection screen.png` — ground truth for prompt/schema design, token-catalog icon seeding, and UI grouping

## Verification

- After M0: confirm the ECS Fargate service is healthy behind the ALB, the Vercel (Next.js) deploy is live, and a signed-in user's request round-trips — Next.js attaches a Clerk JWT, the ALB routes it to Ktor, Ktor validates it via JWKS and returns data from RDS.
- After M1: confirm all 6 `TokenCatalog` rows exist and every row has a working `iconRefKey` before moving on — nothing downstream can match against a row with no icon.
- After M4: run the inventory parser against `untradeables sample.png` and manually check the parsed JSON matches what's visible in the image (correct token names, correct stack counts).
- After M6: manually verify each of the 6 token quantities read off `untradeables sample.png` matches the visible stack-count numbers — this is the full validation surface now, not a scale spike.
- Before considering the MVP done: log in as a test user, add 2-3 characters, bulk-upload a batch of inventory screenshots, and confirm the token dashboard reflects reality without manual data entry.
- Before considering multi-user support done: create two test users, confirm each sees only their own characters and counts (no data leakage), and confirm `UsageLedger` rows are being written per Claude call.
