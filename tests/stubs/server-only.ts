// Vitest stub for the `server-only` package. That package unconditionally
// throws when imported outside Next.js's own webpack/turbopack build (it
// normally relies on a bundler alias to become a no-op in server bundles)
// — including when route handlers that transitively import it are called
// directly in tests, as ours are. Aliased in vitest.config.mts.
export {};
