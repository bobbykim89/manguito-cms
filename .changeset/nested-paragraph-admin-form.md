---
"@bobbykim/manguito-cms-admin": patch
---

Fix a nested paragraph field rendering an empty block in the admin. A paragraph type may hold a paragraph field of its own (one level, per ADR core/0005); adding one of those inner items produced a block with its header and Remove button but no editable fields, so it could only ever be saved empty.

The admin builds paragraph sub-forms at runtime with a render function, and that render pass forwarded only the common field props — never the `formComponent` a `ParagraphEmbed` needs. A top-level paragraph field got one from the form view, so only *nested* paragraphs were affected. The field-to-component mapping and paragraph-form factory now live in their own module (`components/fields/field-registry.ts`) so this wiring is unit-testable, and the nesting case is covered.
