"use client";

import type { Character } from "@/types/character";
import { CarouselFrame } from "@/components/carousel-frame";
import { CharacterTile } from "@/components/character-tile";
import { useCarousel } from "@/lib/use-carousel";

// A picker, and only a picker: whose inventory am I reading.
//
// It used to add, reorder, refresh, delete and set the main character too, which made the strip
// you choose from also the strip you manage in. All of that is on /characters now, so a click here
// means one thing.

// `null` is the no-character-selected slot: the "read the name from the screenshot" upload mode
// (the eye on the dropzone). Nothing in particular is singled out.
export type Selection = string | null;

export function CharacterCarousel({
  characters,
  selectedId,
  onSelect,
}: {
  characters: Character[];
  selectedId: Selection;
  onSelect: (id: Selection) => void;
}) {
  const carousel = useCarousel([characters]);

  return (
    <CarouselFrame carousel={carousel}>
      {characters.map((character) => (
        <CharacterTile
          key={character.id}
          character={character}
          selected={selectedId === character.id}
          onSelect={() => onSelect(character.id)}
        />
      ))}
    </CarouselFrame>
  );
}
