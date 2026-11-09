import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { addLinkDedupe, linkDedupeSql, linkUniqueName } from '../link-tables'

const sha8 = (name: string) =>
  createHash('sha256').update(name).digest('hex').slice(0, 8)

describe('linkUniqueName', () => {
  // MUTATION: a fallback that triggers too early (at 56 characters or more)
  // fails the plain `<name>_unique` assertion.
  it('appends _unique when the result fits in 63 characters', () => {
    const name = 'a'.repeat(56)
    expect(linkUniqueName(name)).toBe(`${name}_unique`)
    expect(linkUniqueName(name)).toHaveLength(63)
  })

  // MUTATION: a plain `<name>_unique` with no fallback gives 64 characters
  // for a 57-character name and fails the 63-character assertion.
  it('falls back to a truncated, hashed name of exactly 63 characters', () => {
    const name = 'b'.repeat(57)
    const result = linkUniqueName(name)
    expect(result).toHaveLength(63)
    expect(result).toBe(`${name.slice(0, 47)}_${sha8(name)}_unique`)
  })

  // MUTATION: hashing the truncated name (first 47 chars) gives the same
  // result for names that share their first 47 characters.
  it('gives different results for long names sharing their first 47 characters', () => {
    const prefix = 'c'.repeat(47)
    const a = `${prefix}${'x'.repeat(13)}`
    const b = `${prefix}${'y'.repeat(13)}`
    expect(a).toHaveLength(60)
    expect(linkUniqueName(a)).not.toBe(linkUniqueName(b))
  })

  // MUTATION: mixing randomness or a timestamp into the hash gives a
  // different name on each call and fails the equality assertion.
  it('is deterministic', () => {
    const name = 'd'.repeat(60)
    expect(linkUniqueName(name)).toBe(linkUniqueName(name))
  })
})

describe('linkDedupeSql', () => {
  // MUTATION: reversing the comparison to `<` keeps the highest order; the
  // exact-string assertion rejects it, and Task 3's integration test checks
  // which row survives.
  it('keeps the lowest (order, ctid) row when the table has an order column', () => {
    expect(linkDedupeSql('t', 'left_id', 'right_id', true)).toBe(
      'DELETE FROM "t" a USING "t" b WHERE a."left_id" = b."left_id" AND a."right_id" = b."right_id" AND (a."order", a.ctid) > (b."order", b.ctid)',
    )
  })

  // MUTATION: always comparing on order references a column the table lacks.
  it('compares on ctid alone when there is no order column', () => {
    expect(linkDedupeSql('t', 'left_id', 'right_id', false)).toBe(
      'DELETE FROM "t" a USING "t" b WHERE a."left_id" = b."left_id" AND a."right_id" = b."right_id" AND a.ctid > b.ctid',
    )
  })
})

describe('addLinkDedupe', () => {
  const ADD_COLUMN =
    'ALTER TABLE "junction_content_a_tags" ADD COLUMN "order" integer DEFAULT 0 NOT NULL;'
  const ADD_CONSTRAINT =
    'ALTER TABLE "junction_content_a_tags" ADD CONSTRAINT "junction_content_a_tags_unique" UNIQUE("left_id","right_id");'
  const input = `${ADD_COLUMN}--> statement-breakpoint\n${ADD_CONSTRAINT}\n`

  const block = [
    '-- Removes only repeated (left, right) pairs, keeping the lowest order, before adding the constraint.',
    'DO $$ BEGIN',
    `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"junction_content_a_tags"'::regclass AND conname = 'junction_content_a_tags_unique') THEN`,
    'LOCK TABLE "junction_content_a_tags" IN SHARE ROW EXCLUSIVE MODE;',
    `${linkDedupeSql('junction_content_a_tags', 'left_id', 'right_id', true)};`,
    ADD_CONSTRAINT,
    'END IF;',
    'END $$;',
  ].join('\n')

  // MUTATION: leaving the ADD CONSTRAINT statement as drizzle-kit wrote it
  // (no rewrite) fails the exact-output assertion.
  it('wraps the ADD CONSTRAINT in a guarded DO block after the dedupe, leaving ADD COLUMN first', () => {
    expect(addLinkDedupe(input)).toBe(
      `${ADD_COLUMN}--> statement-breakpoint\n${block}\n`,
    )
  })

  // MUTATION: matching any `UNIQUE(` instead of only ALTER TABLE ... ADD
  // CONSTRAINT rewrites the inline CREATE TABLE constraint and fails this.
  it('leaves an inline CONSTRAINT in CREATE TABLE untouched', () => {
    const create =
      'CREATE TABLE "junction_content_a_tags" (\n\t"left_id" uuid NOT NULL,\n\t"right_id" uuid NOT NULL,\n\tCONSTRAINT "junction_content_a_tags_unique" UNIQUE("left_id","right_id")\n);\n'
    expect(addLinkDedupe(create)).toBe(create)
  })

  // MUTATION: rewriting every statement (e.g. appending a block regardless of
  // a match) changes this plain table.
  it('leaves SQL without a link constraint untouched', () => {
    const plain = 'CREATE TABLE "content_x" (\n\t"id" uuid PRIMARY KEY NOT NULL\n);\n'
    expect(addLinkDedupe(plain)).toBe(plain)
  })

  // MUTATION: a regex that consumes the trailing breakpoint drops it.
  it('keeps a statement-breakpoint that followed the original statement', () => {
    const out = addLinkDedupe(`${ADD_CONSTRAINT}--> statement-breakpoint\nSELECT 1;`)
    expect(out).toBe(`${block}--> statement-breakpoint\nSELECT 1;`)
  })
})
