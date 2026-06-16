# Phase 9 — CLI Package

> The `@bobbykim/manguito-cms-cli` package — the developer-facing binary that ties all other packages together.

The CLI owns the `manguito` binary and the full project lifecycle: scaffolding, development, building, migrating, and running. It reads `manguito.config.ts` and orchestrates `core`, `db`, `api`, and `admin` into a coherent developer experience. Phase 9 is the last package implementation phase before testing (Phase 7 covered backend testing; the CLI test strategy is finalised here alongside the command implementations).

**Done when:** All CLI commands are implemented and behave as documented. `manguito init` scaffolds a working project. `manguito dev` starts a live dev server with file watching. `manguito build` produces a correct `dist/`. `manguito migrate` runs the full migration lifecycle. `manguito validate` exits non-zero on schema errors. `manguito start` starts the production server. `manguito createsuperuser`, `manguito users:promote`, and `manguito users:demote` manage admin users correctly. All guard rails and guided error messages are in place. The CLI test suite passes.

---

## Decisions Made

| Topic | Detail doc |
|-------|-----------|
| Package structure, libraries, template approach | [decisions/phase-09/phase-09-package-structure.md](./decisions/phase-09/phase-09-package-structure.md) |
| `manguito init` — scaffolding command | [decisions/phase-09/phase-09-init.md](./decisions/phase-09/phase-09-init.md) |
| `manguito build` — codegen and compile | [decisions/phase-09/phase-09-build.md](./decisions/phase-09/phase-09-build.md) |
| `manguito build` / `manguito migrate` relationship | [decisions/phase-09/phase-09-build.md](./decisions/phase-09/phase-09-build.md) |
| `manguito validate` — schema validation command | [decisions/phase-09/phase-09-validate.md](./decisions/phase-09/phase-09-validate.md) |
| `manguito users:promote` / `users:demote` | [decisions/phase-09/phase-09-users.md](./decisions/phase-09/phase-09-users.md) |
| CLI testing strategy | [decisions/phase-09/phase-09-testing.md](./decisions/phase-09/phase-09-testing.md) |
| `manguito migrate` command (from Phase 4) | [decisions/phase-09/phase-09-migrate-command.md](./decisions/phase-09/phase-09-migrate-command.md) |
| Schema drift detection on `manguito start` (from Phase 2) | [decisions/phase-09/phase-09-drift-detection.md](./decisions/phase-09/phase-09-drift-detection.md) |
| `manguito createsuperuser` (from Phase 2) | [decisions/phase-09/phase-09-createsuperuser.md](./decisions/phase-09/phase-09-createsuperuser.md) |
| `--env` flag pattern (from Phase 4) | [decisions/phase-09/phase-09-env-flag.md](./decisions/phase-09/phase-09-env-flag.md) |
| Dev server and auto-migration on `manguito dev` (from Phase 2) | [decisions/phase-09/phase-09-cli-dev-server.md](./decisions/phase-09/phase-09-cli-dev-server.md) |

---

## Where This Fits

```
Phases 1–8 — all packages implemented and tested

Phase 9 — adds:
  @bobbykim/manguito-cms-cli   ← the manguito binary
    manguito init              ← scaffolds new project
    manguito dev               ← dev server with file watching + auto-migration
    manguito build             ← codegen + compile → dist/
    manguito start             ← production server from dist/
    manguito migrate           ← run pending DB migrations
    manguito migrate:status    ← show migration state
    manguito validate          ← parse and validate all schemas
    manguito createsuperuser   ← create initial admin user
    manguito users:promote     ← promote user to admin
    manguito users:demote      ← demote admin to lower role

Phase 10 — CI/CD wiring, GitHub Actions pipeline
```

---

## Package Structure

