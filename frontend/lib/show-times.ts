"use client";

// Whether the run order runs to the clock, remembered across visits. Untimed is a whole different
// reading of the page (an order, not a schedule), so someone who plans that way would otherwise
// untick the box on every visit.

import { rememberedFlag } from "./remembered-flag";

export const SHOW_TIMES_KEY = "sharpeyes.run-order.show-times";

const times = rememberedFlag(SHOW_TIMES_KEY);

/** Timed unless it was explicitly turned off, which is what the page did before it remembered. */
export const readShowTimes = times.read;
export const writeShowTimes = times.write;
export const useShowTimes = times.useFlag;
