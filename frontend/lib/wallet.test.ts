import { describe, expect, it } from "vitest";
import { splitOf } from "./loot";
import { buildWallet, netLabel, settlementFor, transferLine, type Counterparty } from "./wallet";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

// A seat of YOURS: linked to your roster, which is what makes it your side of a debt.
const mine = (id: string, name: string): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: `char-${id}`,
  spriteImgUrl: null,
});

// Somebody else's seat. personId set means you have said whose character it is.
const theirs = (id: string, name: string, person?: { id: string; name: string }): PartyMember => ({
  id,
  name,
  personId: person?.id ?? null,
  personName: person?.name ?? null,
  characterId: null,
  spriteImgUrl: null,
});

const chris = { id: "p-chris", name: "Chris" };

const party = (id: string, members: PartyMember[], over: Partial<Party> = {}): Party => ({
  id,
  characterId: members[0]!.characterId!,
  bossKey: "limbo",
  difficulty: null,
  members,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  ...over,
});

const sold = (over: Partial<Loot> = {}): Loot => ({
  id: "l1",
  dropKey: "grindstone-of-faith",
  customName: null,
  name: "Grindstone of Faith",
  iconUrl: null,
  perMember: null,
  bossKey: "limbo",
  droppedOn: "2026-07-20",
  status: "SOLD",
  saleAmount: 9_500_000_000,
  amountBasis: "LISTED",
  splitMethod: "FAIR",
  sellerMemberId: "m1",
  soldAt: "2026-07-21T10:00:00Z",
  payouts: [{ memberId: "m2", paid: false, paidAt: null }],
  ...over,
});

const pool = (partyId: string, loot: Loot[]): PartyLootPool => ({ partyId, loot });

