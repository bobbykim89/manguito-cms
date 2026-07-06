---
status: accepted
---

# Schema codegen is a pure SchemaRegistry → string function; the generated schema is a build artifact

`generateSchemaFile(registry: SchemaRegistry): string` is a pure function — no filesystem access, no DB connection, no side effects. It turns the parsed registry into a Drizzle schema TypeScript string and returns it; the caller decides where it lands. The CLI writes that string to `.manguito/schema.ts` in dev (rewritten incrementally on schema changes) and to `dist/generated/schema.ts` in the production build. The Drizzle schema is therefore a generated artifact, never hand-authored.

## Considered Options

- **Codegen writes files directly** — rejected: the same logic must serve two output paths (dev vs build) and would otherwise need filesystem mocking and temp dirs to unit-test. Purity makes it testable with a plain string assertion.

## Consequences

- This mirrors core's serializable-output stance ([core 0002](../core/0002-serializable-parser-output.md)): data in, string out, no behaviour to reconstruct.
- Table emission is ordered for TypeScript's benefit (system → taxonomy → paragraphs topologically sorted → content → junctions); the one-level paragraph nesting cap ([core 0005](../core/0005-paragraph-nesting-one-level.md)) guarantees the sort terminates.
- System tables (`media`, `base_paths`, `roles`, `users`) are hardcoded in codegen, not derived from the registry — they are identical regardless of user schemas.
