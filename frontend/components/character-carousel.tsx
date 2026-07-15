"use client";

import { useEffect, useRef, useState } from "react";
import type { Character } from "@/types/character";
import { CharacterTile } from "@/components/character-tile";
import { AddCharacterTile } from "@/components/add-character-tile";

// `null` is the no-character-selected slot at the head of the strip. It means two
// different things on the two pages that use this, and both are the natural reading:
//
// One selected character, always. `null` means only one thing now: no character selected, which
// is the "read the name from the screenshot" upload mode (the eye on the dropzone).
//
// Same control, same position, same meaning: nothing in particular is singled out.
export type Selection = string | null;

export function CharacterCarousel({
  characters,
  selectedId,
  onSelect,
  onUpdated,
  onDeleted,
  onAdded,
}: {
  characters: Character[];
  selectedId: Selection;
  onSelect: (id: Selection) => void;
  onUpdated: (character: Character) => void;
  onDeleted: (id: string) => void;
  onAdded: (character: Character) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  // Arrows are disabled at the ends rather than hidden, so the strip doesn't
  // change width as you page through it.
  function syncArrows() {
    const el = trackRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }

  useEffect(() => {
    syncArrows();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", syncArrows, { passive: true });
    window.addEventListener("resize", syncArrows);
    return () => {
      el.removeEventListener("scroll", syncArrows);
      window.removeEventListener("resize", syncArrows);
    };
  }, [characters.length]);

  function page(direction: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    // Page by a whole number of tiles so the strip lands on a tile edge, never mid-tile.
    // Measured from the first tile so it tracks the real tile width, with a fallback for
    // before the first tile has mounted. At least one tile per page on a narrow window.
    const tile = el.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 16;
    const stride = tile ? tile.offsetWidth + gap : 206;
    const perPage = Math.max(1, Math.floor(el.clientWidth / stride));
    el.scrollBy({ left: direction * perPage * stride, behavior: "smooth" });
  }

  return (
    <div className="carousel">
      <button
        className="carousel-arrow"
        onClick={() => page(-1)}
        disabled={atStart}
        aria-label="Previous characters"
      >
        ‹
      </button>

      <div className="carousel-track" ref={trackRef}>
        {characters.map((character) => (
          <CharacterTile
            key={character.id}
            character={character}
            selected={selectedId === character.id}
            onSelect={() => onSelect(character.id)}
            onUpdated={onUpdated}
            onDeleted={onDeleted}
          />
        ))}
        {/* Last, always. With no characters it is the only card, so the empty state is this same
            control rather than a separate screen telling you to go and find one. */}
        <AddCharacterTile onAdded={onAdded} />
      </div>

      <button
        className="carousel-arrow"
        onClick={() => page(1)}
        disabled={atEnd}
        aria-label="Next characters"
      >
        ›
      </button>
    </div>
  );
}
