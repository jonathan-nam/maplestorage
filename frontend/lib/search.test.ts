import { describe, expect, it } from "vitest";
import { matchesQuery, queryTerms, search, suggest } from "@/components/item-search";
import type { Character } from "@/types/character";
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

const character = (id: string, name: string): Character => ({ id, name }) as Character;

const LUMI = character("1", "Lumidrill");
const HAYATO = character("2", "Hayatoast");

// Lumi holds the Kalos token; Hayato holds the Cernium coupon. So a query naming one character
// must never surface the other's items.
const ROSTER = [LUMI, HAYATO];
const byName = (name: string): CharacterToken => {
  const t = CATALOG.find((c) => c.name === name);
  if (!t) throw new Error(`no such fixture item: ${name}`);
  return t;
};

const HELD: Record<string, CharacterToken[]> = {
  "1": [byName("Kalos's Residual Determination")],
  "2": [byName("Sacred Symbol: Cernium Coupon")],
};

const whoHas = (q: string) =>
  search(q, ROSTER, HELD).map(
    (m) => `${m.character.name}: ${m.items.map((i) => i.name).join(", ")}`,
  );

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

  it("finds a CHARACTER by name, and shows what they are holding", () => {
    // Typing your own character's name used to answer "nobody is holding anything matching
    // Lumidrill", which is true of the items and useless to the person asking.
    expect(whoHas("lumidrill")).toEqual(["Lumidrill: Kalos's Residual Determination"]);
    expect(whoHas("hayatoast")).toEqual(["Hayatoast: Sacred Symbol: Cernium Coupon"]);
  });

  it("narrows by character AND item, because the terms are independent facts", () => {
    expect(whoHas("lumidrill kalos")).toEqual(["Lumidrill: Kalos's Residual Determination"]);
    // Lumi does not hold a symbol, so this is nobody. The character matching is not a shortcut
    // that lets an item through.
    expect(whoHas("lumidrill cernium")).toEqual([]);
  });

  it("tolerates a typo in a character's name too", () => {
    expect(whoHas("lumidril")).toEqual(["Lumidrill: Kalos's Residual Determination"]);
  });

  it("suggests the best match first, and offers characters as well as items", () => {
    const labels = suggest("lumi", ROSTER, HELD).map((s) => `${s.kind}:${s.label}`);
    expect(labels).toEqual(["character:Lumidrill"]);

    // The dropdown must not offer what the results below would then refuse to show. Same matcher,
    // so the two cannot drift apart.
    expect(suggest("kalos", ROSTER, HELD).map((s) => s.label)).toContain(
      "Kalos's Residual Determination",
    );
  });

  it("ranks a whole-label match above one buried in the middle", () => {
    const roster = [character("1", "Kalos"), character("2", "Kalosaurus")];
    const held = { "1": [byName("Kalos's Residual Determination")], "2": [] };
    // Exact first, then prefix, and the item (which only contains the term) last.
    expect(suggest("kalos", roster, held).map((s) => s.label)).toEqual([
      "Kalos",
      "Kalosaurus",
      "Kalos's Residual Determination",
    ]);
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
