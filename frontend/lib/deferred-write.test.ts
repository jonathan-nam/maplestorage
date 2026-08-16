import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferredWrite } from "./deferred-write";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a write held back until the pressing stops", () => {
  it("writes once, with the value it ended on", () => {
    // An accelerating hold fires dozens of times. One write, and the figure that was on screen
    // when the finger came off.
    const written: number[] = [];
    const held = deferredWrite((v) => written.push(v), 600);

    held.schedule(1);
    held.schedule(2);
    held.schedule(3);
    vi.advanceTimersByTime(600);

    expect(written).toEqual([3]);
  });

  it("writes nothing until the wait is up", () => {
    const written: number[] = [];
    const held = deferredWrite((v) => written.push(v), 600);

    held.schedule(7);
    vi.advanceTimersByTime(599);

    expect(written).toEqual([]);
  });

  it("FLUSHES what is waiting rather than dropping it", () => {
    // The bug this file exists for. The popup cancelled its pending write when it closed, so
    // editing an item and clicking another one inside the wait discarded the edit in silence: the
    // count went back to what was stored and read as though it had been reset.
    const written: number[] = [];
    const held = deferredWrite((v) => written.push(v), 600);

    held.schedule(42);
    held.flush();

    expect(written).toEqual([42]);
  });

  it("does not write again when the timer would have fired", () => {
    // Flushing takes the value with it, so the timer behind it has nothing left to write.
    const written: number[] = [];
    const held = deferredWrite((v) => written.push(v), 600);

    held.schedule(42);
    held.flush();
    vi.advanceTimersByTime(600);

    expect(written).toEqual([42]);
  });

  it("does nothing when there is nothing waiting", () => {
    // Closing a popup nobody typed in must not write. Every write stamps capturedAt, and one that
    // restated an untouched figure would age-stamp it as freshly answered for.
    const written: number[] = [];
    const held = deferredWrite((v) => written.push(v), 600);

    held.flush();
    held.flush();

    expect(written).toEqual([]);
  });

  it("writes a zero, which is a real answer and not an absence", () => {
    // Nothing may treat 0 as "no value waiting": it is the item you have just spent, and it clears
    // the row on the server.
    const written: number[] = [];
    const held = deferredWrite((v) => written.push(v), 600);

    held.schedule(0);
    held.flush();

    expect(written).toEqual([0]);
  });

  it("says whether anything is waiting", () => {
    const held = deferredWrite(() => {}, 600);

    expect(held.pending()).toBe(false);
    held.schedule(3);
    expect(held.pending()).toBe(true);
    held.flush();
    expect(held.pending()).toBe(false);
  });

  it("does not re-queue a value whose write threw", () => {
    // Read and cleared before writing. Otherwise a failed write leaves the same figure queued and
    // the next flush sends it again, against whatever item the popup has moved on to.
    const held = deferredWrite(() => {
      throw new Error("refused");
    }, 600);

    held.schedule(5);
    expect(() => held.flush()).toThrow();
    expect(held.pending()).toBe(false);
  });

  it("keeps writing after a flush, for the next edit", () => {
    const written: number[] = [];
    const held = deferredWrite((v) => written.push(v), 600);

    held.schedule(1);
    held.flush();
    held.schedule(2);
    vi.advanceTimersByTime(600);

    expect(written).toEqual([1, 2]);
  });
});
