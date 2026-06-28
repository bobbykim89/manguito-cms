---
status: accepted
---

# Throwing is for fatal setup and lifecycle errors; Result is for expected control-flow failures

CLAUDE.md says "never throw for expected conditions — use Result type." That rule is about *normal control flow*, and the codebase draws the line as follows, across every package:

- **Return `Result`/`ParseResult`/`{ ok, error }`** for failures the caller is expected to branch on as ordinary flow: schema parsing and validation (`ParseResult`), API request handling (the `{ ok, error: { code, message } }` envelope), and any data-path operation where failure is a routine, recoverable outcome.
- **Throw** for fatal setup and lifecycle errors that should halt the process and surface to a developer's terminal, not be threaded through return values: invalid configuration at construction (`DB_URL_MISSING`, `DB_URL_INVALID`), connection/precondition violations (`getDb()` before `connect()`), and CLI lifecycle guards where the step must abort with an actionable message (`SEEDER_ROLE_IN_USE`, `SEEDER_BASE_PATH_IN_USE`).

## Considered Options

- **Result everywhere, including construction** — rejected: an adapter factory or a seeder step has no meaningful "continue" path on bad config; forcing every `createXAdapter()` caller to unwrap a Result adds ceremony to startup code that would just rethrow anyway.
- **Throw everywhere** — rejected: parse and request paths have many expected, individually-reportable failures (per-field validation, per-request errors) that are data, not exceptions.

## Consequences

- The existing throws in `db` (`createPostgresAdapter`, `seedSystemTables`) and `core` (auth/config preconditions) are **conforming**, not violations — they are setup/lifecycle, not control flow.
- A reviewer should reach for `Result` the moment a failure is something a caller routinely handles and keeps going from; reach for `throw` only when the right response is "stop and tell the developer."
- CLAUDE.md's one-line rule should be read through this ADR; consider updating it to reference this boundary.
