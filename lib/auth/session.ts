// Signed persona session (HS256 JWT in an HttpOnly cookie).
//
// Edge-safe core: jose + zod only, no Node.js built-ins, no Next.js request APIs and no database, so proxy.ts can
// verify the cookie. Server Components and Server Actions use the wrappers in ./server-session.ts.
//
// Fail closed everywhere:
// - V13_SESSION_SECRET must be base64url text that decodes to at least 32 bytes; otherwise no session can be
//   created and every token verifies as invalid.
// - V13_PERSONA_SIGNIN must be exactly "enabled"; otherwise persona sign-in is refused and existing persona
//   sessions stop verifying (they are the only kind of session in the prototype).
//
// PRODUCTION_SUBSTITUTION_REQUIRED: persona sign-in is a prototype substitute. Production authenticates through the
// CDF corporate identity provider (OIDC); session keys come from KMS/HSM, not an environment variable.
import { base64url, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import {
  findPersona,
  PersonaIdSchema,
  rolesIn,
  signInWorkspace,
  WorkspaceCodeSchema,
  type Persona,
  type RequestIdentity,
} from "@/lib/contracts";

export const SESSION_COOKIE_NAME = "__Host-v13_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const MIN_SESSION_SECRET_BYTES = 32;

const ALGORITHM = "HS256";
/** Tolerated clock difference for `iat` in the future (seconds). */
const MAX_CLOCK_SKEW_SECONDS = 60;
/** A session cookie is far smaller than this; anything longer is rejected before any parsing. */
const MAX_TOKEN_LENGTH = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** `__Host-` prefix: Secure, Path=/, no Domain. SameSite=Lax keeps top-level navigations signed in. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;

type Env = Readonly<Record<string, string | undefined>>;

export class SessionConfigError extends Error {
  override readonly name = "SessionConfigError";
  readonly code = "SESSION_NOT_CONFIGURED";
}

export class PersonaSignInError extends Error {
  override readonly name = "PersonaSignInError";
  constructor(readonly code: "PERSONA_SIGNIN_DISABLED" | "UNKNOWN_PERSONA") {
    super(code);
  }
}

export interface SessionOptions {
  /** Environment to read V13_SESSION_SECRET / V13_PERSONA_SIGNIN from (default process.env). */
  env?: Env;
  /** Current time (tests). */
  now?: Date;
}

/** Decodes V13_SESSION_SECRET. Throws SessionConfigError (never echoing the value) when it is unusable. */
export function sessionKey(env: Env = process.env): Uint8Array {
  const raw = env.V13_SESSION_SECRET;
  if (!raw || !BASE64URL.test(raw)) {
    throw new SessionConfigError("V13_SESSION_SECRET must be set to base64url text");
  }
  let key: Uint8Array;
  try {
    key = base64url.decode(raw);
  } catch {
    throw new SessionConfigError("V13_SESSION_SECRET is not valid base64url");
  }
  if (key.byteLength < MIN_SESSION_SECRET_BYTES) {
    throw new SessionConfigError(
      `V13_SESSION_SECRET must decode to at least ${MIN_SESSION_SECRET_BYTES} bytes`,
    );
  }
  return key;
}

export function isSessionConfigured(env: Env = process.env): boolean {
  try {
    sessionKey(env);
    return true;
  } catch {
    return false;
  }
}

export function isPersonaSignInEnabled(env: Env = process.env): boolean {
  return env.V13_PERSONA_SIGNIN === "enabled";
}

export type PersonaSignInStatus = "enabled" | "disabled" | "misconfigured";

/** What the sign-in page shows: persona buttons, the "disabled" notice, or the "misconfigured" notice. */
export function personaSignInStatus(env: Env = process.env): PersonaSignInStatus {
  if (!isPersonaSignInEnabled(env)) return "disabled";
  return isSessionConfigured(env) ? "enabled" : "misconfigured";
}

const SessionSubjectSchema = z.strictObject({
  persona_id: PersonaIdSchema,
  active_workspace: WorkspaceCodeSchema,
});

const SessionClaimsSchema = SessionSubjectSchema.extend({
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});
export type SessionClaims = z.infer<typeof SessionClaimsSchema>;

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/**
 * Signs a new session for the subject at sign-in. Payload: {persona_id, active_workspace, iat, exp}; lifetime
 * 8 hours. Only sign-in starts a lifetime: a workspace switch uses reissueSessionToken, which keeps the current exp
 * (ARCH ruling on SEC's review of #10, 28 Oct 2026).
 */
export async function createSessionToken(
  subject: { persona_id: string; active_workspace: string },
  options: SessionOptions = {},
): Promise<string> {
  const key = sessionKey(options.env);
  const { persona_id, active_workspace } = SessionSubjectSchema.parse(subject);
  const iat = seconds(options.now ?? new Date());
  return new SignJWT({ persona_id, active_workspace })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_MAX_AGE_SECONDS)
    .sign(key);
}

export class SessionReissueError extends Error {
  override readonly name = "SessionReissueError";
  constructor(readonly code: "SESSION_EXPIRED" | "SESSION_LIFETIME_INVALID") {
    super(code);
  }
}

/**
 * Re-issues the current session for another active workspace (Scenario C). Keeps persona_id and exp from the
 * verified claims, so a switch never extends the session; iat is now. Returns the token and the cookie Max-Age, which
 * equals the remaining lifetime, so the cookie never outlives the token. Membership is not checked here: the caller
 * checks it before (lib/authz) and sessionFromClaims and the database check it again on every request.
 * Throws SessionReissueError (code only) when the session has expired or its lifetime is out of bounds.
 */
