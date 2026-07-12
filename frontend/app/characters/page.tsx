"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { InventoryPanel } from "@/components/inventory-panel";
import { apiFetch } from "@/lib/api";
import type { Character } from "@/types/character";
import type { TokenTotal } from "@/types/token-total";
import { AddCharacterForm } from "./add-character-form";
import { CharacterTile } from "./character-tile";

type LoadState = "loading" | "loaded" | "error";

export default function CharactersPage() {
  const { getToken } = useAuth();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [totals, setTotals] = useState<TokenTotal[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    Promise.all([
      apiFetch<Character[]>("/api/characters", { method: "GET" }, getToken),
      apiFetch<TokenTotal[]>("/api/tokens", { method: "GET" }, getToken),
    ])
      .then(([characterResult, totalsResult]) => {
        setCharacters(characterResult);
        setTotals(totalsResult);
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

      {state === "loaded" && (
        <InventoryPanel
          title="All characters"
          subtitle={characters.length === 1 ? "1 character" : `${characters.length} characters`}
          emptyHint="Nothing tracked yet. Upload an inventory screenshot."
          items={totals.map((total) => ({
            id: total.tokenCatalogId,
            name: total.name,
            iconUrl: total.iconUrl,
            quantity: total.quantity,
            note:
              `${total.quantity} / ${total.redeemThreshold} toward an Eternal set` +
              `\nheld by ${total.characterCount === 1 ? "1 character" : `${total.characterCount} characters`}`,
          }))}
        />
      )}

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
