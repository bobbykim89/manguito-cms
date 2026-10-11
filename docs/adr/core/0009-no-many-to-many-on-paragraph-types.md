---
status: accepted
---

# Paragraph types hold no many-to-many references

A `reference` field on a paragraph type may be `one-to-one` (or the deprecated `one-to-many`, which holds one item), but not `many-to-many`. The parser refuses it with `UNSUPPORTED_RELATION`. This extends the rule that already limits a `paragraph` field to `one-to-one` and `one-to-many`: a paragraph row belongs to exactly one parent and is deleted and re-inserted on every save of that parent, so it is a poor owner for link rows that would have to be rebuilt with it. Before this rule the parser accepted the field, but codegen created no link table and saves skipped it, so the links an editor picked were silently dropped (#65).

## Considered Options

- **Support it** — a link table per field, keyed to the paragraph row: rejected for now. It needs core metadata, codegen, save, edit read and public include for paragraphs, and the links would be deleted and recreated on every save, for a modelling need the alternatives below already cover.

## Consequences

- A list of references inside a paragraph is modelled either as a `many-to-many` field on the content or taxonomy type that embeds the paragraph, or as a `one-to-many` paragraph field whose items each hold a `one-to-one` reference.
- The `one-to-many` deprecation warning suggests only `one-to-one` on a paragraph type, since its usual advice ("`many-to-many` for a list") would now be refused.
- A project whose paragraph type already declares one fails to parse after upgrading. Nothing is lost: those links were never stored.
