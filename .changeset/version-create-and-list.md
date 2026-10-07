---
'@bobbykim/manguito-cms-cli': minor
---

Make the schema version lifecycle say what it does, and make `validate` check it.

- `manguito version:create` replaces `version:cut`. It freezes the working
  schema exactly as before. On a project with no versions it explains that the
  working schema is already v1 and becomes v2, and it now lists the working
  schema among the live versions.
- The success output changed. It used to read "Froze the working schema as vN
  at ..." and now reads "Created vN at ...", and the "Live:" line now includes
  the working schema. A script that greps the old `version:cut` output must
  update.
- `manguito version:cut` still works as a hidden alias. It prints a
  deprecation notice on stderr and will be removed in a future release.
- New `manguito version:list` shows every live version, its path, and how many
  fields have been renamed, removed, added or restored since.
- `manguito validate` now rejects the version errors `manguito build` rejects:
  a broken snapshot, a field type changed while a version is live, a column a
  live version needs, and a leftover removed field. A schema that passed
  `validate` before may now fail it.
- `manguito build` checks the version model before writing any generated
  file, so a failed build no longer leaves partial output in `dist/generated`.
