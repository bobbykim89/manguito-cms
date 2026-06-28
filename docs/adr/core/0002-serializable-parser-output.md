---
status: accepted
---

# Parser output is serializable plain objects — no class instances, no functions

The schema parser emits only plain JSON-serializable objects (`SchemaRegistry`, `ParsedSchema`, `ParsedField`, …). No output value is a class instance and none carries methods or closures. This exists because the registry is written to `dist/generated/schema.ts` at build time and re-imported at runtime: serializable output means the build artifact is the data, with zero rehydration step and zero behaviour to reconstruct.

## Considered Options

- **Rich domain objects** (parser returns classes with `.validate()`, `.toColumn()` methods) — rejected: cannot be emitted to a static file and re-imported cheaply; would force a runtime parse on every cold start.

## Consequences

- Any logic that operates on parsed schema (DB codegen, route generation, form generation) must be a *function that takes the plain object*, never a method on it.
- The same output feeds three consumers (db, api, admin) without coupling them to a shared class hierarchy.
- Expected failures are returned as `Result`/`ParseResult` values rather than thrown — see the root ADR on the Result type.
