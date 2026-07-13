"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Character } from "@/types/character";

export function AddCharacterForm({ onAdded }: { onAdded: (character: Character) => void }) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        + add character
      </a>
    );
  }

  return (
    <div>
      <label>
        Name:{" "}
        <input
          type="text"
          value={name}
          placeholder="in-game name"
          disabled={submitting}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </label>{" "}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {submitting ? "adding…" : "[add]"}
      </a>{" "}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          if (!submitting) close();
        }}
      >
        [cancel]
      </a>
      <p className="hint">
        Level, job, and sprite are looked up automatically from the name. No need to enter them.
      </p>
      {error && <p className="hint">{error}</p>}
    </div>
  );
}
