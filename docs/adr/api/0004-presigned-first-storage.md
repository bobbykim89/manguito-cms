---
status: accepted
---

# Storage is presigned-URL-first; the server never proxies binary in the cloud path

Uploads go directly from the client to the storage backend via a presigned URL — the CMS server issues the signature and writes the metadata row, but never streams the file bytes itself. This keeps the server lightweight and sidesteps the request-size limits of Lambda/Vercel entirely (large video would otherwise blow past them). The `StorageAdapter` interface (defined in core) is therefore `getPresignedUploadUrl` + `getUrl` + `delete`, and every adapter — local, S3, Cloudinary — exposes the **same** three-step client flow (get URL → PUT/POST file → confirm), so the admin panel's upload code is adapter-agnostic. The local adapter, having no external service to sign against, simulates a presigned endpoint on the CMS server itself.

## Considered Options

- **Proxy all uploads through the CMS server** — rejected: caps file size at the deployment target's request limit and puts upload bandwidth on the server's critical path.
- **A different upload flow per adapter** — rejected: the admin panel would need adapter-specific branches; a uniform `PresignedResult` shape (Cloudinary's POST vs S3's PUT is hidden inside the adapter) keeps the client identical.

## Consequences

- `getUrl(key)` is only used during the upload flow to compute the URL stored in the DB; afterwards the DB value is the source of truth and `getUrl` is never called again at runtime.
- Delete is storage-first then DB: if the storage delete fails the DB row is kept, so a media row never points at a missing file; the reverse orphan (file with no row) is swept by `reference_count` orphan tracking.
- The interface retains an optional `upload?()` that the local adapter uses internally for its simulated endpoint — the only place binary touches the server, and only in local dev.
- `/storage` and `/runtime` are separate package entry points so consumers don't bundle cloud SDKs (AWS, Cloudinary) they don't use.
