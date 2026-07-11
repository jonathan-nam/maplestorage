"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Character } from "@/types/character";
import { CharacterPinPanel } from "./character-pin-panel";
import { ScreenshotHelp } from "./screenshot-help";
import { UploadRow } from "./upload-row";

type Row = { id: string; file: File; thumbUrl: string };

export default function UploadPage() {
  const { getToken } = useAuth();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [pinnedCharacterId, setPinnedCharacterId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rowCounter = useRef(0);

  useEffect(() => {
    apiFetch<Character[]>("/api/characters", { method: "GET" }, getToken)
      .then(setCharacters)
      .catch(() => {
        /* pin panel just renders empty; upload still works via auto-detect */
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

  function handleCharacterAdded(character: Character) {
    setCharacters((prev) => [...prev, character]);
  }

  const pinnedCharacter = characters.find((c) => c.id === pinnedCharacterId);

  return (
    <main style={{ padding: "2rem" }}>
      <Link href="/characters" className="back-link">
        « characters
      </Link>

      <h1>Upload</h1>

      <ScreenshotHelp />

      <div className="upload-layout">
        <CharacterPinPanel
          characters={characters}
          pinnedCharacterId={pinnedCharacterId}
          onPin={setPinnedCharacterId}
        />

        <div className="upload-main">
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
      </div>
    </main>
  );
}
