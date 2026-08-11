"use client";

import { spriteUrl } from "@/lib/api";
import type { Character } from "@/types/character";

// One card in the inventory picker: who this is, and whether you are looking at them.
//
// Nothing here changes anything. The star, refresh, delete and reorder controls that used to hang
// off this tile are on /characters, so the whole card is one click target rather than a card with
// four other things on it that each had to stop the click from also selecting.
export function CharacterTile({
  character,
  selected,
  onSelect,
}: {
  character: Character;
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`char-tile${selected ? " selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {character.spriteImgUrl ? (
        <img className="tile-sprite" src={spriteUrl(character.spriteImgUrl)} alt="" />
      ) : (
        <span className="tile-sprite" />
      )}

      <span className="tile-plate">
        <span className="tile-name">{character.name}</span>
        <span className="tile-meta">
          <span className="tile-level">Lv.{character.level ?? "?"}</span>
          <span className="tile-job">{character.jobName ?? "—"}</span>
        </span>
      </span>
    </button>
  );
}
