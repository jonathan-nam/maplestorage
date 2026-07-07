# MapleStory Companion App — Boss & Untradeable Tracker

## Context

You're a long-time GMS MapleStory player running 15+ characters, and lack any unified view of two things the game only shows you one character at a time: (1) which weekly/monthly/daily bosses are still uncleared, and (2) how many of each character-bound ("untradeable") boss token you've accumulated *across* all characters toward the 10-needed Eternal-set armor redemption. Today that means logging into every character individually — this app replaces that with screenshot uploads parsed by a vision-capable LLM into a unified dashboard. Future scope also includes more advanced processing (e.g. video uploads to track item expirations) — the backend needs to be built assuming more processing-heavy features arrive over time, not just today's two.

GMS has no official Nexon data API (confirmed — only KMS/TMS/MSEA do), so screenshot vision-parsing is the only viable data source, not a shortcut around one. This project started fully greenfield.

**Stack decision**: you're a mobile engineer with strong Kotlin/Compose expertise, not a JS/TS background. The backend and future native iOS/Android apps should play to that strength via Kotlin Multiplatform. The web frontend, however, stays on Next.js/React rather than Compose Multiplatform for Web, because Compose Web is still Beta and — critically — **does not yet officially support drag-and-drop**, which lands directly on this app's bulk-upload feature (dragging 15+ screenshots at once). Splitting the stack this way puts each piece on its strongest footing: Kotlin where it's your expertise and where Kotlin Multiplatform's shared-code story is real (backend ↔ future mobile), and the most battle-tested option (Next.js) for the web layer you're shipping first and that needs mature file-upload/drag-and-drop UX.

You're also explicitly using this project to build resume-relevant AWS skills, which is why several choices below favor the more resume-weighty AWS-native option over a simpler/cheaper alternative, with real recurring cost (~$25-45/month for backend infra) accepted deliberately.

Sample screenshots in `reference-images/` were used to ground this plan:
- `boss clear menu sample.png` / `boss clear menu sample 2.png` — the native in-game "Maple Planner" boss panel (WEEKLY/MONTHLY/DAILY sections, difficulty badge + checkmark-or-chevron per boss row)
- `untradeables sample.png` — a plain inventory grid (icons + stack-count numbers, no item names visible)
- `untradebles description sample.png` — hover tooltips confirming the exact reward template: *"[flavor text]. Collect 10 and double-click to obtain one [slots] from the Eternal set."*

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

Confirmed **not** included: Chosen Seren (no longer drops Eternal material — drops "Jet Black" accessories instead). Black Mage and the pre-Grandis weekly bosses (Lotus, Damien, Guardian Angel Slime, Lucid, Will, Gloom, Verus Hilla, Darknell) belong to a separate older reward chain (Genesis Weapon traces), not Eternal — track their clear status for the boss dashboard, but exclude them from the token catalog.

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

BossCatalog       (id, name, cadence: WEEKLY|MONTHLY|DAILY, difficulties: string[])
                  // seed from samples: Lotus, Damien, Guardian Angel Slime, Lucid, Will, Gloom,
                  // Verus Hilla, Darknell, Chosen Seren, Kalos the Guardian, First Adversary,
                  // Kaling, Malefic Star, Limbo, Akechi Mitsuhide (WEEKLY);
                  // Black Mage (MONTHLY); Zakum, Gollux (DAILY)

UntradeableTokenCatalog
                  (id, name, sourceBossId FK -> BossCatalog, slotGroup: string[],
                   redeemThreshold=10, bonusItemName?, confirmed: boolean)
                  // seed the 6 confirmed tokens above; Akechi row marked confirmed=false
                  // as a placeholder until its tooltip text is captured — doesn't block launch

CharacterBossStatus   (characterId FK, bossCatalogId FK, difficulty, cleared: bool,
                        capturedAt, sourceScreenshotId FK?)  // unique (characterId, bossCatalogId)
CharacterTokenCount   (characterId FK, tokenCatalogId FK, quantity: int,
                        capturedAt, sourceScreenshotId FK?)  // unique (characterId, tokenCatalogId)

Screenshots       (id, userId, characterId?, type: BOSS_CLEAR|INVENTORY|UNRECOGNIZED,
                    storageKey, uploadedAt, parseStatus: PENDING|SUCCESS|FAILED|NEEDS_REVIEW,
                    rawModelResponse: jsonb, detectedCharacterName?, detectedLevel?)
