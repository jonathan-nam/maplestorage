import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FATES, coversThePile, roomFor } from "./ledger-fates";
import {
  type Holder,
  holderLedgers,
  keptByHolder,
  outstanding,
  boughtByHolder,
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

  it("words the purchase for the pile it is drawn on, since the directions are opposite claims", () => {
    // "they took mine" on your own pile says the reverse of what it would mean.
    expect(source).toContain("I took theirs, at a price");
    expect(source).toContain("they took mine, at a price");
  });
});
