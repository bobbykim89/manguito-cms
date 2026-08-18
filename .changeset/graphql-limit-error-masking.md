---
"@bobbykim/manguito-cms-api": patch
---

Fix query-limit rejections being reported to clients as internal server errors. A query exceeding `maxDepth` or `maxComplexity` came back as `INTERNAL_SERVER_ERROR: Unexpected error.` with no hint that the query was too large, and was logged server-side at error level — so a public, unauthenticated endpoint let any caller write error-level noise into the logs.

Yoga classifies an error as safe to show a client with `error instanceof GraphQLError`, and that check is realm-sensitive: GraphQL Armor is CommonJS and throws a `GraphQLError` built from graphql's CJS entry, while Yoga is ESM and compares against the class from graphql's ESM entry. Same version, two classes, so the check failed and a client-side validation error was treated as a server fault. The module now identifies client-safe errors by name — walking the `originalError` chain the same way, which is what envelop's own masking does — and delegates everything else to Yoga's masking untouched, dev-mode detail included. Limit rejections now read `Query depth limit of N exceeded, found M.`

A resolver failure is still masked; the tests now assert the rejection's message and code rather than merely that some error came back, which is what allowed this to pass unnoticed.
