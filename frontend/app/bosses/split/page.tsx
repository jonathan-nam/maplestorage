"use client";

import { useState } from "react";
import {
  type AmountBasis,
  explainSplit,
  FEE_MVP,
  FEE_STANDARD,
  formatMesos,
  parseMesos,
  type SplitInput,
  type SplitMethod,
  splitDrop,
} from "@/lib/drop-split";

const MAX_PARTY = 6;

const percent = (fee: number) => `${(fee * 100).toFixed(0)}%`;

export default function DropSplitPage() {
  const [price, setPrice] = useState("");
  const [amountIs, setAmountIs] = useState<AmountBasis>("listed");
  const [partySize, setPartySize] = useState(6);
  const [method, setMethod] = useState<SplitMethod>("fair");
  // Raw digits by default: these get pasted into the game's price box, which takes nothing else.
  const [grouped, setGrouped] = useState(false);

  const mesos = (value: number) => formatMesos(value, grouped);

  const others = partySize - 1;

  // Everyone at the standard rate. splitDrop still takes a rate PER PERSON, because the payout
  // hop is charged to whoever receives it and MVP members are genuinely cheaper. Asking for that
  // per member was a form demanding what the person handing out loot rarely knows, so the caller
  // assumes the common case and the note below says so.
  const memberFees = Array.from({ length: others }, () => FEE_STANDARD);

  // Null while the price is empty or unreadable. Showing nothing beats showing a split derived
  // from half a typed number.
  const amount = parseMesos(price);
  const input: SplitInput | null =
    amount === null ? null : { amount, amountIs, sellerFee: FEE_STANDARD, memberFees, method };
  const split = input === null ? null : splitDrop(input);

  return (
    <main className="page">
      <h1 className="page-title">Split Utility</h1>

      <p className="split-intro">
        The Auction House takes {percent(FEE_STANDARD)} of every sale. Pay the party through it and
        their share is taxed twice while yours is taxed once, so dividing what landed in your
        inventory does not leave everyone equal.
      </p>

      <div className="split-form">
        <div className="split-field">
          <span className="basis-row">
            {(
              [
                ["listed", "Listed price"],
                ["received", "What I received"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={amountIs === value ? "basis-tab active" : "basis-tab"}>
                <input
                  type="radio"
                  name="basis"
                  checked={amountIs === value}
                  onChange={() => setAmountIs(value)}
                />
                {label}
              </label>
            ))}
          </span>
          <input
            className="split-input"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 9.5b, 970m, 1,000,000,000"
            inputMode="text"
            aria-label={amountIs === "listed" ? "Listed price" : "Amount received"}
            autoFocus
          />
          <span className="split-hint">
            {amountIs === "listed" ? (
              <>
                What the item was listed at, before the fee.
                {split ? <> You received {mesos(split.sellerReceives)}.</> : null}
              </>
            ) : (
              <>
                What actually landed in your inventory. Your own fee is already spent, so it does
                not affect the split.
              </>
            )}
          </span>
        </div>

        <label className="split-field">
          <span>Party size (including you)</span>
          <input
            className="split-input"
            type="number"
            min={1}
            max={MAX_PARTY}
            value={partySize}
            onChange={(e) =>
              setPartySize(Math.min(MAX_PARTY, Math.max(1, Number(e.target.value) || 1)))
            }
          />
        </label>

        <fieldset className="split-field split-methods">
          <legend>Split</legend>
          {(
            [
              ["fair", "Fair", "Everyone ends up holding the same amount."],
              ["lazy", "Lazy", "Divide what you received. Simpler, and you keep more."],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={method === value ? "split-method active" : "split-method"}
            >
              <input
                type="radio"
                name="method"
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
              />
              <span className="split-method-label">{label}</span>
              <span className="split-method-hint">{hint}</span>
            </label>
          ))}
        </fieldset>
      </div>

      {price.trim() !== "" && amount === null && (
        <p className="split-error">
          Couldn&apos;t read that as an amount. Try 9.5b, 970m or 1,000,000,000.
        </p>
      )}

      {split && input && (
        <div className="split-result">
          <p className="split-headline">
            {others === 0 ? (
              <>
                Nobody to pay. You keep <strong>{mesos(split.sellerKeeps)}</strong>.
              </>
            ) : (
              <>
                Send <strong>{mesos(split.members[0]?.pay ?? 0)}</strong> to each of the other{" "}
                {others}
                {others === 1 ? " member" : " members"}.
              </>
            )}
          </p>

          <button
            type="button"
            className="group-toggle"
            onClick={() => setGrouped((g) => !g)}
            aria-pressed={grouped}
          >
            {grouped ? "Show raw numbers" : "Show comma separators"}
          </button>

          <table className="split-table">
            <thead>
              <tr>
                <th>Who</th>
                <th>You send</th>
                <th>They end up with</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>You</td>
                <td className="split-dash">&mdash;</td>
                <td>{mesos(split.sellerKeeps)}</td>
              </tr>
              {split.members.map((m, i) => (
                // Members are positions in a party, not entities: there is nothing else to key on
                // until this is wired to real characters.
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td>Member {i + 1}</td>
                  <td>{mesos(m.pay)}</td>
                  <td>{mesos(m.nets)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="split-lines">
            <div>
              <dt>You received from the sale</dt>
              <dd>{mesos(split.sellerReceives)}</dd>
            </div>
            <div className="split-fee">
              {/* Says which hops it covers: on a received figure the sale's fee is unknown. */}
              <dt>
                Lost to the Auction House{split.totalFeeCoversSale ? "" : " (on the payouts)"}
              </dt>
              <dd>{mesos(split.totalFee)}</dd>
            </div>
          </dl>

          {others > 0 && method === "lazy" && (
            <p className="split-note">
              Every member ends up short of your own share, because their half of the split is taxed
              a second time. Switch to fair to even it out.
            </p>
          )}

          <details className="split-math">
            <summary>Show the math</summary>
            <ol className="math-steps">
              {explainSplit(input, split, { grouped }).map((step) => (
                <li key={step.label}>
                  <span className="math-label">{step.label}</span>
                  <span className="math-expression">{step.expression}</span>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}

      <p className="split-caveat">
        Assumes the standard {percent(FEE_STANDARD)} Auction House fee throughout. MVP pays{" "}
        {percent(FEE_MVP)}, so anyone on MVP keeps a little more than shown here. Treat the figures
        as the fair share to aim for, not to the meso.
      </p>
    </main>
  );
}
