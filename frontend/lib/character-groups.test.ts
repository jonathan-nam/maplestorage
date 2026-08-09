import { describe, expect, it } from "vitest";
import { groupByWorld } from "./character-groups";
import type { Character } from "@/types/character";

const character = (name: string, worldName: string | null): Character => ({
  id: `id-${name}`,
  name,
  level: 200,
  jobName: "Hero",
  worldName,
  worldType: "INTERACTIVE",
  spriteImgUrl: null,
  spriteRefreshedAt: null,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
});

describe("grouping characters by world", () => {
  it("gathers each world's characters together", () => {
    const groups = groupByWorld([
      character("a", "Scania"),
      character("b", "Bera"),
      character("c", "Scania"),
    ]);

    expect(groups.map((g) => g.world)).toEqual(["Scania", "Bera"]);
    expect(groups[0]!.characters.map((c) => c.name)).toEqual(["a", "c"]);
    expect(groups[1]!.characters.map((c) => c.name)).toEqual(["b"]);
  });

  it("orders the worlds by first appearance, not alphabetically", () => {
    // Alphabetical would reorder the page under somebody who arranged their carousel deliberately.
    const groups = groupByWorld([character("a", "Scania"), character("b", "Bera")]);
    expect(groups.map((g) => g.world)).toEqual(["Scania", "Bera"]);
  });

  it("keeps carousel order inside a group", () => {
    const groups = groupByWorld([
      character("third", "Scania"),
      character("first", "Scania"),
      character("second", "Scania"),
    ]);
    expect(groups[0]!.characters.map((c) => c.name)).toEqual(["third", "first", "second"]);
  });

  it("puts the ones with no world last, wherever they came in", () => {
    // Not a world, so it is not competing for a place among them: it is the characters nobody has
    // looked up. First appearance would put them above every answered character on the accident of
    // one being at the top of the list.
    const groups = groupByWorld([
      character("unknown", null),
      character("known", "Kronos"),
      character("also-unknown", null),
    ]);

    expect(groups.map((g) => g.world)).toEqual(["Kronos", null]);
    expect(groups[1]!.characters.map((c) => c.name)).toEqual(["unknown", "also-unknown"]);
  });

  it("has no groups for no characters", () => {
    expect(groupByWorld([])).toEqual([]);
  });

  it("makes one group of characters that are all in one world", () => {
    // Still a group, and still headed. One heading over six rows says the world once where six
    // per-row marks said it six times, which is what the heading replaced.
    const groups = groupByWorld([character("a", "Scania"), character("b", "Scania")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.world).toBe("Scania");
  });
});
