# Cli

The `manguito` binary — the composition root that wires every package together and owns all side effects: scaffolding, codegen file output, the dev/build/start lifecycle, migrations, and CLI-only user governance. It is the only package that imports from all others. See [docs/adr/cli](../../docs/adr/cli) for the decisions that shape it.

## Language

### Lifecycle commands

**init**:
The scaffolding command that writes a working project (config, example schemas, roles/routes, env example) from bundled templates.
_Avoid_: new, scaffold, create

**dev**:
The watch-mode command — parses schemas, regenerates `.manguito/`, runs `drizzle-kit push`, mounts Vite on Hono, and hot-reloads on schema change.
_Avoid_: serve, watch, start (dev)

**build**:
The command that compiles the project to `dist/` (codegen + Vite + tsup). Touches no database; runnable on its own.
_Avoid_: compile, bundle

**migrate**:
The deploy command that builds first, generates and applies migrations, then seeds. Depends on build; build never depends on it.
_Avoid_: deploy, sync, push (prod)

**start**:
The production run command that serves `dist/`, after a startup migration-state check.
_Avoid_: serve, run

**validate**:
The read-only lint command — parses config and all schema/roles/routes files, exits non-zero on any error, writes nothing.
_Avoid_: check, lint, verify

### Orchestration concepts

**Composition root**:
The CLI's role as the single place where concrete dependencies are constructed and side effects happen.
_Avoid_: orchestrator, glue, wiring

**Command handler**:
The dependency-injected function (`run*`) holding a command's logic, kept separate from the `register*` Commander wiring so it can be tested with mock deps.
_Avoid_: action, controller

**PromptAdapter**:
The interface all interactive prompts go through, so handlers are testable without stdin or subprocess simulation.
_Avoid_: inquirer wrapper, prompter

**Guided error**:
A terminal error with an actionable hint, emitted only through `printGuidedError` — the single process-exit boundary.
_Avoid_: fatal, crash, abort

**Build-first contract**:
The rule that `migrate` always refreshes artifacts via `build` before generating migrations, gated by an mtime check.
_Avoid_: auto-build, prebuild

**Startup drift check**:
`start`'s migration-state inspection — block if the DB was never initialized, warn-and-continue if migrations are merely pending.
_Avoid_: health check, preflight

**Superuser**:
An admin user created out-of-band via `createsuperuser`, the dev first-run prompt, or `users:promote` — never through the admin panel. Governed by [[roles-schema-defined-only]].
_Avoid_: root, owner, first user
