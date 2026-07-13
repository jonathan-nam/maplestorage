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

// You search for an item by any name you might actually say out loud.
//
// Nobody thinks "Ferocious Beast Entanglement Ring". They think "the thing Kaling drops", or
// "whatever makes an Eternal hat". So a token is matched on everything the catalog knows about it:
// its name, its BOSS, its section, and the PIECES IT BUYS.
//
// Terms are matched independently and all must hit, which is what makes "eternal hat" work: it is
// not a phrase to be found anywhere, it is two facts -- section "Eternal Pieces", slot "Hat" --
// and the four tokens that satisfy both are exactly Kalos, Kaling, First Adversary and Malefic
// Star. Matching the query as one string would find nothing.
//
// Fuzzy, and only just: substring first, subsequence as the forgiving fallback, so "kalng" still
// finds Kaling. Deliberately NOT an edit-distance ranker -- the catalog is 26 items, and a scorer
// clever enough to be interesting is clever enough to surprise you with a confident wrong answer.
function subsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

// A short subsequence matches almost anything: "shoe" is a subsequence of "Shoulder", and "hat" of
// half the catalog. So the fuzzy fallback only applies to terms long enough to be a mistyped word.
const FUZZY_MIN = 5;

// The game does not call a slot by one name. A hat is a Bandana on a thief; a top is a Hood, a
// Shirt, a Coat, a Robe or an Armor depending on the class. Someone hunting for what makes their
// robe types "robe", and the catalog's canonical "Top" will not find it.
//
// SEARCH aliases only. The catalog keeps ONE canonical name per slot, because redemption is counted
// against it -- giving a slot several identities in the data would let a piece-set silently split
// in two, which is the exact class of bug lib/redemption.ts exists to prevent.
const SLOT_ALIASES: Record<string, string[]> = {
  hat: ["cap", "bandana", "helm", "helmet", "hood", "circlet"],
  top: ["shirt", "coat", "robe", "armor", "armour", "overall"],
  bottom: ["pants", "trousers", "shorts", "skirt"],
  shoulder: ["pauldron", "accessory"],
  cape: ["cloak"],
  glove: ["gloves", "gauntlet"],
  shoe: ["shoes", "boots", "boot"],
};

export function matchesQuery(token: CharacterToken, terms: string[]): boolean {
  const slots = token.redeemSlots.flatMap((s) => [s, ...(SLOT_ALIASES[s.toLowerCase()] ?? [])]);
  const fields = [token.name, token.sourceBoss ?? "", token.itemGroup ?? "", ...slots]
    .filter(Boolean)
    .map((f) => f.toLowerCase());
  return terms.every((t) =>
    fields.some((f) => f.includes(t) || (t.length >= FUZZY_MIN && subsequence(t, f))),
  );
}

export function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function search(
  query: string,
  characters: Character[],
  tokensByChar: Record<string, CharacterToken[]>,
): Match[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  return (
    characters
      .map((character) => {
        const items = (tokensByChar[character.id] ?? []).filter((t) => matchesQuery(t, terms));
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
          placeholder="Search every character — “kaling”, “eternal hat”, “symbol”, “potion”"
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
              <strong>{grandTotal}</strong> held by{" "}
              <strong>
                {matches.length} {matches.length === 1 ? "character" : "characters"}
              </strong>
              {ready.map(([set, n]) => (
                <span key={set}>
                  {", "}
                  <strong>{n}</strong> {set} redeemable now
                </span>
              ))}
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
                      <span className="finder-item-name">
                        {item.name}
                        {item.sourceBoss && (
                          <span className="finder-item-boss"> · {item.sourceBoss}</span>
                        )}
                        {item.redeemSlots.length > 0 && (
                          <span className="finder-item-boss">
                            {" "}
                            · buys {item.redeemSlots.join(" / ")}
                          </span>
                        )}
                      </span>
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
