// Build identity reported by the health endpoints. Never secret: the commit SHA of the deployment, or "local".
export const APP_ID = "v13-enterprise";

const COMMIT_SHA = /^[0-9a-f]{7,40}$/;

/** VERCEL_GIT_COMMIT_SHA when it looks like a git SHA, otherwise "local". */
export function commitSha(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  return sha && COMMIT_SHA.test(sha) ? sha : "local";
}
