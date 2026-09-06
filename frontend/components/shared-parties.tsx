import { clearClass, clearStateLabel } from "@/lib/boss-clears";
import { difficultyLabel } from "@/lib/boss-difficulty";
import { formatMesos } from "@/lib/drop-split";
import { formatDropped, statusLabel } from "@/lib/loot";
import { yourShare } from "@/lib/shared-parties";
import type { Boss } from "@/types/boss";
import type { SeatedParty } from "@/types/party";

// The parties somebody else keeps the book for, and the nights of them you were on.
//
// No controls. The pool is theirs to record and this account is reading it, so there is nothing
// here to press: a member who wants a night changed asks the person who logged it. Whether that
// ought to stay true is the open question behind the write path, not something this screen decides.

export function SharedParties({
  parties,
  bosses,
  clearOf,
}: {
  parties: SeatedParty[];
  bosses: Boss[];
  /**
   * Whether YOUR character has cleared this party's boss this period.
   *
   * Your own account's answer, not the owner's. boss_clear is per character, so the owner's tick is
   * about THEIR character and answers "have they run it", where the question on this card is "have
   * I". Both accounts record the same night, once each, because the run is one run.
   *
   * Passed in rather than resolved here: the page already holds the clears and already has one way
   * of reading them, and a second way is how two screens come to disagree about the same tick.
   */
  clearOf: (party: SeatedParty) => boolean | null;
}) {
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
            {/* Read-only, like a past week's. Your clear is yours to change, but not from a card
                about somebody else's party: it is on your own routine and the Boss Clears page. */}
            <span className={`party-clear is-${clearClass(clearOf(party))} is-readonly`}>
              {clearStateLabel(clearOf(party))}
            </span>
          </h3>
          {/* The roster as its owner keeps it, yours among them. */}
          <p className="party-hint">{party.seats.map((seat) => seat.name).join(", ")}</p>
          {party.nights.length === 0 ? (
            // Not "no drops": the pool may hold plenty, from weeks this account was not on.
            <p className="finder-empty">Nothing on your nights yet.</p>
          ) : (
            <ul className="shared-nights">
              {party.nights.map((night) => {
                const mine = yourShare(night, party);
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
                    {/* What the party got for it, so your own figure below can be checked against
                        something rather than taken on trust. */}
                    {night.saleAmount !== null && (
                      <span className="shared-night-sold">{formatMesos(night.saleAmount)}</span>
                    )}
                    {mine && (
                      <span className="shared-night-yours">
                        You: {formatMesos(mine.nets)} {mine.paid ? "paid" : "owed"}
                      </span>
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
