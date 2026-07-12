"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { InventoryPanel, type InventoryItem } from "@/components/inventory-panel";
import { apiFetch } from "@/lib/api";
import type { Character } from "@/types/character";
import type { CharacterToken } from "@/types/character-token";
import type { TokenTotal } from "@/types/token-total";
import { AddCharacterForm } from "./add-character-form";
import { CharacterCarousel, type Selection } from "./character-carousel";

type LoadState = "loading" | "loaded" | "error";

export default function CharactersPage() {
  const { getToken } = useAuth();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [totals, setTotals] = useState<TokenTotal[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  // null = the aggregate across every character, which is what you land on.
  const [selectedId, setSelectedId] = useState<Selection>(null);

  // Tokens are stored against the character they were fetched for, not on their
  // own. Clicking down the strip fires overlapping requests, and keyed state means
  // a slow response for one character can never be rendered under another's name.
  const [tokensFor, setTokensFor] = useState<{ id: string; tokens: CharacterToken[] } | null>(null);

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

  useEffect(() => {
    if (selectedId === null) return;
    const id = selectedId;
    let cancelled = false;
    apiFetch<CharacterToken[]>(`/api/characters/${id}/tokens`, { method: "GET" }, getToken)
      .then((tokens) => {
        if (!cancelled) setTokensFor({ id, tokens });
      })
      .catch(() => {
        if (!cancelled) setTokensFor({ id, tokens: [] });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function handleAdded(character: Character) {
    setCharacters((prev) => [...prev, character]);
  }

  function handleUpdated(character: Character) {
    setCharacters((prev) => prev.map((c) => (c.id === character.id ? character : c)));
  }

  function handleDeleted(id: string) {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  const selected = characters.find((c) => c.id === selectedId);

  const aggregateItems: InventoryItem[] = totals.map((total) => ({
    id: total.tokenCatalogId,
    name: total.name,
    iconUrl: total.iconUrl,
    quantity: total.quantity,
    note:
      `${total.quantity} / ${total.redeemThreshold} toward an Eternal set` +
      `\nheld by ${total.characterCount === 1 ? "1 character" : `${total.characterCount} characters`}`,
  }));

  // Only render tokens that were fetched for the character actually selected.
  const tokensReady = tokensFor?.id === selectedId;
  const characterItems: InventoryItem[] = (tokensReady ? tokensFor.tokens : []).map((token) => ({
    id: token.tokenCatalogId,
    name: token.name,
    iconUrl: token.iconUrl,
    quantity: token.quantity,
    note: `${token.quantity} / ${token.redeemThreshold} toward an Eternal set`,
  }));

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Characters</h1>

      {state === "loading" && <p>loading…</p>}
      {state === "error" && <p>Couldn&apos;t load your characters.</p>}

      {state === "loaded" && (
        <>
          <CharacterCarousel
            characters={characters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />

          {selected ? (
            <InventoryPanel
              title={selected.name}
              subtitle={`Lv.${selected.level ?? "?"}`}
              emptyHint={
                tokensReady ? "No tokens here yet. Upload an inventory screenshot." : "Loading…"
              }
              items={characterItems}
            />
          ) : (
            <InventoryPanel
              title="All characters"
              subtitle={characters.length === 1 ? "1 character" : `${characters.length} characters`}
              emptyHint="Nothing tracked yet. Upload an inventory screenshot."
              items={aggregateItems}
            />
          )}
        </>
      )}

      <AddCharacterForm onAdded={handleAdded} />
    </main>
  );
}
