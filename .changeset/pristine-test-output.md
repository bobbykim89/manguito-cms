---
"@bobbykim/manguito-cms-api": patch
---

Stop the api test suite printing lines that look like failures on a passing run. The masked-resolver-failure test threw a fake `connect ECONNREFUSED …:5432`, which Yoga logs (correctly — masked faults should be logged), so a green run appeared to contain a dead test database. The schema-collision test likewise let `✗ GraphQL schema failed to initialize` through to stderr.

The fake failure now uses an obviously synthetic message, and the collision diagnostic is captured and asserted instead of printed — so the suite still proves the operator gets told which two schemas collided, without the warning reading as a broken run. No production behaviour changes.
