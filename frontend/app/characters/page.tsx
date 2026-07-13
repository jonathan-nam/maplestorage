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
import { CaptureDock } from "@/components/capture-dock";
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

  // Tokens are kept PER CHARACTER, not as a single "the tokens" slot.
  //
  // Two reasons, and the second one is what you see. Overlapping requests: clicking down the
  // strip fires several fetches, and keying by id means a slow answer for one character can
  // never be painted under another's name. And the flash: with a single slot, selecting a
  // character blanked the inventory (its tokens were "not for this id yet"), the panel collapsed
  // to nothing, and then snapped back a moment later when the fetch landed. Keeping what we
  // already know for each character means a revisit paints instantly, with no empty frame in
  // between -- the fetch still runs and still overwrites, it just no longer decides what you see
  // FIRST.
  const [tokensByChar, setTokensByChar] = useState<Record<string, CharacterToken[]>>({});

  // Bumped after an upload writes counts, to re-pull the inventory it just changed.
  const [revision, setRevision] = useState(0);

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
  }, [revision]);

  useEffect(() => {
    if (selectedId === null) return;
    const id = selectedId;
    const key = `/api/characters/${id}/tokens`;
    let cancelled = false;
    apiFetch<CharacterToken[]>(key, { method: "GET" }, getToken)
      .then((tokens) => {
        if (cancelled) return;
        put(key, tokens);
        setTokensByChar((prev) => ({ ...prev, [id]: tokens }));
      })
      .catch(() => {
        /* keep whatever we were already showing; a failed refresh must not blank the panel */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, revision]);

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
    itemGroup: total.itemGroup,
    // A consumable has nothing to redeem toward. Saying "7 / 10 toward an Eternal set" on a
    // potion would be a confident, meaningless number -- the failure this app exists to avoid.
    note:
      (total.redeemThreshold
        ? `${total.quantity} / ${total.redeemThreshold} toward an Eternal set`
        : `${total.quantity} in total`) +
      `\nheld by ${total.characterCount === 1 ? "1 character" : `${total.characterCount} characters`}`,
  }));

  // Read the cache during RENDER, not in an effect. Seeding it with setState inside the effect
  // works but costs a second render pass on every selection -- and a cascading render is exactly
  // the flash we are here to remove.
  const selectedTokens = selectedId
    ? (tokensByChar[selectedId] ?? peek<CharacterToken[]>(`/api/characters/${selectedId}/tokens`))
    : undefined;
  const tokensReady = selectedTokens !== undefined;
  const characterItems: InventoryItem[] = (selectedTokens ?? []).map((token) => ({
    id: token.tokenCatalogId,
    name: token.name,
    iconUrl: token.iconUrl,
    quantity: token.quantity,
    itemGroup: token.itemGroup,
    note: token.redeemThreshold
      ? `${token.quantity} / ${token.redeemThreshold} toward an Eternal set`
      : `${token.quantity} in total`,
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

          <CaptureDock
            characters={characters}
            pinnedCharacterId={selectedId}
            stored={
              new Map(
                (selectedId ? (selectedTokens ?? []) : totals).map((t) => [
                  t.tokenCatalogId,
                  t.quantity,
                ]),
              )
            }
            getToken={getToken}
            onCharacterAdded={handleAdded}
            onSaved={() => setRevision((n) => n + 1)}
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
