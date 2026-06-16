# Decision — CLI Package Structure

> Defines the library choices, package layout, build config, error handling pattern, and prompt abstraction for `@bobbykim/manguito-cms-cli`.

---

## Library Choices

| Concern | Library | Rationale |
|---------|---------|-----------|
| Command parsing | `commander` | Battle-tested, minimal, excellent TypeScript support built-in. No `@types/` package needed. Fits the minimal dependencies principle. |
| Interactive prompts | `@inquirer/prompts` | Decade-long standard for Node CLI prompts. Modular v9+ API — import only the prompt types needed (`input`, `password`, `confirm`). Handles password masking, re-prompting on invalid input, and confirmation dialogs cleanly. |
| Template engine | None | `manguito init` templates are simple enough that `{{variable}}` string substitution covers all cases. Handlebars is overkill and an unnecessary dependency. |

---

## Package Layout

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
│   │   └── users.ts               ← users:promote + users:demote as Commander subcommand group
│   ├── codegen/
│   │   ├── drizzle-config.ts      ← generateDrizzleConfig() — writes .manguito/drizzle.config.ts
│   │   ├── registry.ts            ← generateSchemaRegistry() — writes .manguito/schema-registry.ts
│   │   ├── routes.ts              ← generateRoutes() — writes .manguito/routes.ts
│   │   ├── forms.ts               ← calls admin generateFormComponent(), writes .manguito/forms/
│   │   └── nav.ts                 ← generateNav() — writes .manguito/nav.ts
│   ├── templates/                 ← plain scaffold files for manguito init
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
│       ├── env.ts                 ← --env flag loader (dotenv)
│       ├── config.ts              ← resolveConfig() — reads manguito.config.ts
│       ├── db.ts                  ← connectDb() — shared DB setup
│       ├── prompt.ts              ← PromptAdapter interface + @inquirer/prompts wrapper
│       ├── error.ts               ← printGuidedError(), process.exit(1) terminal boundary
│       └── template.ts            ← renderTemplate() — {{var}} string substitution
├── src/__tests__/                 ← unit tests for utils/ pure functions
├── tests/                         ← integration tests for command handlers
├── tsup.config.ts
├── tsconfig.json
└── package.json
```

---

## `index.ts` — Wiring Only

`src/index.ts` creates the Commander program and registers all command files. No business logic lives here.

```ts
#!/usr/bin/env node
import { Command } from 'commander'
import { registerInit } from './commands/init'
import { registerDev } from './commands/dev'
// ... etc

const program = new Command()
  .name('manguito')
  .description('Manguito CMS CLI')
  .version('0.0.1')

registerInit(program)
registerDev(program)
// ... etc

program.parse()
```

Each command file exports a `register*(program: Command): void` function that attaches the subcommand to the Commander program.

---

## `tsup.config.ts` — Single ESM Output

The CLI is a binary, not a library. It does not need dual ESM/CJS output or TypeScript declarations.

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  // templates must be copied into dist/ so they are available at runtime
  // use a copy plugin or postbuild script to copy src/templates/ → dist/templates/
})
```

The `src/templates/` folder must be copied into `dist/templates/` as part of the build step — templates are read from disk at runtime by `manguito init`.

---

## Error Handling Pattern

The project-standard Result type is used internally throughout. Command files receive Results from utility and package functions and pass them to `printGuidedError()` at the boundary.

```ts
// utils/error.ts
import type { CmsError } from '@bobbykim/manguito-cms-core'

export function printGuidedError(error: CmsError): never {
  console.error(`\n✖ ${error.message}`)
  if (error.hint) {
    console.error(`  ${error.hint}`)
  }
  process.exit(1)
}
```

Command files never call `console.error` + `process.exit` inline. All error paths go through `printGuidedError`. This keeps error formatting consistent across all commands and makes the terminal boundary explicit.

Exit codes follow standard Unix convention:
- `0` — success
- `1` — any error (config invalid, schema parse failure, DB unreachable, etc.)

---

## PromptAdapter — Testable Interactive Prompts

All interactive prompt calls go through a `PromptAdapter` interface rather than importing `@inquirer/prompts` directly in command files. This allows command handler functions to be tested with pre-supplied answers without subprocess or keystroke simulation.

```ts
// utils/prompt.ts

export type PromptAdapter = {
  input(message: string, options?: { default?: string; validate?: (v: string) => string | true }): Promise<string>
  password(message: string, options?: { validate?: (v: string) => string | true }): Promise<string>
  confirm(message: string, options?: { default?: boolean }): Promise<boolean>
  select<T extends string>(message: string, choices: { value: T; label: string }[]): Promise<T>
}

// Production implementation — wraps @inquirer/prompts
export const inquirerPromptAdapter: PromptAdapter = {
  input: (message, options) => input({ message, ...options }),
  password: (message, options) => password({ message, mask: '•', ...options }),
  confirm: (message, options) => confirm({ message, ...options }),
  select: (message, choices) => select({ message, choices }),
}
```

Command handler functions accept a `PromptAdapter` parameter. In production, `index.ts` passes `inquirerPromptAdapter`. In tests, a simple object with pre-supplied values is passed instead.

---

## `renderTemplate` — Simple Variable Substitution

```ts
// utils/template.ts

export function renderTemplate(
  content: string,
  vars: Record<string, string>
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}
```

Unknown placeholders are left as-is rather than replaced with empty strings — makes missing variables visible rather than silently wrong.

---

## `package.json` Shape

```json
{
  "name": "@bobbykim/manguito-cms-cli",
  "version": "0.0.1",
  "type": "module",
  "bin": {
    "manguito": "./dist/index.js"
  },
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": { "node": ">=22.0.0" },
  "dependencies": {
    "commander": "^12.0.0",
    "@inquirer/prompts": "^7.0.0",
    "@bobbykim/manguito-cms-core": "workspace:*",
    "@bobbykim/manguito-cms-db": "workspace:*",
    "@bobbykim/manguito-cms-api": "workspace:*",
    "@bobbykim/manguito-cms-admin": "workspace:*"
  }
}
```
