"use client";

import Link from "next/link";
import type { Character } from "@/types/character";

// The pin panel isn't optional decoration -- an inventory-only-crop upload
// with no HUD visible always needs a character to attribute to (see
// UploadRow's "unresolvable" handling), so pinning first is the low-friction
// path even though it's not strictly required (auto-detect still works when
// the screenshot's HUD is visible).
export function CharacterPinPanel({
  characters,
  pinnedCharacterId,
  onPin,
}: {
  characters: Character[];
  pinnedCharacterId: string | null;
  onPin: (id: string | null) => void;
}) {
  return (
    <aside className="char-selector">
      <div className="panel-title">
        Pin to one character <span className="panel-subtitle">(optional)</span>
      </div>
      <p className="panel-hint">
        Only needed if the character name isn&apos;t in the screenshot. Pin one and we&apos;ll flag
        it if you drop someone else&apos;s screenshot.
      </p>
      <div className="char-selector-list">
        {characters.map((character) => (
          <div
            key={character.id}
            className={`char-selector-item${character.id === pinnedCharacterId ? " selected" : ""}`}
            onClick={() => onPin(character.id === pinnedCharacterId ? null : character.id)}
          >
            {character.spriteImgUrl ? (
              <img className="selector-sprite" src={character.spriteImgUrl} alt="" />
            ) : (
              <div className="selector-sprite" />
            )}
            <span className="selector-name">{character.name}</span>
          </div>
        ))}
      </div>
      {pinnedCharacterId && (
        <a
          href="#"
          className="selector-clear"
          onClick={(e) => {
            e.preventDefault();
            onPin(null);
          }}
        >
          [unpin]
        </a>
      )}
      <Link href="/characters" className="selector-add">
        + add character
      </Link>
    </aside>
  );
}
