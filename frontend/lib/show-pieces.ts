"use client";

// Whether the run order says how many pieces to pick up, remembered across visits.
//
// Its own key, not a second meaning for the times one: what to pick up is a fact about the loot and
// the clock is a fact about the night, and planning one way about the first says nothing about the
// second.

import { rememberedFlag } from "./remembered-flag";

export const SHOW_PIECES_KEY = "sharpeyes.run-order.show-pieces";

const pieces = rememberedFlag(SHOW_PIECES_KEY);

/** Shown unless it was explicitly turned off, which is what the page did before the box existed. */
export const readShowPieces = pieces.read;
export const writeShowPieces = pieces.write;
export const useShowPieces = pieces.useFlag;
