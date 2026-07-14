"use client";

import { useEffect, useRef, useState } from "react";
import { SlotGrid, type SlotItem } from "@/components/slot-grid";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { compressImage } from "@/lib/compress-image";
import type { Character } from "@/types/character";
import type { CharacterToken } from "@/types/character-token";
import type { ScreenshotResult } from "@/types/screenshot";

// What a write changed, handed to the page so the inventory can animate from it.
export type Saved = {
  characterId: string;
  // The counts held BEFORE this screenshot, keyed by catalog id. An item absent from the map is
  // one the character did not have, which the grid draws as `new`.
  before: Map<string, number>;
};

// Upload lives here, on the character you are already looking at, rather than on a page of its
// own, and that is not just one page fewer.
//
// The old flow could not know who a screenshot belonged to. It parsed the image, OCR'd the
// character's name out of the HUD, and GUESSED; the whole review step existed to let you correct
// the guess. Uploading from a character's own page removes the ambiguity at source: you have
// already said who it is for. The HUD stops being the answer and becomes a CHECK on the answer,
// which is a much stronger thing to be, if the name in the picture disagrees with the character
// you dropped it on, that is now a contradiction rather than a shrug, and it is worth shouting
// about.
//
// The preview grid is the other half. An upload used to be a leap of faith: it parsed, it wrote,
// and you learned what it did afterwards. Now the parse is shown in the same 16-wide lattice as
// the inventory below it, before it is committed.
//
// The preview shows the SCREENSHOT, faithfully: the counts it read, and nothing else. It used to
// carry +n/-n badges as well, and that was the wrong place for them twice over. They were computed
// from live state, so saving refetched the counts, folded them back into "before", and the badges
// silently vanished at the exact moment they were worth reading. And the preview is supposed to
// answer "did it read the picture correctly", which is a question about the picture. What CHANGED
// is a question about the character, and the inventory below now answers it, by animating.

type Phase = "reading" | "read" | "error";
type Capture = {
  id: string;
  file: File;
  thumbUrl: string;
  phase: Phase;
  result: ScreenshotResult | null;
};

const PREVIEW_ROWS = 2;