export async function reissueSessionToken(
  current: SessionClaims,
  active_workspace: string,
  options: SessionOptions = {},
): Promise<{ token: string; maxAge: number }> {
  const key = sessionKey(options.env);
  const workspace = WorkspaceCodeSchema.parse(active_workspace);
  const persona_id = PersonaIdSchema.parse(current.persona_id);
  const iat = seconds(options.now ?? new Date());
  const maxAge = current.exp - iat;
  if (maxAge < 1) throw new SessionReissueError("SESSION_EXPIRED");
  if (maxAge > SESSION_MAX_AGE_SECONDS) throw new SessionReissueError("SESSION_LIFETIME_INVALID");
  const token = await new SignJWT({ persona_id, active_workspace: workspace })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setIssuedAt(iat)
    .setExpirationTime(current.exp)
    .sign(key);
  return { token, maxAge };
}

/** Returns the verified claims, or null on any failure (missing, malformed, tampered, expired, misconfigured). */
export async function verifySessionToken(
  token: string | null | undefined,
  options: SessionOptions = {},
): Promise<SessionClaims | null> {
  const env = options.env ?? process.env;
  if (!token || token.length > MAX_TOKEN_LENGTH || !isPersonaSignInEnabled(env)) return null;
  try {
    const now = options.now ?? new Date();
    const { payload } = await jwtVerify(token, sessionKey(env), {
      algorithms: [ALGORITHM],
      typ: "JWT",
      currentDate: now,
      requiredClaims: ["iat", "exp"],
      maxTokenAge: SESSION_MAX_AGE_SECONDS,
    });
    const claims = SessionClaimsSchema.safeParse(payload);
    if (!claims.success) return null;
    const { iat, exp } = claims.data;
    if (exp - iat > SESSION_MAX_AGE_SECONDS || iat > seconds(now) + MAX_CLOCK_SKEW_SECONDS) return null;
    return claims.data;
  } catch {
    return null;
  }
}

export interface Session {
  readonly persona: Persona;
  readonly identity: RequestIdentity;
  readonly claims: SessionClaims;
}

/**
 * Maps verified claims to the persona registry. The active workspace must be one the persona holds a membership in;
 * the identity carries the persona's roles in that workspace. Unknown persona or workspace → null.
 */
export function sessionFromClaims(claims: SessionClaims): Session | null {
  const persona = findPersona(claims.persona_id);
  if (!persona) return null;
  const roles = rolesIn(persona, claims.active_workspace);
  if (roles.length === 0) return null;
  return {
    persona,
    claims,
    identity: { persona_id: persona.persona_id, active_workspace: claims.active_workspace, roles },
  };
}

/**
 * Persona sign-in: refuses unless V13_PERSONA_SIGNIN is "enabled" and the id is a synthetic persona offered on the
 * sign-in page (negative-test personas are refused the same way as unknown ids). The session starts in the
 * persona's first membership workspace. `personaId` is untrusted form input.
 */
export async function issuePersonaSession(
  personaId: unknown,
  options: SessionOptions = {},
): Promise<{ token: string; persona: Persona }> {
  if (!isPersonaSignInEnabled(options.env ?? process.env))
    throw new PersonaSignInError("PERSONA_SIGNIN_DISABLED");
  const persona = findPersona(personaId);
  if (!persona || persona.negative_test) throw new PersonaSignInError("UNKNOWN_PERSONA");
  const token = await createSessionToken(
    { persona_id: persona.persona_id, active_workspace: signInWorkspace(persona) },
    options,
  );
  return { token, persona };
}

// ---- Cookie helpers ------------------------------------------------------------------------------------------

/** The part of a cookie store needed to read the session (`await cookies()`, `NextRequest.cookies`). */
export interface SessionCookieReader {
  get(name: string): { value: string } | undefined;
}

/** Cookie attributes as written: SESSION_COOKIE_OPTIONS with a Max-Age of 0 (expire) up to the session lifetime. */
export type SessionCookieAttributes = Omit<typeof SESSION_COOKIE_OPTIONS, "maxAge"> & { maxAge: number };

/** The part of a cookie store needed to write the session (`await cookies()` in actions, `NextResponse.cookies`). */
export interface SessionCookieWriter {
  set(name: string, value: string, options: SessionCookieAttributes): unknown;
}

export async function readSession(
  store: SessionCookieReader,
  options: SessionOptions = {},
): Promise<Session | null> {
  const claims = await verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value, options);
  return claims ? sessionFromClaims(claims) : null;
}

/**
 * Writes the session cookie. `maxAge` (seconds, integer 1..SESSION_MAX_AGE_SECONDS) is the token's remaining
 * lifetime after a re-issue; it defaults to the full lifetime of a new sign-in session.
 */
export function writeSessionCookie(
  store: SessionCookieWriter,
  token: string,
  maxAge: number = SESSION_MAX_AGE_SECONDS,
): void {
  if (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > SESSION_MAX_AGE_SECONDS) {
    throw new SessionReissueError("SESSION_LIFETIME_INVALID");
  }
  store.set(SESSION_COOKIE_NAME, token, { ...SESSION_COOKIE_OPTIONS, maxAge });
}

/** Expires the cookie with the same attributes it was set with (required for `__Host-` cookies). */
export function expireSessionCookie(store: SessionCookieWriter): void {
  store.set(SESSION_COOKIE_NAME, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
}
