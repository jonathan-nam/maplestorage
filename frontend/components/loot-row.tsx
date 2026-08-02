"use client";

import { useState } from "react";
import { CopyAmount } from "@/components/copy-amount";
import { apiAssetUrl } from "@/lib/api";
import { formatMesos, parseMesos } from "@/lib/drop-split";
import { formatDropped, splitOf, statusLabel } from "@/lib/loot";
import { canTrade, isPerMember } from "@/lib/world";
import type { Boss } from "@/types/boss";
import type { Loot, SellLootBody } from "@/types/loot";
import type { Party } from "@/types/party";

// One drop in the pool: what it is, what it sold for, and who is still owed.
//
// Every figure below comes from splitOf(), which calls splitDrop(). Nothing here divides anything.

export function LootRow({
  loot,
  party,
  boss,
  busy,
  onSell,
  onUnsell,
  onSetPaid,
  onDelete,
}: {
  loot: Loot;
  party: Party;
  boss: Boss | null;
  busy: boolean;
  onSell: (body: SellLootBody) => void;
  onUnsell: () => void;
  onSetPaid: (memberId: string, paid: boolean) => void;
  onDelete: () => void;
}) {
  const [price, setPrice] = useState("");
  const [amountBasis, setAmountBasis] = useState("LISTED");
  const [splitMethod, setSplitMethod] = useState("FAIR");
  // Who could have sold this drop: the seats that ran the week it FELL in, not the party as it
  // stands now. Offering more than that would offer a seller the sell route refuses, and offering
  // the week's roster for a guest week is the only way to name the guest who actually sold it.
  const ran = party.seats.filter((m) => loot.ranThatWeek.includes(m.id));
  const [sellerMemberId, setSellerMemberId] = useState(ran[0]?.id ?? "");
  const [selling, setSelling] = useState(false);

  const amount = parseMesos(price);
  // Against every seat, not `ran`: a payout pinned before somebody left still names them, and
  // reading it against the week's roster would refuse a split that is perfectly readable.
  const result = splitOf(loot, party.seats);
  // Heroic worlds do not trade. The row stays, because a Heroic player still logs what fell; what
  // goes is every control that would turn a drop into money. The backend refuses the sale too, so
  // this is what the rule looks like rather than the whole of it.
  const canSell = canTrade(party.worldType);

  return (
    <article className={`loot-row status-${loot.status.toLowerCase()}`}>
      <header className="loot-head">
        {loot.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(loot.iconUrl)} alt="" />
        ) : (
          // The drop has no official art (see catalog/drops.yaml). An empty frame keeps the row
          // aligned with the ones that do.
          <span className="loot-icon" aria-hidden="true" />
        )}
        <div className="loot-title">
          <span className="loot-name">{loot.name}</span>
          <span className="loot-meta">
            {boss?.iconUrl && (
              <img className="boss-portrait is-small" src={apiAssetUrl(boss.iconUrl)} alt="" />
            )}
            {[boss?.name, formatDropped(loot.droppedOn)].filter(Boolean).join(" · ")}
          </span>
        </div>
        <span className={`loot-status is-${loot.status.toLowerCase()}`}>
          {statusLabel(loot.status)}
        </span>
      </header>

      {/* The mistake this whole app exists to prevent, in miniature: a drop everyone receives
          their own copy of is not one pot to divide. It used to hedge ("in Heroic/Reboot...")
          because the row did not know where it was; it does now, so it either applies or is not
          said. Only where there is splitting to warn off: in a Heroic pool nothing splits anyway. */}
      {canSell && isPerMember(loot.perMember, party.worldType) && (
        <p className="loot-warn">Everyone gets their own. Nothing to split.</p>
      )}

      {loot.status === "PENDING" && !canSell && (
        <div className="loot-actions">
          <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
            Remove
          </button>
        </div>
      )}

      {loot.status === "PENDING" &&
        canSell &&
        (selling ? (
          <form
            className="loot-sale-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (amount === null || !sellerMemberId) return;
              onSell({ amount, amountBasis, splitMethod, sellerMemberId });
              setSelling(false);
            }}
          >
            <div className="loot-sale-line">
              <input
                className="split-input"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="9.5b"
                aria-label="Sale amount"
                inputMode="decimal"
              />
              <select
                className="split-input"
                value={amountBasis}
                onChange={(e) => setAmountBasis(e.target.value)}
                aria-label="What that amount is"
              >
                <option value="LISTED">listed for</option>
                <option value="RECEIVED">received</option>
              </select>
              <select
                className="split-input"
                value={splitMethod}
                onChange={(e) => setSplitMethod(e.target.value)}
                aria-label="Split method"
              >
                {/* Both are offered for the reason lib/drop-split.ts gives: "lazy" is what most
                    parties do, and only showing "fair" would hide what it costs. */}
                <option value="FAIR">fair split</option>
                <option value="LAZY">lazy split</option>
              </select>
              <select
                className="split-input"
                value={sellerMemberId}
                onChange={(e) => setSellerMemberId(e.target.value)}
                aria-label="Who sold it"
              >
                {ran.map((m) => (
                  <option key={m.id} value={m.id}>
                    sold by {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="loot-actions">
              {/* Without a seller there is nobody to measure the shares against, and the submit
                  would return without saying so. */}
              <button
                type="submit"
                className="party-save"
                disabled={busy || amount === null || !sellerMemberId}
              >
                Save sale
              </button>
              <button
                type="button"
                className="party-cancel"
                onClick={() => setSelling(false)}
                disabled={busy}
              >
                Cancel
              </button>
              {/* Shown before saving, so a typed "9.5b" is confirmed as 9,500,000,000 rather than
                  discovered afterwards. */}
              {price !== "" && (
                <span className="loot-parsed">
                  {amount === null ? "not a price" : formatMesos(amount, true)}
                </span>
              )}
            </div>
          </form>
        ) : (
          <div className="loot-actions">
            <button
              type="button"
              className="party-save"
              onClick={() => setSelling(true)}
              disabled={busy}
            >
              Mark sold
            </button>
            <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
              Remove
            </button>
          </div>
        ))}

      {loot.status !== "PENDING" && (
        <>
          {result === null ? (
            // splitOf refuses when a seat it needs is missing. Saying so beats drawing a payout
            // list that is short a person.
            <p className="loot-warn">
              This sale names somebody who is no longer in the party, so the split cannot be shown.
            </p>
          ) : (
            <>
              <p className="loot-sold-line">
                {loot.amountBasis === "LISTED" ? "Listed at" : "Received"}{" "}
                <strong>{formatMesos(loot.saleAmount ?? 0, true)}</strong> by {result.seller.name},{" "}
                {loot.splitMethod === "FAIR" ? "fair" : "lazy"} split. They keep{" "}
                <strong>{formatMesos(result.seller.keeps, true)}</strong>.
              </p>

              <ul className="loot-shares">
                {result.shares.map((share) => (
                  <li key={share.memberId} className={share.paid ? "is-paid" : undefined}>
                    <span className="loot-share-name">{share.name}</span>
                    {/* The raw digits, because this gets pasted into the game's price box. */}
                    <CopyAmount value={share.pay} display={formatMesos(share.pay, true)} />
                    <span className="loot-share-nets">
                      nets {formatMesos(share.nets, true)} at {(share.fee * 100).toFixed(0)}%
                    </span>
                    <button
                      type="button"
                      className={share.paid ? "loot-paid is-paid" : "loot-paid"}
                      onClick={() => onSetPaid(share.memberId, !share.paid)}
                      disabled={busy}
                    >
                      {share.paid ? "paid" : "mark paid"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="loot-actions">
            <button type="button" className="party-cancel" onClick={onUnsell} disabled={busy}>
              Undo sale
            </button>
            <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
              Remove
            </button>
          </div>
        </>
      )}
    </article>
  );
}
