import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FATES,
  asksAnything,
  coversThePile,
  owes,
  roomFor,
  settledOf,
  worthDrawing,
} from "./ledger-fates";
import {
  type Holder,
  alsoHeldByYou,
  holderLedgers,
  keptByHolder,
  outstanding,
  boughtByHolder,
  salesByHolder,
  unaccounted,
} from "./vestige-ledger";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const M = 1_000_000;
const VESTIGE = "vestige-of-erion";
const ORDER = new Map([["limbo", 6]]);

const seat = (
  id: string,
  name: string,
  { mine = false, person = null as [string, string] | null } = {},
): PartyMember => ({
  id,
  name,
  personId: person?.[0] ?? null,
  personName: person?.[1] ?? null,
  characterId: mine ? `char-${id}` : null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const party = (members: PartyMember[], looter: string | null): Party => ({
  id: "pa",
  characterId: "char-m1",
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "limbo",
  difficulty: "HARD",
  minutes: null,
  looterMemberId: looter,
  members,
  seats: members,
  usualRoster: true,
  skippedThisPeriod: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
});

const coupon = (quantity: number): Loot => ({
  id: "l1",
  dropKey: VESTIGE,
  customName: null,
  name: "Vestige of Erion Coupon",
  iconUrl: null,
  perMember: null,
  bossKey: "limbo",
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
  ranThatWeek: [],
  bundles: null,
  bundlesBy: [],
});

const pool = (loot: Loot[]): PartyLootPool => ({ partyId: "pa", loot });

const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
const BRO: Holder = { kind: "PERSON", personId: "p-bro", characterName: null };

/**
 * A night YOU looted all of: 60 pieces, half of them Bro's.
 *
 * Your own pile holding somebody else's pieces, which is the shape the fate list used to have no
 * answer for. A duo rather than a solo, because a solo owes nobody and the surplus never appears.
 */
const yourPile = (kept = 0, bought = { pieces: 0, paid: 0 }) =>
  holderLedgers(
    outstanding(
      [
        party(
          [
            seat("m1", "Husky", { mine: true }),
            seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
          ],
          "m1",
        ),
      ],
      [pool([coupon(60)])],
      VESTIGE,
      ORDER,
    ),
    new Map(),
    keptByHolder(kept > 0 ? [{ holder: SELF, pieces: kept, amount: null }] : []),
    boughtByHolder(
      bought.pieces > 0
        ? [{ holder: SELF, pieces: bought.pieces, amount: bought.paid, disposition: "BOUGHT" }]
        : [],
    ),
  )[0]!;

/**
 * A night that divided the way it fell: a duo, 60 in 2 stacks, one each.
 *
 * Nobody owes anybody, so `outstanding` drops it and `alsoHeldByYou` is what puts your 30 on the
 * card, which is the only reason the pile is drawn at all. The shape the card used to demand 30
 * pieces of typing for.
 */
const squarePile = () => {
  const parties = [
    party(
      [seat("m1", "Husky", { mine: true }), seat("m2", "BroChar", { person: ["p-bro", "Bro"] })],
      null,
    ),
  ];
  const pools = [pool([{ ...coupon(60), bundles: 2 }])];
  const queued = outstanding(parties, pools, VESTIGE, ORDER);
  // The premise: a square night owes nothing, so it is not in the queue at all.
  expect(queued).toHaveLength(0);
  return holderLedgers(alsoHeldByYou(parties, pools, VESTIGE, ORDER, queued), new Map())[0]!;
};

describe("the answers a pile can be given", () => {
  it("offers all three whoever is holding it", () => {
    // BOUGHT used to be somebody else's fate only. It is not about buying your own coupons, it is
    // about the pieces in a pile that are NOT the holder's, and your own inventory holds those.
    expect([...FATES]).toEqual(["SOLD", "KEPT", "BOUGHT"]);
  });

  it("stops a redemption at the holder's own share", () => {
    const mine = yourPile();
    expect([mine.pieces, mine.ownShare]).toEqual([60, 30]);
    expect(roomFor(mine, "KEPT")).toBe(30);
  });

  it("gives the purchase exactly what the redemption turns away", () => {
    const mine = yourPile();
    expect(roomFor(mine, "BOUGHT")).toBe(30);
  });

  it("bounds a sale only by what is still unanswered, since it names no owner", () => {
    expect(roomFor(yourPile(), "SOLD")).toBe(60);
  });

  it("counts rows already entered against all three, so three cannot walk past what one cannot", () => {
    const half = yourPile(30);
    expect(unaccounted(half)).toBe(30);
    expect(roomFor(half, "KEPT")).toBe(0);
    expect(roomFor(half, "SOLD")).toBe(30);
    expect(roomFor(half, "BOUGHT")).toBe(30);
  });
});

// The dead end this file exists to close. Your own card offered SOLD and KEPT, and KEPT stops at your
// own share, so the 30 pieces of Bro's in your inventory could only ever be sold: a pile you meant to
// keep sat at "30 of 60 accounted for" forever, with nothing on screen saying which answer was
// missing. Nobody may be forced to sell a coupon to make a count come out.
describe("whether the answers can account for the whole pile", () => {
  it("covers your own pile, which holds somebody else's pieces", () => {
    expect(coversThePile(yourPile())).toBe(true);
  });

  it("covers it after the redemption has taken your own share", () => {
    expect(coversThePile(yourPile(30))).toBe(true);
  });

  it("reaches nothing left to answer without a single sale", () => {
    const done = yourPile(30, { pieces: 30, paid: 750 * M });
    expect(unaccounted(done)).toBe(0);
    expect(coversThePile(done)).toBe(true);
  });

  it("covers somebody else's pile the same way", () => {
    const theirs = holderLedgers(
      outstanding(
        [
          party(
            [
              seat("m1", "Husky", { mine: true }),
              seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
            ],
            "m2",
          ),
        ],
        [pool([coupon(60)])],
        VESTIGE,
        ORDER,
      ),
      new Map(),
    ).find((l) => l.holder.kind === "PERSON")!;
    expect(theirs.holder).toEqual(BRO);
    expect(coversThePile(theirs)).toBe(true);
  });
});

// A pile that owes nobody gets the same figures whatever it is told, because #354 left no debt
// derived from these rows. So the count is an instruction with no consequence, and 24 square nights
// asked for 1140 pieces of typing to move a figure nobody reads.
describe("whether the card has anything to ask", () => {
  it("asks nothing of a night that divided the way it fell", () => {
    const square = squarePile();
    expect(square.pieces).toBe(30);
    expect(owes(square)).toBe(0);
    // The pile is unaccounted for and that is fine: nothing turns on the answer.
    expect(unaccounted(square)).toBe(30);
    expect(asksAnything(square)).toBe(false);
  });

  it("still asks a pile that owes somebody, which is what the count is for", () => {
    const mine = yourPile();
    expect(owes(mine)).toBe(30);
    expect(asksAnything(mine)).toBe(true);
  });

  it("stops once the debt is bought out, whatever is left unentered", () => {
    // The 30 owed are answered. The other 30 are your own and nobody is waiting on them, so the
    // card has nothing left to ask even though half the pile has no row against it.
    const done = yourPile(0, { pieces: 30, paid: 750 * M });
    expect([owes(done), settledOf(done)]).toEqual([30, 30]);
    expect(unaccounted(done)).toBe(30);
    expect(asksAnything(done)).toBe(false);
  });

  it("counts the debt, not the pile, so 1150 of your own do not join the question", () => {
    // The complaint this exists for: a 10-piece debt read "0 of 1160 pieces accounted for".
    const mine = yourPile();
    expect(mine.pieces).toBe(60);
    expect(owes(mine)).toBe(30);
    expect(settledOf(mine)).toBe(0);
  });

  it("does not let a redemption answer a debt, since it is the holder's own share", () => {
    const kept = yourPile(30);
    expect(settledOf(kept)).toBe(0);
    expect(asksAnything(kept)).toBe(true);
  });

  it("does not let a SALE answer one either, which is the trap", () => {
    // Coupons are single-trade, so selling the creditor's pieces does not hand them back, and since
    // #354 nothing says which of a mixed pile went out. Counting a sale here would report a debt
    // discharged that nobody was paid for.
    const sold = holderLedgers(
      outstanding(
        [
          party(
            [
              seat("m1", "Husky", { mine: true }),
              seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
            ],
            "m1",
          ),
        ],
        [pool([coupon(60)])],
        VESTIGE,
        ORDER,
      ),
      salesByHolder([{ holder: SELF, pieces: 60, amount: 1_500 * M }]),
    )[0]!;
    expect(sold.soldPieces).toBe(60);
    expect(settledOf(sold)).toBe(0);
    expect(asksAnything(sold)).toBe(true);
  });

  it("speaks up when more was entered than the pile holds, owed or not", () => {
    // A miscount is the one thing a quiet card may not swallow. 40 kept against a 30 pile.
    const over = holderLedgers(
      alsoHeldByYou(
        [
          party(
            [
              seat("m1", "Husky", { mine: true }),
              seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
            ],
            null,
          ),
        ],
        [pool([{ ...coupon(60), bundles: 2 }])],
        VESTIGE,
        ORDER,
        [],
      ),
      new Map(),
      keptByHolder([{ holder: SELF, pieces: 40, amount: null }]),
    )[0]!;
    expect([over.pieces, over.accounted]).toEqual([30, 40]);
    expect(owes(over)).toBe(0);
    expect(asksAnything(over)).toBe(true);
  });
});

// A pile that owes nobody is not a card. It is still a place a sale MAY be recorded, so it is held
// back rather than dropped: dropping it would re-break what alsoHeldByYou exists for.
describe("which of your own piles the ledger draws", () => {
  const none = () => false;

  it("holds back a pile with no debt and no rows", () => {
    const { drawn, quiet } = worthDrawing([squarePile()], none);
    expect(drawn).toHaveLength(0);
    expect(quiet).toHaveLength(1);
  });

  it("draws one that owes somebody", () => {
    const { drawn, quiet } = worthDrawing([yourPile()], none);
    expect(drawn).toHaveLength(1);
    expect(quiet).toHaveLength(0);
  });

  it("draws a settled one that has rows, so a mistyped tranche stays reachable", () => {
    // The debt is bought out, so it asks nothing. It is still a card, because the rows that made it
    // settled are corrected here and nowhere else.
    const done = yourPile(0, { pieces: 30, paid: 750 * M });
    expect(asksAnything(done)).toBe(false);
    expect(worthDrawing([done], () => true).drawn).toHaveLength(1);
    // And without them there would be nothing on it to correct.
    expect(worthDrawing([done], none).quiet).toHaveLength(1);
  });

  it("keeps a miscounted pile on screen even though it owes nothing", () => {
    const over = holderLedgers(
      alsoHeldByYou(
        [
          party(
            [
              seat("m1", "Husky", { mine: true }),
              seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
            ],
            null,
          ),
        ],
        [pool([{ ...coupon(60), bundles: 2 }])],
        VESTIGE,
        ORDER,
        [],
      ),
      new Map(),
      keptByHolder([{ holder: SELF, pieces: 40, amount: null }]),
    )[0]!;
    expect(owes(over)).toBe(0);
    expect(worthDrawing([over], none).drawn).toHaveLength(1);
  });
});

// A source test rather than a unit one: what went wrong was a condition in the JSX, not a figure.
// The option list is where the dead end was, so this is the line that must not come back.
const source = readFileSync(join(__dirname, "..", "components", "piece-ledger.tsx"), "utf8");

/** The picker itself, so a stray "SELF" elsewhere in the card cannot satisfy these. */
const picker = source.match(/<select[\s\S]*?<\/select>/);

describe("the picker the card draws", () => {
  it("draws an option per fate rather than a hand-written list", () => {
    expect(picker).not.toBeNull();
    expect(picker![0]).toContain("FATES.map");
  });

  it("gates no option on whose pile it is, which is what left yours unanswerable", () => {
    expect(picker![0]).not.toContain('!== "SELF"');
  });

  it("puts the count behind the question, so a square pile is not asked", () => {
    // The gate is the whole fix. Ungated, the count returns and every square night demands a
    // pile's worth of typing again.
    expect(source).toMatch(/asksAnything\(ledger\) && \(\s*<span className="ledger-progress">/);
  });

  it("leaves the form ungated, so a sale is offered where it is no longer demanded", () => {
    // Hiding the form with the count would re-break what alsoHeldByYou exists for: a Sale Ledger
    // that will not admit you hold the coupons cannot take the sale.
    expect(source).toMatch(/\{\(toEnter > 0 \|\| ledger\.pieces === 0\) && \(\s*<form/);
  });

  it("words the purchase for the pile it is drawn on, since the directions are opposite claims", () => {
    // "they took mine" on your own pile says the reverse of what it would mean.
    expect(source).toContain("I took theirs, at a price");
    expect(source).toContain("they took mine, at a price");
  });
});

// Holding a pile back is only safe while there is a way to ask for it. Nothing in lib can see the
// Drop Log's own wiring, and the failure is silent: the card simply never comes back, and the
// coupons become unsellable through the app.
const page = readFileSync(join(__dirname, "..", "app", "bosses", "drops", "page.tsx"), "utf8");

describe("the way back to a pile the ledger held back", () => {
  it("offers it, and only while it is still held back", () => {
    expect(page).toMatch(/quiet\.length > 0 && !sellingOwn/);
    expect(page).toContain("Record a sale");
  });

  it("draws the held-back piles once it is asked for", () => {
    expect(page).toMatch(/sellingOwn \? \[\.\.\.drawn, \.\.\.quiet\] : drawn/);
  });

  it("gates the heading on what will draw, not on there being ledgers at all", () => {
    // A heading over no cards is a heading over nothing, and holding a pile back is exactly what
    // empties the section underneath it.
    expect(page).not.toMatch(/sellableLots \|\| ledgers\.length > 0/);
    expect(page).toMatch(/sellableLots \|\| shownYours\.length > 0 \|\| history\.length > 0/);
  });
});
