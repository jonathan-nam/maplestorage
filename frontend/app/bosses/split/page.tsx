"use client";

import { useState } from "react";
import {
  type AmountBasis,
  explainSplit,
  FEE_MVP,
  FEE_STANDARD,
  parseMesos,
  type SplitInput,
  type SplitMethod,
  splitDrop,
} from "@/lib/drop-split";

const MAX_PARTY = 6;

const mesos = (n: number) => n.toLocaleString("en-US");
const percent = (fee: number) => `${(fee * 100).toFixed(0)}%`;

/** The 3% / 5% pair. MVP is the cheaper rate, so the intro says which is which once. */
function FeeChoice({
  name,
  value,
  onChange,
}: {
  name: string;
  value: number;
  onChange: (fee: number) => void;
}) {
  return (
    <span className="fee-choice">
      {[FEE_MVP, FEE_STANDARD].map((fee) => (
        <label key={fee} className={value === fee ? "fee-option active" : "fee-option"}>
          <input type="radio" name={name} checked={value === fee} onChange={() => onChange(fee)} />
          {percent(fee)}
        </label>
      ))}
    </span>
  );
}

export default function DropSplitPage() {
  const [price, setPrice] = useState("");
  const [amountIs, setAmountIs] = useState<AmountBasis>("listed");
  const [partySize, setPartySize] = useState(6);
  const [method, setMethod] = useState<SplitMethod>("fair");
  const [sellerFee, setSellerFee] = useState(FEE_MVP);
  const [sharedFee, setSharedFee] = useState(FEE_MVP);
  const [individual, setIndividual] = useState(false);
  // Kept at full length so toggling party size back up does not forget what was set.
  const [overrides, setOverrides] = useState<number[]>(() =>
    Array.from({ length: MAX_PARTY - 1 }, () => FEE_MVP),
  );

  const others = partySize - 1;
  const memberFees = Array.from({ length: others }, (_, i) =>
    individual ? (overrides[i] ?? sharedFee) : sharedFee,
  );

  // Null while the price is empty or unreadable. Showing nothing beats showing a split derived
  // from half a typed number.
  const amount = parseMesos(price);
  const input: SplitInput | null =
    amount === null ? null : { amount, amountIs, sellerFee, memberFees, method };
  const split = input === null ? null : splitDrop(input);

  const uniformPay =
    split !== null &&
    split.members.length > 0 &&
    split.members.every((m) => m.pay === split.members[0]?.pay);

  return (
    <main className="page">
      <h1 className="page-title">Split Utility</h1>

      <p className="split-intro">
        The Auction House takes a cut of every sale, {percent(FEE_STANDARD)} or {percent(FEE_MVP)}{" "}
        with MVP. Pay the party through it and their share is taxed twice while yours is taxed once,
        so dividing what landed in your inventory does not leave everyone equal.
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

        <fieldset className="split-field">
          <legend>Auction House fee</legend>
          {/* Only shown on a listed price: on a received figure there is nothing for it to do. */}
          {amountIs === "listed" && (
            <div className="fee-row">
              <span className="fee-who">Yours, on the sale</span>
              <FeeChoice name="seller-fee" value={sellerFee} onChange={setSellerFee} />
            </div>
          )}

          {others > 0 && !individual && (
            <div className="fee-row">
              <span className="fee-who">Theirs, on the payout</span>
              <FeeChoice name="member-fee" value={sharedFee} onChange={setSharedFee} />
            </div>
          )}

          {others > 0 &&
            individual &&
            memberFees.map((fee, i) => (
              // Members are positions in a party, not entities: there is nothing else to key on
              // until this is wired to real characters.
              // eslint-disable-next-line react/no-array-index-key
              <div className="fee-row" key={i}>
                <span className="fee-who">Member {i + 1}</span>
                <FeeChoice
                  name={`member-fee-${i}`}
                  value={fee}
                  onChange={(next) =>
                    setOverrides((prev) => prev.map((f, j) => (j === i ? next : f)))
                  }
                />
              </div>
            ))}

          {others > 0 && (
            <button
              type="button"
              className="fee-toggle"
              onClick={() => setIndividual((v) => !v)}
              aria-expanded={individual}
            >
              {individual ? "Use one rate for everyone" : "Set each member's rate"}
            </button>
          )}
        </fieldset>

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
            ) : uniformPay ? (
              <>
                Send <strong>{mesos(split.members[0]?.pay ?? 0)}</strong> to each of the other{" "}
                {others}
                {others === 1 ? " member" : " members"}.
              </>
            ) : (
              <>Send each member the amount below. They differ because their fees do.</>
            )}
          </p>

          <table className="split-table">
            <thead>
              <tr>
                <th>Who</th>
                <th>Fee</th>
                <th>You send</th>
                <th>They end up with</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>You</td>
                <td>{amountIs === "listed" ? percent(sellerFee) : "—"}</td>
                <td className="split-dash">&mdash;</td>
                <td>{mesos(split.sellerKeeps)}</td>
              </tr>
              {split.members.map((m, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td>Member {i + 1}</td>
                  <td>{percent(m.fee)}</td>
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
                Lost to the Auction House
                {split.totalFeeCoversSale ? "" : " (on the payouts)"}
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
              {explainSplit(input, split).map((step) => (
                <li key={step.title}>
                  <p className="math-title">{step.title}</p>
                  <p className="math-formula">{step.formula}</p>
                  <p className="math-substituted">{step.substituted}</p>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </main>
  );
}
