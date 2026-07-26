import { describe, expect, it } from "vitest";
import { type Draft, draftProblem, knownIgn, newKey, toDraft, toSaveBody } from "./party-grid";
import type { PartyGrid } from "@/types/party";

const grid: PartyGrid = {
  people: [
    { id: "p-jman", name: "Jman", mvp: false },
    { id: "p-jared", name: "Jared", mvp: true },
  ],
  parties: [
    {
      id: "party-1",
      name: "Xkalos duo",
      bossKeys: ["kalos-the-guardian"],
      pendingLoot: 0,
      awaitingPayout: 0,
      createdAt: "2026-07-26T00:00:00Z",
      updatedAt: "2026-07-26T00:00:00Z",
      members: [
        {
          id: "seat-1",
          personId: "p-jman",
          name: "2nd mech",
          ign: "morebuff12",
          characterId: "char-1",
          mvp: false,
          spriteImgUrl: null,
        },
        {
          id: "seat-2",
          personId: "p-jared",
          name: "Premial",
          ign: null,
          characterId: null,
          mvp: true,
          spriteImgUrl: null,
        },
      ],
    },
  ],
};

describe("toDraft", () => {
  it("keys cells by person, so a column can move without taking characters with it", () => {
    const draft = toDraft(grid);
    expect(draft.people.map((p) => p.key)).toEqual(["p-jman", "p-jared"]);
    expect(draft.rows[0]?.cells["p-jman"]).toEqual({ label: "2nd mech", ign: "morebuff12" });
    // A seat with no separate IGN leaves the field empty rather than repeating the label, so the
    // label stands as the name.
    expect(draft.rows[0]?.cells["p-jared"]).toEqual({ label: "Premial", ign: "" });
  });
});

describe("toSaveBody", () => {
  it("keeps ids for what exists and omits them for what does not", () => {
    const draft = toDraft(grid);
    draft.people.push({ key: "new-1", name: "Chris", mvp: false });
    draft.rows.push({
      key: "row-2",
      name: "Limbo trio",
      bossKeys: ["limbo"],
      cells: { "new-1": { label: "Kaiser", ign: "" } },
    });

    const body = toSaveBody(draft);
    expect(body.people[0]?.id).toBe("p-jman");
    expect(body.people[2]).toEqual({ key: "new-1", name: "Chris", mvp: false });
    expect(body.parties[1]?.id).toBeUndefined();
    expect(body.parties[1]?.seats).toEqual([
      { personKey: "new-1", characterName: "Kaiser", ign: null },
    ]);
  });

  it("drops blank cells rather than sending seats with no character", () => {
    // An empty cell is how the grid says somebody sat that one out. Sending it would be a seat the
    // server refuses, over a party the user never asked to change.
    const draft = toDraft(grid);
    draft.rows[0]!.cells["p-jared"] = { label: "   ", ign: "" };

    const seats = toSaveBody(draft).parties[0]?.seats;
    expect(seats).toEqual([{ personKey: "p-jman", characterName: "2nd mech", ign: "morebuff12" }]);
  });
});

describe("knownIgn", () => {
  const draft: Draft = {
    people: [{ key: "j", name: "Jared", mvp: false }],
    rows: [
      { key: "r1", name: "A", bossKeys: [], cells: { j: { label: "lynn", ign: "acornacorn" } } },
      { key: "r2", name: "B", bossKeys: [], cells: { j: { label: "corsair", ign: "" } } },
    ],
  };

  it("reuses the IGN this person already gave that label", () => {
    expect(knownIgn(draft, "j", "Lynn")).toBe("acornacorn");
  });

  it("says nothing for a label it has not seen, or one with no IGN behind it", () => {
    expect(knownIgn(draft, "j", "corsair")).toBe("");
    expect(knownIgn(draft, "j", "merc")).toBe("");
    // Another person's "lynn" is a different character, so it must not be borrowed.
    expect(knownIgn(draft, "someone-else", "lynn")).toBe("");
  });
});

describe("draftProblem", () => {
  const row = (cells: Record<string, { label: string; ign: string }>) => ({
    key: "r",
    name: "Row",
    bossKeys: [],
    cells,
  });

  it("refuses what the server would refuse, in the same words", () => {
    expect(draftProblem({ people: [{ key: "a", name: " ", mvp: false }], rows: [] })).toBe(
      "a person needs a name",
    );
    expect(
      draftProblem({
        people: [
          { key: "a", name: "Jared", mvp: false },
          { key: "b", name: "jared", mvp: false },
        ],
        rows: [],
      }),
    ).toBe("two people share a name");
    expect(draftProblem({ people: [], rows: [row({})] })).toBe("a party needs at least one member");

    const seven = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`p${i}`, { label: `C${i}`, ign: "" }]),
    );
    expect(draftProblem({ people: [], rows: [row(seven)] })).toBe(
      "a party holds at most 6 members",
    );
  });

  it("accepts a grid with blanks in it, because blanks are how it says who sat out", () => {
    const cells = { a: { label: "One", ign: "" }, b: { label: "", ign: "" } };
    expect(
      draftProblem({ people: [{ key: "a", name: "Anna", mvp: false }], rows: [row(cells)] }),
    ).toBeNull();
  });
});

describe("newKey", () => {
  it("does not hand out a key already in use", () => {
    expect(newKey("row", [{ key: "row-1" }])).toBe("row-2");
    expect(newKey("row", [{ key: "row-2" }])).toBe("row-3");
  });
});
