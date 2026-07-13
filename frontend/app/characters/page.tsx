"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { InventoryPanel, type InventoryItem } from "@/components/inventory-panel";
import { apiFetch } from "@/lib/api";
import { invalidate, peek, put } from "@/lib/cache";
import { redemptionNote } from "@/lib/redemption";
import type { Character } from "@/types/character";
import type { CharacterToken } from "@/types/character-token";
import type { TokenTotal } from "@/types/token-total";
import { AddCharacterForm } from "./add-character-form";
import { CaptureDock } from "@/components/capture-dock";
import { SearchBar, SearchResults, search } from "@/components/item-search";
import { CharacterCarousel, type Selection } from "@/components/character-carousel";

type LoadState = "loading" | "loaded" | "error";

const CHARACTERS_KEY = "/api/characters";
const TOTALS_KEY = "/api/tokens";
const ALL_TOKENS_KEY = "/api/characters/tokens";

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

  // null = no character selected, which is what you land on.
  const [selectedId, setSelectedId] = useState<Selection>(null);

  const [query, setQuery] = useState("");

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
  const [tokensByChar, setTokensByChar] = useState<Record<string, CharacterToken[]>>(
    peek<Record<string, CharacterToken[]>>(ALL_TOKENS_KEY) ?? {},
  );

  // Bumped after an upload writes counts, to re-pull the inventory it just changed.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    // Every character's inventory is fetched HERE, on load, alongside the roster -- not lazily
    // when you click one. The page already knows you are about to look at one of these; it just
    // does not know which. Waiting to find out puts a network round-trip between the click and
    // the pixels, and that gap is the flicker: the panel renders empty, then fills.
    Promise.all([
      apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, getToken),
      apiFetch<TokenTotal[]>(TOTALS_KEY, { method: "GET" }, getToken),
      apiFetch<Record<string, CharacterToken[]>>(ALL_TOKENS_KEY, { method: "GET" }, getToken),
    ])
      .then(([characterResult, totalsResult, allTokens]) => {
        // The bulk query only returns characters that HAVE something. A character with an empty
        // inventory comes back absent, which is indistinguishable from "not fetched yet" -- so it
        // would sit on a loading state forever. Say so explicitly: no tokens is an answer.
        const seeded: Record<string, CharacterToken[]> = { ...allTokens };
        for (const c of characterResult) seeded[c.id] ??= [];

        setCharacters(characterResult);
        setTotals(totalsResult);
        setTokensByChar(seeded);
        put(CHARACTERS_KEY, characterResult);
        put(TOTALS_KEY, totalsResult);
        put(ALL_TOKENS_KEY, seeded);
        setState("loaded");
      })
      // Only show the error state if we have nothing at all. A failed refresh
      // behind data we already have should not blank the page.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // A selected character is re-fetched on its own, but only as a REFRESH -- the bulk load above
  // has already supplied something to draw, so this never decides what you see first, and a
  // failure never blanks what is on screen.
  useEffect(() => {
    if (selectedId === null) return;
    const id = selectedId;
    let cancelled = false;
    apiFetch<CharacterToken[]>(`/api/characters/${id}/tokens`, { method: "GET" }, getToken)
      .then((tokens) => {
        if (!cancelled) setTokensByChar((prev) => ({ ...prev, [id]: tokens }));
      })
      .catch(() => {
        /* keep showing what we have */
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

  // Eternal pieces CANNOT be pooled across characters: a single character must reach the
  // threshold alone. Six on one and four on another is not a set -- it is two characters who are
  // both short. The aggregate used to report "10 / 10 toward an Eternal set" against the SUM,
  // which is a confidently wrong number, and a confidently wrong number is the one thing this app
  // exists not to produce.
  //
  // So progress is counted per character and only then added up. The total quantity is still worth
  // showing -- it says how much you own -- but it is not progress, and it no longer pretends to be.
  const setsReadyFor = (tokenCatalogId: string, threshold: number) =>
    Object.values(tokensByChar).reduce((sets, tokens) => {
      const held = tokens.find((t) => t.tokenCatalogId === tokenCatalogId)?.quantity ?? 0;
      return sets + Math.floor(held / threshold);
    }, 0);

  const aggregateItems: InventoryItem[] = totals.map((total) => {
    const held = `${total.quantity} across ${
      total.characterCount === 1 ? "1 character" : `${total.characterCount} characters`
    }`;
    if (!total.redeemThreshold) {
      return {
        id: total.tokenCatalogId,
        name: total.name,
        iconUrl: total.iconUrl,
        quantity: total.quantity,
        itemGroup: total.itemGroup,
        note: held,
      };
    }
    const sets = setsReadyFor(total.tokenCatalogId, total.redeemThreshold);
    return {
      id: total.tokenCatalogId,
      name: total.name,
      iconUrl: total.iconUrl,
      quantity: total.quantity,
      itemGroup: total.itemGroup,
      note:
        `${held}\n` +
        `${sets === 0 ? "no" : sets} complete ${sets === 1 ? "set" : "sets"} ` +
        `(${total.redeemThreshold} on ONE character; pieces cannot be combined)`,
    };
  });

  const searching = query.trim().length > 0;
  const matches = search(query, characters, tokensByChar);

  const selectedTokens = selectedId ? tokensByChar[selectedId] : undefined;
  const tokensReady = selectedTokens !== undefined;
  const characterItems: InventoryItem[] = (selectedTokens ?? []).map((token) => ({
    id: token.tokenCatalogId,
    name: token.name,
    iconUrl: token.iconUrl,
    quantity: token.quantity,
    itemGroup: token.itemGroup,
    note: token.redeemThreshold
      ? redemptionNote(token.quantity, token.redeemThreshold)
      : `${token.quantity} in total`,
  }));

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Characters</h1>

      {state === "loading" && <p>loading…</p>}
      {state === "error" && <p>Couldn&apos;t load your characters.</p>}

      {state === "loaded" && (
        <>
          <SearchBar query={query} onQuery={setQuery} />

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

          {/* Searching answers a question the inventory cannot, so it takes over while you are
              asking it. Typing anything replaces the panel with WHERE the item is. */}
          {searching ? (
            <SearchResults query={query} matches={matches} />
          ) : selected ? (
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
              title="Everything you hold"
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
