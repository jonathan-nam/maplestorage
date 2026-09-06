import { describe, expect, it } from "vitest";
import {
  acceptBody,
  inviteUrl,
  invitedSummary,
  joinCallbackPath,
  partiesShown,
  timeLeft,
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
    expect(invitedSummary({ parties: 4, peopleCount: 2 })).toBe("4 parties, 2 people");
  });

  it("says one of each in the singular", () => {
    expect(invitedSummary({ parties: 1, peopleCount: 1 })).toBe("1 party, 1 person");
  });

  // "0 people" next to two of them is the kind of line that reads as a bug in the data rather
  // than as an absence.
  it("leaves out what there is none of", () => {
    expect(invitedSummary({ parties: 3, peopleCount: 0 })).toBe("3 parties");
    expect(invitedSummary({ parties: 0, peopleCount: 0 })).toBe("");
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

describe("timeLeft", () => {
  const at = (iso: string) => timeLeft("2026-09-03T00:05:00Z", new Date(iso));

  it("counts down in minutes and seconds", () => {
    expect(at("2026-09-03T00:00:00Z")).toBe("5:00");
    expect(at("2026-09-03T00:00:28Z")).toBe("4:32");
    expect(at("2026-09-03T00:04:51Z")).toBe("0:09");
  });

  // Floored: 0:01 with most of a second behind it is a second you do not have.
  it("floors the part second", () => {
    expect(at("2026-09-03T00:04:58.900Z")).toBe("0:01");
  });

  // Null, not "0:00". A dead link is a different thing to say, and it is the one that stops
  // offering a Copy button for an address that no longer works.
  it("is nothing at all once the link is spent", () => {
    expect(at("2026-09-03T00:05:00Z")).toBeNull();
    expect(at("2026-09-03T00:06:00Z")).toBeNull();
  });
});

describe("partiesShown", () => {
  // A few is enough to recognise a group by, which is the only question the list answers: whether
  // this link was meant for you.
  it("names the first three and counts the rest", () => {
    expect(partiesShown([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: 2 });
  });

  it("has nothing left over when there are three or fewer", () => {
    expect(partiesShown([1, 2])).toEqual({ shown: [1, 2], more: 0 });
    expect(partiesShown([])).toEqual({ shown: [], more: 0 });
  });
});

describe("acceptBody", () => {
  it("sends the ticked characters for a link addressed to somebody", () => {
    expect(acceptBody(false, ["CreedBratton"], "")).toEqual({ characters: ["CreedBratton"] });
  });

  it("sends the one named character for a link addressed to nobody", () => {
    // And never `characters` alongside it: an open link carries none to tick, so an empty list
    // sent with it is a body that takes nothing, which the backend refuses on purpose.
    expect(acceptBody(true, [], "CreedBratton")).toEqual({ character: "CreedBratton" });
  });

  it("trims the typed name, which a person ticking a box could not have got wrong", () => {
    expect(acceptBody(true, [], "  CreedBratton  ")).toEqual({ character: "CreedBratton" });
  });
});
