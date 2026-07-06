---
status: accepted
---

# Paragraph nesting is capped at one level

A paragraph type may contain a `paragraph` field that references another paragraph type, but that nested paragraph may not itself contain a paragraph field. Nesting stops at exactly one level deep. The parser enforces this and reports `CIRCULAR_REFERENCE` / `INVALID_REF_TARGET` on violations. The cap keeps reference resolution finite and the parser, API serializer, and admin form renderer tractable — arbitrary-depth nesting would make each of those recursive and open the door to cycles.

## Considered Options

- **Arbitrary-depth nesting** — rejected: requires cycle detection and recursive resolution in three separate consumers, for a content-modelling need that the one-level cap already covers in practice.

## Consequences

- Deeply hierarchical content must be modelled with references between content types, not by stacking paragraphs.
- A future "just let paragraphs nest one more level" request should reopen this ADR — the limit is load-bearing for the non-recursive resolver, not an arbitrary number.
