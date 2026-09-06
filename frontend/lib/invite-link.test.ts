import { describe, expect, it } from "vitest";
import {
  inviteUrl,
  invitedSummary,
  joinCallbackPath,
  partiesShown,
  partiesTaken,
  partyLabel,
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

describe("partyLabel", () => {
  // Two configs on one boss are one line twice without the character, which reads as a bug in the
  // list rather than as two parties. This is the real shape: Kalos on two of your own characters.
  it("tells two configs on one boss apart by whose seat it is", () => {
    const kalos = { bossName: "Kalos the Guardian", difficulty: "EXTREME" };
    expect(partyLabel({ ...kalos, characterName: "Freeballynn" })).toBe(
      "Extreme Kalos the Guardian (Freeballynn)",
    );
    expect(partyLabel({ ...kalos, characterName: "CreedBratton" })).toBe(
      "Extreme Kalos the Guardian (CreedBratton)",
    );
  });

  it("leaves out a mode the boss does not have", () => {
    expect(partyLabel({ bossName: "Baldrix", difficulty: null, characterName: "iPhone69C" })).toBe(
      "Baldrix (iPhone69C)",
    );
  });
});

describe("partiesTaken", () => {
  const parties = [
    { bossName: "Kalos the Guardian", difficulty: "EXTREME", characterName: "Freeballynn" },
    { bossName: "Malefic Star", difficulty: "HARD", characterName: "Freeballynn" },
    { bossName: "Kaling", difficulty: "HARD", characterName: "iPhone69C" },
  ];

  it("keeps every party when every character is ticked", () => {
    expect(partiesTaken(parties, ["Freeballynn", "iPhone69C"])).toEqual(parties);
  });

  // The point of the whole thing: a seat binds only where the name was confirmed, so a count of
  // all three next to an unticked Freeballynn is a number accepting will not deliver.
  it("drops the parties of a character that was unticked", () => {
    expect(partiesTaken(parties, ["iPhone69C"]).map((p) => p.bossName)).toEqual(["Kaling"]);
    expect(partiesTaken(parties, [])).toEqual([]);
  });

  it("matches a name the way the backend does, without regard to case", () => {
    expect(partiesTaken(parties, ["freeballynn"]).length).toBe(2);
  });
});
