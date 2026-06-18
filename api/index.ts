// Vercel's "Other" framework convention requires functions to live under
// api/ — the generated dist/vercel.js (built by `manguito build`) isn't in
// a location Vercel's zero-config detection looks at, so this thin wrapper
// re-exports it from where Vercel expects to find a function.
//
// Uses a dynamic import rather than `export ... from` — the repo root
// package.json has no "type": "module", so Vercel's bundler compiles this
// file as CommonJS, and a static re-export would become a require() call.
// dist/vercel.js is genuine ESM (apps/sandbox has "type": "module"), and
// require()-ing an ESM file throws ERR_REQUIRE_ESM. A dynamic import()
// works from a CommonJS module regardless of the target's module format.
// A bare default-exported function is ambiguous with Vercel's legacy
// `(req, res) => void` Node signature — it gets interpreted that way,
// silently ignoring the returned Response and hanging until timeout.
// `{ fetch(request) }` is required to select the unambiguous Web-standard
// signature. See https://vercel.com/docs/functions/functions-api-reference#fetch-web-standard
export default {
  async fetch(request: Request): Promise<Response> {
    const mod = await import('../apps/sandbox/dist/vercel.js')
    return mod.default(request)
  },
}
