# Context Map

Manguito CMS is a pnpm monorepo of five packages, each its own context. Architectural decisions are recorded per package under [docs/adr/](./docs/adr); cross-cutting decisions live at the root of that tree ([0001 throw-vs-Result boundary](./docs/adr/0001-throw-vs-result-boundary.md), [0002 response envelope](./docs/adr/0002-response-envelope.md), [0003 real-Postgres integration tests](./docs/adr/0003-real-postgres-integration-tests.md), [0004 coverage by intention](./docs/adr/0004-coverage-by-intention.md), [0005 smoke-test layer](./docs/adr/0005-smoke-test-layer.md)). Each context owns a `CONTEXT.md` glossary.

## Contexts

- [Core](./packages/core/CONTEXT.md) — schema parser, registry, adapter interfaces, shared primitives. ADRs: [docs/adr/core](./docs/adr/core)
- [Db](./packages/db/CONTEXT.md) — Drizzle codegen, Postgres adapter, migrations, seeding. ADRs: [docs/adr/db](./docs/adr/db)
- [Api](./packages/api/CONTEXT.md) — Hono app, route generation, storage adapters, auth. ADRs: [docs/adr/api](./docs/adr/api)
- [Admin](./packages/admin/CONTEXT.md) — Vue 3 admin panel, schema-driven forms, form codegen. ADRs: [docs/adr/admin](./docs/adr/admin)
- [Cli](./packages/cli/CONTEXT.md) — `manguito` binary: init, dev, build, start, migrate, users. ADRs: [docs/adr/cli](./docs/adr/cli)

## Relationships

- **Core → everyone**: core is the shared kernel; every package imports its interfaces, parsed types, and primitives. Core imports nothing downstream.
- **Db → Core**: db implements `DbAdapter` and consumes the parsed `SchemaRegistry` for codegen.
- **Api → Core, Db**: api implements `StorageAdapter`/`ServerAdapter`/`APIAdapter`, generates routes from the registry, and persists through db.
- **Admin → Core**: admin implements `AdminAdapter` and generates forms from the registry; it talks to the running API over HTTP, not by import.
- **Cli → all**: the CLI wires the lifecycle and may import from every package.

These import directions are the layer boundaries in CLAUDE.md and are enforced by [docs/adr/core/0001-adapter-interfaces-in-core.md](./docs/adr/core/0001-adapter-interfaces-in-core.md).
