"use client";

import { type ReactNode, useEffect, useState } from "react";

/**
 * Holds the wait on screen until what replaces it is visible.
 *
 * The two halves of a load used to hand over in one frame with nothing in between: the "Loading..."
 * was unmounted and the content began its fade at opacity 0, so a page read as three beats, the
 * middle one blank. Traced on the production build, the blank frame was the full height of the
 * loaded page with only the title on it.
 *
 * So they overlap. The placeholder is kept mounted for the length of the fade and taken out of
 * flow, the content fades up underneath it, and only then is it dropped.
 *
 * Once settled this renders its children and nothing else, so steady-state layout is exactly what
 * it would be without the wrapper.
 */

// The overlap. Must match .page-swap-out and .page-swap-in in globals.css: the placeholder is
// unmounted from here, so a shorter timer cuts the fade off part-way through it. Pinned by
// page-swap.test.ts.
export const CROSSFADE_MS = 280;

export function PageSwap({
  waiting,
  placeholder,
  children,
}: {
  waiting: boolean;
  /** What stands in while the page waits, and fades out over what arrives. */
  placeholder: ReactNode;
  children: ReactNode;
}) {
  const [lingering, setLingering] = useState(false);
  const [wasWaiting, setWasWaiting] = useState(waiting);

  // Adjusted during render rather than in an effect. React supports this for deriving a transition
  // from a prop change, and it is the difference between the placeholder lingering from the very
  // frame the content mounts and lingering from the frame after it. That one frame is the blank
  // one this component exists to remove.
  if (wasWaiting !== waiting) {
    setWasWaiting(waiting);
    if (!waiting) setLingering(true);
  }

  useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), CROSSFADE_MS);
    return () => clearTimeout(timer);
  }, [lingering]);

  const holding = waiting || lingering;

  // Nothing in hand and nothing on the way: the page has never waited, or has finished. No wrapper,
  // so a settled page is laid out exactly as it would be without this component in the tree.
  if (!holding) return <>{children}</>;

  return (
    <div className="page-swap">
      {holding && (
        // While waiting it is the placeholder, and wears the delay that decides whether it is drawn
        // at all: a load that finishes inside 150ms should never show one. That class is on this
        // element rather than on the page's <main> because the router unmounts the outgoing page the
        // moment the route commits, so hiding <main> hid everything, title included.
        //
        // On the way out it goes out of flow, not stacked in a grid: a grid container does not
        // collapse margins with its children, which added 20px above the first panel for the length
        // of the fade and then took it away again. That is the shift this exists to remove.
        <div className={waiting ? "page-waiting" : "page-swap-out"} aria-hidden={!waiting}>
          {placeholder}
        </div>
      )}
      {!waiting && <div className="page-swap-in">{children}</div>}
    </div>
  );
}
