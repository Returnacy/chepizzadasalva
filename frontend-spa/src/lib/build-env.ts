/**
 * The build-time env bag, behind one function.
 *
 * Vite inlines `import.meta.env` while bundling, so what a brand's Cloudflare
 * Pages project sets is frozen into the JS and cannot be changed afterwards —
 * not at runtime, and not by a test. Reading it through this single
 * indirection is what lets the tests exercise several brands' builds in one
 * run; everything else should ask brand-flags.ts, not this.
 */
export function buildEnv(): Record<string, unknown> {
  return ((import.meta as any).env ?? {}) as Record<string, unknown>;
}
