"use client";

import Link from "next/link";
import { SeatChip } from "@/components/seat-chip";
import { apiAssetUrl } from "@/lib/api";
import { bossesFor, partyLabel, partySizeLabel } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

export function PartyCard({
  party,
  bossByKey,
  onEdit,
  onDelete,
  busy,
}: {
  party: Party;
  bossByKey: Map<string, Boss>;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const bosses = bossesFor(party, bossByKey);

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
          <SeatChip key={member.id} member={member} />
        ))}
      </ul>

      {/* No bosses is a real state, not an unfinished one: a party can exist before you decide
          what it runs. Saying so beats an empty row that looks like a failed load. */}
      {bosses.length > 0 ? (
        <ul className="party-bosses">
          {bosses.map((boss) => (
            <li key={boss.key}>
              {boss.iconUrl && (
                <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
              )}
              {boss.name}
            </li>
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
