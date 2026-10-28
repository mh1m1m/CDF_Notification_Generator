// Vitest setup (unit project): what the Next.js server runtime provides before any app module loads. Next's server
// modules (next/server, next/experimental/testing/server) expect AsyncLocalStorage on globalThis, exactly as
// next/dist/server/node-environment-baseline.js installs it.
import { AsyncLocalStorage } from "node:async_hooks";

const runtime = globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage };
if (typeof runtime.AsyncLocalStorage !== "function") runtime.AsyncLocalStorage = AsyncLocalStorage;
