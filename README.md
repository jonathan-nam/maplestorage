# MapleStorage

Cross-character redemption-progress tracker for MapleStory's Eternal-set boss
tokens.

You farm the same Grandis boss on several characters, and the game gives you no
way to see your total progress toward a full set without logging into each one and
counting by hand. Upload a screenshot of each character's inventory and get one
view: how many of each token you hold, across every character, and how close that
puts you to the next redemption.

## How it works

Take a screenshot of the game with your inventory open. The app reads the item
icons and their stack counts, reads the character's name and level off the HUD to
work out whose inventory it is, and records the counts against that character. Drop
in a batch of screenshots from all your mules at once and it sorts them out.

Parsing is done locally with classical computer vision — no AI model, no
per-screenshot cost, and the same screenshot always produces the same answer. If it
can't read something reliably, it says so rather than guessing.

## Layout

```
backend/     Ktor + Exposed + Flyway. API, auth, ingestion.
vision/      Python + OpenCV. Parses screenshots. Runs alongside the backend.
frontend/    Next.js. Deployed on Vercel.
infra/       Terraform: VPC, ALB, ECS, ECR, RDS.
scripts/     smoke.sh -- runs the whole stack and checks it works.
reference-images/   Real screenshots. Ground truth for the parser's tests.
```

## Running it

```bash
./scripts/smoke.sh
```

Builds and starts the database, the parser, and the backend, then checks the whole
thing works end to end — including parsing a real screenshot. About a minute from
cold; `--keep` leaves it running.

For the frontend, and for working on each piece individually, see `backend/README.md`,
`vision/README.md`, and `infra/README.md`.

## Deploying

Not currently possible: the AWS account is under a new-account hold and no ECS task
has ever started. See `PLAN.md` → M0.

## Where the reasoning lives

- `PLAN.md` — why the project is built the way it is, including the reversals.
- `vision/README.md` — how screenshot parsing works, and what didn't work.
- `infra/README.md` — deployment, and the order things must happen in.
- `WEB-UI-SPEC.md` — the frontend design.

## Dev container freezing?

It is running out of memory. WSL2 gives its VM about half the host's RAM by
default, and everything runs in there. When it fills, Docker stops responding and
the UI can't stop it.

`wsl --shutdown` from PowerShell clears it in seconds — you do not need to reboot.
To stop it recurring, raise the limits in `%UserProfile%\.wslconfig`:

```ini
[wsl2]
memory=12GB
swap=8GB
autoMemoryReclaim=gradual
```
