# MapleStorage

Cross-character redemption-progress tracker for MapleStory's Eternal-set boss
tokens. You farm the same Grandis boss on several characters; the game gives you
no way to see your total progress toward a full set without logging into each one
and counting by hand. Upload screenshots, get one view.

`PLAN.md` is the source of truth for *why* things are the way they are — it keeps
the decision trail, including the reversals. `WEB-UI-SPEC.md` covers the frontend.

## Layout

```
backend/     Ktor + Exposed + Flyway. The API, auth, and ingestion orchestration.
vision/      Python + OpenCV. Parses screenshots. Runs as a 2nd container in the
             backend's ECS task, reached over 127.0.0.1.
frontend/    Next.js. Deployed on Vercel.
infra/       Terraform: VPC, ALB, ECS, ECR (x2), RDS.
scripts/     smoke.sh -- brings the whole stack up and proves it works.
reference-images/   Real screenshots. Ground truth, and the CV regression corpus.
prototypes/  The original static HTML/JS UI sketch. Historical.
```

## Running it

```bash
./scripts/smoke.sh
```

That builds and starts Postgres + the vision service + the backend, then asserts
seven things end to end — including that a real screenshot parses to the right
character and the right token counts, and that database migrations actually
applied. About a minute from cold. `--keep` leaves the stack running.

This is the closest thing to a staging environment, and it is not decoration: on
its first run it found a bug that would have failed every production deploy and
that no unit test could have caught (see `backend/README.md`, packaging note).

For the individual pieces, see `backend/README.md`, `vision/README.md`, and
`infra/README.md`.

## Screenshots are parsed with classical CV, not a vision model

This is the one thing to know before reading any older document in this repo,
because most of them were written on the opposite assumption.

Claude vision was built first and was **consistently inaccurate on the stack-count
numbers**. Classical CV reads the same screenshots exactly: **16/16 token counts
correct across all three real reference screenshots**, zero false positives across
128 slots × 6 tokens, plus the character name and level.

It works because MapleStory is not a photograph. The client draws its UI at a
**fixed pixel size** — the inventory slot pitch is 46px whether you play at
1080p or 4K — and renders each item icon **pixel-identically** every time. Once
you find the slot grid, identifying an item is a *lookup*, not a recognition
problem.

The consequences are worth stating plainly: **$0 per screenshot** instead of
~$0.017–0.045, no third-party call in the request path, and a deterministic
result — the same screenshot always produces the same answer, so a wrong read is a
bug you can fix rather than a sample you re-roll.

`vision/README.md` has the full account, including the approaches that **didn't**
work, which are the more useful half.

## Deploying

Not yet possible. `terraform apply` has run and the infrastructure exists, but the
AWS account is under a new-account compute hold and **no ECS task has ever been
placed**. That is the only blocker; the image is present and the task definition
is valid. See `PLAN.md` → M0.

When it clears, run `infra/bootstrap-images.sh` **once** before the first apply
that creates the service — the task definition pins `:latest` and Terraform creates
the ECR repositories empty, so a service created against an image that does not
exist cannot start a task, and on a first deploy there is no previous revision to
roll back to. See `infra/README.md`.