```

`CharacterBossStatus` / `CharacterTokenCount` are **latest-snapshot upserts**, not an append-only history log — the dashboard only needs "what's true right now."

**Weekly reset handling — computed at read time, no cron job.** Define pure boundary functions per cadence (`weeklyBoundary(now)`, `monthlyBoundary(now)`, `dailyBoundary(now)`) parameterized by a `RESET_ANCHOR` config constant (day/hour/timezone — confirm GMS's actual reset hour empirically once, then hardcode it there). When rendering the dashboard, compare each `CharacterBossStatus.capturedAt` against the current boundary — if it's from before the boundary, render that cell as **stale/greyed-out** ("as of last week — re-upload") rather than a false checkmark. Token counts are handled differently: they don't invalidate on a timer, so just show an "as of [date]" freshness label per contributing character rather than a stale/fresh binary.

## Character creation & the Nexon avatar lookup

**Default flow is manual-add-by-name, not screenshot-derived.** Adding a character means typing the in-game name; screenshots are only ever used afterward to *match* boss-clear/inventory data to an already-known character, never to create one. This was validated directly against a real endpoint during planning (2026-07-06):

- `GET https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na?type=world&id={worldId}&page_index=1&character_name={name}` — no API key required, filters to the named character (confirmed via `character_name=Kraane` returning `totalCount: 1`). Returns `level`, `jobName`, `worldID`, `exp`, and `characterImgURL`.
- `characterImgURL` points to `https://msavatar1.nexon.net/Character/{encoded}.png` — Nexon's own avatar-rendering CDN (the same one mapleranks proxies). Confirmed directly fetchable with no auth/hotlink-referrer restriction, returns a real ~96x96 character sprite PNG.
- This is an **undocumented endpoint the nexon.com website itself uses**, not the official versioned OpenAPI (which is KMS-only and requires a key) — treat it as unofficial and add a fallback path (manual level entry, no sprite) for when a name isn't found or the endpoint changes/breaks.
- Ktor calls this server-side when a character is added, storing `level`/`jobName`/`worldName`/`spriteImgUrl` directly on the `Characters` row. Re-fetch on demand (e.g. a "refresh" action) rather than on a schedule — gear/level changes don't need to be real-time here, screenshots remain the source of truth for boss/token state.

## Screenshot ingestion & vision-parsing pipeline

- **Upload transport**: Next.js requests a presigned S3 upload URL from Ktor, client uploads the file directly to S3 (avoids routing 15-20 multi-MB images through the Ktor request body), then Next.js calls a Ktor endpoint with the resulting object keys to kick off parsing.
- **No manual screenshot-type selector** — one drag-and-drop zone accepts anything. One Claude call per image using a discriminated JSON schema (forced via tool-use) with a `screenshot_type` field plus both possible payload shapes:
  ```json
  {
    "screenshot_type": "boss_clear" | "inventory" | "unrecognized",
    "character_hud": { "name": string|null, "level": number|null } | null,
    "boss_clears": [{ "boss_name": string, "difficulty": string, "cleared": boolean, "cadence_section": "WEEKLY"|"MONTHLY"|"DAILY" }] | null,
    "inventory_items": [{ "item_name": string, "quantity": number }] | null
  }
  ```
  Validate with `kotlinx.serialization`, persist `rawModelResponse` regardless of outcome, show a "detected as: X" badge with manual override + re-parse button per image.
  **Known open gap (deferred, revisit before/during M4)**: this schema currently assumes a screenshot is *either* boss-clear *or* inventory, never both. A screenshot capturing both UI panels at once (e.g. two windows visible in one snip) would break that assumption. Likely fix: let `boss_clears` and `inventory_items` both populate independently in one response (default to empty arrays rather than one being forced `null`), with `unrecognized` only when both come back empty — which means both a `CharacterBossStatus` and `CharacterTokenCount` upsert could fire off one `sourceScreenshotId`, and the upload row UI needs to render both status lines on one row instead of assuming one classification per row.
