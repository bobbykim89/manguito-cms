---
"@bobbykim/manguito-cms-admin": patch
---

The content and taxonomy forms show the details of a save refused with `VALIDATION_ERROR`, not only the generic message: an error for a field appears next to that field, and an error inside a paragraph item (such as `cards[0].heading`) is listed with the form's message. Before, only `PUBLISH_VALIDATION_ERROR` details were shown.
