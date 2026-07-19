# Working in this repo

## Comments

The bar for a comment is: **it says something the code cannot.** A constraint, a measurement, a
rejected alternative, a bug that will come back. Everything else is noise that goes stale.

**Be brief.** Say it once, in the fewest words that survive being wrong later. A comment that
takes three paragraphs to justify a threshold will not be read, and will not be updated when the
threshold moves. Prefer:

- One line for the *what*, only when the code cannot say it.
- A short block for the *why*, but only where the reasoning is genuinely non-obvious and
  expensive to rediscover (a measured number, a design that failed, an invariant).
- A pointer instead of a repeat. If two places share a reason, put it in one and reference it.
  This codebase had the same "per-instance alignment was wrong" paragraph in two files.

**Do not narrate the diff.** No "this used to be X", "I changed this because", "previously we
did Y", unless the old approach is one a future reader would otherwise re-introduce. That is the
only reason to record a dead end, and one sentence is usually enough.

**Numbers in comments are claims.** `0.925 against a 0.55 bar` was cited long after the bar became
0.80, and `6 tokens` long after the catalog reached 26. If you quote a measurement, quote where it
came from, and treat it as something that must be re-measured when its inputs change, or better,
pin it with a test so it cannot silently rot.

**When you change behaviour, grep for the comments that describe it.** Stale comments are worse
than none: they are confidently wrong, and they are believed.

**No em dashes.** Write two sentences. Where the second clause cannot stand alone, use a comma, a
colon, or parentheses. This applies to comments, docs and commit messages alike.

## The failure this project exists to prevent

A **plausible, confident, wrong number**. Not a crash, a count that looks right and is not.
Everything else is secondary. Concretely, this has already happened via: a shortlist that silently
dropped an item; a prefilter that binned one real match in eight; an aggregate that pooled
redemption pieces which cannot be pooled; and an OCR path that resampled its own evidence away
before reading it.

So: prefer refusing to answer over guessing, prefer a missing item over a wrong count, and never
trust an accuracy figure measured through a step you also control.

## Test fixtures

`test-fixtures/` is the vision corpus, not a pile of screenshots. Every file in it is read by a
test in `vision/tests/`, by a build script in `vision/app/cv/`, or by `scripts/smoke.sh`, and
`docker-compose.yml` mounts the directory into the vision container as `/screenshots`. Deleting
one breaks CI, so check who reads it first.

The subdirectories are roles, not file types:

- `inventory/` captures the parser must read correctly.
- `occluded/` captures it must **refuse**. Filing one of these under `inventory/` turns a
  refusal test into a parse test that happens to pass, which is the silent-wrong-number failure
  this repo exists to prevent.
- `planner/` boss clear menu captures.
- `hud/` name and level crops.

Tests reach the corpus through `vision/tests/fixtures.py`, never by rebuilding the path. Two
captures are also build inputs, so moving them silently changes generated templates:
`inventory/untradeables sample.png` builds the digit font sheet, and
`planner/boss clear menu sample 2.png` builds the planner state glyphs.

`test-fixtures/scratch/` is the opposite: gitignored, disposable, the place to drop a capture
that illustrates a feature or a bug. A capture graduates by moving into a role directory and
gaining a test that reads it, in the same commit. If it never gets a test it stays scratch.

## Source of truth

`catalog/items.yaml` defines every item. `catalog/build.py` generates the SQL seed and validates
that templates and icons exist. Never edit `R__token_catalog.sql` by hand, and never add an item
in only one place, that drift is exactly what the manifest exists to end.
