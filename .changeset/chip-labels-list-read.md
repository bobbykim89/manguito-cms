---
'@bobbykim/manguito-cms-admin': patch
---

Reference fields load their chip labels in one list request instead of reading each linked item in full, and their search now filters by what you type.

- Chip labels: one `GET /admin/api/<type>?filter[id]=…` per 100 linked items. Before, every chip fetched its whole item, with every paragraph and link.
- Search: the typeahead sends `search=`, which the list endpoint reads. Before, it sent a `filters[…][like]` parameter the API ignored, so every search returned the first 10 items whatever was typed.
