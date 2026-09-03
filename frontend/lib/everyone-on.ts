"use client";

// Whether a run has to seat everyone who is on, remembered across visits.
//
// Parties nest: the three of you have a three-person config, and the same bosses again as duos and
// solos. All of those can be staffed on a night the three are on, so the night filled up with the
// smaller versions of runs you were already doing.

import { rememberedFlag } from "./remembered-flag";

export const EVERYONE_ON_KEY = "sharpeyes.run-order.everyone-on";

const everyone = rememberedFlag(EVERYONE_ON_KEY);

/** On unless it was explicitly turned off. */
export const readEveryoneOn = everyone.read;
export const writeEveryoneOn = everyone.write;
export const useEveryoneOn = everyone.useFlag;
