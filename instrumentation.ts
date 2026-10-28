// Next.js server start hook (instrumentation.ts). Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
//
// Node.js runtime only: installs the request-claims key before the server takes traffic (ADR-014 §4), so the claims
// MAC wiring in lib/db/security-context.ts and the key in the database are always present together. The work and
// its rules (no-op when unconfigured, never throws, one code-only log line) live in lib/db/claims-key-startup.ts.
// The import is dynamic so the Edge bundle never includes the database driver.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installClaimsKeyAtStartup } = await import("./lib/db/claims-key-startup");
  await installClaimsKeyAtStartup();
}
