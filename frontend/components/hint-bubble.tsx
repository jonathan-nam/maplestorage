"use client";

import { type ReactNode, useId } from "react";

/**
 * A mark beside a control, and the sentence it stands for. Hover it or tab to it.
 *
 * For a caveat that cannot be said in the label. It is not a place to explain a control: see
 * CLAUDE.md, the default is still no prose.
 *
 * The bubble anchors to the nearest POSITIONED ancestor, so give the row it sits in
 * `position: relative`. Anchored to the mark instead it hangs off the right of a phone, and every
 * width that fixes that is measured against where the label happens to end.
 *
 * Never inside a <label>: the mark is a button, and a button in a label toggles the control it is
 * about the moment somebody asks what that control does.
 *
 * The Sale Ledger has its own copy of this, which predates it: .ledger-hint in globals.css, pinned
 * by sale-past-the-debt.test.ts, anchored to a card's step row.
 */
export function HintBubble({ name, children }: { name: string; children: ReactNode }) {
  const hintId = useId();

  return (
    <span className="hint">
      <button type="button" className="hint-mark" aria-describedby={hintId}>
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
          <path d="M8 7.4v4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {/* The mark is a glyph, so the button needs a name that is not the letter i. */}
        <span className="visually-hidden">{name}</span>
      </button>
      {/* Drawn whether or not it is on screen, so aria-describedby has something to read and the
          hint reaches somebody who cannot hover for it. */}
      <span id={hintId} role="tooltip" className="hint-bubble">
        {children}
      </span>
    </span>
  );
}
