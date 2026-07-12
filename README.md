# MapleStorage

Track your Eternal-set boss token progress across every character at once.

Farming the same Grandis boss on several mules is normal, but the game gives you no
way to see how close you actually are to a full redemption set without logging into
each character and counting by hand. MapleStorage does the counting.

## What it does

**Add your characters.** Give it a name and it looks up the level, job and sprite
for you.

**Upload a screenshot.** Take one of the game with your inventory open, and drop it
in. It reads which tokens are in the inventory and how many of each, works out which
character it belongs to from the name shown in-game, and records the counts against
them.

**Drop in a whole batch.** Screenshot each of your mules, drag them all in at once,
and it sorts out which is which.

**See where you stand.** One view across every character: how many of each token you
hold, and how close that puts you to your next set.

If a screenshot can't be read reliably, it says so and tells you how to fix it,
rather than quietly recording a wrong number.

## Working on it

```bash
./scripts/smoke.sh
```

Runs the whole thing locally and checks it works.

| | |
| --- | --- |
| `PLAN.md` | Why the project is built the way it is |
| `WEB-UI-SPEC.md` | The frontend design |
| `backend/`, `frontend/`, `vision/`, `infra/` | Each has its own README |
| `.devcontainer/README.md` | **Start here on a new machine.** Setup, credentials, and what to do when it hangs |