describe("buildWallet", () => {
  it("takes every figure from splitOf rather than dividing anything itself", () => {
    // The claim that matters: the wallet is a fold over the same split the drop's own row shows.
    // If these ever disagree, one of them is a second implementation.
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const loot = sold();
    const expected = splitOf(loot, p.members)!;

    const wallet = buildWallet([p], [pool("pa", [loot])]);

    expect(wallet.owe).toBe(expected.shares[0]!.pay);
    expect(wallet.counterparties[0]!.lines[0]!.nets).toBe(expected.shares[0]!.nets);
  });

  it("owes when your seat sold, and is owed when theirs did", () => {
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const youSold = buildWallet([p], [pool("pa", [sold()])]);
    // The same drop, sold by them: the payout row is now yours.
    const theySold = buildWallet(
      [p],
      [
        pool("pa", [
          sold({ sellerMemberId: "m2", payouts: [{ memberId: "m1", paid: false, paidAt: null }] }),
        ]),
      ],
    );

    expect(youSold.owe).toBeGreaterThan(0);
    expect(youSold.owed).toBe(0);
    expect(youSold.net).toBeLessThan(0);
    expect(theySold.owed).toBeGreaterThan(0);
    expect(theySold.owe).toBe(0);
    expect(theySold.net).toBeGreaterThan(0);
  });

  it("folds a person's characters into one debt", () => {
    // The whole point of attributing characters: two of Chris's names are one person to settle up
    // with, not two.
    const one = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const two = party("pb", [mine("m3", "mechyfechy"), theirs("m4", "CreedBratton2", chris)], {
      bossKey: "kalos",
    });

    const wallet = buildWallet(
      [one, two],
      [
        pool("pa", [sold()]),
        pool("pb", [
          sold({
            id: "l2",
            sellerMemberId: "m3",
            payouts: [{ memberId: "m4", paid: false, paidAt: null }],
          }),
        ]),
      ],
    );

    expect(wallet.counterparties).toHaveLength(1);
    expect(wallet.counterparties[0]!.name).toBe("Chris");
    expect(wallet.counterparties[0]!.lines).toHaveLength(2);
    expect(wallet.counterparties[0]!.owe).toBe(wallet.owe);
  });

  it("owes one person twice when two of their characters are in the party", () => {
    // Two seats, one person, one drop: two transfers, not one line drawn twice. Their ids are what
    // keeps them apart, and the pair (drop, seat) is what makes a line unique.
    const p = party("pa", [
      mine("m1", "mechyfechy"),
      theirs("m2", "CreedBratton", chris),
      theirs("m3", "CreedBratton2", chris),
    ]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [
          sold({
            payouts: [
              { memberId: "m2", paid: false, paidAt: null },
              { memberId: "m3", paid: false, paidAt: null },
            ],
          }),
        ]),
      ],
    );

    const lines = wallet.counterparties[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l) => `${l.lootId}-${l.theirsId}`)).size).toBe(2);
    expect(wallet.owe).toBe(lines[0]!.pay + lines[1]!.pay);
  });

  it("keeps unattributed characters apart, and says they are characters", () => {
    // Merging two names nobody has claimed would be a guess about who plays what.
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "Rune"), theirs("m3", "Steve")]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [
          sold({
            payouts: [
              { memberId: "m2", paid: false, paidAt: null },
              { memberId: "m3", paid: false, paidAt: null },
            ],
          }),
        ]),
      ],
    );

    expect(wallet.counterparties).toHaveLength(2);
    expect(wallet.counterparties.every((c) => !c.attributed)).toBe(true);
  });

  it("nets the two directions per counterparty", () => {
    const one = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const two = party("pb", [mine("m3", "mechyfechy"), theirs("m4", "CreedBratton", chris)], {
      bossKey: "kalos",
    });

    const wallet = buildWallet(
      [one, two],
      [
        // You sold one, they sold the other.
        pool("pa", [sold({ saleAmount: 1_000_000_000 })]),
        pool("pb", [
          sold({
            id: "l2",
            saleAmount: 4_000_000_000,
            sellerMemberId: "m4",
            payouts: [{ memberId: "m3", paid: false, paidAt: null }],
          }),
        ]),
      ],
    );

    const chrisRow = wallet.counterparties[0]!;
    expect(chrisRow.owe).toBeGreaterThan(0);
    expect(chrisRow.owed).toBeGreaterThan(chrisRow.owe);
    expect(chrisRow.net).toBe(chrisRow.owed - chrisRow.owe);
    expect(wallet.net).toBe(wallet.owed - wallet.owe);
  });

  it("leaves out paid shares and drops still in the pool", () => {
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [
          sold({ payouts: [{ memberId: "m2", paid: true, paidAt: "2026-07-22T00:00:00Z" }] }),
          // Still in the pool: nobody holds the mesos, so nobody owes them.
          sold({
            id: "l2",
            status: "PENDING",
            soldAt: null,
            saleAmount: null,
            amountBasis: null,
            splitMethod: null,
            sellerMemberId: null,
            payouts: [],
          }),
        ]),
      ],
    );

    expect(wallet.counterparties).toHaveLength(0);
    expect(wallet.owe).toBe(0);
    expect(wallet.unreadable).toBe(0);
  });

  it("counts a share between two other people rather than owing it", () => {
    // Your party, their business: you are neither end of this transfer.
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "Rune"), theirs("m3", "Steve")]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [
          sold({
            sellerMemberId: "m2",
            payouts: [
              { memberId: "m1", paid: true, paidAt: "2026-07-22T00:00:00Z" },
              { memberId: "m3", paid: false, paidAt: null },
            ],
          }),
        ]),
      ],
    );

    expect(wallet.betweenOthers).toBe(1);
    expect(wallet.owe).toBe(0);
    expect(wallet.owed).toBe(0);
  });

  it("counts a share between two of your own characters rather than owing it", () => {
    const p = party("pa", [mine("m1", "mechyfechy"), mine("m2", "mechymule")]);
    const wallet = buildWallet([p], [pool("pa", [sold()])]);

    expect(wallet.betweenMine).toBe(1);
    expect(wallet.counterparties).toHaveLength(0);
  });

  it("counts a split it cannot read instead of dropping it", () => {
    // A sale naming a seat that is gone. The debt is real and its size is not knowable, so the
    // total has to say it is short rather than look complete.
    const p = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [sold({ sellerMemberId: "gone" })]),
        // A pool whose party is missing entirely: no seats, so no split.
        pool("pz", [sold({ id: "l2" })]),
      ],
    );

    expect(wallet.unreadable).toBe(2);
    expect(wallet.owe).toBe(0);
  });

  it("has nothing to say about an account with no parties", () => {
    const wallet = buildWallet([], []);
    expect(wallet).toEqual({
      counterparties: [],
      owe: 0,
      owed: 0,
      net: 0,
      unreadable: 0,
      betweenOthers: 0,
      betweenMine: 0,
    });
  });

  it("puts the biggest outstanding relationship first, netted or not", () => {
    const big = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "Rune")]);
    const small = party("pb", [mine("m3", "mechyfechy"), theirs("m4", "Steve")], {
      bossKey: "kalos",
    });

    const wallet = buildWallet(
      [big, small],
      [
        pool("pa", [sold({ saleAmount: 9_000_000_000 })]),
        pool("pb", [
          sold({
            id: "l2",
            saleAmount: 1_000_000_000,
            sellerMemberId: "m3",
            payouts: [{ memberId: "m4", paid: false, paidAt: null }],
          }),
        ]),
      ],
    );

    expect(wallet.counterparties.map((c) => c.name)).toEqual(["Rune", "Steve"]);
  });
});

