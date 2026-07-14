"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Character } from "@/types/character";

// The add control lives IN the strip, at the end of it, shaped like the thing it makes.
//
// It used to be a link under the inventory, a long way from the characters it added to and below
// the thing you were reading. Putting it last in the carousel says what it does without a caption:
// this is where the next character goes. With no characters at all it is the only card on screen,
// so the empty state is the same control rather than a different screen.
export function AddCharacterTile({ onAdded }: { onAdded: (character: Character) => void }) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setName("");
    setError(null);
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const character = await apiFetch<Character>(
        "/api/characters",
        { method: "POST", body: JSON.stringify({ name: trimmed }) },
        getToken,
      );
      onAdded(character);
      close();
    } catch {
      setError("Couldn't add that character. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button className="char-tile add-tile" onClick={() => setOpen(true)}>
        <span className="add-tile-plus" aria-hidden="true">
          +
        </span>
        <span className="tile-plate">
          <span className="tile-name">Add character</span>
        </span>
      </button>
    );
  }

  return (
    <div className="char-tile add-tile open">
      <input
        ref={inputRef}
        type="text"
        className="add-tile-input"
        value={name}
        placeholder="in-game name"
        disabled={submitting}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") close();
        }}
      />
      <span className="add-tile-actions">
        <button className="link" onClick={submit} disabled={submitting || !name.trim()}>
          {submitting ? "adding…" : "add"}
        </button>
        <button className="link" onClick={close} disabled={submitting}>
          cancel
        </button>
      </span>
      {/* Level, job and sprite are looked up from the name, so there is nothing else to ask for. */}
      <span className="add-tile-hint">{error ?? "Level and sprite are looked up for you."}</span>
    </div>
  );
}
