"use client";

import { useRef, useState } from "react";
import { createWriteQueue, type WriteQueue } from "./write-queue";

/**
 * A page's row writes: which rows are mid-save, and one write at a time.
 *
 * The list pages here used to hold a single page-wide `busy` boolean and feed it to every row's
 * `disabled`, so ticking one boss dimmed every control on the page and put it back a moment later:
 * a one-row edit read as the whole page flickering. The boolean was also the only thing stopping two
 * writes overlapping, which matters because each one refetches the list, so it could not just be
 * narrowed. The ordering moved into the queue instead. See lib/write-queue.ts.
 *
 * `key` is whatever names the row, usually its id. A control that is about the page rather than a
 * row takes a key of its own, since it is one more thing that can be mid-save.
 */
export function useRowWrites() {
  const queue = useRef<WriteQueue | null>(null);
  queue.current ??= createWriteQueue();
  // A list, not a set: the same row can be queued twice, and the first to finish must not clear the
  // second's mark.
  const [saving, setSaving] = useState<readonly string[]>([]);

  /**
   * Runs one row's write, marked as that row's until it settles.
   *
   * Rejections are the caller's. A row shows the server's refusal, and swallowing it here would
   * leave the row claiming a save that never happened.
   */
  async function write<T>(key: string, job: () => Promise<T>): Promise<T> {
    setSaving((current) => [...current, key]);
    try {
      return await queue.current!.run(job);
    } finally {
      setSaving((current) => {
        const at = current.indexOf(key);
        return at < 0 ? current : [...current.slice(0, at), ...current.slice(at + 1)];
      });
    }
  }

  return {
    /** What a row's own controls are disabled by. */
    isSaving: (key: string) => saving.includes(key),
    /** Whether any write is in flight at all. For what is about the page, not a row. */
    busy: saving.length > 0,
    write,
  };
}
