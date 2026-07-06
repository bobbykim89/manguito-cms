---
status: accepted
---

# SVG uploads are not accepted, and user media is served with nosniff

Media the CMS accepts and serves is untrusted. Of the image types, SVG is the one that can execute script when rendered inline — embedded `<script>`, `on*` handlers, `javascript:` URIs, `<foreignObject>` — so an SVG served inline is a stored-XSS vector, worst on the local adapter whose `/uploads` are served **same-origin** with the admin panel.

Making SVG safe requires sanitizing it, which needs a full DOM in Node. We tried DOMPurify with jsdom: it works, but **jsdom is hostile to serverless bundling** — it loads asset files (`browser/default-stylesheet.css`) via runtime paths that break once bundled, and once externalized it was absent from the pruned deploy `node_modules`, so the handler crashed at module load (Lambda `502` on every request, Vercel `500` on the API function). The lighter linkedom backend silently no-ops with DOMPurify (returns the input unsanitized), which is worse. So there is no dependency-light way to sanitize SVG that survives the Fargate/Lambda/Vercel build.

Therefore **SVG is not an accepted upload type**: `image/svg+xml` is removed from the media allowlist, so uploads are rejected with `415`. Separately, served local uploads carry `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` for unknown (`application/octet-stream`) types, so browsers honor the declared type and don't render arbitrary bytes.

## Considered Options

- **Sanitize SVG with DOMPurify + jsdom** — rejected: breaks the deploy build and crashes the serverless functions at init (see above).
- **DOMPurify + linkedom (lighter DOM)** — rejected: bundles cleanly but DOMPurify does not recognize linkedom's DOM and silently returns the input unsanitized — a false sense of safety.
- **Serve SVG as `attachment`** — viable but needs per-adapter serving config (local server + S3 `ContentDisposition` + Cloudinary `fl_attachment`); deferred as a way to re-introduce SVG later if wanted.
- **Keep SVG, serve inline** — rejected: stored XSS.

## Consequences

- Users cannot upload SVG. If it's needed later, re-introduce it via storage-level `Content-Disposition: attachment` (so it downloads instead of rendering) rather than server-side sanitization — and verify on the actual Fargate/Lambda/Vercel deploys, since the storage/serving path differs per adapter.
- The core field-type registry still lists `image/svg+xml` in the default `image` `allowed_mime_types`; this is now inconsistent with the upload gate (harmless — uploads reject it) and is a minor follow-up.
- `nosniff` on S3/Cloudinary-served media is not set by the CMS — those serve from their own domains and need a CloudFront (or equivalent) response-headers policy. Tracked as a pre-release infra follow-up.
- Direct uploads are size-bounded by `max_file_size`; presigned uploads are not yet (see [0004-presigned-first-storage.md](./0004-presigned-first-storage.md) and the pre-release security round).
