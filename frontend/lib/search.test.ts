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
  // The Arcane pair earns its place: "arcana" is a subsequence of "arcane symbol: vanishing
  // journey coupon" once a match may cross word boundaries, so naming one symbol used to return
  // its siblings. A fixture with only one symbol in it could not have caught that.
  item("Arcane Symbol: Arcana Coupon", "Daily", "Symbols"),
  item("Arcane Symbol: Vanishing Journey Coupon", "Daily", "Symbols"),
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

  // Every one of these was a real false positive, found by running the matcher over the whole
  // 26-item catalog. They share a cause: a subsequence allowed to run across word boundaries
  // treats the gaps between words as free letters, and the fields are multi-word.
  it("does NOT let a fuzzy match run across word boundaries", () => {
    // "eternal pieces" contains t-r-a-c-e in order, so this used to return all six pieces.
    expect(found("trace")).toEqual(["Trace of Eternal Loyalty"]);

    // "Kalos the Guardian" contains s-h-a-r-d in order.
    expect(found("shard")).toEqual(["Blissful Fantasy Shard"]);

    // "arcane symbol: vanishing journey coupon" contains a-r-c-a-n-a in order, so naming one
    // symbol used to return its siblings too.
    expect(found("arcana")).toEqual(["Arcane Symbol: Arcana Coupon"]);
  });

  it("answers 'accessory' with nothing rather than with the wrong set", () => {
    // It was an alias for Shoulder, so it returned the four ARMOUR tokens: the opposite of the
    // Cape/Glove/Shoe set the word means.
    expect(found("accessory")).toEqual([]);
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
