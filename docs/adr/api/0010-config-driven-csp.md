---
status: accepted
---

# The Content-Security-Policy is built from the storage adapter's upload origin

The security-headers middleware sets a strict CSP (`default-src 'self'`,
`script-src 'self'`, no `'unsafe-inline'` for scripts). Presigned uploads,
however, go directly from the browser to the storage backend
([ADR api/0004](./0004-presigned-first-storage.md)), whose origin is
per-deployment configuration — S3 `https://<bucket>.s3.<region>.amazonaws.com`,
Cloudinary `https://api.cloudinary.com`. A hardcoded CSP therefore blocked the
upload `connect-src`. The storage adapter exposes `getUploadOrigins()`, and
`createCmsApp` threads it into `createSecurityHeadersMiddleware({ connectSrc })`,
so `connect-src` is exactly `'self'` plus the configured storage host — no
wildcard. The admin SPA self-hosts its fonts (bundled, same-origin) so no
external font origin is allowlisted, and the Vite module-preload polyfill is
disabled so `script-src 'self'` needs no inline exception.

## The GraphiQL exception (v2)

The one documented carve-out. Yoga's GraphiQL explorer loads its UI bundle and
stylesheet from `https://unpkg.com`, boots via inline `<script>` tags, `fetch`es
three Monaco editor workers from that same CDN, and runs them from `blob:` URLs.
Under the strict policy every one of those is blocked and the page renders as the
un-substituted `Loading __TITLE__...` shell.

`createSecurityHeadersMiddleware` therefore takes an optional `graphiqlPath`.
`createCmsApp` sets it **only** when GraphQL is enabled *and* `graphiql` is on —
which is `NODE_ENV !== 'production'` by default, so production is unaffected
unless an operator explicitly opts in. Requests whose path matches exactly get
`'unsafe-inline'` + the CDN origin on `script-src`/`style-src`, the CDN added to
`connect-src`, and `worker-src 'self' blob:`. Every other path — the admin SPA,
the REST API, and GraphQL `POST` queries — keeps the strict policy verbatim.

The relaxation is deliberately *path-scoped rather than global*: it is the
narrowest change that makes the explorer work, and it disappears entirely when
GraphiQL is off.

## Considered Options

- **Relax `script-src` to `'unsafe-inline'` / add a broad `connect-src *`** —
  rejected: guts the XSS/exfiltration protection the middleware exists for. (The
  GraphiQL carve-out above is scoped to one path behind a dev-only flag, not a
  global relaxation.)
- **Self-host the GraphiQL assets so `'self'` suffices** — rejected for now:
  ships a ~1 MB bundle inside the api package and the inline bootstrap would
  still need a nonce or hash, so it does not actually avoid a CSP change.
- **Hash the GraphiQL inline scripts instead of `'unsafe-inline'`** — rejected:
  the hashes change with every Yoga release, making the policy silently brittle
  across dependency bumps.
- **Nonce the inline script** — rejected for now: the admin HTML is served as a
  static file, so per-response nonce injection means rewriting the HTML on every
  request; disabling the polyfill is simpler and safe for modern targets.
- **Allowlist the external Google Fonts origins** — rejected in favor of
  self-hosting, which removes the third-party origin entirely.

## Consequences

- Adding a storage adapter means implementing `getUploadOrigins()` (optional; a
  same-origin/local adapter omits it). Cloudinary serves from
  `res.cloudinary.com`, already permitted by `img-src https:`.
- A custom S3 endpoint (path-style, transfer acceleration, or a non-AWS S3) is
  not covered by the default virtual-hosted origin and would need the adapter to
  return the matching host — tracked as a follow-up if such config is added. A
  dotted bucket name likewise forces path-style presigning and would not match
  the virtual-hosted origin (consistent with the same assumption in `getUrl`).
- `connect-src` assumes the admin SPA and API are served **same-origin** (true
  for the bundled Node/Lambda/Vercel deploys). A split-origin setup (admin on a
  separate CDN, API elsewhere) would need the admin's API origin added to
  `connect-src` — not supported today.
- `font-src` allows `'self' data:`: the admin self-hosts fonts via `@fontsource`,
  and Vite inlines the small per-subset `.woff2` files under `assetsInlineLimit`
  as `data:` URIs in the built CSS. `data:` is permitted only for fonts (never
  `script-src`/`object-src`), which carries no script-execution risk.
