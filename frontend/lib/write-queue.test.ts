import { describe, expect, it } from "vitest";
import { createWriteQueue } from "./write-queue";

/** A promise the test resolves when it wants to. */
function deferred<T>() {
  let settle!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

describe("a page's writes go one at a time", () => {
  it("does not start the second until the first has finished", async () => {
    const queue = createWriteQueue();
    const first = deferred<void>();
    const order: string[] = [];

    const a = queue.run(async () => {
      order.push("a starts");
      await first.promise;
      order.push("a ends");
    });
    const b = queue.run(async () => {
      order.push("b starts");
    });

    // The point of the queue: b has not touched the server while a is still in flight, which is
    // what stops a's refetch landing after b's with b's change missing from it.
    await Promise.resolve();
    expect(order).toEqual(["a starts"]);

    first.settle();
    await Promise.all([a, b]);
    expect(order).toEqual(["a starts", "a ends", "b starts"]);
  });

  it("keeps the order they were asked for", async () => {
    const queue = createWriteQueue();
    const ran: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((n) =>
        queue.run(async () => {
          ran.push(n);
        }),
      ),
    );
    expect(ran).toEqual([0, 1, 2, 3, 4]);
  });

  it("hands the refusal back to the caller", async () => {
    const queue = createWriteQueue();
    await expect(
      queue.run(async () => {
        throw new Error("the server said no");
      }),
    ).rejects.toThrow("the server said no");
  });

  // A rejected tail used to be the whole queue's tail, so one refusal would have silently dropped
  // every write after it: the row would sit there having taken the click and never saved.
  it("runs the next write after one is refused", async () => {
    const queue = createWriteQueue();
    const refused = queue.run(async () => {
      throw new Error("no");
    });
    const after = queue.run(async () => "saved");

    await expect(refused).rejects.toThrow("no");
    await expect(after).resolves.toBe("saved");
  });

  it("counts what is still outstanding", async () => {
    const queue = createWriteQueue();
    const first = deferred<void>();
    expect(queue.waiting()).toBe(0);

    const a = queue.run(() => first.promise);
    const b = queue.run(async () => {});
    expect(queue.waiting()).toBe(2);

    first.settle();
    await Promise.all([a, b]);
    expect(queue.waiting()).toBe(0);
  });
});
