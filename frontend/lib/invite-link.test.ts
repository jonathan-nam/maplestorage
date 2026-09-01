import { describe, expect, it } from "vitest";
import type { Invite } from "@/types/invite";
import {
  minutesUntil,
  inviteUrl,
  invitedSummary,
  joinCallbackPath,
  liveInvite,
  omittedSummary,
} from "./invite-link";

describe("inviteUrl", () => {
  it("points at the join page on the origin the link was made from", () => {
    expect(inviteUrl("https://sharpeyes.app", "abc123")).toBe("https://sharpeyes.app/join/abc123");
  });

  it("escapes a token, because it is base64url and a browser is not asked to guess", () => {
    expect(inviteUrl("https://sharpeyes.app", "a+b/c")).toBe(
      "https://sharpeyes.app/join/a%2Bb%2Fc",
    );
  });

  it("sends the sign-in round trip back to the same link", () => {
    // Discord returns to whatever this names, so a mismatch with inviteUrl's path is an invite
    // that survives being opened and dies on being signed into.
    expect(joinCallbackPath("abc123")).toBe("/join/abc123");
    expect(inviteUrl("https://sharpeyes.app", "abc123")).toBe(
      `https://sharpeyes.app${joinCallbackPath("abc123")}`,
    );
  });
});

describe("invitedSummary", () => {
  it("counts both", () => {
    expect(invitedSummary({ bosses: 4, peopleCount: 2 })).toBe("4 parties, 2 people");
  });

  it("says one of each in the singular", () => {
    expect(invitedSummary({ bosses: 1, peopleCount: 1 })).toBe("1 party, 1 person");
  });

  // "0 people" next to two of them is the kind of line that reads as a bug in the data rather
  // than as an absence.
  it("leaves out what there is none of", () => {
    expect(invitedSummary({ bosses: 3, peopleCount: 0 })).toBe("3 parties");
    expect(invitedSummary({ bosses: 0, peopleCount: 0 })).toBe("");
  });
});

describe("omittedSummary", () => {
  // A count that changed still gets said. What it does NOT do is say so when nothing changed.
  it("is empty when nothing was left out", () => {
    expect(omittedSummary([])).toBe("");
  });

  it("names how many were", () => {
    expect(omittedSummary([1])).toBe("1 party is not included.");
    expect(omittedSummary([1, 2])).toBe("2 parties are not included.");
  });
});

const invite = (over: Partial<Invite> = {}): Invite => ({
  id: "i1",
  personId: "p1",
  personName: "Bro",
  senderName: "mechyfechy",
  createdAt: "2026-09-01T00:00:00Z",
  expiresAt: "2026-09-03T00:05:00Z",
  accepted: false,
  characterCount: 3,
  partyCount: 17,
  omitted: [],
  ...over,
});

const now = new Date("2026-09-03T00:00:00Z");

describe("liveInvite", () => {
  it("is the person's own unaccepted, unexpired link", () => {
    expect(liveInvite([invite()], "p1", now)?.id).toBe("i1");
    expect(liveInvite([invite()], "p2", now)).toBeNull();
  });

  // Both are the backend's rules. Offering revoke on either is a button that does nothing: an
  // accepted invite is the record of where an account came from, and an expired one is already
  // refused on redemption.
  it("is not an accepted one, and not an expired one", () => {
    expect(liveInvite([invite({ accepted: true })], "p1", now)).toBeNull();
    expect(liveInvite([invite({ expiresAt: "2026-09-02T23:59:00Z" })], "p1", now)).toBeNull();
  });

  it("takes the newest when somehow there are two", () => {
    const older = invite({ id: "old", createdAt: "2026-08-20T00:00:00Z" });
    const newer = invite({ id: "new", createdAt: "2026-08-30T00:00:00Z" });
    expect(liveInvite([older, newer], "p1", now)?.id).toBe("new");
    expect(liveInvite([newer, older], "p1", now)?.id).toBe("new");
  });
});

describe("minutesUntil", () => {
  it("counts whole minutes left", () => {
    expect(minutesUntil("2026-09-03T00:05:00Z", now)).toBe(5);
  });

  // Floored, because it reads as "you have this long": rounding up promises most of a minute that
  // is not there, and on a five minute link that is a fifth of it.
  it("floors a part minute rather than rounding it up", () => {
    expect(minutesUntil("2026-09-03T00:01:50Z", now)).toBe(1);
  });

  it("never goes below zero", () => {
    expect(minutesUntil("2026-09-02T00:00:00Z", now)).toBe(0);
  });
});
