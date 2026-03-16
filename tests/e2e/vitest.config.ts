import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    passWithNoTests: true,
    include: ["**/*.test.ts"],
    // E2E tests share mutable remote host state (shuvtest, shuvbot).
    // They MUST run sequentially to avoid cross-test interference.
    fileParallelism: false,
  },
});