describe("settlementFor", () => {
  // You sold in one party, they sold in the other, so the relationship runs both ways.
  const bothWays = () => {
    const one = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton", chris)]);
    const two = party("pb", [mine("m3", "mechyfechy"), theirs("m4", "CreedBratton2", chris)], {
      bossKey: "kalos",
    });
    return buildWallet(
      [one, two],
      [
        pool("pa", [sold({ saleAmount: 4_000_000_000 })]),
        pool("pb", [
          sold({
            id: "l2",
            saleAmount: 1_000_000_000,
            sellerMemberId: "m4",
            payouts: [{ memberId: "m3", paid: false, paidAt: null }],
          }),
        ]),
      ],
    );
  };

  it("names the seat being PAID: theirs when you owe, yours when they owe you", () => {
    // The whole feature turns on this. A payout row is against the seat that is owed, so settling
    // by "their" seat would mark a row that does not exist on every line you are owed, and the
    // debt would quietly survive a settle that reported success.
    const wallet = bothWays();

    expect(settlementFor(wallet.counterparties[0]!)).toEqual([
      { lootId: "l1", memberId: "m2" },
      { lootId: "l2", memberId: "m3" },
    ]);
  });

  it("covers both directions, since one transfer of the net closes both", () => {
    const chrisRow = bothWays().counterparties[0]!;

    expect(chrisRow.owe).toBeGreaterThan(0);
    expect(chrisRow.owed).toBeGreaterThan(0);
    expect(settlementFor(chrisRow)).toHaveLength(chrisRow.lines.length);
  });

  it("names one row per seat when a drop owes two of the same person's characters", () => {
    // Two seats, one person, one drop: two payout rows, and settling has to mark both.
    const p = party("pa", [
      mine("m1", "mechyfechy"),
      theirs("m2", "CreedBratton", chris),
      theirs("m3", "CreedBratton2", chris),
    ]);
    const wallet = buildWallet(
      [p],
      [
        pool("pa", [
          sold({
            payouts: [
              { memberId: "m2", paid: false, paidAt: null },
              { memberId: "m3", paid: false, paidAt: null },
            ],
          }),
        ]),
      ],
    );

    expect(settlementFor(wallet.counterparties[0]!)).toEqual([
      { lootId: "l1", memberId: "m2" },
      { lootId: "l1", memberId: "m3" },
    ]);
  });
});

describe("transferLine", () => {
  const person = (over: Partial<Counterparty>): Counterparty => ({
    key: "person:p-chris",
    name: "Chris",
    attributed: true,
    owe: 0,
    owed: 0,
    net: 0,
    lines: [],
    ...over,
  });

  it("sends the net one way or the other, and nothing when the sides cancel", () => {
    expect(transferLine(person({ owe: 1_000, net: -1_000 }))).toBe("You send Chris 1,000.");
    expect(transferLine(person({ owed: 1_000, net: 1_000 }))).toBe("Chris sends you 1,000.");
    // Square, but the shares behind it are still unpaid rows that a settle has to mark.
    expect(transferLine(person({ owe: 500, owed: 500, net: 0 }))).toBe(
      "The two sides cancel out, so nothing needs to be sent.",
    );
  });
});

describe("netLabel", () => {
  it("names each direction, and square when they cancel", () => {
    expect(netLabel(5)).toBe("they owe you");
    expect(netLabel(-5)).toBe("you owe them");
    expect(netLabel(0)).toBe("square");
  });
});
