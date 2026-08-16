import { describe, expect, it } from "vitest";
import { STARTING_COUNT, addableItems } from "./add-item";
import type { TokenCatalogItem } from "@/types/token-catalog";

const item = (id: string, name = id): TokenCatalogItem => ({
  tokenCatalogId: id,
  name,
  iconUrl: null,
  itemGroup: "Eternal Pieces",
  sourceBoss: null,
  redeemThreshold: 10,
  redeemSlots: [],
});

describe("what can still be added", () => {
  const catalog = [item("a"), item("b"), item("c")];

  it("offers everything a character holds none of", () => {
    expect(addableItems(catalog, [{ tokenCatalogId: "b" }]).map((i) => i.tokenCatalogId)).toEqual([
      "a",
      "c",
    ]);
  });

  it("offers the whole catalog to a character holding nothing", () => {
    // The empty inventory, which is the case with no slot to hover at all and therefore the one
    // that most needs this.
    expect(addableItems(catalog, []).map((i) => i.tokenCatalogId)).toEqual(["a", "b", "c"]);
  });

  it("offers nothing once every item is held", () => {
    const all = catalog.map((i) => ({ tokenCatalogId: i.tokenCatalogId }));
    expect(addableItems(catalog, all)).toEqual([]);
  });

  it("keeps the catalog's own order rather than sorting", () => {
    // So the list reads down the same sections the inventory does and an item is where you last
    // saw it.
    const ordered = [item("z", "Zeta"), item("a", "Alpha")];
    expect(addableItems(ordered, []).map((i) => i.name)).toEqual(["Zeta", "Alpha"]);
  });

  it("treats a held row as held whatever else is on it", () => {
    // Absence IS zero: the server deletes a row rather than storing one, so "not in the list" and
    // "has none" are the same fact and there is no third state.
    expect(addableItems(catalog, [{ tokenCatalogId: "a" }, { tokenCatalogId: "c" }])).toHaveLength(
      1,
    );
  });
});

describe("what a new item starts at", () => {
  it("starts at one, not zero", () => {
    // A zero would be deleted by the server the moment it was written, so the slot would appear
    // and vanish. Adding something you have none of is not a thing anybody does.
    expect(STARTING_COUNT).toBe(1);
  });
});
