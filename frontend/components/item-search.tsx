"use client";

import { apiAssetUrl } from "@/lib/api";
import type { Character } from "@/types/character";
import { redeemableBySet, redemptionNote } from "@/lib/redemption";
import type { CharacterToken } from "@/types/character-token";

// "Who has Kalos pieces, and how many?"
//
// This is the question the aggregate view was pretending to answer and could not. Summing an
// UNTRADEABLE item across characters produces a number nobody can act on: 40 Kalos pieces spread
// four-a-piece over ten characters is not 40 pieces, it is ten characters who each need six more.
// The total is arithmetic that means nothing. WHERE the items are is the whole question.
//
// It costs no network. Every character's inventory is already in the browser -- the page fetches
// them all up front so that selecting a character does not flicker -- so this filters what is
// already there, on every keystroke. There is nothing to debounce and nothing to wait for.

export type Match = {
  character: Character;
  items: CharacterToken[];
  total: number;
};

// Match on the BOSS as well as the item.
//
// Nobody thinks "Ferocious Beast Entanglement Ring". They think "the thing Kaling drops". The
// catalog already knows which boss each piece comes from -- Kaling, Limbo, Malefic Star, First
// Adversary -- and searching on a name you would never say out loud is not searching.
//
// Fuzzy, and only just: a subsequence match, so "kaling" finds it, "kalng" still finds it, and
// "malefic" finds Blissful Fantasy Shard. Deliberately NOT a full edit-distance ranker -- the
// catalog is 26 items, not 26,000, and a scorer clever enough to be interesting is also clever
// enough to surprise you with a confident wrong answer.
function subsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

function matches(token: CharacterToken, q: string): boolean {
  const fields = [token.name, token.sourceBoss ?? "", token.itemGroup ?? ""];
  return fields.some((f) => {
    const s = f.toLowerCase();
    // A plain substring first -- it is what people expect, and it ranks nothing surprising.
    // The subsequence is the forgiving fallback for a typo or a half-remembered name.
    return s.includes(q) || subsequence(q, s);
  });
}

export function search(
  query: string,
  characters: Character[],
  tokensByChar: Record<string, CharacterToken[]>,
): Match[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return (
    characters
      .map((character) => {
        const items = (tokensByChar[character.id] ?? []).filter((t) => matches(t, q));
        return { character, items, total: items.reduce((n, t) => n + t.quantity, 0) };
      })
      .filter((m) => m.items.length > 0)
      // Most of it first: the character you are looking for is almost always the one with the most.
      .sort((a, b) => b.total - a.total)
  );
}

// Deliberately two components, not one with a flag. The BAR belongs at the top of the page, above
// the character strip; the RESULTS belong where the inventory is, because they are what you are
// looking at instead of it. Rendering one component in both places put two search boxes on screen.
export function SearchBar({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return (
    <section className="finder">
      <div className="finder-bar">
        <input
          type="search"
          className="finder-input"
          placeholder="Search every character — item, boss (“kaling”, “limbo”), or section"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label="Find an item across every character"
        />
        {query && (
          <button className="link finder-clear" onClick={() => onQuery("")}>
            clear
          </button>
        )}
      </div>
    </section>
  );
}

export function SearchResults({ query, matches }: { query: string; matches: Match[] }) {
  const grandTotal = matches.reduce((n, m) => n + m.total, 0);

  // What is ACTUALLY redeemable, counted per character AND per piece-set.
  //
  // The counting lives in lib/redemption.ts, not here, and that is the point: it is the one piece
  // of arithmetic in this app that produces a confident wrong number when it is "simplified", and
  // inline in a component it could not be tested. Every holding is passed through flat and
  // un-summed -- redeemableBySet divides each by its own threshold before adding anything, which
  // is what stops pieces being pooled across characters or mixed between tokens.
  const ready = [...redeemableBySet(matches.flatMap((m) => m.items)).entries()];
  return (
    <section className="finder">
      <div className="finder-results">
        {matches.length === 0 ? (
          <p className="finder-empty">
            No character is holding anything matching <strong>{query}</strong>.
          </p>
        ) : (
          <>
            <p className="finder-summary">
              <strong>{grandTotal}</strong> across{" "}
              <strong>
                {matches.length} {matches.length === 1 ? "character" : "characters"}
              </strong>
            </p>
            {matches.map(({ character, items, total }) => (
              <article key={character.id} className="finder-row">
                <header>
                  <span className="finder-name">{character.name}</span>
                  <span className="finder-level">Lv.{character.level ?? "?"}</span>
                  <span className="finder-total">{total}</span>
                </header>
                <ul>
                  {items.map((item) => (
                    <li key={item.tokenCatalogId} title={item.name}>
                      {item.iconUrl && (
                        <img src={apiAssetUrl(item.iconUrl)} alt="" aria-hidden="true" />
                      )}
                      <span className="finder-item-name">{item.name}</span>
                      <span className="finder-item-qty">{item.quantity}</span>
                      {item.redeemThreshold && (
                        <span className="finder-item-note">
                          {redemptionNote(item.quantity, item.redeemThreshold)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
