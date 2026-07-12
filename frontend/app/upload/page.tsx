"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CharacterCarousel, type Selection } from "@/components/character-carousel";
import { apiFetch } from "@/lib/api";
import { invalidate, peek, put } from "@/lib/cache";
import type { Character } from "@/types/character";
import { ScreenshotHelp } from "./screenshot-help";
import { UploadRow } from "./upload-row";

const CHARACTERS_KEY = "/api/characters";

type Row = { id: string; file: File; thumbUrl: string };

export default function UploadPage() {
  const { getToken } = useAuth();
  // Seeded from the same cache /characters fills, so arriving here from that page
  // paints the strip immediately instead of flashing empty while it refetches a list
  // it already has.
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );

  // null = auto-detect. The carousel's head tile, exactly as on /characters, where the
  // same slot means "everyone".
  const [pinnedCharacterId, setPinnedCharacterId] = useState<Selection>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rowCounter = useRef(0);

  useEffect(() => {
    apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, getToken)
      .then((result) => {
        setCharacters(result);
        put(CHARACTERS_KEY, result);
      })
      .catch(() => {
        /* the strip just renders empty; upload still works via auto-detect */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) addFiles(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  function addFiles(files: File[]) {
    const newRows = files
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({
        id: `row-${rowCounter.current++}`,
        file,
        thumbUrl: URL.createObjectURL(file),
      }));
    setRows((prev) => [...prev, ...newRows]);
  }

  // The tiles carry edit / refresh / delete, same as on /characters -- a strip you can
  // only look at would be a worse version of the panel it replaced.
  function handleCharacterAdded(character: Character) {
    setCharacters((prev) => [...prev, character]);
    invalidate("/api/");
  }

  function handleCharacterUpdated(character: Character) {
    setCharacters((prev) => prev.map((c) => (c.id === character.id ? character : c)));
    invalidate("/api/");
  }

  function handleCharacterDeleted(id: string) {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    // Never leave an upload pinned to a character that no longer exists: the parse would
    // come back UNRESOLVABLE and it would look like the screenshot was at fault.
    if (pinnedCharacterId === id) setPinnedCharacterId(null);
    invalidate("/api/");
  }

  const pinnedCharacter = characters.find((c) => c.id === pinnedCharacterId);

  return (
    <main style={{ padding: "2rem" }}>
      <Link href="/characters" className="back-link">
        « characters
      </Link>

      <h1>Upload</h1>

      <ScreenshotHelp />

      <CharacterCarousel
        characters={characters}
        selectedId={pinnedCharacterId}
        onSelect={setPinnedCharacterId}
        onUpdated={handleCharacterUpdated}
        onDeleted={handleCharacterDeleted}
        allLabel="Auto-detect"
        allHint="read the name from the screenshot"
        allSymbol="?"
      />

      <div>
        <div
          className={`dropzone${dragOver ? " dragover" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <p>
            {pinnedCharacter
              ? `Drag ${pinnedCharacter.name}'s screenshot here, or click to browse`
              : "Drag screenshots here, or click to browse"}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
        </div>

        <section className="row-list">
          {rows.map((row) => (
            <UploadRow
              key={row.id}
              file={row.file}
              thumbUrl={row.thumbUrl}
              pinnedCharacterId={pinnedCharacterId}
              characters={characters}
              getToken={getToken}
              onCharacterAdded={handleCharacterAdded}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