- **Token/icon matching**: since there are only ~7 distinct token icons, include one-time reference icon crops in the vision prompt ("this icon = Distorted Ambition", etc.) so the model matches icon→catalog entry and reads the stack-count badge directly off a plain inventory screenshot — no per-token tooltip screenshots needed. Treat this as the one piece of real technical risk in the whole plan; validate it directly against `untradeables sample.png` before building the full milestone around it.
- **Concurrency**: Kotlin coroutines, fanned out with `async`/`awaitAll` inside a `supervisorScope` (so one image's failure doesn't cancel the batch), capped at ~5 concurrent Claude calls via a `Semaphore(5)`. No external queue (Redis/etc.) needed at this scale (15-20 images/week). Partial failures mark just that screenshot `FAILED` with a per-image retry button.
- **Character match, not character creation**: use `character_hud.name` (case-insensitive) to match an existing `Character` — screenshots never create a new `Character` row, since manual-add-by-name (enriched via the Nexon lookup above) is the only creation path. A HUD name with no matching existing character is flagged `NEEDS_REVIEW` with a manual character picker, same as when the HUD isn't visible at all (tightly-cropped upload, as happened with one of the samples) — both are the same fallback UI, just a different reason for landing there.

## Build order

1. **M0 — Scaffold both services + AWS infrastructure**: provision the VPC (public subnet for the ALB, private subnets for ECS tasks + RDS), security groups, ECR repo, RDS instance, and ECS cluster/service/task definition via Terraform. Ktor project (routing skeleton, `Authentication`/`jwt` wired to Clerk's JWKS, Exposed+Flyway pointed at RDS), Next.js project (Clerk web SDK, calling one Ktor health-check endpoint through the ALB). Deploy both (ECS Fargate + Vercel) and confirm an authenticated round-trip end-to-end before building features. This milestone is the heaviest lift in the whole plan given the infrastructure involved — budget real time for it.
2. **M1 — Data model + catalog seed**: Exposed tables above; Flyway migration + a seed script for `BossCatalog` (full list) and `UntradeableTokenCatalog` (6 confirmed + Akechi placeholder).
3. **M2 — Character CRUD + Nexon lookup**: Ktor endpoints + Next.js pages for add/edit/delete, where "add" is name-only and triggers the Nexon no-auth ranking lookup server-side to populate level/jobName/worldName/spriteImgUrl; manual level entry as the fallback when the lookup finds nothing. Nothing downstream has anything to attach to without this milestone.
4. **M3 — Boss-clear upload (single image) + per-character view**: S3 upload flow, Ktor endpoint calling Claude scoped to the boss-clear schema, `CharacterBossStatus` upsert, staleness-aware per-character list in Next.js. Validate parse accuracy directly against the two boss-clear samples before moving on.
5. **M4 — Bulk upload + auto-classification + HUD matching**: multi-file drag-and-drop in Next.js, full discriminated schema (both branches) in Ktor, coroutine fan-out with the semaphore cap, HUD-name matching against already-existing characters (never creating new ones — see M2), a batch review screen (per-image status, editable).
6. **M5 — Token parsing + cross-character token dashboard**: reference-icon-crop prompt technique (spike this first against `untradeables sample.png`), `CharacterTokenCount` upsert, aggregate "sum across all characters per token, progress toward next redemption" view with freshness labels.
7. **M6 — Unified weekly dashboard**: the actual payoff screen — rows = characters, columns = bosses, cells = cleared/not-cleared/stale/no-data, across all characters at a glance.
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
- Reference: `reference-images/boss clear menu sample.png`, `untradeables sample.png`, `untradebles description sample.png` — ground truth for prompt/schema design and catalog seeding

## Verification

- After M0: confirm the ECS Fargate service is healthy behind the ALB, the Vercel (Next.js) deploy is live, and a signed-in user's request round-trips — Next.js attaches a Clerk JWT, the ALB routes it to Ktor, Ktor validates it via JWKS and returns data from RDS.
- After M3: run the boss-clear parser against both existing sample screenshots and manually check the parsed JSON matches what's visible in the image (all 15+ boss rows, correct cleared/uncleared, correct difficulty).
- After M5 spike: run the icon-matching prompt against `untradeables sample.png` and manually verify each of the ~7 token quantities read off matches the visible stack-count numbers before building the full milestone on top of it.
- Before considering the MVP done: log in as a test user, add 2-3 characters, bulk-upload a mixed batch of boss-clear and inventory screenshots, and confirm the unified dashboard reflects reality without manual data entry.
