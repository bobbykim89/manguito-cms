---
status: accepted
---

# Adapter interfaces live in core; implementations live in sibling packages

`@bobbykim/manguito-cms-core` defines the interfaces for every swappable concern — `DbAdapter`, `StorageAdapter`, `ServerAdapter`, `APIAdapter`, `AdminAdapter` — but ships no implementation of them. The concrete factories (`createPostgresAdapter`, `createS3Adapter`, `createServer`, etc.) live in `db`, `api`, and `admin`. This is the mechanism that lets `defineConfig` (in core) type-check a complete configuration while core depends on nothing downstream, and it is what makes the layer boundaries in CLAUDE.md enforceable rather than aspirational.

## Considered Options

- **Plain config objects** (`{ db: { type: 'postgres', url: ... } }`) instead of adapter factories — rejected: core would need to know every adapter's option shape, and adding an adapter would be a breaking change to core.
- **Implementations in core** — rejected: core would have to depend on `pg`, `@aws-sdk`, Hono, Vue, etc., collapsing the dependency graph.

## Consequences

- Adding a new adapter (e.g. a MySQL `DbAdapter`) is non-breaking: a new sibling package implements the existing interface; core is untouched.
- A reader who finds `DbAdapter` declared in core but never implemented there is seeing this on purpose — the implementation is one package down.
