"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { InventoryPanel, type InventoryItem } from "@/components/inventory-panel";
import { apiFetch } from "@/lib/api";
import { invalidate, peek, put } from "@/lib/cache";
import type { Character } from "@/types/character";
import type { CharacterToken } from "@/types/character-token";
import type { TokenTotal } from "@/types/token-total";
import { AddCharacterForm } from "./add-character-form";
import { CharacterCarousel, type Selection } from "@/components/character-carousel";

type LoadState = "loading" | "loaded" | "error";

const CHARACTERS_KEY = "/api/characters";
const TOTALS_KEY = "/api/tokens";

export default function CharactersPage() {
  const { getToken } = useAuth();

  // Seed from cache so a repeat visit paints immediately instead of flashing a
  // loading state while it re-fetches data it already had. The fetch below still
  // runs and overwrites this -- the cache decides what you see FIRST, not what is
  // true.
  const seededCharacters = peek<Character[]>(CHARACTERS_KEY);
  const seededTotals = peek<TokenTotal[]>(TOTALS_KEY);

  const [characters, setCharacters] = useState<Character[]>(seededCharacters ?? []);
  const [totals, setTotals] = useState<TokenTotal[]>(seededTotals ?? []);
  const [state, setState] = useState<LoadState>(seededCharacters ? "loaded" : "loading");

  // null = the aggregate across every character, which is what you land on.
  const [selectedId, setSelectedId] = useState<Selection>(null);

  // Tokens are stored against the character they were fetched for, not on their
  // own. Clicking down the strip fires overlapping requests, and keyed state means
  // a slow response for one character can never be rendered under another's name.
  const [tokensFor, setTokensFor] = useState<{ id: string; tokens: CharacterToken[] } | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, getToken),
      apiFetch<TokenTotal[]>(TOTALS_KEY, { method: "GET" }, getToken),
    ])
      .then(([characterResult, totalsResult]) => {
        setCharacters(characterResult);
        setTotals(totalsResult);
        put(CHARACTERS_KEY, characterResult);
        put(TOTALS_KEY, totalsResult);
        setState("loaded");
      })
      // Only show the error state if we have nothing at all. A failed refresh
      // behind data we already have should not blank the page.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
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

  // Every write drops the cache. A cache that can serve a stale list after you have
  // added, renamed or deleted a character is worse than no cache at all: the wrong
  // answer arrives instantly and looks exactly like a backend bug.
  function handleAdded(character: Character) {
    setCharacters((prev) => [...prev, character]);
    invalidate("/api/");
  }

  function handleUpdated(character: Character) {
    setCharacters((prev) => prev.map((c) => (c.id === character.id ? character : c)));
    invalidate("/api/");
  }

  function handleDeleted(id: string) {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
    invalidate("/api/");
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
