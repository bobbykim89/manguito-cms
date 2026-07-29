---
"@bobbykim/manguito-cms-api": patch
---

Fix unpublished content being reachable through relations on the public API. A published item that referenced a draft exposed that draft's full record when the relation was expanded — via `?include=` on the public REST routes, and at any depth of a GraphQL nested selection. The published-only guarantee held for the items a request asked for directly, but not for the relation targets it reached through them.

Relation resolution now takes an opt-in `publishedOnly` flag, and every public caller passes it: `reference` and `junction` target lookups add `AND published = true`, so a draft target resolves to `null` for a single reference and is omitted from a multi-value relation. The filtering happens in the shared resolver, so both public surfaces inherit it rather than each re-implementing the check.

This is a behavior change for the public REST API: responses that previously embedded a draft through `?include=` now return `null` or omit it from the list. Admin API reads are unaffected and continue to resolve relations without the filter, so editors still see drafts in the admin panel.
