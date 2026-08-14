"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

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

// The overlap. Must match .page-swap-in in globals.css: the placeholder is unmounted from here, so
// a shorter timer cuts the fade off part-way through it. Pinned by section-menu-css.test.ts.
export const CROSSFADE_MS = 280;

export function PageSwap({
  waiting,
  placeholder,
  children,
  shaped = false,
}: {
  waiting: boolean;
  /** What stands in while the page waits, and fades out over what arrives. */
  placeholder: ReactNode;
  children: ReactNode;
  /**
   * The placeholder is the page's own shape, not a line of text, so it is drawn from the frame the
   * route commits instead of waiting out the delay. See PAGE_WAITING_SHAPED in route-loading.tsx.
   */
  shaped?: boolean;
}) {
  const [lingering, setLingering] = useState(false);
  const [wasWaiting, setWasWaiting] = useState(waiting);
  const leaving = useRef<HTMLDivElement>(null);

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

  /*
   * The fade OUT is script's, because only script can read where the fade IN got to.
   *
   * A CSS animation cannot: it restarts from the base opacity, which is 1. Measured in Chromium
   * against the real rules, a wait ending at 60ms took the placeholder from 0.00 to 1.00 in one
   * frame, and one ending at 200ms from 0.59 to 1.00. The first is the whole flicker on Drop Log:
   * inside the 150ms delay nothing has been drawn, and the way out drew all of it anyway. It was
   * only ever noticed there because every other page stands a line of text in the gap and that
   * page stands a full-height skeleton.
   *
   * .page-waiting stays on the element, so this reads the opacity actually on screen and the fade
   * in carries on undisturbed until this takes over.
   */
  useEffect(() => {
    const el = leaving.current;
    if (!lingering || !el || typeof el.animate !== "function") return;
    const fade = el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], {
      duration: CROSSFADE_MS,
      easing: "ease-out",
      // Or the placeholder snaps back to what the fade in left it at, for any frame between this
      // ending and the timer above unmounting it.
      fill: "forwards",
    });
    return () => fade.cancel();
  }, [lingering]);

  const holding = waiting || lingering;
  const wait = shaped ? "page-waiting-shaped" : "page-waiting";

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
        // of the fade and then took it away again. That is the shift this exists to remove. It keeps
        // .page-waiting through that, so the delay is not undone on the way out: see the fade above.
        <div
          ref={leaving}
          className={waiting ? wait : `${wait} page-swap-out`}
          aria-hidden={!waiting}
        >
          {placeholder}
        </div>
      )}
      {!waiting && <div className="page-swap-in">{children}</div>}
    </div>
  );
}
