// instrumentation.ts register(): installs the claims key once in the Node.js runtime, nothing elsewhere. The install
// itself (no-op when unconfigured, never throws) is tested in claims-key-startup.spec.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const { install } = vi.hoisted(() => ({ install: vi.fn(async () => "INSTALLED_OR_PRESENT") }));
vi.mock("@/lib/db/claims-key-startup", () => ({ installClaimsKeyAtStartup: install }));

import { register } from "@/instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
  install.mockClear();
});

describe("instrumentation.ts register()", () => {
  it("installs the claims key once in the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("does nothing in the Edge runtime or outside Next.js", async () => {
    for (const runtime of ["edge", ""]) {
      vi.stubEnv("NEXT_RUNTIME", runtime);
      await register();
    }
    expect(install).not.toHaveBeenCalled();
  });
});