```
packages/cli/
├── src/
│   ├── index.ts                   ← Commander program, registers all commands, bin entry
│   ├── commands/
│   │   ├── init.ts
│   │   ├── dev.ts
│   │   ├── build.ts
│   │   ├── start.ts
│   │   ├── migrate.ts
│   │   ├── validate.ts
│   │   ├── createsuperuser.ts
│   │   └── users.ts               ← users:promote + users:demote as subcommand group
│   ├── codegen/
│   │   ├── drizzle-config.ts      ← generateDrizzleConfig()
│   │   ├── registry.ts            ← generateSchemaRegistry()
│   │   ├── routes.ts              ← generateRoutes()
│   │   ├── forms.ts               ← calls admin codegen, writes .manguito/forms/
│   │   └── nav.ts                 ← generateNav()
│   ├── templates/                 ← plain files for manguito init scaffolding
│   │   ├── manguito.config.ts.template
│   │   ├── package.json.template
│   │   ├── tsconfig.json.template
│   │   ├── .gitignore.template
│   │   ├── .env.example.template
│   │   ├── README.md.template
│   │   ├── roles.json.template
│   │   ├── routes.json.template
│   │   └── schemas/
│   │       ├── content-types/
│   │       │   └── blog-post.json.template
│   │       └── taxonomy-types/
│   │           └── tag.json.template
│   └── utils/
│       ├── env.ts                 ← --env flag loader
│       ├── config.ts              ← resolveConfig()
│       ├── db.ts                  ← connectDb()
│       ├── prompt.ts              ← PromptAdapter interface + @inquirer/prompts wrapper
│       ├── error.ts               ← printGuidedError(), process.exit(1) boundary
│       └── template.ts            ← renderTemplate() — simple {{var}} substitution
├── src/__tests__/                 ← unit tests for utils/ pure functions
├── tests/                         ← integration tests for commands
├── tsup.config.ts                 ← single ESM output, no CJS, no dts
├── tsconfig.json
└── package.json                   ← bin: { manguito: ./dist/index.js }
```

---

## Key Design Principles

**Commander.js + `@inquirer/prompts`** — Commander handles command parsing and routing; `@inquirer/prompts` handles all interactive input. No other CLI framework dependencies.

**Plain templates, no Handlebars** — `manguito init` scaffolds files from `src/templates/` using simple `{{variable}}` string substitution. No template engine dependency needed.

**Result type at the boundary** — all internal functions return the project-standard `{ ok, data }` / `{ ok, error }` Result type. The CLI is the terminal boundary where Results are translated into guided terminal output via `printGuidedError()` and `process.exit(1)`.

**PromptAdapter injection** — interactive prompt calls are wrapped behind a `PromptAdapter` interface, allowing command handler functions to be tested with pre-supplied answers without subprocess or keystroke simulation.

**`manguito start` is static** — starts the production Hono server from `dist/`. No watching, no rebuilding. For serverless deployments (Lambda, Vercel) the platform invokes the handler entry point directly; `manguito start` is the traditional server path only.

**`manguito build` / `manguito migrate` relationship** — build and migrate are independent commands. Migrate calls build internally using smart mtime comparison: if schema files are newer than `dist/generated/schema.ts`, build runs first; otherwise the existing artifacts are reused. If no artifacts exist at all, build runs first. See [phase-09-build.md](./decisions/phase-09/phase-09-build.md).

---

## Deployment Targets

| Target | How it runs |
|--------|-------------|
| Traditional server | `manguito start` → Hono server listens on PORT |
| AWS Lambda | Platform invokes `dist/handler.js` directly |
| Vercel | Platform invokes `dist/vercel.js` directly |

`manguito start` has no knowledge of serverless targets — that is handled by which entry point the platform calls.

---

## Developer Checklist

### Setup
- [ ] Add `package.json` with `"bin": { "manguito": "./dist/index.js" }` and all workspace dependencies
- [ ] Add `tsup.config.ts` — single ESM output, no CJS, no `dts`, bundle templates via `publicDir` or copy step
- [ ] Add `tsconfig.json` extending `tsconfig.base.json`
- [ ] Install `commander` and `@inquirer/prompts` as production dependencies

