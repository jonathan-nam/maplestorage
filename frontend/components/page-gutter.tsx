"use client";

import type { ReactNode } from "react";

/**
 * Standing figures, in the empty column beside the page.
 *
 * The page is a fixed 794px measure centred in the window, so on a wide screen there is a gutter
 * either side of it doing nothing. What goes here is read at a glance and never interacted with,
 * which is what earns it a place outside the reading column: it costs the page no height, and the
 * matrix begins where the controls end.
 *
 * Below --gutter-min the gutter is not wide enough to hold this, so the stylesheet drops the
 * fixed positioning and it lands back in the flow where it was written. Nothing is hidden at any
 * width; it only moves.
 */
export function PageGutter({ children }: { children: ReactNode }) {
  return <aside className="page-gutter">{children}</aside>;
}
