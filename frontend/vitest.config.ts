import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the pure logic, not the components. There is no jsdom and no React here on
// purpose: the things worth guarding in this app are the ones that quietly return a wrong NUMBER,
// and none of them need a DOM to be wrong.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    /*
     * A red suite that means nothing is worse than a slow one.
     *
     * This suite reported "Test timed out in 5000ms" against a synchronous one-line test that does
     * no work, and it did it often enough to be written down as something to re-run rather than
     * believe. Which is the state a suite must never be in: the next real failure gets re-run too.
     *
     * It is contention, not any test. A test timeout is WALL CLOCK on a worker, so it measures how
     * long that worker went unscheduled, and this box runs the suite beside docker, a dev server
     * and whatever else wants the CPU. Measured: 32 spinners against 16 cores, three full runs,
     * two timeouts, both in tests doing nothing; the same three runs idle, none. Every test here is
     * pure, so nothing else could be flaky.
     *
     * A longer timeout alone did not do it (it still tripped at 30s), so the retry is what closes
     * it: four full runs under the same load, all green. A retry cannot hide a real failure, since
     * a real one fails all three attempts, and it cannot hide flaky product code either, because
     * there is none here to hide. Both together, because the retry should be rare.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    retry: 2,
  },
});
