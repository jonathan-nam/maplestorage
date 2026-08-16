// A write held back until the pressing stops, and never lost.
//
// This exists because losing one was the bug. The count popup debounced its write and CANCELLED it
// on unmount, so editing an item and then clicking another one inside the wait discarded the edit
// silently: the number went back to what was stored and looked like it had been reset. What was
// wanted is the opposite, and it is the whole rule here: closing is not cancelling.
//
// Its own file, and testable, because a timer inside a component is not reachable by any test in
// this repo. The bug was invisible to the compiler, to eslint and to every test, and only showed up
// as a count that quietly went back.

export type DeferredWrite = {
  /** Hold this value, replacing anything already waiting. */
  schedule: (value: number) => void;
  /** Write whatever is waiting, now. Does nothing when nothing is. */
  flush: () => void;
  /** Whether a value is waiting to be written. */
  pending: () => boolean;
};

/**
 * Holds the LAST value scheduled, and writes it once the caller stops.
 *
 * The last one, not each of them, which is what makes an accelerating hold one write rather than
 * forty. It is safe because the value written is a TOTAL rather than a step, so a value that never
 * gets its own write is not a lost increment, it is a figure that was replaced before anybody saw
 * it.
 */
export function deferredWrite(write: (value: number) => void, delayMs: number): DeferredWrite {
  let waiting: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // Read and clear BEFORE writing: a write that throws must not leave the same value queued to
    // be written again by the next flush.
    const value = waiting;
    waiting = null;
    if (value !== null) write(value);
  }

  return {
    schedule(value: number) {
      waiting = value;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
    pending: () => waiting !== null,
  };
}