export function CaptureDock({
  characters,
  pinnedCharacterId,
  tokensByChar,
  getToken,
  onCharacterAdded,
  onSaved,
  onToggleGeneric,
}: {
  characters: Character[];
  // null = no character selected, so the character is read from the screenshot's HUD instead.
  pinnedCharacterId: string | null;
  // Every character's holdings, not just the selected one's. The screenshot may be written to a
  // character other than the selected one (generic upload, resolved mismatch), and the "before"
  // snapshot has to come from the character it was actually WRITTEN to. Reading it from whoever
  // happened to be selected is how you get a confident, wrong diff.
  tokensByChar: Record<string, CharacterToken[]>;
  getToken: () => Promise<string | null>;
  onCharacterAdded: (character: Character) => void;
  // Carries the counts held BEFORE the write, so the inventory can animate from them. Passed even
  // though the page could recompute it, because by the time the page hears about this the refetch
  // is already in flight and the old numbers are gone.
  onSaved: (change?: Saved) => void;
  onToggleGeneric: () => void;
}) {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  // Read inside async callbacks, where the prop captured at render time may already be stale: the
  // snapshot has to be the counts as they were when the screenshot was written. Written in an
  // effect rather than during render, which React forbids.
  const tokensRef = useRef(tokensByChar);
  useEffect(() => {
    tokensRef.current = tokensByChar;
  }, [tokensByChar]);

  // Who this screenshot's counts were written to. The pin if there is one, otherwise the character
  // the HUD named, which is what the backend matched on.
  function ownerOf(result: ScreenshotResult): string | null {
    if (pinnedCharacterId) return pinnedCharacterId;
    const name = result.detectedCharacterName?.toLowerCase();
    if (!name) return null;
    return characters.find((c) => c.name.toLowerCase() === name)?.id ?? null;
  }

  function snapshot(characterId: string): Map<string, number> {
    return new Map(
      (tokensRef.current[characterId] ?? []).map((t) => [t.tokenCatalogId, t.quantity]),
    );
  }

  // "Generic" is not a second piece of state that can disagree with the carousel, it IS having
  // no character selected. One truth, so the eye and the carousel can never contradict each other.
  const generic = pinnedCharacterId === null;
  const pinned = characters.find((c) => c.id === pinnedCharacterId);

  function add(files: File[]) {
    for (const file of files.filter((f) => f.type.startsWith("image/"))) {
      const id = `cap-${counter.current++}`;
      const capture: Capture = {
        id,
        file,
        thumbUrl: URL.createObjectURL(file),
        phase: "reading",
        result: null,
      };
      setCaptures((prev) => [capture, ...prev]);
      read(capture);
    }
  }

  async function read(capture: Capture) {
    const patch = (next: Partial<Capture>) =>
      setCaptures((prev) => prev.map((c) => (c.id === capture.id ? { ...c, ...next } : c)));
    try {
      const { base64, mediaType } = await compressImage(capture.file);
      const body: { imageBase64: string; mediaType: string; characterId?: string } = {
        imageBase64: base64,
        mediaType,
      };
      // Pinning is the point of uploading from a character's page, unless you have said this
      // screenshot is not theirs, in which case we are back to reading the HUD.
      if (pinnedCharacterId) body.characterId = pinnedCharacterId;

      const result = await apiFetch<ScreenshotResult>(
        "/api/screenshots",
        { method: "POST", body: JSON.stringify(body) },
        getToken,
      );
      patch({ phase: "read", result });
      if (result.outcome === "MATCHED") {
        // Take the snapshot BEFORE onSaved, which refetches. A moment later these counts are the
        // new ones and there is nothing left to diff against.
        const owner = ownerOf(result);
        const before = owner ? snapshot(owner) : null;

        // Counts were written. Anything cached from before is now a wrong number that looks
        // right.
        invalidate("/api/");
        onSaved(owner && before ? { characterId: owner, before } : undefined);
      }
    } catch {
      patch({ phase: "error" });
    }
  }

  async function resolveTo(capture: Capture, characterId: string) {
    if (!capture.result) return;
    // Same snapshot, same reason, and for the character you just NAMED rather than the one that
    // happens to be selected.
    const before = snapshot(characterId);
    await apiFetch(
      `/api/screenshots/${capture.result.screenshotId}/resolve`,
      { method: "POST", body: JSON.stringify({ characterId }) },
      getToken,
    );
    invalidate("/api/");
    onSaved({ characterId, before });
    dismiss(capture.id);
  }

  async function ignore(capture: Capture) {
    if (!capture.result) return;
    await apiFetch(
      `/api/screenshots/${capture.result.screenshotId}/ignore`,
      { method: "POST" },
      getToken,
    );
    dismiss(capture.id);
  }

  async function addAndResolve(capture: Capture, name: string) {
    const character = await apiFetch<Character>(
      "/api/characters",
      { method: "POST", body: JSON.stringify({ name }) },
      getToken,
    );
    onCharacterAdded(character);
    await resolveTo(capture, character.id);
  }

  function dismiss(id: string) {
    setCaptures((prev) => {
      const going = prev.find((c) => c.id === id);
      if (going) URL.revokeObjectURL(going.thumbUrl);
      return prev.filter((c) => c.id !== id);
    });
  }

  // Declared after `add` on purpose: referencing it from above trips the hooks lint.
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
      if (files.length > 0) add(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedCharacterId]);

  return (
    <section className="dock">
      <div
        className={`dock-drop${dragOver ? " dragover" : ""}${generic ? " generic" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          add(Array.from(e.dataTransfer.files));
        }}
      >
        <span className="dock-drop-main">
          {pinned
            ? `Drop ${pinned.name}'s inventory screenshot here`
            : "Drop an inventory screenshot here"}
        </span>
        <span className="dock-drop-sub">
          {pinned
            ? "or paste it, it will be saved to this character"
            : "or paste it. We'll read the character's name from the screenshot"}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) add(Array.from(e.target.files));
            e.target.value = "";
          }}
        />

        {/* Turning this on DESELECTS the character in the strip above, and that is the point:
            the two are one state, so what you can see is what will happen. A screenshot cannot be
            both "definitely Bob's" and "work out whose it is". stopPropagation because the whole
            dropzone is a click target for the file picker. */}
        <button
          type="button"
          className={`dock-eye${generic ? " on" : ""}`}
          aria-pressed={generic}
          onClick={(e) => {
            e.stopPropagation();
            onToggleGeneric();
          }}
          title={
            generic
              ? "Reading the character's name from the screenshot. Pick a character above to save it to them instead."
              : "Not this character's? Read the name from the screenshot instead."
          }
        >
          <span aria-hidden="true">👁</span>
          <span className="dock-eye-label">
            {generic ? "Reading the name from the screenshot" : "Not this character's?"}
          </span>
        </button>
      </div>

      {captures.map((capture) => (
        <CaptureCard
          key={capture.id}
          capture={capture}
          characters={characters}
          pinned={pinned}
          onResolve={(id) => resolveTo(capture, id)}
          onIgnore={() => ignore(capture)}
          onAddAndResolve={(name) => addAndResolve(capture, name)}
          onDismiss={() => dismiss(capture.id)}
        />
      ))}
    </section>
  );
}

