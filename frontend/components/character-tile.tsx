"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Character } from "@/types/character";

type Props = {
  character: Character;
  onUpdated: (character: Character) => void;
  onDeleted: (id: string) => void;
  // When the tile is being used to pick whose inventory to show, clicking it
  // selects rather than navigates. Without onSelect it keeps its original
  // behaviour and opens the character's page.
  selected?: boolean;
  onSelect: () => void;
};

export function CharacterTile({ character, onUpdated, onDeleted, selected, onSelect }: Props) {
  const { getToken } = useAuth();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(character.name);
  const [editLevel, setEditLevel] = useState(character.level?.toString() ?? "");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function saveEdit() {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await apiFetch<Character>(
        `/api/characters/${character.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            name: editName.trim() || undefined,
            level: editLevel.trim() ? Number(editLevel) : undefined,
          }),
        },
        getToken,
      );
      onUpdated(updated);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

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

      {editing ? (
        <div onClick={(e) => e.stopPropagation()}>
          <input value={editName} disabled={busy} onChange={(e) => setEditName(e.target.value)} />
          <br />
          <input
            value={editLevel}
            disabled={busy}
            placeholder="level"
            onChange={(e) => setEditLevel(e.target.value)}
          />
          <div className="tile-actions">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                saveEdit();
              }}
            >
              {busy ? "saving…" : "[save]"}
            </a>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setEditing(false);
              }}
            >
              [cancel]
            </a>
          </div>
        </div>
      ) : (
        <div className="tile-actions">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setEditing(true);
            }}
          >
            [edit]
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              refresh();
            }}
          >
            {refreshing ? "refreshing…" : "[refresh]"}
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              remove();
            }}
          >
            [delete]
          </a>
        </div>
      )}
    </div>
  );
}
