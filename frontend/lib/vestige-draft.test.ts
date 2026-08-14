import { describe, expect, it } from "vitest";
import { draftDrop, draftStacks, draftUnanswered } from "./vestige-pickup";
import type { ShareConfig } from "./vestige-stacks";
import type { PartyMember } from "@/types/party";

// The night about to be logged, before there is a row for it.
//
// What matters here is what gets SENT. The arrangement now travels with the drop, and the server
// rolls the drop back when it refuses one, so a form that submits a half-filled map loses the drop
// as well. These are the two answers that must not be confused: nothing said (send no arrangement,
// leave the night unanswered as every other add does) and something said badly (send nothing, and
// do not let the submit through at all).

// personId is spelled out, not left off. holderOf tests `personId !== null`, and an ABSENT field is
// undefined, which passes that test and folds every seat into one holder called "person:undefined".
// A holder is a person, so three seats of one person really are one pile; the trap is getting that
// by accident from a half-built seat.
const seat = (id: string, name: string, shares = 1): PartyMember =>
  ({ id, name, shares, characterId: null, personId: null }) as PartyMember;

/** Hard Limbo: 60 coupons in 3 stacks of 20, split by three seats. */
const config: ShareConfig = {
  quantity: 60,
  bundles: 3,
  size: 20,
  seats: [seat("a", "Rune"), seat("b", "Steve"), seat("c", "Bob")],
};

describe("draftDrop", () => {
  it("reads the stacks off the catalog, not off the quantity typed", () => {
    // Half the usual haul still falls in three stacks. It is the SIZE that changes, which is how
    // the server derives it too: the count is per boss and mode, and quantity is what fell.
    const half = draftDrop(config, 30)!;
    expect(half.bundles).toBe(3);
    expect(half.size).toBe(10);
    expect(draftDrop(config, 60)!.size).toBe(20);
  });

  it("has no loot id, because the row it is about does not exist yet", () => {
    expect(draftDrop(config, 60)!.lootId).toBe("");
    expect(draftDrop(config, 60)!.recorded).toBe(false);
  });

  it("refuses a night there is nothing to hand out on", () => {
    // One stack cannot be shared however anybody agreed. Same ground assignableDrops leaves it out.
    expect(draftDrop({ ...config, bundles: 1 }, 60)).toBeNull();
    // One holder has nobody to hand to.
    expect(draftDrop({ ...config, seats: [seat("a", "Rune")] }, 60)).toBeNull();
    // Nothing fell.
    expect(draftDrop(config, 0)).toBeNull();
  });
});

describe("draftStacks", () => {
  const drop = draftDrop(config, 60)!;

  it("sends the arrangement when every stack is placed", () => {
    expect(draftStacks(drop, { a: "1", b: "1", c: "1" })).toEqual({ a: 1, b: 1, c: 1 });
  });

  it("leaves a seat that picked nothing up OUT, rather than sending it a zero", () => {
    // The server refuses a zero: somebody who did not bend down is not present with none.
    expect(draftStacks(drop, { a: "3", b: "0", c: "0" })).toEqual({ a: 3 });
  });

  it("sends nothing at all when the boxes are cleared, which is the night left unanswered", () => {
    // The escape hatch from the suggestion the boxes open on. Empty is a valid answer and must not
    // read as a shortfall, or a drop could not be logged without answering for it.
    expect(draftUnanswered(drop, { a: "", b: "", c: "" })).toBe(true);
    expect(draftStacks(drop, { a: "", b: "", c: "" })).toEqual({});
    expect(draftStacks(drop, {})).toEqual({});
  });

  it("refuses one that does not add up, which would take the drop down with it", () => {
    expect(draftStacks(drop, { a: "1", b: "1", c: "0" })).toBeNull();
    expect(draftStacks(drop, { a: "2", b: "2", c: "2" })).toBeNull();
  });

  it("refuses half a stack and anything that is not a number", () => {
    // Halves belong to the DEAL, where they mean an average across weeks. Nobody bends down for
    // half a stack on the night.
    expect(draftStacks(drop, { a: "1.5", b: "1.5", c: "0" })).toBeNull();
    expect(draftStacks(drop, { a: "three", b: "0", c: "0" })).toBeNull();
  });

  it("tells a cleared box from a zeroed one", () => {
    // Both come to nothing placed, and only one of them is an answer. A single zero typed in is
    // somebody saying the split, badly; every box empty is somebody declining to say.
    expect(draftUnanswered(drop, { a: "0", b: "", c: "" })).toBe(false);
    expect(draftStacks(drop, { a: "0", b: "", c: "" })).toBeNull();
  });
});
