"use client";

import Link from "next/link";
import { bossNamesFor, partyLabel, partySizeLabel } from "@/lib/parties";
import type { Party } from "@/types/party";

export function PartyCard({
  party,
  bossNameByKey,
  onEdit,
  onDelete,
  busy,
}: {
  party: Party;
  bossNameByKey: Map<string, string>;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const bossNames = bossNamesFor(party, bossNameByKey);

  return (
    <article className="party-card">
      <header className="party-card-head">
        <h3 className="party-card-name">
          <Link href={`/bosses/parties/${party.id}`}>{partyLabel(party)}</Link>
        </h3>
        <span className="party-card-size">{partySizeLabel(party.members.length)}</span>
      </header>

      <ul className="party-roster">
        {party.members.map((member) => (
          <li
            key={member.id}
            className={`party-seat-chip${member.characterId ? " is-mine" : ""}`}
            title={member.characterId ? "One of your characters" : undefined}
          >
            {member.name}
            {member.mvp && <span className="party-mvp">MVP</span>}
          </li>
        ))}
      </ul>

      {/* No bosses is a real state, not an unfinished one: a party can exist before you decide
          what it runs. Saying so beats an empty row that looks like a failed load. */}
      {bossNames.length > 0 ? (
        <ul className="party-bosses">
          {bossNames.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : (
        <p className="party-hint">No bosses assigned yet.</p>
      )}

      {/* Only what needs doing. A settled pool says nothing, because a card that always shows
          "0 awaiting payout" is a card nobody reads. */}
      {(party.pendingLoot > 0 || party.awaitingPayout > 0) && (
        <p className="party-loot-summary">
          {[
            party.pendingLoot > 0 ? `${party.pendingLoot} in the pool` : null,
            party.awaitingPayout > 0 ? `${party.awaitingPayout} awaiting payout` : null,
          ]
            .filter(Boolean)
            .join(" \u00b7 ")}
        </p>
      )}

      <div className="party-card-actions">
        <button type="button" className="party-cancel" onClick={onEdit} disabled={busy}>
          Edit
        </button>
        <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
          Delete
        </button>
      </div>
    </article>
  );
}
