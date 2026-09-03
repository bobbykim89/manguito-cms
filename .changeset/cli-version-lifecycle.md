---
'@bobbykim/manguito-cms-core': minor
'@bobbykim/manguito-cms-cli': minor
---

Add the schema version lifecycle to the CLI: `version:diff` shows what cutting would freeze, `version:cut` freezes the working schema as a new version after confirmation, and `version:retire <version>` stops serving a cut version.

Core gains two exports the commands need: `describeSchemaChange`, a pure classification of the difference between two schema versions keyed by column (so a rename reads as a rename, not as a delete plus an add), and `loadVersionSnapshots`, extracted from what `loadVersionModel` already did internally so a caller can reach a snapshot's registry.

`version:retire` refuses to retire the highest-numbered snapshot: `current` is derived as highest + 1, so retiring it would renumber the working schema onto an already-published version number, and a consumer pinned to it would silently receive a different contract. Cutting first makes it retirable.
