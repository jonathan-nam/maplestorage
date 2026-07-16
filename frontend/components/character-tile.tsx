"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Character } from "@/types/character";

type Props = {
  character: Character;
  onUpdated: (character: Character) => void;
  onDeleted: (id: string) => void;
  // When the tile is being used to pick whose inventory to show, clicking it selects.
  selected?: boolean;
  onSelect: () => void;
  // Reorder within the carousel. Disabled at the ends.
  onMove: (direction: -1 | 1) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
};

export function CharacterTile({
  character,
  onUpdated,
  onDeleted,
  selected,
  onSelect,
  onMove,
  canMoveLeft,
  canMoveRight,
}: Props) {
  const { getToken } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const updated = await apiFetch<Character>(
        `/api/characters/${character.id}/refresh`,
        { method: "POST" },
        getToken,
      );
      onUpdated(updated);
    } finally {
      setRefreshing(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch<void>(`/api/characters/${character.id}`, { method: "DELETE" }, getToken);
      onDeleted(character.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`char-tile${selected ? " selected" : ""}`} onClick={onSelect}>
      {character.spriteImgUrl ? (
        <img className="tile-sprite" src={character.spriteImgUrl} alt="" />
      ) : (
        <div className="tile-sprite" />
      )}

      <div className="tile-plate">
        <div className="tile-name">{character.name}</div>
        <div className="tile-meta">
          <span className="tile-level">Lv.{character.level ?? "?"}</span>
          <span className="tile-job">{character.jobName ?? "—"}</span>
        </div>
      </div>

      {/* Clicks here manage the tile, they must not also select it. */}
      <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="tile-move"
          onClick={() => onMove(-1)}
          disabled={!canMoveLeft}
          aria-label={`Move ${character.name} left`}
        >
          ‹
        </button>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            refresh();
          }}
        >
          {refreshing ? "refreshing…" : "[refresh]"}
        </a>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            remove();
          }}
        >
          [delete]
        </a>
        <button
          type="button"
          className="tile-move"
          onClick={() => onMove(1)}
          disabled={!canMoveRight}
          aria-label={`Move ${character.name} right`}
        >
          ›
        </button>
      </div>
    </div>
  );
}
