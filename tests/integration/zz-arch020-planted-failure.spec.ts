// THROWAWAY PROOF (V13-ARCH-020, never merged): a test planted to fail. The integration job's test step swallows the
// exit code, so the step ends green while the run's own report records this failure. SYNTHETIC; no database.
import { expect, it } from "vitest";

it("is a planted failure the required run proof must report (V13-ARCH-020 throwaway)", () => {
  expect(1 + 1).toBe(3);
});
