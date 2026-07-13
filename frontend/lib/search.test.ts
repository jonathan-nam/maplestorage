import { describe, expect, it } from "vitest";
import { matchesQuery, queryTerms } from "@/components/item-search";
import type { CharacterToken } from "@/types/character-token";

// The catalog facts a query is matched against. Kept as a fixture rather than mocked away,
// because the interesting failures are collisions BETWEEN real items.
const item = (
  name: string,
  sourceBoss: string,
  itemGroup: string,
  redeemSlots: string[] = [],
): CharacterToken =>
  ({
    tokenCatalogId: name,
    name,
    sourceBoss,
    itemGroup,
    redeemSlots,
    quantity: 1,
    redeemThreshold: redeemSlots.length ? 10 : null,
  }) as CharacterToken;

const ARMOUR = ["Hat", "Top", "Bottom", "Shoulder"];
const ACCESSORY = ["Cape", "Glove", "Shoe"];

const CATALOG = [
  item("Kalos's Residual Determination", "Kalos the Guardian", "Eternal Pieces", ARMOUR),
  item("Ferocious Beast Entanglement Ring", "Kaling", "Eternal Pieces", ARMOUR),
  item("Echo of Ancient Resolve", "First Adversary", "Eternal Pieces", ARMOUR),
  item("Blissful Fantasy Shard", "Malefic Star", "Eternal Pieces", ARMOUR),
  item("Distorted Ambition", "Limbo", "Eternal Pieces", ACCESSORY),
  item("Trace of Eternal Loyalty", "Baldrix", "Eternal Pieces", ACCESSORY),
  item("Sacred Symbol: Cernium Coupon", "Daily", "Symbols"),
  item("Extreme Red Potion", "Monster Park", "Consumables"),
];

const found = (q: string) =>
  CATALOG.filter((t) => matchesQuery(t, queryTerms(q))).map((t) => t.name);

describe("search", () => {
  it("finds a piece by the BOSS, which is what people actually say", () => {
    expect(found("kaling")).toEqual(["Ferocious Beast Entanglement Ring"]);
    expect(found("limbo")).toEqual(["Distorted Ambition"]);
  });

  it("finds a piece by WHAT IT BUYS. 'eternal hat' is the four armour tokens", () => {
    expect(found("eternal hat")).toEqual([
      "Kalos's Residual Determination",
      "Ferocious Beast Entanglement Ring",
      "Echo of Ancient Resolve",
      "Blissful Fantasy Shard",
    ]);
    expect(found("eternal cape")).toEqual(["Distorted Ambition", "Trace of Eternal Loyalty"]);
  });

  it("matches terms independently, so a two-word query is two facts and not a phrase", () => {
    // "eternal hat" appears verbatim in no field. As one string it finds nothing.
    expect(found("eternal hat").length).toBe(4);
  });

  it("tolerates a typo in a word long enough to be one", () => {
    expect(found("kalng")).toEqual(["Ferocious Beast Entanglement Ring"]);
  });

  it("does NOT fuzzy-match a short term. 'shoe' is a subsequence of 'Shoulder'", () => {
    // The bug this guards: with a permissive fuzzy floor, "shoe" matched every armour token.
    expect(found("shoe")).toEqual(["Distorted Ambition", "Trace of Eternal Loyalty"]);
  });

  it("knows a slot by the names the game actually uses", () => {
    // A top is a Hood / Shirt / Coat / Robe / Armor depending on class; a hat is a Bandana on a
    // thief. Someone types what they are wearing, not what the catalog calls the slot.
    const armour = [
      "Kalos's Residual Determination",
      "Ferocious Beast Entanglement Ring",
      "Echo of Ancient Resolve",
      "Blissful Fantasy Shard",
    ];
    expect(found("robe")).toEqual(armour);
    expect(found("bandana")).toEqual(armour);
    expect(found("helm")).toEqual(armour);
    expect(found("boots")).toEqual(["Distorted Ambition", "Trace of Eternal Loyalty"]);
  });
});
