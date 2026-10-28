// Test stand-in for the `server-only` package (aliased in vitest.config.ts). The real package makes a client
// bundle fail at build time; under Vitest the modules under test are server modules, so the marker is a no-op.
export {};
