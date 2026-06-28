---
status: accepted
---

# Public /api/* and authenticated /admin/api/* are separate surfaces; drafts never leak to the public API

The API is split by prefix. `/api/*` is public, unauthenticated, and **always** filters to `published: true` — this is hardcoded in the public route handlers and no query parameter can override it, so unpublished content is invisible to anonymous consumers under every circumstance. `/admin/api/*` is authenticated (auth middleware applied once at the prefix, never running for public requests) and returns all content regardless of state, with an optional `?published=` filter. Publish/unpublish is a normal `PATCH` of the `published` field gated by `content:edit` — there is no separate publish endpoint or `content:publish` permission ([core 0004](../core/0004-roles-schema-defined-only.md)).

## Considered Options

- **One surface with auth-dependent filtering** — rejected: a single code path guarding draft visibility by request state is one bug away from leaking unpublished content; a hardcoded `published_only` on a physically separate public router makes the leak structurally impossible.
- **A query param to fetch drafts publicly** — rejected outright: there must be no public mechanism to request drafts.

## Consequences

- Setting `published: true` triggers server-side required-field validation (`PUBLISH_VALIDATION_ERROR`) independently of the admin panel — any client gets the same enforcement; unpublishing skips validation so an editor can always pull content down.
- **Known limitation:** media referenced by unpublished content is still reachable by direct URL (media is served straight from storage, not proxied) — gated media serving is deferred to v2.
