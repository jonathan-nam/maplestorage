<!-- docs/sharpeyes-mark.png is a 4x nearest-neighbour upscale of frontend/app/icon.png.
     Regenerate it the same way if the mark changes, or the README stops matching the app. -->
<p align="center">
  <img src="docs/sharpeyes-mark.png" width="128" alt="">
</p>

<h1 align="center">SharpEyes</h1>

<p align="center"><em>A greater view of your whole MapleStory account.</em></p>

The game shows you one character at a time. SharpEyes reads your screenshots and counts across all
of them.

## What it does

- **Characters.** Add by name. Level, job and sprite are looked up for you.
- **Inventory.** Drop a screenshot on a character and it reads which items are there and how many.
  It also reads the HUD name, and says so if the picture is not that character.
- **Search.** 26 tracked items across every character: who is holding what, how many, and what each
  can redeem now. Eternal pieces count per character, never pooled and never mixed.
- **Boss clears.** Drop a Maple Planner screenshot per character and it reads what is cleared this
  period. Tick the rest by hand.
- **Individual View, Party View.** Clears by character, or by who you run each boss with and at what
  difficulty. Earlier weeks are read-only.
- **Who runs what.** Bosses a character does not run stop counting towards the week.
- **Run Order.** Who is around and how long you have, in, out for time, and cannot be scheduled.
  Copies as text.
- **Drop Log, Wallet.** Log a party's drops and what they sold for to get each share. The Wallet is
  the running total of who owes whom, settled per person.
- **Split Utility.** A GMS Reg Server split, from the listed price or from what landed.

## Limits

- An unreadable stack count is dropped, never guessed.
- A rescaled capture (remote play, display scaling) is read at its own scale. Only a downscaled one
  is refused.
- No vision model and no API key. Reading a capture is a deterministic OpenCV pipeline, same answer
  every time.

Running it yourself: `.devcontainer/README.md`.

## Not a Nexon product

SharpEyes is an unofficial fan project. It is **not affiliated with, endorsed by, or sponsored by
Nexon**. MapleStory and all game assets are the property of Nexon.

It reads screenshots you took of your own account, and it ships some of the game's art so that what
it shows you looks like what you saw: boss portraits, item and drop icons, and the inventory count
digits. Those are used to identify what the game already showed you, and they remain Nexon's. The
project is free, carries no advertising, and is not sold.
