---
status: accepted
---

# Uploaded SVGs are sanitized server-side, and user media is served with nosniff

Media the CMS accepts and serves is untrusted. Of the allowlisted types, SVG is the one that can execute script when rendered inline — embedded `<script>`, `on*` handlers, `javascript:` URIs, `<foreignObject>` — so an unsanitized SVG is a stored-XSS vector. It is worst on the local storage adapter, whose `/uploads` are served **same-origin** with the admin panel (an SVG there runs in the CMS origin). Uploads are hardened in two places:

1. **Sanitize on the way in.** The direct upload path (`POST /admin/api/media/{image,video,file}`) runs SVG bytes through DOMPurify's SVG profile before handing them to storage. The presigned path uploads straight to storage and the server never sees the bytes, so it **cannot** sanitize — it rejects `image/svg+xml` (`415`) and steers clients to the direct endpoint.
2. **Neutralize on the way out.** The server-controlled local `/uploads` handler (both the generated production server and the dev server) sends `X-Content-Type-Options: nosniff` so browsers honor the declared type instead of sniffing, and `Content-Disposition: attachment` for unknown (`application/octet-stream`) types so they download rather than render. Known media types stay inline for the admin preview.

## Considered Options

- **Drop SVG from the allowlist** — rejected: SVG is a legitimate, widely-wanted format; disallowing it is a usability regression and does not address the general "client-declared MIME" issue.
- **Hand-rolled / allowlist sanitizer** — rejected: SVG sanitization has a long history of bypasses (mutation XSS, namespace confusion). A maintained sanitizer (DOMPurify) is the safer choice, even at the cost of the `jsdom` dependency.
- **Serve all media as `attachment`** — rejected: the media library needs inline previews; forcing downloads is poor UX. `attachment` is used only for unknown types.

## Consequences

- The api package depends on `dompurify` + `jsdom` (heavy). Watch the serverless bundle in Phase 10 (Lambda cold start); if it hurts, revisit (lighter sanitizer, or sanitize in a separate build target).
- **SVG cannot be uploaded via presigned URLs** — clients must use the direct endpoint. This is the one upload asymmetry between the two paths.
- `nosniff` on S3/Cloudinary-served media is **not** set by the CMS — those are served from their own domains and need a CloudFront (or equivalent) response-headers policy. Tracked as a pre-release infra follow-up.
- Direct uploads are size-bounded by `max_file_size`; presigned uploads are not yet (see [0004-presigned-first-storage.md](./0004-presigned-first-storage.md) and the pre-release security round).
