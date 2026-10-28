// @ts-check
// SCRAM-SHA-256 password verifiers (RFC 7677 / PostgreSQL's stored format), computed on the client so a plain-text
// password never travels to the server or into its logs. Used for LOCAL and CI test clusters only.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

/** Printable ASCII, 16–128 characters: SASLprep leaves it unchanged, so client and server derive the same keys. */
export const TEST_PASSWORD_PATTERN = /^[\x21-\x7e]{16,128}$/;

/**
 * `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>` for ALTER ROLE … PASSWORD '<verifier>'.
 * The result contains only base64 characters, digits, `$` and `:`, so it is safe inside a SQL string literal.
 * @param {string} password
 * @param {number} [iterations]
 */
export function scramVerifier(password, iterations = 4096) {
  if (!TEST_PASSWORD_PATTERN.test(password)) {
    throw new Error("test passwords are 16–128 printable ASCII characters without spaces");
  }
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** A random password for a throw-away test role (never printed). */
export function randomTestPassword() {
  return randomBytes(24).toString("base64url");
}
