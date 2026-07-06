---
status: accepted
---

# The CLI is the composition root — it owns side effects; packages stay pure

`@bobbykim/manguito-cms-cli` is the only package permitted to import from all others (core, db, api, admin). That privilege exists because the CLI is the system's composition root: the packages expose pure primitives (parse, `generateSchemaFile`, `generateFormComponent`, route generation, the seeder, migration runners), and the CLI is what wires them together and performs every side effect — writing generated files to `.manguito/` or `dist/generated/`, generating `drizzle.config.ts`, spawning Vite/tsup/Drizzle Kit, opening DB connections, and reading/writing the terminal. No package below the CLI decides *where* output lands or *when* a process runs; the CLI owns that.

## Considered Options

- **Let each package own its own file output / process spawning** — rejected: codegen would need filesystem and path knowledge spread across core/db/api/admin, making each impure and harder to test, and duplicating dev-vs-build path logic in several places.
- **A separate orchestration package the CLI thinly wraps** — rejected as premature: the CLI *is* that orchestrator; an extra layer adds indirection without a second consumer.

## Consequences

- Every "pure function" codegen decision ([db 0003](../db/0003-pure-schema-codegen.md), [admin 0001](../admin/0001-dual-mode-form-rendering.md), api route generation) depends on this: those functions return data/strings precisely because the CLI supplies the I/O.
- The CLI's broad import surface is intentional, not a smell — it is the one place the dependency graph fans in.
- This makes the CLI the natural home for the dev/build/start/migrate lifecycle and the only layer that knows the difference between dev (`.manguito/`, `drizzle-kit push`) and production (`dist/`, `generate`+`migrate`).
