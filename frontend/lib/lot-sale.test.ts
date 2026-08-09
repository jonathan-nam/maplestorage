import { describe, expect, it } from "vitest";
import {
  fungibleDropKeys,
  lotDrops,
  lotQueue,
  lotSaleBody,
  priceLot,
  proposeLot,
} from "./lot-sale";
import { largestRemainder } from "./piece-ledger";
import { SELF_KEY } from "./vestige-ledger";
import type { BossDrop, DropTables } from "@/types/drop";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const M = 1_000_000;
const B = 1_000_000_000;
const STONE = "grindstone-of-faith";
const BOX = "eternal-armor-of-desire-box";

const seat = (id: string, name: string, { mine = false, shares = 1 } = {}): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: mine ? `char-${id}` : null,
  spriteImgUrl: null,
  guest: false,
  shares,
});

const party = (
  id: string,
  bossKey: string,
  members: PartyMember[],
  over: Partial<Party> = {},
): Party => ({
  id,
  characterId: members[0]!.characterId ?? `char-${members[0]!.id}`,
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey,
  difficulty: "HARD",
  minutes: null,
  looterMemberId: null,
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
  ...over,
});

const drop = (
  id: string,
  dropKey: string,
  droppedOn: string,
  ran: string[],
  over: Partial<Loot> = {},
): Loot => ({
  id,
  dropKey,
  customName: null,
  name: dropKey === STONE ? "Grindstone of Faith" : "Eternal Armor of Desire Box",
  iconUrl: null,
  perMember: null,
  bossKey: "limbo",
  quantity: 1,
  droppedOn,
  weekStart: droppedOn,
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
  bundles: null,
  bundlesBy: [],
  ...over,
});

const pool = (partyId: string, loot: Loot[]): PartyLootPool => ({ partyId, loot });

const catalogDrop = (dropKey: string, fungible: boolean): BossDrop => ({
  dropKey,
  name: dropKey,
  iconUrl: null,
  perMember: null,
  worlds: null,
  quantity: 1,
  fungible,
  pieces: {},
  bundles: {},
});

/** Your character and one stranger, in two parties on two bosses. */
const duo = () => [seat("m1", "Husky", { mine: true }), seat("m2", "Rune")];

describe("which drops are sold as a lot", () => {
  it("reads the catalog rather than a list of its own", () => {
    const tables: DropTables = {
      limbo: [catalogDrop(STONE, true), catalogDrop("whisper-of-the-source", false)],
      baldrix: [catalogDrop(STONE, true), catalogDrop("oath-of-death", false)],
    };
    expect(fungibleDropKeys(tables)).toEqual(new Set([STONE]));
  });

  it("is one answer per item however many bosses list it", () => {
    // The flag sits on the item, so a drop in two tables must not depend on which was read.
    const tables: DropTables = {
      limbo: [catalogDrop(BOX, true)],
      kaling: [catalogDrop(BOX, true)],
    };
    expect([...fungibleDropKeys(tables)]).toEqual([BOX]);
  });
});

describe("the queue a lot is drawn from", () => {
  const parties = [party("p1", "limbo", duo()), party("p2", "kaling", duo())];
  const pools = [
    pool("p1", [drop("l2", STONE, "2026-08-06", ["m1", "m2"])]),
    pool("p2", [drop("l1", STONE, "2026-07-30", ["m1", "m2"])]),
  ];

  it("is oldest first, across parties", () => {
    expect(lotQueue(parties, pools, STONE, SELF_KEY).map((r) => r.lootId)).toEqual(["l1", "l2"]);
  });

  it("names your own seat as the seller, and seeds the shares from the party", () => {
    const [first] = lotQueue(parties, pools, STONE, SELF_KEY);
    expect(first?.sellerMemberId).toBe("m1");
    expect(first?.shares).toEqual({ m1: 1, m2: 1 });
  });

  it("carries a standing share rather than flattening it", () => {
    const carried = [seat("m1", "Husky", { mine: true }), seat("m2", "Rune", { shares: 2 })];
    const queue = lotQueue(
      [party("p1", "limbo", carried)],
      [pool("p1", [drop("l1", STONE, "2026-07-30", ["m1", "m2"])])],
      STONE,
      SELF_KEY,
    );
    expect(queue[0]?.shares).toEqual({ m1: 1, m2: 2 });
  });

  it("leaves out a row that has already sold", () => {
    const sold = [
      pool("p1", [drop("l1", STONE, "2026-07-30", ["m1"], { soldAt: "2026-08-01T00:00:00Z" })]),
    ];
    expect(lotQueue(parties, sold, STONE, SELF_KEY)).toEqual([]);
  });

  it("leaves out another drop entirely", () => {
    expect(lotQueue(parties, pools, BOX, SELF_KEY)).toEqual([]);
  });

  it("leaves out a week you did not run, since the sale could not name you as seller", () => {
    const guestWeek = [pool("p1", [drop("l1", STONE, "2026-07-30", ["m2"])])];
    expect(lotQueue(parties, guestWeek, STONE, SELF_KEY)).toEqual([]);
  });

  it("leaves out a Heroic pool, where nothing is sold at all", () => {
    const heroic = [party("p1", "limbo", duo(), { worldType: "HEROIC" })];
    expect(
      lotQueue(heroic, [pool("p1", [drop("l1", STONE, "2026-07-30", ["m1"])])], STONE, SELF_KEY),
    ).toEqual([]);
  });
});

