/**
 * Runs writes one at a time, in the order they were asked for.
 *
 * Every list page here refetches after a write, so two overlapping writes can have their refetches
 * land out of order and leave the screen showing a state the server disagrees with. That used to be
 * prevented by disabling every control on the page while one write was in flight, which meant a
 * one-row edit dimmed the whole list. Queueing keeps the ordering and costs no pixels: the click is
 * taken, it just waits its turn.
 */
export type WriteQueue = {
  /** Runs `job` after everything already queued. Settles exactly as `job` does. */
  run: <T>(job: () => Promise<T>) => Promise<T>;
  /** How many jobs are queued or running. Zero once the last one has settled. */
  waiting: () => number;
};

export function createWriteQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let waiting = 0;

  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      waiting += 1;
      // Both arms run `job`, so one refusal does not strand every write queued behind it.
      const started = tail.then(job, job);
      const settled = () => {
        waiting -= 1;
      };
      tail = started.then(settled, settled);
      return started;
    },
    waiting: () => waiting,
  };
}
