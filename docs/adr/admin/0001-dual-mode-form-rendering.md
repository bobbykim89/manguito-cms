---
status: accepted
---

# Dual-mode form rendering: dynamic renderer in dev, static generated SFCs in build

Content forms render two ways from one source of truth. In `manguito dev` a dynamic renderer reads `ParsedSchema` at runtime and picks a field component from a `field_type → component` map (`<component :is>`). In `manguito build`, `generateFormComponent` emits one static Vue SFC per content/paragraph/taxonomy type. The static output is the pre-rendered form of exactly what the dynamic renderer would produce — same field components, same props, same events — so dev and production behave identically. `generateFormComponent` is a pure `schema → string` function (no I/O); the CLI writes its output to `.manguito/forms/` (dev) or `dist/generated/` (build).

## Considered Options

- **Dynamic rendering in production too** — rejected: runtime schema interpretation on every form mount is slower and ships the interpreter; pre-generated SFCs let Vite tree-shake and optimize per-type forms.
- **Static generation only (no dynamic renderer)** — rejected: dev would lose instant HMR feedback on schema edits; the dynamic path is what makes schema iteration fast.

## Consequences

- The generator must live in a Vue-free module so the CLI can import it without pulling the SPA runtime: it ships through a `./codegen` subpath built by tsup with `external: ['vue']`, separate from the Vite SPA build. This is why the admin package has two build tools.
- Generated SFCs use package imports (`@bobbykim/manguito-cms-admin/src/components/fields/...`), are emitted in topological order (nested paragraph before parent, guaranteed terminating by [core 0005](../core/0005-paragraph-nesting-one-level.md)), and carry an `AUTO-GENERATED` header.
- This is the admin-side instance of the same pure-codegen, dev-vs-build artifact pattern as [db 0003](../db/0003-pure-schema-codegen.md); `generateFormComponent` is verified by string-snapshot tests, not DOM snapshots.
