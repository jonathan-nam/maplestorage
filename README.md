<!-- docs/sharpeyes-mark.png is a 4x nearest-neighbour upscale of frontend/app/icon.png.
     Regenerate it the same way if the mark changes, or the README stops matching the app. -->
<p align="center">
  <img src="docs/sharpeyes-mark.png" width="128" alt="">
</p>

<h1 align="center">SharpEyes</h1>

<p align="center"><em>A greater view of your whole MapleStory account.</em></p>

The game only ever shows you one character at a time. Farming the same Grandis boss across a stable
of mules is normal, and so is having no idea how close you actually are to a full Eternal set, which
bosses tonight still owes you, or who you have to pay for last week's drop.

Screenshot your characters, drop the lot in, and SharpEyes does the counting.

## Your items, every character at once

**Add a character by name.** It looks up the level, job and sprite for you.

**Drop a screenshot on the character it belongs to.** Inventory open, that is all it needs. It reads
which items are there and how many of each. It also reads the name out of the game's HUD, not to
guess whose screenshot it is, but to *check*: if the picture disagrees with the character you
dropped it on, it says so rather than filing it anyway.

**Search the way you would say it.** `kaling`, `eternal hat`, `robe`, `symbol`. You get who is
holding a match, how many, and **what each of them can redeem right now**.

It tracks 26 items: the six Eternal boss pieces, the thirteen Arcane and Sacred symbol coupons, and
seven consumables.

That redemption number is the point, and it is the one the arithmetic gets wrong. Eternal pieces
cannot be pooled: six on one character and four on another is not a set, it is two characters who
are both short. Nor can they be mixed, nine Kalos and one Kaling is nine and one. And the two
piece-sets do not buy the same thing. Kalos / Kaling / First Adversary / Malefic Star pieces make a
Hat, Top, Bottom or Shoulder, while Limbo and Baldrix pieces make a Cape, Glove or Shoe. Ten of each
is one armour and one accessory, never two of anything.

## Your bosses, week by week

**Drop a Maple Planner screenshot per character** and it reads which bosses that character has
cleared this period. The list usually takes two or three captures, one per scroll position. Anything
it cannot read, you tick by hand.

**Individual View** is which bosses each character has cleared. **Party View** is the same week
grouped by who you run each boss with, at what difficulty. Both step back through earlier weeks,
which are read-only.

**Who runs what** takes the bosses a character does not run out of the count, so a week can actually
finish.

## Your night

**Run Order** builds the night. Say who is around and how long you have, and it orders the runs that
fit, what got left out for time, and what cannot be scheduled at all (someone is away, or one person
is sitting in two seats of the same run). Bosses already cleared this period can be dropped from the
list. Copy the order as text and paste it into party chat.

## Your money

**Drop Log and Wallet.** Log what a party dropped and what it sold for, and the pool works out each
person's share. The Wallet is the running total across every party: what you owe, what you are owed,
and settling with a person clears every share between you at once.

**Split Utility** is the same sum on its own, for a GMS Reg Server split, from either the listed
price or what actually landed in your inventory.

## What it will not do

**Report a count it cannot stand behind.** An item whose stack count is unreadable is dropped rather
than reported with a guessed number. A plausible wrong number is the only failure this project
really has.

**Refuse a screenshot it can actually read.** A rescaled capture (remote play, display scaling) is
read at its own scale rather than rejected. Only a *downscaled* one is refused, because that
genuinely throws pixels away.

**Send your screenshots to an AI.** There is no vision model and no API key anywhere in this.
Reading a capture is a deterministic OpenCV pipeline: it costs nothing, makes no call out of the
machine it runs on, and gives the same answer every time.

---

Running it yourself: `.devcontainer/README.md`.
