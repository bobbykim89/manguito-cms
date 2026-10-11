---
"@bobbykim/manguito-cms-api": minor
---

Admin writes check every value before writing anything, at the top level and inside paragraph items. A value of the wrong type, text longer than its column, a number its column cannot hold, or an enum value outside its set used to reach Postgres and fail with a 500, and inside a paragraph item it failed after the field's old items were already deleted. Such a value is now rejected with 422 `VALIDATION_ERROR`, naming each field by path (`cards[0].heading`).

The schema's declared rules (`pattern`, `min` and `max`, `max` items) are now enforced by the API for every client, as the admin form already did in the browser. An API client that stored values outside them now gets a 422.

An empty string sent for a `date`, number or `enum` field is stored as `null`. Clearing a date in the admin form used to fail with a 500. A `float` is accepted as a number or as the decimal string a read returns for it (`"9.9900"`), so an item read and sent back unchanged still saves. An optional text field left blank (`""`) is not tested against its `pattern`, and a `pattern` that does not compile is skipped.
