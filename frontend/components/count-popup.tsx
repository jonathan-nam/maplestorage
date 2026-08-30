"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_COUNT, SAVE_AFTER_MS, clampCount, parseCount, stepFor } from "@/lib/count-stepper";
import { deferredWrite } from "@/lib/deferred-write";

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
// Two lines: what the item is, then what you hold with a button either side of it. It carried the
// item's ICON as a third line and no longer does. The slot you clicked is directly under the popup
// and already shows it, at the 46px every icon here is normalised to and drawn at 1:1, so a second
// copy cost a third of the popup's height to repeat what was under it. Shrinking that copy was not
// an option: these are pixel sprites and rescaling one is the bug drop-icon-canvas already fixed.
//
// Dressed as the window it opens over, in its 12/18 and the --ms-* palette. It is drawn ON the
// game's window, so the dark shell's surface and ink read as a different app's dialog sitting on
// top of it.

export function CountPopup({
  name,
  value,
  anchor,
  onChange,
  onCommit,
  onClose,
}: {
  name: string;
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

  // Held back until the pressing stops, and FLUSHED when this closes rather than cancelled. It was
  // cancelled, and that is what lost edits: typing a count and clicking another item inside the
  // wait threw the write away in silence, so the number went back to what was stored and read as
  // though it had been reset. See lib/deferred-write.ts.
  //
  // onCommit is taken ONCE, at mount, which is safe only because this popup cannot outlive what it
  // writes to: it is remounted per item, and the panel above is keyed on the character, so picking
  // a different one closes it rather than leaving it bound to the character it opened over.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const held = useMemo(() => deferredWrite(onCommit, SAVE_AFTER_MS), []);
  // The box as typed, so a half-cleared "" survives the keystroke it takes to retype it. See
  // parseCount: blank is not zero.
  const [typed, setTyped] = useState(String(value));

  // Only while nothing is waiting to be written. A re-pull elsewhere on the page changes this prop
  // mid-edit, and taking it then would drop the figure being typed and write the old one back.
  useEffect(() => {
    if (!held.pending()) live.current = value;
  }, [value]);

  // On the way out: stop the repeat, then WRITE what is waiting. A repeat still firing after this
  // closed would go on changing a count nobody is looking at, but a value already typed is one
  // somebody meant, and dropping it is the bug this file was rewritten for.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      held.flush();
    };
  }, []);

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
    // A TOTAL, so the one write that lands is the figure this ended on, and a hold is one write
    // rather than forty.
    held.schedule(next);
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
      <div className="ms-count-row">
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
        <input
          className="ms-count-input"
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
              held.schedule(read);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onClose();
          }}
          maxLength={String(MAX_COUNT).length}
        />
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
