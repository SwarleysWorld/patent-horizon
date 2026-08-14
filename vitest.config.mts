import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    testTimeout: 15_000,
    // All test files share one real Postgres database (tests/helpers.ts
    // truncates + reseeds it in beforeEach) — running files in parallel
    // would let one file's reset race another file's in-progress seed.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // See tests/stubs/server-only.ts.
      "server-only": path.resolve(import.meta.dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
