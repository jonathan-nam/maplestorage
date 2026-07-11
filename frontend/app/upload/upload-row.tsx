"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { compressImage } from "@/lib/compress-image";
import type { Character } from "@/types/character";
import type { ScreenshotResult } from "@/types/screenshot";

type Phase = "detecting" | "resolved" | "request-error";
type PostAction = null | "ignored" | { resolvedTo: string };

function findCharacterByName(characters: Character[], name: string | null): Character | undefined {
  if (!name) return undefined;
  return characters.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

export function UploadRow({
  file,
  thumbUrl,
  pinnedCharacterId,
  characters,
  getToken,
  onCharacterAdded,
}: {
  file: File;
  thumbUrl: string;
  pinnedCharacterId: string | null;
  characters: Character[];
  getToken: () => Promise<string | null>;
  onCharacterAdded: (character: Character) => void;
}) {
  const [phase, setPhase] = useState<Phase>("detecting");
  const [result, setResult] = useState<ScreenshotResult | null>(null);
  const [runId, setRunId] = useState(0);
  const [postAction, setPostAction] = useState<PostAction>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setPhase("detecting");
      setPostAction(null);
      try {
        const { base64, mediaType } = await compressImage(file);
        const body: { imageBase64: string; mediaType: string; characterId?: string } = {
          imageBase64: base64,
          mediaType,
        };
        if (pinnedCharacterId) {
          body.characterId = pinnedCharacterId;
        }
        const res = await apiFetch<ScreenshotResult>(
          "/api/screenshots",
          { method: "POST", body: JSON.stringify(body) },
          getToken,
        );
        if (!cancelled) {
          setResult(res);
          setPhase("resolved");
        }
      } catch {
        if (!cancelled) {
          setPhase("request-error");
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  async function resolveTo(characterId: string, characterName: string) {
    if (!result) return;
    setBusy(true);
    try {
      await apiFetch(
        `/api/screenshots/${result.screenshotId}/resolve`,
        { method: "POST", body: JSON.stringify({ characterId }) },
        getToken,
      );
      setPostAction({ resolvedTo: characterName });
      setPickerOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function ignore() {
    if (!result) return;
    setBusy(true);
    try {
      await apiFetch(`/api/screenshots/${result.screenshotId}/ignore`, { method: "POST" }, getToken);
      setPostAction("ignored");
    } finally {
      setBusy(false);
    }
  }

  async function addAndResolve(name: string) {
    setBusy(true);
    try {
      const character = await apiFetch<Character>(
        "/api/characters",
        { method: "POST", body: JSON.stringify({ name }) },
        getToken,
      );
      onCharacterAdded(character);
      await resolveTo(character.id, character.name);
    } finally {
      setBusy(false);
    }
  }

  const { statusText, statusClass } = describeStatus(phase, result, postAction);

  return (
    <div className="upload-row">
      <img className="thumb" src={thumbUrl} alt="" />
      <span className="filename">{file.name}</span>
      <span className={`status${statusClass ? ` ${statusClass}` : ""}`}>{statusText}</span>
      <span className="row-actions">
        {phase === "request-error" && (
          <a href="#" onClick={(e) => (e.preventDefault(), setRunId((n) => n + 1))}>
            [retry]
          </a>
        )}
        {phase === "resolved" && result?.outcome === "FAILED" && !postAction && (
          <a href="#" onClick={(e) => (e.preventDefault(), setRunId((n) => n + 1))}>
            [retry]
          </a>
        )}
        {phase === "resolved" && result?.outcome === "UNRECOGNIZED_SCREENSHOT" && !postAction && (
          <a href="#" onClick={(e) => (e.preventDefault(), ignore())}>
            [ignore]
          </a>
        )}
        {phase === "resolved" && result?.outcome === "NEW_CHARACTER_DETECTED" && !postAction && (
          <>
            <a href="#" onClick={(e) => (e.preventDefault(), addAndResolve(result.detectedCharacterName!))}>
              [add {result.detectedCharacterName}]
            </a>
            <a href="#" onClick={(e) => (e.preventDefault(), setPickerOpen((o) => !o))}>
              [pick existing character]
            </a>
            <a href="#" onClick={(e) => (e.preventDefault(), ignore())}>
              [ignore]
            </a>
          </>
        )}
        {phase === "resolved" && result?.outcome === "MISMATCH" && !postAction && (
          <>
            {findCharacterByName(characters, result.detectedCharacterName) && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  const match = findCharacterByName(characters, result.detectedCharacterName)!;
                  resolveTo(match.id, match.name);
                }}
              >
                [use {result.detectedCharacterName}]
              </a>
            )}
            <a href="#" onClick={(e) => (e.preventDefault(), setPickerOpen((o) => !o))}>
              [pick a different character]
            </a>
            <a href="#" onClick={(e) => (e.preventDefault(), ignore())}>
              [ignore]
            </a>
          </>
        )}
        {phase === "resolved" && result?.outcome === "UNRESOLVABLE" && !postAction && (
          <>
            <a href="#" onClick={(e) => (e.preventDefault(), setPickerOpen(true))}>
              [pick character]
            </a>
            <a href="#" onClick={(e) => (e.preventDefault(), ignore())}>
              [ignore]
            </a>
          </>
        )}
      </span>
      {pickerOpen && !postAction && (
        <div className="change-panel">
          <label>
            Character:{" "}
            <select
              disabled={busy}
              defaultValue=""
              onChange={(e) => {
                const chosen = characters.find((c) => c.id === e.target.value);
                if (chosen) resolveTo(chosen.id, chosen.name);
              }}
            >
              <option value="" disabled>
                (choose)
              </option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function describeStatus(
  phase: Phase,
  result: ScreenshotResult | null,
  postAction: PostAction,
): { statusText: string; statusClass: string } {
  if (postAction === "ignored") {
    return { statusText: "Ignored — not added", statusClass: "needs-review" };
  }
  if (postAction && typeof postAction === "object") {
    return { statusText: `Inventory — matched to ${postAction.resolvedTo}`, statusClass: "" };
  }
  if (phase === "detecting") {
    return { statusText: "Detecting…", statusClass: "pending" };
  }
  if (phase === "request-error") {
    return { statusText: "Upload failed — check your connection", statusClass: "needs-review" };
  }
  if (!result) {
    return { statusText: "", statusClass: "" };
  }
  switch (result.outcome) {
    case "MATCHED":
      return {
        statusText: `Inventory — matched to ${result.detectedCharacterName ?? result.pinnedCharacterName}`,
        statusClass: "",
      };
    case "MISMATCH":
      return {
        statusText: `Mismatch — pinned to ${result.pinnedCharacterName}, but this screenshot looks like ${result.detectedCharacterName}`,
        statusClass: "mismatch",
      };
    case "NEW_CHARACTER_DETECTED":
      return {
        statusText: `New character detected: ${result.detectedCharacterName} — not in your roster`,
        statusClass: "new-character",
      };
    case "UNRESOLVABLE":
      return {
        statusText: "No character visible in this screenshot — pick one to attribute it",
        statusClass: "needs-review",
      };
    case "UNRECOGNIZED_SCREENSHOT":
      return { statusText: "Unrecognized — needs review", statusClass: "needs-review" };
    case "FAILED":
      return { statusText: result.failureReason ?? "Parse failed", statusClass: "needs-review" };
    default:
      return { statusText: "", statusClass: "" };
  }
}
