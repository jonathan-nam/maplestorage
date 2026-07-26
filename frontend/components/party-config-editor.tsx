"use client";

import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { bossesWithoutConfig, MAX_PARTY, otherMembers } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { Party, SavePartyBody } from "@/types/party";

// One character's parties: a row per boss they do not solo, and who they run it with.
//
// The character leads because that is how the question gets asked ("what does mechyfechy run Kalos
// with"), and a boss with no row is a boss that character solos. Nothing has to be said for those,
// which is what keeps this down to the handful of lines that matter.

export function PartyConfigEditor({
  characterId,
  characterName,
  parties,
  bosses,
  knownCharacters,
  busy,
  error,
  onSave,
  onDelete,
}: {
  characterId: string;
  characterName: string;
  parties: Party[];
  bosses: Boss[];
  /** Characters named anywhere already, for the datalist. Picking beats remembering a spelling. */
  knownCharacters: string[];
  busy: boolean;
  error: string | null;
  onSave: (body: SavePartyBody, partyId?: string) => void;
  onDelete: (party: Party) => void;
}) {
  const [addingBoss, setAddingBoss] = useState("");
  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const available = bossesWithoutConfig(parties, bosses, characterId);

  return (
    <section className="configs">
      {parties.length === 0 && (
        <p className="party-hint">
          {characterName} has no parties yet. A boss they solo needs none, so add only the ones they
          run with somebody.
        </p>
      )}

      {parties.map((party) => (
        <ConfigRow
          key={party.id}
          party={party}
          boss={bossByKey.get(party.bossKey) ?? null}
          busy={busy}
          onSave={(members, name) =>
            onSave({ characterId, bossKey: party.bossKey, name, members }, party.id)
          }
          onDelete={() => onDelete(party)}
        />
      ))}

      {error && <p className="split-error">{error}</p>}

      <div className="loot-actions">
        <select
          className="split-input"
          value={addingBoss}
          onChange={(e) => setAddingBoss(e.target.value)}
          aria-label={`Add a boss for ${characterName}`}
          disabled={available.length === 0}
        >
          <option value="">
            {available.length === 0 ? "every boss has a party" : "add a boss..."}
          </option>
          {available.map((boss) => (
            <option key={boss.bossKey} value={boss.bossKey}>
              {boss.name}
            </option>
          ))}
        </select>
        <AddParty
          busy={busy || addingBoss === ""}
          onAdd={(member) => {
            onSave({ characterId, bossKey: addingBoss, name: null, members: [member] });
            setAddingBoss("");
          }}
          knownCharacters={knownCharacters}
        />
      </div>
    </section>
  );
}

/**
 * Adding a party takes the boss AND the first person in one go.
 *
 * The server refuses a party with nobody else in it, on purpose: that is a solo run, and a solo
 * run is not a party. So there is no such thing as an empty row to fill in afterwards.
 */
function AddParty({
  busy,
  onAdd,
  knownCharacters,
}: {
  busy: boolean;
  onAdd: (member: string) => void;
  knownCharacters: string[];
}) {
  const [member, setMember] = useState("");
  return (
    <>
      <input
        className="split-input"
        value={member}
        list="known-characters"
        onChange={(e) => setMember(e.target.value)}
        placeholder="with who?"
        aria-label="First member of the new party"
        maxLength={40}
      />
      <button
        type="button"
        className="party-save"
        disabled={busy || member.trim() === ""}
        onClick={() => {
          onAdd(member.trim());
          setMember("");
        }}
      >
        Add party
      </button>
      <datalist id="known-characters">
        {knownCharacters.map((character) => (
          <option key={character} value={character} />
        ))}
      </datalist>
    </>
  );
}

function ConfigRow({
  party,
  boss,
  busy,
  onSave,
  onDelete,
}: {
  party: Party;
  boss: Boss | null;
  busy: boolean;
  onSave: (members: string[], name: string | null) => void;
  onDelete: () => void;
}) {
  const saved = otherMembers(party).map((m) => m.name);
  const [members, setMembers] = useState<string[]>(saved.length > 0 ? saved : [""]);
  const [name, setName] = useState(party.name ?? "");
  const dirty = members.join(" ") !== saved.join(" ") || name.trim() !== (party.name ?? "");
  const attributed = otherMembers(party).filter((m) => m.personName);

  return (
    <article className="config-row">
      <header className="config-head">
        {boss?.iconUrl && <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />}
        <h3 className="config-boss">{boss?.name ?? party.bossKey}</h3>
        <input
          className="split-input config-label"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="label (carry, duo...)"
          aria-label={`Label for ${boss?.name ?? party.bossKey}`}
          maxLength={40}
        />
        <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
          Remove
        </button>
      </header>

      <div className="config-members">
        {members.map((member, index) => (
          // Positions in a list of text: there is nothing else to key on until it is saved.
          <span className="config-member" key={index}>
            <input
              className="split-input"
              value={member}
              list="known-characters"
              onChange={(e) =>
                setMembers(members.map((m, i) => (i === index ? e.target.value : m)))
              }
              placeholder="character"
              aria-label={`Member ${index + 1}`}
              maxLength={40}
            />
            {members.length > 1 && (
              <button
                type="button"
                className="grid-boss-remove"
                aria-label={`Remove member ${index + 1}`}
                onClick={() => setMembers(members.filter((_, i) => i !== index))}
              >
                &times;
              </button>
            )}
          </span>
        ))}
        {/* Your own character is the config, so the others cap one below the party limit. */}
        {members.length < MAX_PARTY - 1 && (
          <button
            type="button"
            className="party-add-seat"
            onClick={() => setMembers([...members, ""])}
          >
            + Member
          </button>
        )}
      </div>

      {/* Whose character each one is, when the people list says so. Read-only here: it is an
          account-wide fact, kept on the People page rather than per config. */}
      {attributed.length > 0 && (
        <p className="party-hint">
          {attributed.map((m) => `${m.name} is ${m.personName}'s`).join(", ")}
        </p>
      )}

      {dirty && (
        <div className="loot-actions">
          <button
            type="button"
            className="party-save"
            disabled={busy}
            onClick={() =>
              onSave(
                members.map((m) => m.trim()).filter((m) => m !== ""),
                name.trim() === "" ? null : name.trim(),
              )
            }
          >
            Save
          </button>
          <button
            type="button"
            className="party-cancel"
            disabled={busy}
            onClick={() => {
              setMembers(saved.length > 0 ? saved : [""]);
              setName(party.name ?? "");
            }}
          >
            Revert
          </button>
        </div>
      )}
    </article>
  );
}
