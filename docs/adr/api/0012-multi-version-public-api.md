---
status: accepted
---

# The public API serves every live schema version, with the version in the path

A project's public read API is served once per **live version**: every snapshot under `schemas/versions/` plus the working schema. Content and taxonomy routes carry the version as a path segment (`/api/v1/blog`). The unversioned path (`/api/blog`) resolves to the current version. GraphQL gets one schema per live version at `/graphql/vN`, and `/graphql` serves the current one. Every version reads the same rows; a version differs only in the field names it uses and the fields it exposes, applied once at the response boundary through that version's field-key map ([ADR api/0011](./0011-field-label-vs-storage-key.md)).

**Deprecation is signalled on the version a consumer should leave, never on the one they should be on:**
- An older live version's responses carry `Deprecation: true` and a `Link: <…>; rel="successor-version"` header.
- The unversioned path carries both, plus a `Warning: 299` saying it floats, but only once more than one version is live. A project that has never created a version sees none of this.
- The current version's own path carries no deprecation headers.

**A version outside the live set** answers 410 `VERSION_RETIRED` when its number is below current's, and 404 `VERSION_NOT_FOUND` otherwise. Both use the standard envelope and name the live versions. GraphQL answers the same two conditions with HTTP 200 and a GraphQL error (`VERSION_RETIRED` / `VERSION_UNKNOWN`), because GraphQL clients surface a 4xx as an opaque network error.

**Rate limiting** is not affected by the version. The public list limiter counts requests per client IP and globally, and never looks at the path, so rotating versions cannot multiply a client's budget.

## Considered Options

- **Version in a header (`Accept-Version`) or a query parameter.** Rejected. The version would be invisible in logs, caches and copied URLs, and every cache would need to vary on it. The path makes the version part of the resource's identity.
- **One unversioned `/graphql`, with deprecated fields for anything an older REST version still exposes.** This was the umbrella design's plan. It was rejected in 2e: one schema cannot serve two names for one field without exposing both to every client, and a pinned GraphQL consumer then has nothing to pin to.
- **Per-version write paths.** Rejected. The admin API always follows the current schema, so retained columns go stale for rows written after a removal. Fallbacks make that explicit. A live version is a supported contract, not a permanently faithful one.

## Consequences

- Media routes and the OpenAPI document are not versioned. `MediaItem` is a fixed shape, so a version segment would duplicate identical routes. The OpenAPI document lists only the unversioned paths of the working schema's types, plus media, so it does not describe an older version's contract.
- Programmatic resolvers read the record in the **current** field names on every version and both APIs. Only their computed values are merged into a version's response ([column-as-identity design](../../superpowers/specs/2026-10-01-column-as-identity-design.md)).
- The live set is derived from snapshot directories at build time and baked into the server, so nothing about versions is stored at runtime.
- User guide: [`docs/schema-versioning.md`](../../schema-versioning.md).
