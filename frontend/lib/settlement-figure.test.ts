import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Settlement Ledger's headline figure is what somebody is going to be ASKED for, so it is stated
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

const source = readFileSync(join(__dirname, "..", "components", "settlement-ledger.tsx"), "utf8");
const page = readFileSync(join(__dirname, "..", "app", "bosses", "drops", "page.tsx"), "utf8");
const summary = readFileSync(join(__dirname, "..", "components", "settlement-summary.tsx"), "utf8");
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
  it("names the shares an offset discharged, and folds them behind one row", () => {
    // Without V58 the link is gone: the settle marks those shares PAID, so they leave the wallet,
    // and the adjustment is left saying only "-139,548,023, offset against Bro". Folding is what
    // keeps the list one row per offset however many nights went into it.
    expect(source).toContain("const sharesBehind = (entry: SettlementDebt)");
    expect(source).toContain("offsetShares.get(shareKey(share.lootId, share.memberId))");
    expect(source).toContain("function EnteredRow(");
    expect(source).toContain("party-row-chevron");
  });

  it("names WHAT FELL first, then when and what the lot made", () => {
    // One boss drops several things and the same box drops off several bosses, so the boss alone
    // says which night without ever saying which thing. The date tells two nights on one boss
    // apart, and the lot is what the share can be checked against rather than taken on trust.
    expect(source).toContain("{share.item}");
    expect(source).toContain("formatDropped(share.on)");
    expect(source).toContain("sold for ${formatMesos(share.sale, true)}");
    expect(source).toContain("{signed(-share.share)}");
  });

  it("resolves a share off the POOLS, since an offset's shares are paid and gone from the wallet", () => {
    expect(page).toContain("const offsetShares = new Map<string, OffsetShare>()");
    expect(page).toContain("item: loot.name");
    expect(page).toContain("on: loot.droppedOn");
    expect(page).toContain("sale: loot.saleAmount");
  });

  it("splits only the drops an offset actually names", () => {
    // Splitting every loot row in every pool to answer for a handful would be a pass over the whole
    // account on every render.
    expect(page).toContain("const wanted = new Set(debts.flatMap");
    expect(page).toContain("if (!wanted.has(loot.id)) continue;");
  });

  it("says so when a drop behind an offset has been deleted", () => {
    // A row that quietly drops one of the nights behind a figure is a figure that no longer adds up.
    expect(source).toContain('item: "A drop that has been deleted"');
  });

  it("keeps a hand-entered debt a plain row, since it discharges no share", () => {
    // The chevron frame is still drawn, so a typed row lines up with a folded one.
    expect(source).toContain("shares.length > 0 ? (");
    expect(source).toContain('<span className="party-row-toggle is-empty"');
  });
  it("keeps the summary to totals, since the cards are the per-person list", () => {
    // A line per person went here and came straight back out: the cards below say the same thing, at
    // more length and with something to do about it, so it was a second list of the same names half
    // a screen above the first.
    expect(page).toContain("<SettlementSummary rows={settlement} totals={owedTotals} />");
    expect(summary).not.toContain("settlement-strip");
    expect(css).not.toContain(".settlement-strip");
  });

  it("sums the strip off the same rows the cards draw", () => {
    // The Wallet had its own pass over the pools, which is how two surfaces come to give two
    // answers. A strip disagreeing with the list under it is the same bug with a shorter walk.
    // Asserted on the IMPORTS, not on the prose: the comment above it has to be free to name the
    // pools in order to say why it does not read them.
    expect(summary).toContain("rows: Settlement[]");
    expect(summary).not.toMatch(/^import .*(wallet|types\/loot)/m);
  });

  it("lets a figure be copied, since it gets pasted into the game", () => {
    // Retiring the Wallet took the only place on this account where an amount could be copied, and
    // CopyAmount sends the RAW digits: a pasted "3,284,739,285" is not a price the game accepts.
    expect(source).toContain("<CopyAmount");
  });

  it("keeps a pinned person's card drawn with nothing on it", () => {
    // The one case a blank card is wanted: it is where next week's entry goes. Without it the place
    // you record what somebody owes is somewhere you have to make appear first.
    expect(source).toContain("row.pinned ?");
    expect(page).toContain("people.filter((p) => p.pinned)");
  });

  it("offers the pin only on a PERSON, never on an unclaimed character", () => {
    // A character nobody has claimed is somebody the account cannot name yet, and pinning one would
    // keep a card for a human it may turn out to already have.
    expect(source).toContain("{row.attributed && (");
  });

  it("does not offer to copy a COUNT of pieces, which is not a price", () => {
    expect(source).toContain("{`${row.pieces} pieces`}");
    expect(source).toContain("const toCopy = row.mesos > 0 ? row.mesos");
  });
});
