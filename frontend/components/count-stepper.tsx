"use client";

import { useEffect, useRef } from "react";
import { SAVE_AFTER_MS, clampCount, stepFor } from "@/lib/count-stepper";

// The two buttons that raise and lower a count, floating above the slot they belong to.
//
// ABOVE the slot rather than on it, and that is the point. A filled slot is already a button that
// searches every character for the item, so a stepper inside it would put two targets in one 42px
// square: a click a few pixels off would change a count when you meant to look the item up.
//
// FIXED rather than absolute, because .ms-window sets overflow-x: auto, and an element that clips
// one axis clips both. Absolutely positioned, the popover over the first row was cut off by the
// window it was drawn in. Fixed escapes that, and nothing between here and the viewport carries a
// transform, which is the thing that would quietly turn a fixed box back into an absolute one.
//
// Holding accelerates. What that means is lib/count-stepper.ts, tested there and staggered so a
// short hold still moves one at a time: a number that jumps five at a time immediately is one you
// cannot land on 7 with.

export function CountStepper({
  value,
  anchor,
  onChange,
  onCommit,
  onPointerEnter,
  onPointerLeave,
  label,
}: {
  value: number;
  /** The slot this belongs to, in viewport coordinates. */
  anchor: DOMRect;
  /** Every step, for the number on screen. Cheap, local, and written nowhere. */
  onChange: (next: number) => void;
  /** The total to keep, once the pressing stops. See SAVE_AFTER_MS. */
  onCommit: (final: number) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  /** What this is a count OF, for the buttons' own labels. */
  label: string;
}) {
  // The live total, so a repeat reads what the last repeat produced rather than the value this
  // component last rendered with. A hold fires faster than React re-renders.
  const live = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saver = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    live.current = value;
  }, [value]);

  // Nothing may outlive the popover. A repeat still firing after it has gone would go on changing a
  // count nobody is looking at, and the save behind it would land a figure nobody saw.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (saver.current) clearTimeout(saver.current);
    },
    [],
  );

  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (saver.current) clearTimeout(saver.current);
    // Written as a TOTAL once the pressing stops, so a flush cannot land a figure nobody saw.
    const final = live.current;
    saver.current = setTimeout(() => onCommit(final), SAVE_AFTER_MS);
  }

  function press(direction: 1 | -1) {
    const startedAt = Date.now();

    const fire = () => {
      const { step, wait } = stepFor(Date.now() - startedAt);
      const next = clampCount(live.current + step * direction);
      // At the floor or the ceiling there is nothing left to do, so stop repeating rather than
      // spinning a timer against a number that cannot move.
      if (next !== live.current) {
        live.current = next;
        onChange(next);
      }
      timer.current = setTimeout(fire, wait);
    };

    fire();
  }

  return (
    <div
      className="ms-stepper"
      role="group"
      aria-label={`Adjust ${label}`}
      style={{ left: anchor.left + anchor.width / 2, top: anchor.top - 4 }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <button
        type="button"
        className="ms-step"
        aria-label={`One fewer ${label}`}
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
        aria-label={`One more ${label}`}
        onPointerDown={() => press(1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        +
      </button>
    </div>
  );
}
