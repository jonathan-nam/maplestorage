"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { InventoryPanel } from "@/components/inventory-panel";
import { apiFetch, ApiError } from "@/lib/api";
import type { Character } from "@/types/character";
import type { CharacterToken } from "@/types/character-token";

type LoadState = "loading" | "loaded" | "not-found" | "error";

export default function CharacterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const [character, setCharacter] = useState<Character | null>(null);
  const [tokens, setTokens] = useState<CharacterToken[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    Promise.all([
      apiFetch<Character>(`/api/characters/${id}`, { method: "GET" }, getToken),
      apiFetch<CharacterToken[]>(`/api/characters/${id}/tokens`, { method: "GET" }, getToken),
    ])
      .then(([characterResult, tokensResult]) => {
        setCharacter(characterResult);
        setTokens(tokensResult);
        setState("loaded");
      })
      .catch((err) =>
        setState(err instanceof ApiError && err.status === 404 ? "not-found" : "error"),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <main style={{ padding: "2rem" }}>
      <Link href="/characters" className="back-link">
        « back to characters
      </Link>

      {state === "loading" && <p>loading…</p>}
      {state === "not-found" && <p>Character not found.</p>}
      {state === "error" && <p>Couldn&apos;t load this character.</p>}

      {state === "loaded" && character && (
        <>
          <div className="char-detail-header">
            {character.spriteImgUrl ? (
              <img className="tile-sprite" src={character.spriteImgUrl} alt="" />
            ) : (
              <div className="tile-sprite" />
            )}
            <div>
              <h1>
                {character.name} <span className="meta">Lv.{character.level ?? "?"}</span>
              </h1>
              <div className="meta">{character.jobName ?? "—"}</div>
            </div>
          </div>

          <InventoryPanel
            title={character.name}
            subtitle={`Lv.${character.level ?? "?"}`}
            emptyHint="No tokens here yet. Upload an inventory screenshot."
            items={tokens.map((token) => ({
              id: token.tokenCatalogId,
              name: token.name,
              iconUrl: token.iconUrl,
              quantity: token.quantity,
              note: `${token.quantity} / ${token.redeemThreshold} toward an Eternal set`,
            }))}
          />
        </>
      )}
    </main>
  );
}
