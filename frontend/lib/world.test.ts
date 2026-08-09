import { describe, expect, it } from "vitest";
import { canTrade, dropExistsIn, isPerMember, offersWallet, showsMoney, worldLabel } from "./world";

describe("what a world can do", () => {
  it("trades only in Interactive worlds", () => {
    expect(canTrade("INTERACTIVE")).toBe(true);
    expect(canTrade("HEROIC")).toBe(false);
  });

  it("carries the old name for the world players still call Reboot", () => {
    expect(worldLabel("HEROIC")).toContain("Reboot");
    expect(worldLabel("INTERACTIVE")).toBe("Interactive");
  });
});

describe("whether a drop exists here", () => {
  it("puts an unnarrowed drop in both worlds", () => {
    // null is every drop in catalog/drops.yaml today. Reading it as "nowhere" would empty every
    // picker in the app.
    expect(dropExistsIn(null, "INTERACTIVE")).toBe(true);
    expect(dropExistsIn(null, "HEROIC")).toBe(true);
  });

  it("keeps an Interactive-only drop out of Heroic worlds", () => {
    expect(dropExistsIn("INTERACTIVE", "INTERACTIVE")).toBe(true);
    expect(dropExistsIn("INTERACTIVE", "HEROIC")).toBe(false);
  });
});

describe("whether everyone gets their own", () => {
  it("says yes everywhere for ALWAYS", () => {
    expect(isPerMember("ALWAYS", "INTERACTIVE")).toBe(true);
    expect(isPerMember("ALWAYS", "HEROIC")).toBe(true);
  });

  it("turns HEROIC into a yes or a no, never a hedge", () => {
    // The flag the rings carry. One for the party in Interactive worlds, one each in Heroic, and
    // getting it backwards is the pooling-what-cannot-be-pooled mistake in miniature.
    expect(isPerMember("HEROIC", "HEROIC")).toBe(true);
    expect(isPerMember("HEROIC", "INTERACTIVE")).toBe(false);
  });

  it("says no for a drop with no flag", () => {
    expect(isPerMember(null, "INTERACTIVE")).toBe(false);
    expect(isPerMember(null, "HEROIC")).toBe(false);
  });
});

describe("what an account is shown", () => {
  it("draws mesos until no character is known to trade", () => {
    // `trades`, never a single world, and that is the whole point of the field: an account with
    // one Interactive character among Heroic ones has real earnings in the Drop Log, and keying
    // this off an account-wide world would hide them behind a default nobody set.
    expect(showsMoney(undefined)).toBe(true);
    expect(showsMoney(true)).toBe(true);
    expect(showsMoney(false)).toBe(false);
  });

  it("keeps the Wallet reachable while a share is still owed", () => {
    // The rule that stops this from hiding what it dropped: moving every character to Heroic must
    // not strand money somebody was already owed behind a link that no longer exists.
    expect(offersWallet(false, true)).toBe(true);
    expect(offersWallet(false, false)).toBe(false);
    expect(offersWallet(true, false)).toBe(true);
  });
});
