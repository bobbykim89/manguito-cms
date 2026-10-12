---
"@bobbykim/manguito-cms-api": minor
---

A `many-to-many` list now keeps the order it was saved in: saves store each link's position, and the admin edit read and the public REST and GraphQL reads return links in that order. Links saved before this change read in id order until the item is next saved. An id repeated in a save is stored once, at its first position, where it used to create duplicate links; duplicates already stored go at the item's next save. Saving a list now takes one INSERT instead of one per link.

**Run `manguito migrate` before deploying this version.** Every read and write of a type with a many-to-many field now uses the `order` column it adds; until it exists, those requests fail.
