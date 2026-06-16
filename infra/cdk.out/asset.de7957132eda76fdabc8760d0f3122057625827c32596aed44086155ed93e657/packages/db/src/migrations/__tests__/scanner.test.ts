import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanMigrationFiles } from '../scanner'

function writeTmp(name: string, content: string): string {
  const filePath = path.join(tmpdir(), name)
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

describe('scanMigrationFiles — no destructive operations', () => {
  const files: string[] = []

  afterEach(() => {
    files.splice(0).forEach((f) => unlinkSync(f))
  })

  it('returns false and empty array for clean migration file', () => {
    const file = writeTmp('clean.sql', [
      'CREATE TABLE "blog_post" ("id" serial PRIMARY KEY);',
      'ALTER TABLE "blog_post" ADD COLUMN "title" text NOT NULL;',
    ].join('\n'))
    files.push(file)

    const result = scanMigrationFiles([file])
    expect(result).toEqual({ hasDestructiveOperations: false, operations: [] })
  })

  it('returns false and empty array for empty file array', () => {
    const result = scanMigrationFiles([])
    expect(result).toEqual({ hasDestructiveOperations: false, operations: [] })
  })
})

describe('scanMigrationFiles — DROP_COLUMN', () => {
  const files: string[] = []

  afterEach(() => {
    files.splice(0).forEach((f) => unlinkSync(f))
  })

  it('detects DROP COLUMN and returns correct file, operation, and pattern', () => {
    const file = writeTmp('0001_drop_col.sql', 'ALTER TABLE "blog_post" DROP COLUMN "summary";')
    files.push(file)

    const result = scanMigrationFiles([file])
    expect(result.hasDestructiveOperations).toBe(true)
    expect(result.operations).toHaveLength(1)
    expect(result.operations[0]).toEqual({
      file: '0001_drop_col.sql',
      operation: 'DROP COLUMN blog_post.summary',
      pattern: 'DROP_COLUMN',
    })
  })

  it('detects lowercase drop column (case-insensitive)', () => {
    const file = writeTmp('0001_drop_col_lower.sql', 'alter table "blog_post" drop column "summary";')
    files.push(file)

    const result = scanMigrationFiles([file])
    expect(result.hasDestructiveOperations).toBe(true)
    expect(result.operations[0].pattern).toBe('DROP_COLUMN')
    expect(result.operations[0].operation).toBe('DROP COLUMN blog_post.summary')
  })
})

describe('scanMigrationFiles — DROP_TABLE', () => {
  const files: string[] = []

  afterEach(() => {
    files.splice(0).forEach((f) => unlinkSync(f))
  })

  it('detects DROP TABLE and returns correct file, operation, and pattern', () => {
    const file = writeTmp('0002_drop_table.sql', 'DROP TABLE "paragraph_photo_card";')
    files.push(file)

    const result = scanMigrationFiles([file])
    expect(result.hasDestructiveOperations).toBe(true)
    expect(result.operations).toHaveLength(1)
    expect(result.operations[0]).toEqual({
      file: '0002_drop_table.sql',
      operation: 'DROP TABLE paragraph_photo_card',
      pattern: 'DROP_TABLE',
    })
  })

  it('detects lowercase drop table (case-insensitive)', () => {
    const file = writeTmp('0002_drop_table_lower.sql', 'drop table "paragraph_photo_card";')
    files.push(file)

    const result = scanMigrationFiles([file])
    expect(result.hasDestructiveOperations).toBe(true)
    expect(result.operations[0].pattern).toBe('DROP_TABLE')
    expect(result.operations[0].operation).toBe('DROP TABLE paragraph_photo_card')
  })
})

describe('scanMigrationFiles — ALTER_COLUMN_TYPE', () => {
  const files: string[] = []

  afterEach(() => {
    files.splice(0).forEach((f) => unlinkSync(f))
  })

  it('detects ALTER COLUMN TYPE and returns correct file, operation, and pattern', () => {
    const file = writeTmp('0003_alter_type.sql', 'ALTER TABLE "blog_post" ALTER COLUMN "price" TYPE integer;')
    files.push(file)

    const result = scanMigrationFiles([file])
    expect(result.hasDestructiveOperations).toBe(true)
    expect(result.operations).toHaveLength(1)
    expect(result.operations[0]).toEqual({
      file: '0003_alter_type.sql',
      operation: 'ALTER COLUMN blog_post.price TYPE integer',
      pattern: 'ALTER_COLUMN_TYPE',
    })
  })

  it('does NOT flag ALTER COLUMN without TYPE keyword', () => {
    const file = writeTmp('0003_alter_no_type.sql', 'ALTER TABLE "blog_post" ALTER COLUMN "price" SET DEFAULT 0;')
    files.push(file)

    const result = scanMigrationFiles([file])
    expect(result).toEqual({ hasDestructiveOperations: false, operations: [] })
  })
})

describe('scanMigrationFiles — multiple operations', () => {
  const files: string[] = []

  afterEach(() => {
    files.splice(0).forEach((f) => unlinkSync(f))
  })

  it('returns all destructive operations from a single file with two', () => {
    const file = writeTmp('0004_multi.sql', [
      'ALTER TABLE "blog_post" DROP COLUMN "summary";',
      'DROP TABLE "paragraph_photo_card";',
    ].join('\n'))
    files.push(file)

    const result = scanMigrationFiles([file])
    expect(result.hasDestructiveOperations).toBe(true)
    expect(result.operations).toHaveLength(2)
    expect(result.operations[0].pattern).toBe('DROP_COLUMN')
    expect(result.operations[1].pattern).toBe('DROP_TABLE')
  })

  it('attributes operations to correct files across two files', () => {
    const fileA = writeTmp('0005_file_a.sql', 'ALTER TABLE "blog_post" DROP COLUMN "summary";')
    const fileB = writeTmp('0005_file_b.sql', 'DROP TABLE "paragraph_photo_card";')
    files.push(fileA, fileB)

    const result = scanMigrationFiles([fileA, fileB])
    expect(result.hasDestructiveOperations).toBe(true)
    expect(result.operations).toHaveLength(2)

    const opA = result.operations.find((o) => o.file === '0005_file_a.sql')
    const opB = result.operations.find((o) => o.file === '0005_file_b.sql')

    expect(opA?.pattern).toBe('DROP_COLUMN')
    expect(opB?.pattern).toBe('DROP_TABLE')
  })

  it('only returns destructive operations when batch has one clean and one destructive file', () => {
    const clean = writeTmp('0006_clean.sql', [
      'CREATE TABLE "new_table" ("id" serial PRIMARY KEY);',
      'ALTER TABLE "new_table" ADD COLUMN "name" text NOT NULL;',
    ].join('\n'))
    const destructive = writeTmp('0006_destructive.sql', 'ALTER TABLE "blog_post" DROP COLUMN "summary";')
    files.push(clean, destructive)

    const result = scanMigrationFiles([clean, destructive])
    expect(result.hasDestructiveOperations).toBe(true)
    expect(result.operations).toHaveLength(1)
    expect(result.operations[0].file).toBe('0006_destructive.sql')
  })
})
