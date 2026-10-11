---
status: accepted
---

# Paragraph types hold no many-to-many references

A `reference` field on a paragraph type may be `one-to-one` (or the deprecated `one-to-many`, which holds one item), but not `many-to-many`. `validateCrossReferences` refuses it with `UNSUPPORTED_RELATION`, and `manguito validate`, `dev`, `build` and the `version:*` commands all run that check. This extends the rule that already limits a `paragraph` field to `one-to-one` and `one-to-many`: a paragraph row belongs to exactly one parent and is deleted and re-inserted on every save of that parent, so it is a poor owner for link rows that would have to be rebuilt with it. Before this rule the parser accepted the field, but codegen created no link table and saves skipped it, so the links an editor picked were silently dropped (#65).

## Considered Options

- **Refuse it in `parseSchema`**: rejected. Version snapshots are re-parsed on every load but never cross-validated, so a version cut while a paragraph type held the field would fail to load, and no edit to the current schema could clear it.
- **Support it** — a link table per field, keyed to the paragraph row: rejected for now. It needs core metadata, codegen, save, edit read and public include for paragraphs, and the links would be deleted and recreated on every save, for a modelling need the alternatives below already cover.

## Consequences

- A list of references inside a paragraph is modelled either as a `many-to-many` field on the content or taxonomy type that embeds the paragraph, or as a `one-to-many` paragraph field whose items each hold a `one-to-one` reference.
- The `one-to-many` deprecation warning suggests only `one-to-one` on a paragraph type, since its usual advice ("`many-to-many` for a list") would now be refused.
- A project whose paragraph type already declares one fails `manguito validate`, `dev` and `build` after upgrading, until the field is changed. Nothing is lost: those links were never stored. Version snapshots that hold it still load.
- `manguito dev`, `build` and the `version:*` commands now run the full cross-reference validation, not only `manguito validate`, so the check cannot be skipped, and `version:create` cannot freeze the field into a new snapshot. That also stops them on the other cross-reference errors (unknown or wrong-type targets, circular paragraphs, media size limits), which they used to pass through to codegen.
