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
  },
});
