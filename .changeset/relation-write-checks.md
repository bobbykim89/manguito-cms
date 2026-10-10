---
"@bobbykim/manguito-cms-api": patch
---

Admin writes now refuse, with a 422 naming the field, two inputs that used to fail part-way through a write with a 500. They are a reference to an item that does not exist (`Relation fields refer to items that do not exist`, e.g. `tags[1]` or `cards[0].card_tag`) and a paragraph item missing a required field (`Required fields are missing`, e.g. `cards[0].card_tag`). Both are checked before anything is written, so the existing links and paragraph rows are kept.