function CaptureCard({
  capture,
  characters,
  pinned,
  onResolve,
  onIgnore,
  onAddAndResolve,
  onDismiss,
}: {
  capture: Capture;
  characters: Character[];
  pinned: Character | undefined;
  onResolve: (characterId: string) => void;
  onIgnore: () => void;
  onAddAndResolve: (name: string) => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const result = capture.result;

  async function guard(fn: () => Promise<void> | void) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  // The screenshot, verbatim. No `previous`, so no badges and no ticking: this grid answers "did
  // it read the picture right", and the only honest answer to that is the number it read.
  const items: SlotItem[] = (result?.tokenCounts ?? []).map((t) => ({
    // tokenCatalogId is null when the parser knows an item the catalog does not. That should not
    // happen (both are generated from catalog/items.yaml) but if it ever does, show the item
    // rather than dropping it. A silently missing item is the failure this whole app exists to
    // prevent.
    id: t.tokenCatalogId ?? t.tokenName,
    name: t.displayName,
    iconUrl: t.iconUrl,
    quantity: t.quantity,
    itemGroup: t.itemGroup,
  }));

  const { text, tone } = describe(capture, pinned);
  const saved = result?.outcome === "MATCHED";

  return (
    <article className={`capture${busy ? " busy" : ""}`}>
      <header className="capture-head">
        <img className="capture-thumb" src={capture.thumbUrl} alt="" />
        <div className="capture-meta">
          <span className={`capture-status ${tone}`}>{text}</span>
          <span className="capture-file">{capture.file.name}</span>
        </div>
        <span className="capture-actions">
          <Actions
            capture={capture}
            characters={characters}
            busy={busy}
            onResolve={(id) => guard(() => onResolve(id))}
            onIgnore={() => guard(onIgnore)}
            onAddAndResolve={(n) => guard(() => onAddAndResolve(n))}
            onDismiss={onDismiss}
            saved={saved}
          />
        </span>
      </header>

      {capture.phase === "read" && items.length > 0 && (
        <div className={`capture-preview${saved ? " saved" : " pending"}`}>
          <SlotGrid items={items} rows={PREVIEW_ROWS} />
          <p className="capture-preview-note">
            {saved
              ? `${items.length} ${items.length === 1 ? "item" : "items"} read and saved.`
              : `${items.length} ${items.length === 1 ? "item" : "items"} read. Nothing has been saved yet.`}
          </p>
        </div>
      )}
    </article>
  );
}

function Actions({
  capture,
  characters,
  busy,
  saved,
  onResolve,
  onIgnore,
  onAddAndResolve,
  onDismiss,
}: {
  capture: Capture;
  characters: Character[];
  busy: boolean;
  saved: boolean;
  onResolve: (characterId: string) => void;
  onIgnore: () => void;
  onAddAndResolve: (name: string) => void;
  onDismiss: () => void;
}) {
  const result = capture.result;
  if (capture.phase === "reading") return <span className="capture-spinner">Reading…</span>;
  if (capture.phase === "error" || !result) {
    return (
      <button className="link" onClick={onDismiss}>
        dismiss
      </button>
    );
  }
  if (saved) {
    return (
      <button className="link" onClick={onDismiss} disabled={busy}>
        done
      </button>
    );
  }

  const detected = result.detectedCharacterName;
  const known = detected
    ? characters.find((c) => c.name.toLowerCase() === detected.toLowerCase())
    : undefined;

  return (
    <>
      {result.outcome === "MISMATCH" && known && (
        <button className="link" disabled={busy} onClick={() => onResolve(known.id)}>
          save to {known.name} instead
        </button>
      )}
      {result.outcome === "NEW_CHARACTER_DETECTED" && detected && (
        <button className="link" disabled={busy} onClick={() => onAddAndResolve(detected)}>
          add {detected}
        </button>
      )}
      {(result.outcome === "UNRESOLVABLE" ||
        result.outcome === "MISMATCH" ||
        result.outcome === "NEW_CHARACTER_DETECTED") && (
        <select
          disabled={busy}
          defaultValue=""
          onChange={(e) => e.target.value && onResolve(e.target.value)}
        >
          <option value="" disabled>
            save to…
          </option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <button className="link" disabled={busy} onClick={onIgnore}>
        discard
      </button>
    </>
  );
}

function describe(capture: Capture, pinned: Character | undefined): { text: string; tone: string } {
  if (capture.phase === "reading") return { text: "Reading the screenshot…", tone: "pending" };
  if (capture.phase === "error")
    return { text: "The upload didn't reach the server.", tone: "bad" };

  const r = capture.result!;
  switch (r.outcome) {
    case "MATCHED":
      return { text: `Saved to ${r.detectedCharacterName ?? r.pinnedCharacterName}`, tone: "good" };

    // The HUD now CHECKS the answer instead of supplying it, so a disagreement is a real
    // contradiction and is worded as one. You said this is Bob's; the picture says Alice.
    case "MISMATCH":
      return {
        text: `This screenshot is ${r.detectedCharacterName}'s, but you dropped it on ${
          pinned?.name ?? r.pinnedCharacterName
        }. Nothing was saved.`,
        tone: "bad",
      };

    case "NEW_CHARACTER_DETECTED":
      return {
        text: `This looks like ${r.detectedCharacterName}, who isn't in your roster yet.`,
        tone: "warn",
      };

    // Only reachable with no character selected. Pick one and there is nothing to resolve.
    case "UNRESOLVABLE":
      return {
        text: "No character name is visible in this screenshot. Pick a character, or select one above before uploading.",
        tone: "warn",
      };

    case "UNRECOGNIZED_SCREENSHOT":
      return { text: "That isn't an inventory screenshot.", tone: "bad" };

    case "FAILED":
      return { text: r.failureReason ?? "Couldn't read this one.", tone: "bad" };

    default:
      return { text: "", tone: "" };
  }
}
