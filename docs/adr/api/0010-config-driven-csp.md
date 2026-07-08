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

## Considered Options

- **Relax `script-src` to `'unsafe-inline'` / add a broad `connect-src *`** —
  rejected: guts the XSS/exfiltration protection the middleware exists for.
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