### Utils — see [phase-09-package-structure.md](./decisions/phase-09/phase-09-package-structure.md)
- [ ] `utils/env.ts` — loads dotenv file from `--env` flag before config resolution
- [ ] `utils/config.ts` — `resolveConfig()` reads and validates `manguito.config.ts`
- [ ] `utils/db.ts` — `connectDb()` shared DB setup for commands that need it
- [ ] `utils/prompt.ts` — `PromptAdapter` interface + `@inquirer/prompts` production implementation
- [ ] `utils/error.ts` — `printGuidedError()` formats Result errors as terminal output, calls `process.exit(1)`
- [ ] `utils/template.ts` — `renderTemplate(content, vars)` replaces `{{key}}` placeholders

### Templates — see [phase-09-init.md](./decisions/phase-09/phase-09-init.md)
- [ ] `templates/manguito.config.ts.template` — uses `{{projectName}}`, `{{storageAdapter}}`
- [ ] `templates/package.json.template` — uses `{{projectName}}`
- [ ] `templates/tsconfig.json.template` — static, no variables
- [ ] `templates/.gitignore.template` — static
- [ ] `templates/.env.example.template` — uses `{{storageAdapter}}` to include correct vars
- [ ] `templates/README.md.template` — uses `{{projectName}}`
- [ ] `templates/roles.json.template` — static five-role hierarchy
- [ ] `templates/routes.json.template` — static placeholder base path
- [ ] `templates/schemas/content-types/blog-post.json.template` — static example
- [ ] `templates/schemas/taxonomy-types/tag.json.template` — static example

### `manguito init` — see [phase-09-init.md](./decisions/phase-09/phase-09-init.md)
- [ ] Accepts optional `[name]` argument; `manguito init` and `manguito init .` scaffold in current directory
- [ ] Non-empty target directory → abort with clear error
- [ ] Prompts: project name (pre-filled from argument if provided), storage adapter
- [ ] Renders all templates with collected variables
- [ ] Writes scaffolded files to target directory
- [ ] Prints "next steps" block on success

### `manguito build` — see [phase-09-build.md](./decisions/phase-09/phase-09-build.md)
- [ ] Loads env, resolves config, parses all schemas
- [ ] Parse errors list all failures with file and location before stopping
- [ ] Runs DB codegen → `dist/generated/schema.ts`
- [ ] Runs API codegen → `dist/generated/routes.ts`
- [ ] Runs admin form codegen → `dist/generated/forms/`
- [ ] Runs Vite build with `__ADMIN_PREFIX__` and `__API_PREFIX__` injected
- [ ] Runs tsup compile for server + handler entry points
- [ ] Prints step-by-step success summary

### `manguito dev` — see [phase-09-cli-dev-server.md](./decisions/phase-09/phase-09-cli-dev-server.md)
- [ ] Full startup sequence including DB check, table creation, seeding, first-admin prompt
- [ ] Writes `.manguito/` artifacts before starting server
- [ ] Mounts Vite dev server as Hono middleware for admin routes
- [ ] File watcher triggers incremental re-parse and hot-swap on schema changes

### `manguito start` — see [phase-09-drift-detection.md](./decisions/phase-09/phase-09-drift-detection.md)
- [ ] Drift detection on startup — Scenarios A, B, C handled correctly
- [ ] Loads `dist/` artifacts, starts Hono server, listens on PORT
- [ ] No file watching, no rebuilding

### `manguito migrate` — see [phase-09-migrate-command.md](./decisions/phase-09/phase-09-migrate-command.md)
- [ ] mtime check — rebuild if schema files newer than artifacts or no artifacts exist
- [ ] Full migrate flow: build check → drizzle-kit generate → scanMigrationFiles → destructive warning → apply → seed
- [ ] `--status` flag — read-only migration state, no build
- [ ] `--dry-run` flag — preview only, no writes
- [ ] `--force` flag — skip destructive confirmation prompt
- [ ] `--env` flag — loads env file before all steps

