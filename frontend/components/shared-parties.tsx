import { difficultyLabel } from "@/lib/boss-difficulty";
import { formatDropped, statusLabel } from "@/lib/loot";
import type { Boss } from "@/types/boss";
import type { SeatedParty } from "@/types/party";

// The parties somebody else keeps the book for, and the nights of them you were on.
//
// No controls. The pool is theirs to record and this account is reading it, so there is nothing
// here to press: a member who wants a night changed asks the person who logged it. Whether that
// ought to stay true is the open question behind the write path, not something this screen decides.

/** Whether YOUR seat has been paid for this drop, or null when nobody is owed anything yet. */
function yoursPaid(
  payouts: { memberId: string; paid: boolean }[],
  mySeatIds: string[],
): boolean | null {
  const mine = payouts.filter((p) => mySeatIds.includes(p.memberId));
  if (mine.length === 0) return null;
  return mine.every((p) => p.paid);
}

export function SharedParties({ parties, bosses }: { parties: SeatedParty[]; bosses: Boss[] }) {
  if (parties.length === 0) return null;
  const nameOf = (bossKey: string) => bosses.find((b) => b.bossKey === bossKey)?.name ?? bossKey;
  return (
    <section className="party-group">
      <header className="party-banner">
        <h2 className="party-group-name">Shared with you</h2>
      </header>
      {parties.map((party) => (
        <div className="shared-party" key={party.id}>
          <h3 className="config-boss">
            {nameOf(party.bossKey)}
            {party.difficulty && (
              <span className="party-difficulty">{difficultyLabel(party.difficulty)}</span>
            )}
          </h3>
          {/* The roster as its owner keeps it, yours among them. */}
          <p className="party-hint">{party.seats.map((seat) => seat.name).join(", ")}</p>
          {party.nights.length === 0 ? (
            // Not "no drops": the pool may hold plenty, from weeks this account was not on.
            <p className="finder-empty">Nothing on your nights yet.</p>
          ) : (
            <ul className="shared-nights">
              {party.nights.map((night) => {
                const paid = yoursPaid(night.payouts, party.mySeatIds);
                return (
                  <li key={night.id}>
                    <span className="shared-night-drop">
                      {night.name}
                      {night.quantity > 1 && ` x${night.quantity}`}
                    </span>
                    <span className="shared-night-when">{formatDropped(night.droppedOn)}</span>
                    {/* Their word for the drop's stage, then yours for your own share of it: a pool
                        can be Awaiting payout while your seat is already settled. */}
                    <span className="shared-night-status">{statusLabel(night.status)}</span>
                    {paid !== null && (
                      <span className="shared-night-yours">{paid ? "You: paid" : "You: owed"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
