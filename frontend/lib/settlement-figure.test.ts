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
const settlement = readFileSync(join(__dirname, "settlement.ts"), "utf8");

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
    // towards pricing it, which is what #354 deleted. Netted into ONE count now, and the direction is
    // in the words: netting a count of the same coupon between the same two people values nothing.
    expect(source).toContain("${row.piecesNet} coupons to hand over");
    expect(source).toContain("${-row.piecesNet} coupons owed");
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
  it("names the nights an offset discharged, off the pools", () => {
    // Without V58 the link is gone: the settle marks those shares PAID, so they leave the wallet,
    // and the adjustment is left saying only "-139,548,023, offset against Bro".
    expect(source).toContain("const nightsBehind = (payouts:");
    expect(source).toContain("offsetShares.get(shareKey(share.lootId, share.memberId))");
    expect(source).toContain("function DischargeRow(");
  });

  it("puts the DROP on the offset's own row, not a note and a count", () => {
    // Almost every offset covers one share, so a middle row reading "offset against Bro · 1 share"
    // cost a second click to reach the only fact anybody wanted: which drop that was. Where there
    // is one share, its drop IS the row, with the art the rest of the account reads drops by.
    expect(source).toContain("const one = shares.length === 1 ? shares[0]! : null;");
    expect(source).toContain("const art = one?.iconUrl ?? (pieces > 0 ? iconUrl : null);");
    expect(source).toContain("apiAssetUrl(art)");
    expect(source).toContain("{one.item}");
    expect(source).toContain(`one.members.join(", ")`);
    expect(source).toContain("formatDropped(one.on)");
    expect(source).toContain("sold for ${formatMesos(one.sale, true)}");
  });

  it("keeps a fold for the offset that really is a group", () => {
    // Several nights, or several sales, and no single one names the act, so the count stands and
    // opens. One of either IS the row.
    expect(source).toContain("const folds = shares.length > 1 || act.sales.length > 1;");
    expect(source).toContain("folds ? (");
    expect(source).toContain("party-row-chevron");
  });

  it("counts the coupons a sale offset was made of, and opens onto them", () => {
    // The row reached Jonathan's card as the bare words "coupon sale" beside 2.41b: how many coupons
    // that was, what each fetched and when they sold were on no screen in the app.
    expect(source).toContain(
      "const pieces = act.sales.reduce((sum, sale) => sum + sale.pieces, 0);",
    );
    expect(source).toContain("`${pieces} coupons sold`");
    expect(source).toContain("`${sale.pieces} coupons`");
    expect(source).toContain("sale.soldAt && dayOf(sale.soldAt)");
    expect(source).toContain("signed(-sale.mesos)");
  });

  it("wears the coupon's own art on a sale offset, every piece of one being a coupon", () => {
    expect(source).toContain("iconUrl: string | null;");
    // Off the drop tables, which is where every other coupon sprite on this page comes from.
    expect(page).toContain("iconUrl={vestigeIcon}");
  });

  it("dates every act in the history, and means the same thing by it on each", () => {
    // A history read from the top, in which nothing said which day an act was. The day the ACT was
    // recorded, not the day the drop fell: one column down one list cannot mean two facts, so the
    // drop's own day stays on hover.
    expect(source).toContain('<span className="loot-meta ledger-when">{dayOf(act.at)}</span>');
    expect(source).toContain("const dayOf = (at: string) => formatDropped(at.slice(0, 10));");
    // Never shrunk: a date is unreadable clipped, so the name stays the only part that gives.
    expect(css).toContain(".ledger-drop-head.is-oneline .ledger-when");
    // And below 560px the line runs out. Measured at 390px: a 15-digit figure and the date leave the
    // name at nothing and still spill 6px past the card, so the row wraps rather than lose the
    // figure off the end. One line is worth having where there is width for it, and no further.
    expect(css).toMatch(
      /@media \(max-width: 560px\) \{\s*\.ledger-drop-head\.is-oneline \{\s*flex-wrap: wrap;/,
    );
  });

  it("holds an offset to ONE line, whatever is behind it", () => {
    // Two folds in there is no width for an icon, a name, a boss, three member names, a date and two
    // mesos figures: they came out three lines tall and the list stopped being scannable. The figure,
    // the art and what fell stay; the rest is the title, which is what the shares row above already
    // does. The name is the only part allowed to give, being the one a reader recognises from half.
    expect(source).toContain(
      '<div className="ledger-drop-head is-oneline" title={behind || undefined}>',
    );
    expect(css).toContain(".ledger-drop-head.is-oneline");
    expect(css).toContain("flex-wrap: nowrap");
    expect(css).toContain("text-overflow: ellipsis");
    // The figure is pushed right and never shrunk: it is the one number nobody can infer.
    expect(css).toContain(".ledger-drop-head.is-oneline .ledger-amount");
    expect(css).toContain(".ledger-drop-head.is-oneline .loot-icon");
  });

  it("nests a drop queue in a drop row, never a share list", () => {
    // `.loot-shares > li` is a wrapping ROW with a rule above it and a `.ledger-drop` is a COLUMN
    // with a rule down its left. One inside the other gave every act both, and the section came out
    // with stray borders and two indents fighting.
    expect(source).toContain('<ul className="ledger-queue" id={`off-${row.key}`}>');
    expect(css).toContain(".ledger-drop .ledger-queue");
  });

  it("states a discharge once, in the list that is for discharges", () => {
    // `soldOfTheirs` is only ever the part somebody has said comes off their debt, which makes it a
    // discharge. Listed as a part as well, 2,412,222,150 sat in the owed list AND inside the fold
    // below it, so the two lists came to more than the card did.
    expect(source).not.toContain("mesos: row.parts.soldOfTheirs");
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
    // The chevron frame is still drawn, so a typed row lines up with a folded one. No fold on it at
    // all any more: an entry that names a share is a discharge and is drawn under `offsets`, so
    // what is left in the owed list names nothing and never had anything to open.
    expect(source).toContain('<span className="party-row-toggle is-empty"');
    expect(source).toContain("function EnteredRow(");
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

  it("lets the money you are HOLDING be copied too, it being the one you send", () => {
    // "I paid them" beside it means the mesos went across in a trade, so this is a figure that gets
    // pasted, and it was the only one on the card with an act behind it and no way to take it.
    expect(source).toContain(
      "<CopyAmount value={row.holding} display={formatMesos(row.holding, true)} />",
    );
  });

  it("asks what a PAYMENT was for too, the same way the entry above it does", () => {
    // The two halves of one conversation were recorded differently: a debt could say "for the Kalos
    // run" and the money arriving back could not say which debt it answered. Same box, same words,
    // and optional on both, so neither form waits on it.
    expect(source).toContain("onAddPayment(row.holder, paid, gotNote.trim())");
    expect(source).toContain("const [gotNote, setGotNote] = useState");
    // Its own state. One box shared between the two forms would clear a half-typed note in the
    // other the moment either saved.
    expect(source).not.toContain("setGotNote(note)");
    expect(page).toContain("body: JSON.stringify({ holder, amount, note: note || undefined })");
  });

  it("says what a receipt was for where it has one, and stays plain where it does not", () => {
    expect(source).toContain("${formatMesos(got.amount, true)} paid \\u00b7 ${got.note}");
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
    expect(source).toContain("row.piecesNet > 0");
    expect(source).toContain("const toCopy = row.mesos > 0 ? row.mesos");
  });
});

// A payment was on the card twice, in two different words: an unlabelled "received" line folding
// every receipt into the arithmetic, and a "210,000,000 paid · 20 stars" pill under the form. The
// note was legible only on the pill and the figure only in the list, so neither said the whole act.
describe("a receipt on the card", () => {
  it("is an act in the history, beside the offsets that also came off", () => {
    expect(source).toContain("moneyRows(row, payments.counted)");
    expect(settlement).toContain('source: "PAYMENT"');
    expect(settlement).toContain('label: got.note ?? "paid"');
  });

  it("is not also folded into a received line, which said the sum and nothing else", () => {
    expect(source).not.toContain("row.parts.received");
    expect(source).not.toContain('label: "received"');
  });

  it("names the step for the effect, since the history is no longer offsets alone", () => {
    expect(source).toContain('<span className="ledger-step">came off</span>');
    expect(source).not.toContain('<span className="ledger-step">offsets</span>');
  });

  it("counts what is in the fold rather than calling a payment an offset", () => {
    // A count that looks right and is not is the one failure this ledger exists to prevent.
    expect(source).toContain('plural(offsetActs, "offset")} and ${plural(paidActs, "payment")}');
  });

  it("is removable where it is drawn, since this is the only screen that records one", () => {
    expect(source).toContain("onRemovePayment(act.id)");
  });

  it("keeps the strip for the receipts a closure already spent, and only those", () => {
    // Those came off a debt that is closed, so listing them with the rest would put money against a
    // debt they have already paid. They stay drawn because nothing else takes a mistyped one back.
    expect(source).toContain("{payments.spent.length > 0 && (");
    expect(page).toContain("paymentsSinceClosing(payments, settlements)");
  });
});
