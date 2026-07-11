"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Character } from "@/types/character";
import { AddCharacterForm } from "./add-character-form";
import { CharacterTile } from "./character-tile";

type LoadState = "loading" | "loaded" | "error";

export default function CharactersPage() {
  const { getToken } = useAuth();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    apiFetch<Character[]>("/api/characters", { method: "GET" }, getToken)
      .then((result) => {
        setCharacters(result);
        setState("loaded");
      })
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAdded(character: Character) {
    setCharacters((prev) => [...prev, character]);
  }

  function handleUpdated(character: Character) {
    setCharacters((prev) => prev.map((c) => (c.id === character.id ? character : c)));
  }

  function handleDeleted(id: string) {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Characters</h1>

      <AddCharacterForm onAdded={handleAdded} />

      {state === "loading" && <p>loading…</p>}
      {state === "error" && <p>Couldn&apos;t load your characters.</p>}
      {state === "loaded" && characters.length === 0 && <p>No characters yet — add one above.</p>}

      {state === "loaded" && characters.length > 0 && (
        <div className="char-grid">
          {characters.map((character) => (
            <CharacterTile
              key={character.id}
              character={character}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}
    </main>
  );
}
