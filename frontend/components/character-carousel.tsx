"use client";

import { useEffect, useRef, useState } from "react";
import type { Character } from "@/types/character";
import { CharacterTile } from "@/components/character-tile";

// `null` is the no-character-selected slot at the head of the strip. It means two
// different things on the two pages that use this, and both are the natural reading:
//
//   /characters  "All characters" -- the aggregate across everyone
//   /upload      "Auto-detect"    -- no pin; work out who it is from the screenshot
//
// Same control, same position, same meaning: nothing in particular is singled out.
export type Selection = string | null;

export function CharacterCarousel({
  characters,
  selectedId,
  onSelect,
  onUpdated,
  onDeleted,
  showAllTile = false,
}: {
  characters: Character[];
  selectedId: Selection;
  onSelect: (id: Selection) => void;
  onUpdated: (character: Character) => void;
  onDeleted: (id: string) => void;
  // The "All characters" tile is gone by default, and the default is now the only caller.
  //
  // It meant two different things at once, which is why it had to go. In the inventory it meant
  // "the sum across everyone" -- a number nobody can act on, since the items cannot be moved. In
  // the upload it meant "work out who this belongs to from the HUD". One tile, two jobs, and
  // selecting it for one silently opted you into the other. Uploading generically is now an
  // explicit choice on the dropzone itself, where the choice actually applies.
  showAllTile?: boolean;
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
    // Scroll by most of a viewport rather than a fixed tile count, so it still
    // behaves on a narrow window where only one tile fits.
    el.scrollBy({ left: direction * Math.max(206, el.clientWidth * 0.8), behavior: "smooth" });
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
        {showAllTile && (
          <div
            className={`char-tile all-tile${selectedId === null ? " selected" : ""}`}
            onClick={() => onSelect(null)}
          >
            <div className="tile-sprite all-sprite">Σ</div>
            <div className="tile-plate">
              <span className="tile-name">All characters</span>
            </div>
          </div>
        )}

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
