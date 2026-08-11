"use client";

import { CarouselFrame } from "@/components/carousel-frame";
import { spriteUrl } from "@/lib/api";
import { useCarousel } from "@/lib/use-carousel";
import type { Character } from "@/types/character";

// The same strip of sprites as the inventory carousel, minus everything that manages the roster:
// this one only answers "whose planner is this?". Adding, deleting, reordering and setting a main
// stay on the Inventory page, where the roster is the subject.
export function CharacterPicker({
  characters,
  selectedId,
  onSelect,
}: {
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const carousel = useCarousel([characters]);

  return (
    <CarouselFrame
      carousel={carousel}
      className="carousel-compact"
      trackRole="radiogroup"
      trackLabel="Whose planner is this?"
    >
      {characters.map((character) => (
        <button
          key={character.id}
          type="button"
          className={`char-tile is-compact${selectedId === character.id ? " selected" : ""}`}
          // Radio semantics, not a toggle: exactly one character is the answer, and clicking the
          // chosen one again must not clear it back to a state the dock refuses uploads in.
          role="radio"
          aria-checked={selectedId === character.id}
          onClick={() => onSelect(character.id)}
        >
          {character.spriteImgUrl ? (
            <img className="tile-sprite" src={spriteUrl(character.spriteImgUrl)} alt="" />
          ) : (
            <div className="tile-sprite" />
          )}
          <div className="tile-plate">
            <div className="tile-name">{character.name}</div>
          </div>
        </button>
      ))}
    </CarouselFrame>
  );
}
