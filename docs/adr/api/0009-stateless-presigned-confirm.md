---
status: accepted
---

# Presigned upload confirmation is stateless — a signed token, not server-side state

The presigned upload flow is three steps: the client asks for an upload URL, uploads the file directly to storage, then POSTs to `/admin/api/media/confirm/:id` where the server writes the media row. Confirm needs the pending upload's `key` / `folder` / `mime_type` to build that row. Originally these lived in a module-level in-memory `Map` keyed by a random id.

That only works when both requests hit the same process. On serverless they routinely don't: the get-URL request and the confirm request land on **different function instances**, so the confirm instance's Map is empty and returns `410 Gone`. It held on Fargate (one long-running server) and usually on Lambda (warm-instance reuse), but failed on Vercel.

So the pending state is encoded in a short-lived **JWT signed with `AUTH_SECRET`** (`{ key, folder, mime_type, exp }`), handed to the client as `media_id`, and verified at confirm. There is no server-side state, so it works regardless of which instance serves each request, and it is tamper-proof — the client cannot forge the storage key or mime type.

## Considered Options

- **In-memory `Map` (original)** — rejected: doesn't survive across serverless instances; worked only by process/warm-instance luck and broke on Vercel.
- **A DB-backed `pending_uploads` table** — rejected: a migration and a system table for transient (≤1h) state the DB doesn't otherwise need. The token carries the same data with no persistence and no cleanup.
- **A signed token (chosen)** — the token *is* the pending record; verified with the same `AUTH_SECRET` the auth layer already uses.

## Consequences

- The token is tamper-proof but **replayable until it expires**: confirming the same token twice creates a duplicate media row. Both are orphans (`reference_count = 0`) until referenced and are harmless; add a one-time-use check if that ever matters.
- The token's `exp` is set to the presigned URL's expiry, so a stale confirm returns `410` just like an expired upload.
- No server-side state to store or purge — one fewer thing that can drift between instances.
