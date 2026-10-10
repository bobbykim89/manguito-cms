---
"@bobbykim/manguito-cms-api": patch
---

Admin writes now refuse, with a 422 naming the field, inputs that used to fail part-way through a write with a 500:

- an id that points at nothing, in a reference or a media field, at the top level or inside a paragraph item. Message: `Relation fields refer to items that do not exist`, e.g. `tags[1]`, `cards[0].card_tag`, `cards[0].card_image`;
- a paragraph item missing a required field. Message: `Required fields are missing`, e.g. `cards[0].card_tag`.

Both are checked before anything is written, so the existing links and paragraph rows are kept. A whitespace-only value now counts as missing inside paragraph items too, matching the top-level required check.
