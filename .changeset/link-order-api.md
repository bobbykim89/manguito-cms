---
"@bobbykim/manguito-cms-api": minor
---

A `many-to-many` list now keeps the order it was saved in: saves store each link's position, and the admin edit read and the public REST and GraphQL reads return links in that order. Links saved before this change read in id order until the item is next saved. An id repeated in a list is stored once, at its first position, where it used to create duplicate links. Requires the `order` column that `manguito migrate` adds to each link table.
