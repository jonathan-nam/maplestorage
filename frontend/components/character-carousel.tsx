"use client";

import type { Character } from "@/types/character";
import { CarouselFrame } from "@/components/carousel-frame";
import { CharacterTile } from "@/components/character-tile";
import { AddCharacterTile } from "@/components/add-character-tile";
import { useCarousel } from "@/lib/use-carousel";

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
  onReorder,
}: {
  characters: Character[];
  selectedId: Selection;
  onSelect: (id: Selection) => void;
  onUpdated: (character: Character) => void;
  onDeleted: (id: string) => void;
  onAdded: (character: Character) => void;
  onReorder: (ordered: Character[]) => void;
}) {
  const carousel = useCarousel([characters]);

  // Swap a character with its neighbour and hand the whole new order up to persist. The parent
  // keeps the source of truth, so it also decides how to save it.
  function moveCharacter(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= characters.length) return;
    const next = characters.slice();
    const moved = next[index];
    const displaced = next[target];
    // Bounds already guarantee both exist; the guard is what tells the type checker so.
    if (!moved || !displaced) return;
    next[index] = displaced;
    next[target] = moved;
    carousel.pinScroll();
    onReorder(next);
  }

  return (
    <CarouselFrame carousel={carousel}>
      {characters.map((character, index) => (
        <CharacterTile
          key={character.id}
          character={character}
          selected={selectedId === character.id}
          onSelect={() => onSelect(character.id)}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
          onMove={(direction) => moveCharacter(index, direction)}
          canMoveLeft={index > 0}
          canMoveRight={index < characters.length - 1}
        />
      ))}
      {/* Last, always. With no characters it is the only card, so the empty state is this same
          control rather than a separate screen telling you to go and find one. */}
      <AddCharacterTile onAdded={onAdded} />
    </CarouselFrame>
  );
}