describe("proposing the rows a lot covers", () => {
  const queue = lotQueue(
    [party("p1", "limbo", duo())],
    [
      pool("p1", [
        drop("l1", STONE, "2026-07-16", ["m1"]),
        drop("l2", STONE, "2026-07-23", ["m1"]),
        drop("l3", STONE, "2026-07-30", ["m1"]),
      ]),
    ],
    STONE,
    SELF_KEY,
  );

  it("takes the oldest rows, and only as many as were sold", () => {
    const proposal = proposeLot(queue, 2);
    expect(proposal.rows.map((r) => r.lootId)).toEqual(["l1", "l2"]);
    expect(proposal.units).toBe(2);
  });

  it("proposes nothing for more than the queue holds, and says what it holds", () => {
    const proposal = proposeLot(queue, 5);
    expect(proposal.rows).toEqual([]);
    expect(proposal.reachable).toEqual([1, 2, 3]);
  });

  it("refuses a count that lands mid-row rather than rounding to the nearest", () => {
    // Two rows of two: 1 and 3 are not sellable amounts, and picking the closest would file a sale
    // for a quantity nobody entered.
    const stacked = lotQueue(
      [party("p1", "limbo", duo())],
      [
        pool("p1", [
          drop("l1", STONE, "2026-07-16", ["m1"], { quantity: 2 }),
          drop("l2", STONE, "2026-07-23", ["m1"], { quantity: 2 }),
        ]),
      ],
      STONE,
      SELF_KEY,
    );
    expect(proposeLot(stacked, 3).rows).toEqual([]);
    expect(proposeLot(stacked, 3).reachable).toEqual([2, 4]);
    expect(proposeLot(stacked, 4).rows.map((r) => r.lootId)).toEqual(["l1", "l2"]);
  });

  it("proposes nothing for nothing", () => {
    expect(proposeLot(queue, 0).rows).toEqual([]);
  });
});

describe("what each row of a lot sold for", () => {
  const rowsOf = (units: number[]) =>
    units.map((u, i) => ({
      lootId: `l${i}`,
      partyId: "p1",
      units: u,
      name: "Grindstone of Faith",
      iconUrl: null,
      bossKey: "limbo",
      droppedOn: "2026-07-16",
      weekStart: "2026-07-16",
      characterId: "char-m1",
      sellerMemberId: "m1",
      sellerName: "Husky",
      shares: { m1: 1 },
    }));

  it("divides the total evenly when it divides", () => {
    expect(priceLot(2 * B, rowsOf([1, 1, 1, 1]))).toEqual([500 * M, 500 * M, 500 * M, 500 * M]);
  });

  it("adds up to exactly the total when it does not divide", () => {
    const amounts = priceLot(1 * B, rowsOf([1, 1, 1]));
    expect(amounts.reduce((sum, n) => sum + n, 0)).toBe(1 * B);
    // The odd meso goes to one row, not to none of them: a per-unit price rounded and multiplied
    // out would leave the party a meso short with every figure looking ordinary.
    expect(amounts).toEqual([333_333_334, 333_333_333, 333_333_333]);
  });

  it("prices a row of three at three times a row of one", () => {
    expect(priceLot(4 * B, rowsOf([3, 1]))).toEqual([3 * B, 1 * B]);
  });

  it("is the same arithmetic the piece ledger divides pieces with", () => {
    expect(priceLot(7, rowsOf([1, 1, 1]))).toEqual(largestRemainder(7, [1, 1, 1]));
  });
});

describe("the request a confirmed lot sends", () => {
  const queue = lotQueue(
    [party("p1", "limbo", duo()), party("p2", "kaling", duo())],
    [
      pool("p1", [drop("l1", STONE, "2026-07-16", ["m1", "m2"])]),
      pool("p2", [drop("l2", STONE, "2026-07-23", ["m1", "m2"])]),
    ],
    STONE,
    SELF_KEY,
  );

  it("names every row with its own party, seller and slice", () => {
    const body = lotSaleBody(STONE, 2 * B, "RECEIVED", "FAIR", proposeLot(queue, 2).rows);
    expect(body.rows).toEqual([
      {
        partyId: "p1",
        lootId: "l1",
        amount: 1 * B,
        sellerMemberId: "m1",
        shares: { m1: 1, m2: 1 },
      },
      {
        partyId: "p2",
        lootId: "l2",
        amount: 1 * B,
        sellerMemberId: "m1",
        shares: { m1: 1, m2: 1 },
      },
    ]);
  });

  it("carries the total, which is what the server checks the slices against", () => {
    const body = lotSaleBody(STONE, 1 * B, "LISTED", "LAZY", proposeLot(queue, 2).rows);
    expect(body.total).toBe(1 * B);
    expect(body.rows.reduce((sum, r) => sum + r.amount, 0)).toBe(body.total);
  });
});

describe("the drops a lot can be entered for", () => {
  it("lists only what is waiting, most units first", () => {
    const parties = [party("p1", "limbo", duo())];
    const pools = [
      pool("p1", [
        drop("l1", STONE, "2026-07-16", ["m1"]),
        drop("l2", STONE, "2026-07-23", ["m1"]),
        drop("l3", BOX, "2026-07-23", ["m1"]),
        // Sold, so it is not waiting for anything.
        drop("l4", BOX, "2026-07-30", ["m1"], { soldAt: "2026-08-01T00:00:00Z" }),
      ]),
    ];
    const drops = lotDrops(parties, pools, new Set([STONE, BOX]), SELF_KEY);
    expect(drops.map((d) => [d.dropKey, d.units])).toEqual([
      [STONE, 2],
      [BOX, 1],
    ]);
  });

  it("leaves out a drop with an empty queue rather than showing a box that refuses everything", () => {
    const drops = lotDrops(
      [party("p1", "limbo", duo())],
      [pool("p1", [])],
      new Set([STONE]),
      SELF_KEY,
    );
    expect(drops).toEqual([]);
  });
});
