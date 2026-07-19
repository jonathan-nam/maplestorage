import { describe, expect, it } from "vitest";
import {
  explainSplit,
  FEE_MVP,
  FEE_STANDARD,
  parseMesos,
  type SplitInput,
  type SplitMethod,
  splitDrop,
} from "./drop-split";

const B = 1_000_000_000;

/** Everyone on the same rate, the common case. */
const flat = (salePrice: number, partySize: number, method: SplitMethod, fee = FEE_MVP) =>
  splitDrop({
    amount: salePrice,
    amountIs: "listed",
    sellerFee: fee,
    memberFees: Array.from({ length: partySize - 1 }, () => fee),
    method,
  });

const nets = (s: ReturnType<typeof splitDrop>) => [s.sellerKeeps, ...s.members.map((m) => m.nets)];
const spread = (s: ReturnType<typeof splitDrop>) => Math.max(...nets(s)) - Math.min(...nets(s));

describe("the fee", () => {
  it("takes the seller's own rate off the sale before anything is divided", () => {
    expect(flat(B, 1, "lazy", FEE_MVP).sellerReceives).toBe(970_000_000);
    expect(flat(B, 1, "lazy", FEE_STANDARD).sellerReceives).toBe(950_000_000);
  });

  it("leaves a solo seller everything they received", () => {
    for (const method of ["lazy", "fair"] as const) {
      const s = flat(B, 1, method);
      expect(s.members).toEqual([]);
      expect(s.sellerKeeps).toBe(970_000_000);
    }
  });
});

describe("a fair split leaves everyone holding the same", () => {
  // The whole point of the mode. If this ever fails the tool is lying to the party.
  it.each([2, 3, 4, 5, 6])("party of %i, all on the same rate", (partySize) => {
    expect(spread(flat(B, partySize, "fair"))).toBeLessThanOrEqual(partySize);
  });

  it.each([2, 3, 4, 5, 6])("party of %i, all on the standard rate", (partySize) => {
    expect(spread(flat(B, partySize, "fair", FEE_STANDARD))).toBeLessThanOrEqual(partySize);
  });

  // The reason rates are per member and not one value for the room.
  it("equalises a party of mixed MVP status", () => {
    const s = splitDrop({
      amount: 9_500_000_000,
      amountIs: "listed",
      sellerFee: FEE_MVP,
      memberFees: [FEE_MVP, FEE_STANDARD, FEE_STANDARD, FEE_MVP, FEE_STANDARD],
      method: "fair",
    });
    expect(spread(s)).toBeLessThanOrEqual(6);
    // A member paying more tax must be SENT more, or they would not land level.
    const [mvp, standard] = s.members;
    expect(standard?.pay).toBeGreaterThan(mvp?.pay ?? 0);
  });

  it("sends more than it keeps, because the transfer is taxed again", () => {
    const s = flat(B, 4, "fair");
    expect(s.members[0]?.pay).toBeGreaterThan(s.sellerKeeps);
  });
});

describe("a lazy split quietly favours the seller", () => {
  it("pays everyone the same gross and so leaves them a fee short", () => {
    const s = flat(B, 4, "lazy");
    expect(s.members[0]?.pay).toBe(242_500_000);
    expect(s.sellerKeeps).toBe(242_500_000);
    expect(s.members[0]?.nets).toBe(235_225_000); // 3% lighter than the seller's own share
  });

  it("shorts a standard-rate member more than an MVP one", () => {
    const s = splitDrop({
      amount: B,
      amountIs: "listed",
      sellerFee: FEE_MVP,
      memberFees: [FEE_MVP, FEE_STANDARD],
      method: "lazy",
    });
    // Same gross to each, so the one taxed harder simply ends up with less.
    expect(s.members[0]?.pay).toBe(s.members[1]?.pay);
    expect(s.members[1]?.nets).toBeLessThan(s.members[0]?.nets ?? 0);
  });
});

