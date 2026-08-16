// A count being edited, held over the stored one until the server catches up.
//
// This exists because of a flicker, and the flicker was a real disagreement on screen. The local
// figure was dropped the moment the write SUCCEEDED, which is before the re-pull carrying it has
// landed, so for one round trip the slot fell back to the stored number and showed the OLD count:
// new, then old, then new again.
//
// So it is keyed on the CHARACTER and nothing else. It survives the refresh it triggered, and stops
// mattering on its own once the stored figure agrees with it, because both then give the same
// answer. What clears it is picking a different character, or a write coming back refused.
//
// Its own file for the same reason as lib/deferred-write.ts: this rule lives in a component, where
// no test in this repo can reach it, and getting it wrong is invisible to the compiler.

export type PendingCounts = {
  /** Whose figures these are. Another character's are not ours to show. */
  character: string;
  /** By item, the figure being edited. */
  values: Record<string, number>;
};

export function noPending(character: string): PendingCounts {
  return { character, values: {} };
}

/**
 * The figures pending for this character, or none.
 *
 * None when the state belongs to somebody else, which is what makes switching character clear
 * them: one inventory wearing another's numbers is the wrong-count failure in its plainest form.
 */
export function pendingFor(state: PendingCounts, character: string): Record<string, number> {
  return state.character === character ? state.values : {};
}

/** Records a figure being edited, dropping anything held for another character. */
export function withPending(
  state: PendingCounts,
  character: string,
  item: string,
  value: number,
): PendingCounts {
  return { character, values: { ...pendingFor(state, character), [item]: value } };
}

/**
 * Forgets one, for a write that came back refused.
 *
 * The figure on screen would otherwise be a claim the server has not accepted, sitting there
 * looking saved.
 */
export function withoutPending(state: PendingCounts, item: string): PendingCounts {
  const { [item]: _refused, ...rest } = state.values;
  return { character: state.character, values: rest };
}

/**
 * What to draw: the figure being edited, else the stored one.
 *
 * Zero is a pending figure like any other, so this cannot test truthiness: an item stepped down to
 * none would otherwise show the count it had before.
 */
export function shownCount(stored: number, pending: number | undefined): number {
  return pending === undefined ? stored : pending;
}
