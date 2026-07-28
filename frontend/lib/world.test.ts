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
    // null is the overwhelming majority of catalog/drops.yaml. Reading it as "nowhere" would empty
    // every picker in the app.
    expect(dropExistsIn(null, "INTERACTIVE")).toBe(true);
    expect(dropExistsIn(null, "HEROIC")).toBe(true);
  });

  it("keeps the scroll coupons out of Heroic worlds", () => {
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
  it("draws mesos until the account is known to be Heroic", () => {
    expect(showsMoney(undefined)).toBe(true);
    expect(showsMoney("INTERACTIVE")).toBe(true);
    expect(showsMoney("HEROIC")).toBe(false);
  });

  it("keeps the Wallet reachable while a share is still owed", () => {
    // The rule that stops this from hiding what it dropped: switching an account to Heroic must
    // not strand money somebody was already owed behind a link that no longer exists.
    expect(offersWallet("HEROIC", true)).toBe(true);
    expect(offersWallet("HEROIC", false)).toBe(false);
    expect(offersWallet("INTERACTIVE", false)).toBe(true);
  });
});
