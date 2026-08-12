import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Collection Ledger's headline figure is what somebody is going to be ASKED for, so it is stated
// to the meso.
//
// It was shortened, and that hid a real movement: settling a 144m share took a card from 253.86b to
// 254b, which at two decimals reads as a number that did not move at all. The parts underneath were
// exact the whole time, so rounding only their sum made the one figure you act on the one figure you
// cannot check against them.
//
// A source test, like ledger-card-title.test.ts, because there is nothing to call: the choice is
// which formatter a literal in the header uses, and the way it goes wrong is somebody reaching for
// the shorter one because it fits better.

const source = readFileSync(join(__dirname, "..", "components", "collection-ledger.tsx"), "utf8");
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

describe("what the card says a person owes", () => {
  it("states it to the meso, never shortened", () => {
    expect(source).toContain("formatMesos(row.mesos, true)");
    expect(source).toContain("formatMesos(row.owedByYou, true)");
  });

  it("does not reach for shortMesos anywhere, including the import", () => {
    // The import is the tell. While it is there the short form is one keystroke away, and every
    // figure on this card is money somebody is owed rather than a scale to eyeball.
    expect(source).not.toContain("shortMesos");
  });

  it("counts the pieces rather than formatting them, since they are not money", () => {
    // A piece debt has no price. Putting it through a meso formatter would be the first step back
    // towards pricing it, which is what #354 deleted.
    expect(source).toContain("${row.pieces} pieces");
  });

  it("leaves the arithmetic uncoloured, and signs every component instead", () => {
    // The parts sum to the headline, so "settled" cannot be asked of one. Colouring them put a
    // credit AGAINST the debt in red for being unsettled, so one number read as a problem and as
    // progress at once.
    expect(source).not.toContain('className="droplog-take"');
    expect(source).toContain("const signed = (mesos: number) =>");
    expect(source).toContain("{signed(part.mesos)}");
    expect(source).toContain("{signed(entry.amount)}");
    expect(css).not.toContain(".ledger-amount.is-open");
    expect(css).not.toContain("is-owing");
  });

  it("keeps green meaning PAID, the way a share badge already uses it", () => {
    // .loot-paid.is-paid is --good for a share that has been paid, and one app cannot have green
    // mean settled on one page and outstanding on the next. This went the wrong way round first.
    expect(css).toMatch(/\.ledger-amount\.is-paid\s*\{\s*color: var\(--good\)/);
    expect(css).toMatch(/\.ledger-summary\.is-open\s*\{\s*color: var\(--bad\)/);
    expect(css).toMatch(/\.loot-paid\.is-paid\s*\{[^}]*var\(--good\)/);
  });

  it("says what settling will RECORD, never what you have already done", () => {
    // "says you have already sent 139,548,023" beside an enabled button reads as a statement of
    // fact rather than as the act the button performs. Same subject-less fragment as the entry box
    // it replaced.
    expect(source).not.toContain("already sent");
    expect(source).toContain("records ${formatMesos(owes, true)} sent to ${row.name}");
  });
  it("puts the nights behind the shares figure on hover, and marks that it has them", () => {
    // The same list sits under its own step further down, with two forms between the two, so the
    // figure and the nights it came off did not read as the same thing.
    expect(source).toContain("const behindShares = row.lines");
    expect(source).toContain("title={part.detail || undefined}");
    expect(source).toContain('part.detail ? "loot-name has-detail" : "loot-name"');
    expect(css).toContain(".loot-name.has-detail");
  });
  it("offers Settle only where there is something to COLLECT", () => {
    // A card whose every share runs against you has nothing to collect, so a Settle on it can only
    // mean "I have already paid them", the one thing nobody comes to this page to say. It was hit
    // three times running, each time taking a debt of Jonathan's out of the netting and putting the
    // figure back UP. A warning beside it was not enough and could not be: a button with one
    // possible effect, and that effect wrong, is a trap however it is labelled.
    expect(source).toContain('row.lines.some((line) => line.direction === "owed")');
    expect(source).toContain("{collectable && (");
  });

  it("still says what a MIXED settle also does, since it clears both directions", () => {
    expect(source).toContain("also records ${formatMesos(owes, true)} sent to ${row.name}");
  });
});
