"use client";

import { useState } from "react";
import { AUCTION_HOUSE_FEE, parseMesos, type SplitMethod, splitDrop } from "@/lib/drop-split";

const FEE_PERCENT = `${AUCTION_HOUSE_FEE * 100}%`;

const mesos = (n: number) => n.toLocaleString("en-US");

export default function DropSplitPage() {
  const [price, setPrice] = useState("");
  const [partySize, setPartySize] = useState(6);
  const [method, setMethod] = useState<SplitMethod>("fair");

  // Null while the price is empty or unreadable. Showing nothing beats showing a split derived
  // from half a typed number.
  const salePrice = parseMesos(price);
  const split = salePrice === null ? null : splitDrop({ salePrice, partySize, method });
  const others = partySize - 1;

  return (
    <main className="page">
      <h1 className="page-title">Drop split</h1>

      <p className="split-intro">
        The Auction House takes {FEE_PERCENT} of every sale. Pay the party through it and their
        share is taxed twice while yours is taxed once, so dividing what landed in your inventory
        does not leave everyone equal.
      </p>

      <div className="split-form">
        <label className="split-field">
          <span>Sold for</span>
          <input
            className="split-input"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 9.5b, 970m, 1,000,000,000"
            inputMode="text"
            autoFocus
          />
        </label>

        <label className="split-field">
          <span>Party size (including you)</span>
          <input
            className="split-input"
            type="number"
            min={1}
            max={6}
            value={partySize}
            onChange={(e) => setPartySize(Math.min(6, Math.max(1, Number(e.target.value) || 1)))}
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

      {price.trim() !== "" && salePrice === null && (
        <p className="split-error">
          Couldn&apos;t read that as an amount. Try 9.5b, 970m or 1,000,000,000.
        </p>
      )}

      {split && (
        <div className="split-result">
          <p className="split-headline">
            {others === 0 ? (
              <>
                Nobody to pay. You keep <strong>{mesos(split.sellerKeeps)}</strong>.
              </>
            ) : (
              <>
                Send <strong>{mesos(split.payEach)}</strong> to each of the other {others}
                {others === 1 ? " member" : " members"}.
              </>
            )}
          </p>

          <dl className="split-lines">
            <div>
              <dt>You received from the sale</dt>
              <dd>{mesos(split.sellerReceives)}</dd>
            </div>
            {others > 0 && (
              <div>
                <dt>Each of them ends up with</dt>
                <dd>{mesos(split.eachNets)}</dd>
              </div>
            )}
            <div>
              <dt>You end up with</dt>
              <dd>{mesos(split.sellerKeeps)}</dd>
            </div>
            <div className="split-fee">
              <dt>Lost to the Auction House</dt>
              <dd>{mesos(split.totalFee)}</dd>
            </div>
          </dl>

          {others > 0 && method === "lazy" && (
            <p className="split-note">
              Each member is {mesos(split.sellerKeeps - split.eachNets)} short of your own share.
              Switch to fair to even it out.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
