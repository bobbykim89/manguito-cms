---
"@bobbykim/manguito-cms-api": patch
---

Taxonomy types now fully support relation fields in the admin API. The taxonomy edit read returns paragraph fields and many-to-many link ids, as the content edit read does, and taxonomy create and update save many-to-many links, which were silently dropped before. An update still leaves relation fields absent from its body untouched.

Publishing through a PATCH that leaves out a required paragraph or many-to-many field now sees that field's stored value, for content and taxonomy types. Before, such a field always read as missing, and the publish was refused unless the body repeated it.
