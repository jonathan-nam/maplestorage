"use client";

import { useState } from "react";
import { parseMesos } from "@/lib/drop-split";
import type { Holder } from "@/lib/vestige-ledger";
import type { Person } from "@/types/party";

// The way in for somebody with no card yet.
//
// A card is drawn for a person who already owes you something, which cannot open the first debt of
// a relationship: a loan to somebody you have never split a drop with had nowhere to be entered at
// all. Same shape as the Sale Ledger's own way back to a pile it holds off drawing.
//
// PEOPLE, not characters. A debt is between two humans, which is what the holder fold has meant
// everywhere since V39, and the picker is the people list so a name cannot arrive misspelled.

export function AddCollection({
  people,
  busy,
  onAdd,
}: {
  /** The account's people list, in its own order. Empty draws nothing: there is nobody to pick. */
  people: Person[];
  busy: boolean;
  onAdd: (holder: Holder, amount: number, note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState("");
  const [owed, setOwed] = useState("");
  const [note, setNote] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  if (people.length === 0) return null;

  const entered = parseMesos(owed);
  const amount = entered !== null && entered >= 1 ? entered : null;
  const who = personId || people[0]?.id || "";

  if (!open) {
    return (
      <button type="button" className="party-save" onClick={() => setOpen(true)}>
        Add a collection
      </button>
    );
  }

  return (
    <form
      className="ledger-sale"
      onSubmit={(e) => {
        e.preventDefault();
        if (!amount || !who) return;
        setRefusal(null);
        void onAdd({ kind: "PERSON", personId: who, characterName: null }, amount, note.trim())
          .then(() => {
            // Closed on success, because the card it just made is the thing to look at, and left
            // open on a refusal so what was typed can be corrected rather than typed again.
            setOwed("");
            setNote("");
            setOpen(false);
          })
          .catch((e: unknown) => {
            setRefusal(e instanceof Error ? e.message : "That didn't save.");
          });
      }}
    >
      <select
        className="split-input"
        value={who}
        onChange={(e) => setPersonId(e.target.value)}
        aria-label="Who owes you"
        disabled={busy}
      >
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      {/* The same two boxes a card carries, in the same words, so this is the card's own form
          reached from outside it rather than a second way to say the same thing. */}
      <label className="loot-share-input">
        owes me
        <input
          className="split-input"
          value={owed}
          onChange={(e) => setOwed(e.target.value)}
          placeholder="1.5b"
          inputMode="decimal"
          aria-label="What they owe you"
        />
      </label>
      <input
        className="split-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="what for"
        maxLength={120}
        aria-label="What it was for, optional"
      />
      <button type="submit" className="party-save" disabled={busy || amount === null}>
        Add
      </button>
      {refusal && <span className="split-error">{refusal}</span>}
    </form>
  );
}
