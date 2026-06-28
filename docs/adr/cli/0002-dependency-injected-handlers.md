---
status: accepted
---

# Command handlers take injected dependencies; the binary is the only place real deps and process.exit live

Each command is a handler function that receives its side-effecting dependencies as a parameter — e.g. `runMigrate(options, deps)` where `deps` carries the build runner, migration runner, scanner, seeder, and prompt adapter. The `register*(program)` function in the same file wires the real implementations when the binary runs; tests call the handler directly with mock deps. All interactive prompts go through a `PromptAdapter` interface (not a direct `@inquirer/prompts` import), so tests supply pre-baked answers with no stdin or subprocess simulation. Errors flow as the project `Result` type up to a single terminal boundary — `printGuidedError()` is the only place that formats an error and calls `process.exit(1)`.

## Considered Options

- **Import deps directly in handlers and test via subprocess (`execa`)** — rejected: subprocess tests are slow, give poor failure messages, and can't easily assert step ordering or guard-rail behaviour. Injected deps let tests verify "seeder runs after migrate", "build failure stops execution", etc. directly.
- **Scatter `console.error`/`process.exit` through handlers** — rejected: inconsistent error formatting and many implicit exit points; one `printGuidedError` boundary keeps output uniform and the process-exit surface explicit.

## Consequences

- Command handlers are unit-testable without a DB or a real terminal — DB interactions are mocked at the repository level, prompts via `PromptAdapter`.
- No snapshot tests on CLI output strings (too brittle for terminal formatting) and no subprocess tests — direct calls with injected mocks only.
- The pattern only works because the CLI is the composition root ([cli 0001](./0001-cli-composition-root.md)): real deps are constructed at the `register*` seam, nowhere deeper.
