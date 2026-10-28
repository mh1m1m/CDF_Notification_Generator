// The one synthetic claims key every integration suite uses (ADR-014). Derived exactly as the app derives it, from a
// synthetic, test-only V13_SESSION_SECRET: 32 bytes of 0x5a, base64url. Not a secret; never used outside tests.
// All suites share it because the database accepts one key until database/hosted/reset_claims_key.sql clears it
// (pnpm db:reset rebuilds the database without a key).
import { requestClaimsKey } from "@/lib/auth/claims-key";

export const TEST_SESSION_SECRET = Buffer.alloc(32, 0x5a).toString("base64url");
export const TEST_CLAIMS_KEY = requestClaimsKey({ V13_SESSION_SECRET: TEST_SESSION_SECRET });
