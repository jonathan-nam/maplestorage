"use client";

import { useState } from "react";
import { MAX_PARTY } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party, PartyMemberDraft, SavePartyBody } from "@/types/party";

// Creating and editing are the same form: a party is submitted whole either way (see
// SavePartyRequest), so an editor that could only add would have to be written twice.

const NOBODY = "";

function draftFrom(party: Party | null): PartyMemberDraft[] {
  if (party) return party.members.map((m) => ({ ...m }));
  // A new party starts with two seats, because the smallest party anyone tracks is a duo. One
  // empty seat reads as a form that is not finished.
  return [emptySeat(), emptySeat()];
}

function emptySeat(): PartyMemberDraft {
  return { name: "", characterId: null, mvp: false };
}

export function PartyEditor({
  party,
  bosses,
  characters,
  busy,
  error,
  onSave,
  onCancel,
}: {
  // Null when creating.
  party: Party | null;
  bosses: Boss[];
  characters: Character[];
  busy: boolean;
  error: string | null;
  onSave: (body: SavePartyBody) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(party?.name ?? "");
  const [members, setMembers] = useState<PartyMemberDraft[]>(() => draftFrom(party));
  const [bossKeys, setBossKeys] = useState<string[]>(party?.bossKeys ?? []);

  const filled = members.filter((m) => m.name.trim() !== "");
  // The server refuses a party with no members or with seven; saying so here saves the round trip
  // rather than replacing the check. Blank seats are dropped on submit, so they do not count.
  const canSave = filled.length > 0 && filled.length <= MAX_PARTY && !busy;

  const update = (index: number, patch: Partial<PartyMemberDraft>) =>
    setMembers((current) => current.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  // Picking one of your characters fills the seat's name from the roster, so the two cannot
  // disagree. Typing over it afterwards is allowed: the name is what you call them.
  const pickCharacter = (index: number, characterId: string) => {
    const character = characters.find((c) => c.id === characterId);
    update(index, {
      characterId: characterId === NOBODY ? null : characterId,
      name: character ? character.name : (members[index]?.name ?? ""),
    });
  };

  const toggleBoss = (bossKey: string) =>
    setBossKeys((current) =>
      current.includes(bossKey) ? current.filter((k) => k !== bossKey) : [...current, bossKey],
    );

  // A character may hold only one seat (the server refuses two, since it would double that
  // character's share of every split), so an already-seated character is not offered again.
  const takenCharacterIds = new Set(members.map((m) => m.characterId).filter(Boolean));

  return (
    <form
      className="party-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        onSave({
          name: name.trim() === "" ? null : name.trim(),
          members: filled.map((m) => ({ ...m, name: m.name.trim() })),
          bossKeys,
        });
      }}
    >
      <label className="party-field">
        <span className="party-field-label">Name</span>
        <input
          className="split-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="optional, e.g. Kalos duo"
          maxLength={60}
        />
      </label>

      <fieldset className="party-field">
        <legend className="party-field-label">Members</legend>
        {members.map((member, index) => (
          // Saved seats key on their id; a seat that has never been saved has only its slot.
          <div className="party-seat" key={member.id ?? `new-${index}`}>
            <input
              className="split-input party-seat-name"
              value={member.name}
              onChange={(e) => update(index, { name: e.target.value })}
              placeholder="character name"
              aria-label={`Member ${index + 1} name`}
              maxLength={40}
            />
            <select
              className="split-input party-seat-character"
              value={member.characterId ?? NOBODY}
              onChange={(e) => pickCharacter(index, e.target.value)}
              aria-label={`Member ${index + 1} is one of my characters`}
            >
              <option value={NOBODY}>not mine</option>
              {characters
                .filter((c) => c.id === member.characterId || !takenCharacterIds.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <label className="party-seat-mvp">
              <input
                type="checkbox"
                checked={member.mvp}
                onChange={(e) => update(index, { mvp: e.target.checked })}
              />
              {/* The Auction House takes 3% from MVP and 5% from everyone else, and it is the
                  RECEIVING member's rate that applies to a payout. See lib/drop-split.ts. */}
              <span>MVP</span>
            </label>
            <button
              type="button"
              className="party-seat-remove"
              onClick={() => setMembers((current) => current.filter((_, i) => i !== index))}
              aria-label={`Remove member ${index + 1}`}
            >
              &times;
            </button>
          </div>
        ))}
        <button
          type="button"
          className="party-add-seat"
          disabled={members.length >= MAX_PARTY}
          onClick={() => setMembers((current) => [...current, emptySeat()])}
        >
          + Add member
        </button>
        {members.length >= MAX_PARTY && <p className="party-hint">A party holds {MAX_PARTY}.</p>}
      </fieldset>

      <fieldset className="party-field">
        <legend className="party-field-label">Bosses this party runs</legend>
        <div className="party-boss-picker">
          {bosses.map((boss) => (
            <label
              key={boss.bossKey}
              className={`party-boss-chip${bossKeys.includes(boss.bossKey) ? " selected" : ""}`}
            >
              <input
                type="checkbox"
                checked={bossKeys.includes(boss.bossKey)}
                onChange={() => toggleBoss(boss.bossKey)}
              />
              <span>{boss.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && <p className="split-error">{error}</p>}

      <div className="party-editor-actions">
        <button type="submit" className="party-save" disabled={!canSave}>
          {busy ? "Saving..." : "Save party"}
        </button>
        <button type="button" className="party-cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
