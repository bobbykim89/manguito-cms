---
"@bobbykim/manguito-cms-core": minor
---

A paragraph type can no longer declare a `many-to-many` reference: `validateCrossReferences` refuses it with the new `UNSUPPORTED_RELATION` error code. Such a field was accepted before, but nothing stored its links (#65). Use `"rel": "one-to-one"`, or move the field to the content or taxonomy type the paragraph appears in. Version snapshots that hold one still load. The `one-to-many` deprecation warning on a paragraph type now suggests only `one-to-one`.
