import { describe, expect, it } from "vitest";
import { rotatingDrops, rotationFor } from "./loot-rotation";
import type { BossDrop, DropTables } from "@/types/drop";
import type { Loot } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const mine = (id: string, name: string): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: `char-${id}`,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const theirs = (id: string, name: string, personId = `p-${id}`): PartyMember => ({
  id,
  name,
  personId,
  personName: name,
  characterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const party = (members: PartyMember[], over: Partial<Party> = {}): Party => ({
  id: "pa",
  characterId: "char-m1",
  solo: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "kalos-the-guardian",
  difficulty: "CHAOS",
  minutes: null,
  members,
  seats: members,
  looterMemberId: null,
  usualRoster: true,
  skippedThisPeriod: false,
  oneOff: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  ...over,
});

const TOKEN = "kalos-token";

const token = (over: Partial<BossDrop> = {}): BossDrop => ({
  dropKey: TOKEN,
  name: "Kalos's Residual Determination",
  iconUrl: null,
  perMember: "HEROIC",
  worlds: null,
  quantity: 1,
  fungible: false,
  untradeable: true,
  pieces: { INTERACTIVE: { CHAOS: 5, EXTREME: 14 }, HEROIC: { CHAOS: 2, EXTREME: 3 } },
  bundles: { INTERACTIVE: { CHAOS: 5, EXTREME: 14 }, HEROIC: { CHAOS: 2, EXTREME: 3 } },
  ...over,
});

/**
 * A night of pieces. `by` is who bent down for how many, which for these IS the piece count.
 *
 * `ran` is stated apart from `by` on purpose: running and looting nothing is the entire case this
 * file exists for, and deriving the roster from the pickups would make that case unwritable.
 */
const night = (
  id: string,
  quantity: number,
  by: Record<string, number>,
  ran: string[] = Object.keys(by),
  over: Partial<Loot> = {},
): Loot => ({
  id,
  dropKey: TOKEN,
  customName: null,
  name: "Kalos's Residual Determination",
  iconUrl: null,
  perMember: "HEROIC",
  bossKey: "kalos-the-guardian",
  quantity,
  droppedOn: "2026-08-06",
  weekStart: "2026-08-06",
  status: "PENDING",
  saleAmount: null,
  amountBasis: null,
  splitMethod: null,
  sellerShares: null,
  sellerMemberId: null,
  takenByMemberId: null,
  soldAt: null,
  payouts: [],
  ranThatWeek: ran,
  // One token is one bundle, which is what lets a party divide these down to the single piece.
  bundles: quantity,
  bundlesBy: Object.entries(by).map(([memberId, bundles]) => ({ memberId, bundles })),
  ...over,
});

type Rotated = { holders: { name: string; takes: number; behind: number }[] };
const takesOf = (r: Rotated) => Object.fromEntries(r.holders.map((h) => [h.name, h.takes]));
const behindOf = (r: Rotated) => Object.fromEntries(r.holders.map((h) => [h.name, h.behind]));
const totalTaken = (r: Rotated) => r.holders.reduce((sum, h) => sum + h.takes, 0);

/** A sixth, which is the unit a five-across-six rotation moves in. */
const SIXTH = 1 / 6;

describe("which drops rotate at all", () => {
  const tables = (drop: BossDrop): DropTables => ({ "kalos-the-guardian": [drop] });
  const duo = () => party([mine("m1", "Husky"), theirs("m2", "Rune")]);

  it("rotates a pooled untradeable piece at the mode being run", () => {
    expect(rotatingDrops(duo(), tables(token())).map((d) => d.dropKey)).toEqual([TOKEN]);
  });

  it("does not rotate on Heroic, where everyone gets their own", () => {
    // The count is there for Heroic too, and it is 2 EACH rather than 2 to share. Dividing it would
    // pay everybody a share of something they already hold, which is what per_member exists to stop.
    const heroic = party([mine("m1", "Husky"), theirs("m2", "Rune")], { worldType: "HEROIC" });
    expect(rotatingDrops(heroic, tables(token()))).toEqual([]);
  });

  it("does not rotate a drop that is instanced in both worlds", () => {
    // Limbo, Baldrix and Jupiter. Nothing to divide anywhere, so no rotation anywhere.
    expect(rotatingDrops(duo(), tables(token({ perMember: "ALWAYS" })))).toEqual([]);
  });

  it("does not rotate a coupon, which settles in the ledger instead", () => {
    const coupon = token({ dropKey: "vestige-of-erion", perMember: null, untradeable: false });
    expect(rotatingDrops(duo(), tables(coupon))).toEqual([]);
  });

  it("does not rotate at a mode the boss drops none at, or with no mode named", () => {
    const seats = [mine("m1", "Husky"), theirs("m2", "Rune")];
    // Easy Kalos drops none, and the catalog carries no row for it rather than a zero.
    expect(rotatingDrops(party(seats, { difficulty: "EASY" }), tables(token()))).toEqual([]);
    expect(rotatingDrops(party(seats, { difficulty: null }), tables(token()))).toEqual([]);
  });
});

describe("a rotation nobody has answered for yet", () => {
  // The starting state: the balance begins at the first recorded pickup, with no backtracking over
  // the weeks before it.
  const seats = [mine("m1", "Husky"), theirs("m2", "Rune"), theirs("m3", "Free")];

  it("carries nobody, and still says what an even week looks like", () => {
    const r = rotationFor(party(seats), [], token(), 5)!;

    expect(r.weeks).toBe(0);
    expect(behindOf(r)).toEqual({ you: 0, Rune: 0, Free: 0 });
    // 5 across 3 is 1 each with 2 spare, and with nobody behind the spares go by position.
    expect(takesOf(r)).toEqual({ you: 2, Rune: 2, Free: 1 });
  });

  it("ignores a week the drop fell in that nobody filled the boxes for", () => {
    const r = rotationFor(party(seats), [night("l1", 5, {})], token(), 5)!;

    expect(r.weeks).toBe(0);
    expect(behindOf(r)).toEqual({ you: 0, Rune: 0, Free: 0 });
  });
});

describe("the balance carries the fraction, which is what makes it turn", () => {
  const six = [
    mine("m1", "Husky"),
    theirs("m2", "Rune"),
    theirs("m3", "Free"),
    theirs("m4", "Creed"),
    theirs("m5", "Dwight"),
    theirs("m6", "Pam"),
  ];
  const ALL = ["m1", "m2", "m3", "m4", "m5", "m6"];

  it("shows a zero take, because somebody's turn is to miss one", () => {
    // Chaos Kalos on Interactive gives 5 to the whole party. Six people, so one of them gets none,
    // every single week. That is the line the screen exists to draw.
    const r = rotationFor(party(six), [], token(), 5)!;

    expect(r.even).toBe(false);
    expect(Object.values(takesOf(r)).filter((n) => n === 0)).toHaveLength(1);
    expect(totalTaken(r)).toBe(5);
  });

  it("measures against the EXACT share, not the whole-piece entitlement", () => {
    // The mechanism, and the thing that was wrong first time. Five across six has no whole-number
    // entitlement, so largestRemainder breaks the tie by POSITION: the same five seats would be
    // entitled to one every week and the sixth to none, nobody would ever be behind, and the
    // rotation would never move. Against 5/6 each, the one who got none is five sixths behind.
    const week1 = night("l1", 5, { m1: 1, m2: 1, m3: 1, m4: 1, m5: 1 }, ALL);
    const r = rotationFor(party(six), [week1], token(), 5)!;

    expect(r.weeks).toBe(1);
    expect(behindOf(r).Pam).toBeCloseTo(5 * SIXTH);
    expect(behindOf(r).you).toBeCloseTo(-SIXTH);
    // And this week she is the one who is not left out.
    expect(takesOf(r).Pam).toBe(1);
    expect(totalTaken(r)).toBe(5);
  });

  it("turns, so a different person misses each week", () => {
    // Six weeks of Chaos Kalos, each one answered with whatever the rotation said. Everybody should
    // have missed exactly once, which is the whole promise.
    const seats = party(six);
    const rows: Loot[] = [];
    const missed: string[] = [];

    for (let week = 0; week < 6; week += 1) {
      const r = rotationFor(seats, rows, token(), 5)!;
      missed.push(r.holders.find((h) => h.takes === 0)!.name);
      const by: Record<string, number> = {};
      for (const seat of six) {
        const take = r.holders.find((h) => h.name === (seat.personName ?? "you"))!.takes;
        if (take > 0) by[seat.id] = take;
      }
      rows.push(night(`l${week}`, 5, by, ALL));
    }

    expect(new Set(missed).size).toBe(6);
  });

  it("never writes the shortfall off, because nothing can settle it", () => {
    // The difference from a coupon. Three weeks of missing out is two and a half pieces owed, and
    // there is no tranche, no sale and no closure that makes it go away. Only looting does.
    const missed = (id: string, on: string) =>
      night(id, 5, { m1: 1, m2: 1, m3: 1, m4: 1, m5: 1 }, ALL, { droppedOn: on, weekStart: on });
    const rows = [
      missed("l1", "2026-07-23"),
      missed("l2", "2026-07-30"),
      missed("l3", "2026-08-06"),
    ];

    const r = rotationFor(party(six), rows, token(), 5)!;

    expect(r.weeks).toBe(3);
    expect(behindOf(r).Pam).toBeCloseTo(3 * 5 * SIXTH);
    // Still only one piece this week: the schedule works a shortfall off a piece at a time, it does
    // not hand somebody three at once and starve everybody else.
    expect(takesOf(r).Pam).toBe(1);
  });

  it("counts somebody who took more than their share as ahead", () => {
    const r = rotationFor(party(six), [night("l1", 5, { m1: 5 }, ALL)], token(), 5)!;

    expect(behindOf(r).you).toBeCloseTo(5 * SIXTH - 5);
    expect(behindOf(r).Pam).toBeCloseTo(5 * SIXTH);
    // So you are last in line, and take none this week.
    expect(takesOf(r).you).toBe(0);
  });

  it("balances to zero across the party, so nothing is invented or lost", () => {
    const rows = [night("l1", 5, { m1: 3, m2: 2 }, ALL), night("l2", 5, { m3: 5 }, ALL)];
    const r = rotationFor(party(six), rows, token(), 5)!;

    expect(r.holders.reduce((sum, h) => sum + h.behind, 0)).toBeCloseTo(0);
  });
});

describe("what a rotation measures itself against", () => {
  it("folds two characters of one person into one turn", () => {
    // A person with two characters is one holder with two shares: entitled to twice as much, and
    // entitled to it once. Reading it per seat would give them two turns in the queue.
    const seats = [
      mine("m1", "Husky"),
      { ...theirs("m2", "Rune", "p-rune"), name: "RuneAlt" },
      theirs("m3", "Rune", "p-rune"),
    ];
    const r = rotationFor(party(seats), [], token(), 6)!;

    expect(r.holders).toHaveLength(2);
    // Six pieces, one share against two, so four are theirs and two are yours.
    expect(takesOf(r)).toEqual({ you: 2, Rune: 4 });
  });

  it("divides an old night by the roster that ran THAT week", () => {
    // The pool spans months and `members` is whichever week the page asked for. A trio's night read
    // against today's duo would owe a share to somebody who was not there.
    const all = [mine("m1", "Husky"), theirs("m2", "Rune"), theirs("m3", "Free")];
    const nowADuo = party([all[0]!, all[1]!], { seats: all });
    const july = night("l1", 3, { m1: 2, m2: 1 }, ["m1", "m2", "m3"]);

    const r = rotationFor(nowADuo, [july], token(), 3)!;

    // One each across the three who ran, so taking two of them is one ahead.
    expect(behindOf(r).you).toBeCloseTo(-1);
    expect(behindOf(r).Rune).toBeCloseTo(0);
  });

  it("weighs the turns by the shares the party agreed", () => {
    const seats = [{ ...mine("m1", "Husky"), shares: 2 }, theirs("m2", "Rune")];
    const r = rotationFor(party(seats), [], token(), 6)!;

    expect(takesOf(r)).toEqual({ you: 4, Rune: 2 });
    expect(r.even).toBe(true);
  });

  it("says an even split is even, and carries nobody", () => {
    // 18 Extreme Kaling pieces across six is 3 each, so the rotation never has to move. It is still
    // drawn: that is what says nobody is behind.
    const six = ["m1", "m2", "m3", "m4", "m5", "m6"].map((id, i) =>
      i === 0 ? mine(id, "Husky") : theirs(id, `P${i}`),
    );
    const r = rotationFor(party(six), [], token(), 18)!;

    expect(r.even).toBe(true);
    expect(new Set(Object.values(takesOf(r)))).toEqual(new Set([3]));
  });
});

describe("what a rotation refuses to read", () => {
  const seats = [mine("m1", "Husky"), theirs("m2", "Rune")];

  it("skips a week whose stacks were never counted", () => {
    // bundles null is uncounted, NOT one stack, so what a pickup of "2" means is unknown. Reading it
    // as 2 pieces on a drop that fell in stacks of 30 would be out by a factor of thirty.
    const unreadable = night("l1", 5, { m1: 3, m2: 2 }, ["m1", "m2"], { bundles: null });
    expect(rotationFor(party(seats), [unreadable], token(), 5)!.weeks).toBe(0);
  });

  it("skips a week naming a seat the party cannot resolve", () => {
    // Silently dropping the row would shrink what was looted and invent a shortfall out of nothing.
    const ghost = night("l1", 5, { m1: 3, gone: 2 }, ["m1", "m2"]);
    expect(rotationFor(party(seats), [ghost], token(), 5)!.weeks).toBe(0);
  });

  it("counts only its own drop, so fragments never mix with tokens", () => {
    // Two of a fragment make one token, and it is still a separate rotation. A party runs one mode,
    // so the two never fall in the same week, and crediting a fragment turn against a token one
    // would say somebody had their turn when they did not.
    const fragments = night("l1", 3, { m1: 3 }, ["m1", "m2"], {
      dropKey: "kalos-residual-determination-fragment",
    });
    expect(rotationFor(party(seats), [fragments], token(), 5)!.weeks).toBe(0);
  });

  it("has nothing to say with no roster, or a mode that drops none", () => {
    expect(rotationFor(party([]), [], token(), 5)).toBeNull();
    expect(rotationFor(party(seats), [], token(), 0)).toBeNull();
  });
});
