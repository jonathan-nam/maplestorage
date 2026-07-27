import { describe, expect, it } from "vitest";
import { bossLabel, difficultyLabel } from "./boss-difficulty";

describe("difficultyLabel", () => {
  it("writes a stored mode the way the game does", () => {
    expect(difficultyLabel("NORMAL")).toBe("Normal");
    expect(difficultyLabel("EXTREME")).toBe("Extreme");
  });

  it("keeps Chaos and Hard apart, which is the whole reason both exist", () => {
    // The same rung of the ladder, named for whether the boss is a monster. Collapsing them would
    // put "Hard Gloom" on screen, which is not a thing you can queue for.
    expect(difficultyLabel("CHAOS")).toBe("Chaos");
    expect(difficultyLabel("HARD")).toBe("Hard");
  });
});

describe("bossLabel", () => {
  it("puts the mode in front of the boss", () => {
    expect(bossLabel("Kalos the Guardian", "CHAOS")).toBe("Chaos Kalos the Guardian");
    expect(bossLabel("Baldrix", "HARD")).toBe("Hard Baldrix");
  });

  it("says only the boss when no mode has been picked", () => {
    // Not "Normal Lotus". Nobody said Normal, and a config that predates the column says nothing.
    expect(bossLabel("Lotus", null)).toBe("Lotus");
    expect(bossLabel("Lotus", undefined)).toBe("Lotus");
  });
});
