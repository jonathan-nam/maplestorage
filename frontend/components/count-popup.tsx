"use client";

import { useEffect, useRef, useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { MAX_COUNT, SAVE_AFTER_MS, clampCount, parseCount, stepFor } from "@/lib/count-stepper";

// Editing one item's count, in a popup over the slot you clicked.
//
// CLICKING is what opens it, and that is what settles the conflict a hover stepper had: a filled
// slot used to put the item's name in the search bar, so a stepper on the slot meant two things
// competing for one 42px square. The click does one thing now.
//
// FIXED rather than absolute, because .ms-window sets overflow-x: auto and an element clipping one
// axis clips both: absolutely positioned, a popup over the first row was cut off by the window it
// was drawn in. Nothing between the grid and the viewport carries a transform, which is what would
// quietly turn a fixed box back into an absolute one.
//
// Stacked in the order you read it: what the item is, then what you hold, then the controls.

export function CountPopup({
  name,
  iconUrl,
  value,
  anchor,
  onChange,
  onCommit,
  onClose,
}: {
  name: string;
  iconUrl: string | null;
  value: number;
  /** The slot this belongs to, in viewport coordinates. */
  anchor: DOMRect;
  /** Every step or keystroke that reads as a number. Local, and written nowhere. */
  onChange: (next: number) => void;
  /** The total to keep, once the pressing or typing stops. */
  onCommit: (final: number) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saver = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The box as typed, so a half-cleared "" survives the keystroke it takes to retype it. See
  // parseCount: blank is not zero.
  const [typed, setTyped] = useState(String(value));

  useEffect(() => {
    live.current = value;
  }, [value]);

  // Nothing may outlive the popup: a repeat still firing after it closed would go on changing a
  // count nobody is looking at, and the write behind it would land a figure nobody saw.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (saver.current) clearTimeout(saver.current);
    },
    [],
  );

  // Escape closes, and so does a click anywhere else. Both commit first: closing is not cancelling,
  // and a number you typed and then clicked away from is one you meant.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Capture, so a click on another slot closes this before that slot opens its own.
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  function schedule(next: number) {
    live.current = next;
    onChange(next);
    setTyped(String(next));
    if (saver.current) clearTimeout(saver.current);
    // Written as a TOTAL once the pressing stops, so a flush cannot land a figure nobody saw, and
    // a hold is one write rather than forty.
    saver.current = setTimeout(() => onCommit(live.current), SAVE_AFTER_MS);
  }

  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function press(direction: 1 | -1) {
    const startedAt = Date.now();
    const fire = () => {
      const { step, wait } = stepFor(Date.now() - startedAt);
      const next = clampCount(live.current + step * direction);
      // At the floor or the ceiling there is nothing left to do, so stop rather than spinning a
      // timer against a number that cannot move.
      if (next !== live.current) schedule(next);
      timer.current = setTimeout(fire, wait);
    };
    fire();
  }

  return (
    <div
      ref={box}
      className="ms-count-popup"
      style={{ left: anchor.left + anchor.width / 2, top: anchor.top - 6 }}
      role="dialog"
      aria-label={`How many ${name}`}
    >
      <span className="ms-count-name">{name}</span>
      {iconUrl ? (
        <img className="ms-count-icon" src={apiAssetUrl(iconUrl)} alt="" />
      ) : (
        // No art, which is every item newer than the pinned dataset. The frame keeps the popup the
        // same height either way.
        <span className="ms-count-icon" aria-hidden="true" />
      )}
      <input
        className="split-input ms-count-input"
        inputMode="numeric"
        // Text, not number: a number input turns a half-typed value into "" and takes the spinners
        // with it, and the spinners are what the buttons below already are.
        type="text"
        value={typed}
        aria-label={`How many ${name}`}
        autoFocus
        onChange={(e) => {
          setTyped(e.target.value);
          const read = parseCount(e.target.value);
          // Nothing is written until it reads as a number. A box mid-clear is not a zero.
          if (read !== null) {
            live.current = read;
            onChange(read);
            if (saver.current) clearTimeout(saver.current);
            saver.current = setTimeout(() => onCommit(live.current), SAVE_AFTER_MS);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onClose();
        }}
        maxLength={String(MAX_COUNT).length}
      />
      <div className="ms-count-buttons">
        <button
          type="button"
          className="ms-step"
          aria-label={`One fewer ${name}`}
          disabled={value <= 0}
          onPointerDown={() => press(-1)}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
        >
          &minus;
        </button>
        <button
          type="button"
          className="ms-step"
          aria-label={`One more ${name}`}
          onPointerDown={() => press(1)}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
        >
          +
        </button>
      </div>
    </div>
  );
}