describe("nothing is invented and nothing is lost", () => {
  it.each([
    [B, 2],
    [B, 6],
    [123_456_789, 5],
    [7, 3],
  ])("price %i across %i never pays out more than was received", (salePrice, partySize) => {
    for (const method of ["lazy", "fair"] as const) {
      for (const fee of [FEE_MVP, FEE_STANDARD]) {
        const s = flat(salePrice, partySize, method, fee);
        const paidOut = s.members.reduce((sum, m) => sum + m.pay, 0);
        expect(s.sellerKeeps + paidOut).toBe(s.sellerReceives);
        expect(s.sellerKeeps).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("accounts for every meso of the sale price, at mixed rates", () => {
    const s = splitDrop({
      amount: B,
      amountIs: "listed",
      sellerFee: FEE_STANDARD,
      memberFees: [FEE_MVP, FEE_STANDARD, FEE_MVP],
      method: "fair",
    });
    const received = s.members.reduce((sum, m) => sum + m.nets, 0);
    expect(s.sellerKeeps + received + s.totalFee).toBe(B);
  });
});

describe("it refuses rather than guesses", () => {
  it.each([1, 1.5, -0.01, Number.NaN])("rejects a fee of %s", (fee) => {
    expect(() =>
      splitDrop({
        amount: B,
        amountIs: "listed",
        sellerFee: fee,
        memberFees: [FEE_MVP],
        method: "fair",
      }),
    ).toThrow(RangeError);
    expect(() =>
      splitDrop({
        amount: B,
        amountIs: "listed",
        sellerFee: FEE_MVP,
        memberFees: [fee],
        method: "fair",
      }),
    ).toThrow(RangeError);
  });

  it("rejects a negative price", () => {
    expect(() => flat(-1, 4, "fair")).toThrow(RangeError);
  });

  it("handles a price too small to divide without inventing mesos", () => {
    const s = flat(1, 6, "fair");
    expect(s.sellerReceives).toBe(0);
    expect(s.sellerKeeps).toBe(0);
    expect(s.members.every((m) => m.pay === 0)).toBe(true);
  });
});

describe("reading a price the way a player types it", () => {
  it.each([
    ["1b", 1_000_000_000],
    ["9.5b", 9_500_000_000],
    ["970m", 970_000_000],
    ["500k", 500_000],
    ["1,000,000,000", 1_000_000_000],
    [" 1B ", 1_000_000_000],
    ["0", 0],
  ])("reads %s", (input, expected) => {
    expect(parseMesos(input)).toBe(expected);
  });

  it.each(["", "b", "1x", "1.2.3", "abc", "-1", "1b2"])(
    "returns null for %s rather than a guess",
    (input) => {
      expect(parseMesos(input)).toBeNull();
    },
  );
});

describe("the worked math cannot disagree with the numbers", () => {
  // The whole reason explainSplit reads off the split rather than restating the formula. Working
  // that drifts from the figures above it is worse than none: a wrong number with a proof attached.
  const cases: SplitInput[] = [
    {
      amount: 9_500_000_000,
      amountIs: "listed",
      sellerFee: FEE_STANDARD,
      memberFees: [FEE_STANDARD, FEE_STANDARD],
      method: "fair",
    },
    {
      amount: 9_500_000_000,
      amountIs: "listed",
      sellerFee: FEE_STANDARD,
      memberFees: [FEE_MVP, FEE_STANDARD],
      method: "fair",
    },
    {
      amount: 9_500_000_000,
      amountIs: "received",
      sellerFee: FEE_STANDARD,
      memberFees: [FEE_STANDARD, FEE_STANDARD],
      method: "lazy",
    },
    { amount: B, amountIs: "listed", sellerFee: FEE_STANDARD, memberFees: [], method: "fair" },
  ];

  it.each(cases)("quotes every figure it computed ($method)", (input) => {
    const split = splitDrop(input);
    const text = explainSplit(input, split)
      .map((s) => s.expression)
      .join(" | ");

    expect(text).toContain(split.sellerReceives.toLocaleString("en-US"));
    expect(text).toContain(split.sellerKeeps.toLocaleString("en-US"));
    for (const m of split.members) {
      expect(text).toContain(m.pay.toLocaleString("en-US"));
      expect(text).toContain(m.nets.toLocaleString("en-US"));
    }
  });

  it("collapses a same-rate party to one line each for send and keep", () => {
    const input = cases[0] as SplitInput;
    const labels = explainSplit(input, splitDrop(input)).map((s) => s.label);
    expect(labels).toEqual(["received", "X", "send each", "they keep", "you keep", "check"]);
  });

  it("gives a mixed party a line per member instead", () => {
    const input = cases[1] as SplitInput;
    const labels = explainSplit(input, splitDrop(input)).map((s) => s.label);
    expect(labels).toContain("member 1");
    expect(labels).toContain("member 2");
    expect(labels).not.toContain("send each");
  });

  it("skips the X line for a lazy split, which never solves for one", () => {
    const input = cases[2] as SplitInput;
    const labels = explainSplit(input, splitDrop(input)).map((s) => s.label);
    expect(labels).not.toContain("X");
  });

  it("always ends on a check that balances against what came in", () => {
    const input = cases[0] as SplitInput;
    const steps = explainSplit(input, splitDrop(input));
    expect(steps.at(-1)?.label).toBe("check");
    expect(steps.at(-1)?.expression).toContain(input.amount.toLocaleString("en-US"));
  });
});

describe("entering what you received instead of the listed price", () => {
  const received = (amount: number, memberFees: number[], method: SplitMethod = "fair") =>
    splitDrop({ amount, amountIs: "received", sellerFee: FEE_MVP, memberFees, method });

  it("hands out exactly what was entered, untouched by any sale fee", () => {
    const s = received(970_000_000, [FEE_MVP, FEE_MVP]);
    expect(s.sellerReceives).toBe(970_000_000);
    expect(s.grossSale).toBeNull();
  });

  it("matches the listed-price path once the sale fee is applied by hand", () => {
    // 1b listed at 3% IS 970m received, so the two routes must agree exactly.
    const viaListed = splitDrop({
      amount: B,
      amountIs: "listed",
      sellerFee: FEE_MVP,
      memberFees: [FEE_MVP, FEE_STANDARD, FEE_MVP],
      method: "fair",
    });
    const viaReceived = received(970_000_000, [FEE_MVP, FEE_STANDARD, FEE_MVP]);
    expect(viaReceived.sellerKeeps).toBe(viaListed.sellerKeeps);
    expect(viaReceived.members).toEqual(viaListed.members);
  });

  it("ignores the seller's own fee entirely, whatever it is set to", () => {
    const at3 = splitDrop({
      amount: 970_000_000,
      amountIs: "received",
      sellerFee: FEE_MVP,
      memberFees: [FEE_STANDARD, FEE_MVP],
      method: "fair",
    });
    const at5 = splitDrop({
      amount: 970_000_000,
      amountIs: "received",
      sellerFee: FEE_STANDARD,
      memberFees: [FEE_STANDARD, FEE_MVP],
      method: "fair",
    });
    expect(at5).toEqual(at3);
  });

  it("does not invent a gross, and says its fee total covers the payouts only", () => {
    const s = received(970_000_000, [FEE_MVP, FEE_STANDARD]);
    expect(s.grossSale).toBeNull();
    expect(s.totalFeeCoversSale).toBe(false);
    // The fee it does report is exactly what the payout hop cost.
    const netted = s.members.reduce((sum, m) => sum + m.nets, 0);
    expect(s.sellerKeeps + netted + s.totalFee).toBe(s.sellerReceives);
  });

  it("still equalises a fair split", () => {
    const s = received(9_215_000_000, [FEE_MVP, FEE_STANDARD, FEE_STANDARD, FEE_MVP, FEE_MVP]);
    expect(spread(s)).toBeLessThanOrEqual(6);
  });

  it("says so in the working rather than quoting a sale it was never told about", () => {
    const input: SplitInput = {
      amount: 970_000_000,
      amountIs: "received",
      sellerFee: FEE_MVP,
      memberFees: [FEE_MVP],
      method: "fair",
    };
    const steps = explainSplit(input, splitDrop(input));
    expect(steps[0]?.expression).toContain("(entered)");
    expect(steps.at(-1)?.expression).toContain((970_000_000).toLocaleString("en-US"));
  });
});

describe("rounding matches the split bot people cross-check against", () => {
  // A real transcript: net sale 9,689,980,888 across a party of 3 at the standard rate. The bot
  // says to list at 3,284,739,285, which is received / (3 - 0.05) rounded UP.
  it("reproduces the bot's figure exactly", () => {
    const s = splitDrop({
      amount: 9_689_980_888,
      amountIs: "received",
      sellerFee: FEE_STANDARD,
      memberFees: [FEE_STANDARD, FEE_STANDARD],
      method: "fair",
    });
    expect(s.members.map((m) => m.pay)).toEqual([3_284_739_285, 3_284_739_285]);
    expect(s.sellerKeeps).toBe(3_120_502_318);
    expect(s.members.map((m) => m.nets)).toEqual([3_120_502_320, 3_120_502_320]);
  });

  it("gives the dust to the party, not the seller", () => {
    const s = splitDrop({
      amount: 9_689_980_888,
      amountIs: "received",
      sellerFee: FEE_STANDARD,
      memberFees: [FEE_STANDARD, FEE_STANDARD],
      method: "fair",
    });
    expect(s.sellerKeeps).toBeLessThanOrEqual(s.members[0]?.nets ?? 0);
  });

  // Rounding up can overshoot a purse too small to divide. This is the branch that falls back.
  it.each([
    [1, 6],
    [3, 6],
    [5, 2],
    [0, 4],
  ])("never pays out more than is held, at %i mesos across %i", (amount, partySize) => {
    for (const method of ["fair", "lazy"] as const) {
      const s = splitDrop({
        amount,
        amountIs: "received",
        sellerFee: FEE_MVP,
        memberFees: Array.from({ length: partySize - 1 }, () => FEE_STANDARD),
        method,
      });
      const paidOut = s.members.reduce((sum, m) => sum + m.pay, 0);
      expect(s.sellerKeeps).toBeGreaterThanOrEqual(0);
      expect(s.sellerKeeps + paidOut).toBe(s.sellerReceives);
    }
  });
});
