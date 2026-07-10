---
"@bobbykim/manguito-cms-cli": patch
---

Fix `manguito init` scaffolding a broken project (shipped in 0.1.1). The tsup build copied templates with `cp -r src/templates dist/templates`, which nests into `dist/templates/templates` when the target already exists (e.g. a turbo-cached `dist`). The published bundle then scaffolded a stray `templates/` folder plus duplicate `.env.example`/`.gitignore` at the project root. The copy is now an idempotent remove-then-copy via Node's `fs`, so `dist/templates` is always a flat, correct mirror of the source templates.
