---
'@bobbykim/manguito-cms-cli': patch
---

Saves close together in `manguito dev` now run one reload at a time, and a burst of saves runs at most one more reload.

Every command now parses the project's schemas through one loader. Their output and exit codes are unchanged.
