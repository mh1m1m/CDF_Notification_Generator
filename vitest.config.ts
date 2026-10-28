import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

// Integration suites run against a real PostgreSQL (local clusters or CI service containers) one file at a time:
// they reset cluster-wide roles, so files must never run side by side.
const dbTimeout = Number(process.env.V13_DB_TEST_TIMEOUT_MS) || 60_000;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: root },
      // `server-only` throws outside a React Server Components bundle; tests import server modules directly.
      { find: /^server-only$/, replacement: `${root}tests/support/server-only.ts` },
    ],
  },
  test: {
    // CI also writes JUnit XML into test-results/ (uploaded as a workflow artifact).
    reporters: process.env.CI === "true" ? ["default", "junit"] : ["default"],
    outputFile: { junit: "test-results/vitest-junit.xml" },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // Component tests render with react-dom/server in the node environment (no jsdom).
          include: ["tests/unit/**/*.spec.{ts,tsx}"],
          environment: "node",
          setupFiles: ["tests/support/next-runtime.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.spec.ts"],
          environment: "node",
          setupFiles: ["tests/support/next-runtime.ts"],
          fileParallelism: false,
          testTimeout: dbTimeout,
          hookTimeout: 2 * dbTimeout,
        },
      },
    ],
  },
});
