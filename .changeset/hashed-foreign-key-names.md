---
'@bobbykim/manguito-cms-db': patch
---

Foreign keys whose names pass 63 characters now get a hashed 63-character name, so the dev server's push stops re-planning them on every run (#88). An existing project's long foreign keys are renamed once, on its next dev push or in its next generated migration.
