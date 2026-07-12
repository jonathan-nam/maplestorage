"use client";

import { useEffect, useRef, useState } from "react";
import type { Character } from "@/types/character";
import { CharacterTile } from "./character-tile";

// `null` selects the aggregate -- everything across every character -- which is
// the view you want first and so sits at the head of the strip.
export type Selection = string | null;

export function CharacterCarousel({
  characters,
  selectedId,
  onSelect,
  onUpdated,
  onDeleted,
}: {
  characters: Character[];
  selectedId: Selection;
  onSelect: (id: Selection) => void;
  onUpdated: (character: Character) => void;
  onDeleted: (id: string) => void;
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
        <div
          className={`char-tile all-tile${selectedId === null ? " selected" : ""}`}
          onClick={() => onSelect(null)}
        >
          <div className="tile-sprite all-sprite">Σ</div>
          <div className="tile-plate">
            <span className="tile-name">All characters</span>
          </div>
          <div className="tile-job">
            {characters.length === 1 ? "1 character" : `${characters.length} characters`}
          </div>
        </div>

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