### `manguito validate` — see [phase-09-validate.md](./decisions/phase-09/phase-09-validate.md)
- [ ] Validates config, all schema files, `roles.json`, `routes.json`
- [ ] Lists all errors before exiting — does not stop at first error
- [ ] Exits with non-zero code on any error
- [ ] No codegen, no DB access

### `manguito createsuperuser` — see [phase-09-createsuperuser.md](./decisions/phase-09/phase-09-createsuperuser.md)
- [ ] Precondition checks: DB reachable, users table exists, roles seeded
- [ ] Interactive flow with re-prompt on invalid input
- [ ] Password masking, confirmation field
- [ ] Assigns highest-hierarchy role from DB lookup

### `manguito users:promote` / `users:demote` — see [phase-09-users.md](./decisions/phase-09/phase-09-users.md)
- [ ] Both accept `--email` as flag or interactive prompt if omitted
- [ ] Precondition: users table exists
- [ ] Promote: warns and stops if already admin
- [ ] Demote: warns and stops if target role matches current role
- [ ] Demote: blocks if user is last admin in system

### `index.ts`
- [ ] Creates Commander program with correct version and description
- [ ] Registers all command files
- [ ] No business logic in `index.ts` — wiring only

---

## Tests — see [phase-09-testing.md](./decisions/phase-09/phase-09-testing.md)

### Unit tests (`src/__tests__/`)
- [ ] `utils/env.ts` — loads correct file, missing file guided error
- [ ] `utils/template.ts` — replaces all variables, leaves unknown placeholders intact
- [ ] `utils/error.ts` — formats error codes as expected terminal strings
- [ ] Build mtime logic — rebuild triggered when schema newer, skipped when not, triggered when no artifacts

### Integration tests (`tests/`) — command handler functions with injected mocks
- [ ] `migrate` — correct step order, mtime skip logic, destructive warning flow, build failure stops execution
- [ ] `start` — Scenario A blocks, Scenario B warns + continues, Scenario C clean start
- [ ] `dev` — startup sequence, first-admin prompt triggers when no admin exists
- [ ] `createsuperuser` — precondition failures, re-prompt on invalid input, last-admin guard

### Lighter tests — happy path + key failure case
- [ ] `build` — succeeds with valid schemas, stops on parse error
- [ ] `validate` — exits 0 on valid schemas, exits non-zero on errors
- [ ] `users:promote` — already-admin guard
- [ ] `users:demote` — last-admin guard
- [ ] `init` — non-empty directory error, correct files scaffolded

---

## Claude Code Checklist

- [ ] Read all decision docs linked in the Decisions Made table before implementing any command
- [ ] `tsup.config.ts` — single ESM output only, no CJS, no `dts`; the CLI is a binary not a library
- [ ] `index.ts` is wiring only — no business logic, no direct package imports beyond Commander registration
- [ ] Every command uses `utils/env.ts` as its first step if `--env` is accepted — env must be loaded before config resolution
- [ ] All interactive prompts go through `PromptAdapter` — never import `@inquirer/prompts` directly in command files
- [ ] All errors use `printGuidedError()` from `utils/error.ts` followed by `process.exit(1)` — never `console.error` + `process.exit` inline
- [ ] Result type pattern used internally throughout — the CLI boundary is `printGuidedError`, not scattered `try/catch` blocks
- [ ] `manguito start` is static — no file watching, no rebuilding, no Vite dependency
- [ ] `manguito build` does not touch the DB — codegen and compile only
- [ ] `manguito migrate --status` does not trigger a build — read-only
- [ ] Templates are plain files in `src/templates/` — do not use Handlebars or any template engine
- [ ] Do not hardcode role names (e.g. `"admin"`) — always look up by `hierarchy_level` from the DB or roles registry
- [ ] `manguito users:demote` must query the DB to confirm at least one other admin exists before demoting
