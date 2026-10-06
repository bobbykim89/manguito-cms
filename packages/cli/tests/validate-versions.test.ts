import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { makeTempProject, run, snapshot, type TempProject } from './support/temp-project.js'

let project: TempProject

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))
vi.mock('../src/utils/config.js', () => ({
  // Read lazily: `project` is assigned in beforeEach, after this factory runs.
  resolveConfig: vi.fn(async () => ({
    schema: {
      base_path: project.schemas,
      folders: {
        content_types: 'content-types',
        paragraph_types: 'paragraph-types',
        taxonomy_types: 'taxonomy-types',
        enum_types: 'enum-types',
      },
    },
    api: { prefix: '/api', media: undefined },
    programmatic: { dir: './src/programmatic' },
  })),
}))

import { runValidate } from '../src/commands/validate.js'
import { runBuild } from '../src/commands/build.js'

const title = { name: 'title', label: 'Title', type: 'text/plain', required: false }

// Fragments of core's own messages. The CLI prints messages, not codes.
const ORPHANED = 'no live version exposes that column any more'
const TYPE_CHANGED = 'is exposed by live version v1 as text/plain, but the current schema now types it integer'

beforeEach(() => {
  project = makeTempProject()
})
afterEach(() => {
  project.cleanup()
})

describe('manguito validate — version model', () => {
  it('rejects a tombstone no live version exposes (ORPHANED_TOMBSTONE)', async () => {
    // The case version:retire tells the author validate will report.
    // MUTATION: drop the loadProjectVersionModel call from runValidate.
    // validate then prints "No errors found" and exits normally.
    project.writeType('content--blog_post', [
      title,
      { name: 'legacy', column: 'legacy_col', label: 'Legacy', type: 'text/plain', required: false, removed: true },
    ])

    const result = await run(() => runValidate({}, { cwd: project.root }))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(ORPHANED)
  })

  it('rejects a type change while a version is live (FIELD_TYPE_CHANGED_WHILE_LIVE)', async () => {
    // MUTATION: drop the loadProjectVersionModel call from runValidate.
    project.writeType('content--blog_post', [title])
    snapshot(project, 'v1')
    project.writeType('content--blog_post', [{ ...title, type: 'integer' }])

    const result = await run(() => runValidate({}, { cwd: project.root }))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(TYPE_CHANGED)
  })

  it('names a snapshot that does not parse (VERSION_SNAPSHOT_INVALID)', async () => {
    // Review Focus #1: a hand-edited or half-copied snapshot.
    // MUTATION: drop the loadProjectVersionModel call from runValidate.
    project.writeType('content--blog_post', [title])
    snapshot(project, 'v1')
    fs.writeFileSync(
      path.join(project.schemas, 'versions', 'v1', 'content-types', 'content--blog_post.json'),
      '{ not json'
    )

    const result = await run(() => runValidate({}, { cwd: project.root }))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(path.join('versions', 'v1'))
  })

  it('passes a valid versioned project and reports the live set', async () => {
    // A declared rename while v1 is live is exactly what versioning is for.
    // MUTATION: in runValidate, pass an empty registry to the helper. The
    // model then reports v1's column as missing (VERSION_COLUMN_MISSING).
    project.writeType('content--blog_post', [title])
    snapshot(project, 'v1')
    project.writeType('content--blog_post', [{ ...title, name: 'heading', column: 'title' }])

    const result = await run(() => runValidate({}, { cwd: project.root }))

    expect(result.exitCode).toBeNull()
    expect(result.stdout).toContain('Versions valid (live: v1, v2)')
    expect(result.stdout).toContain('No errors found')
  })

  it('does not pile version errors on top of a cross-reference error', async () => {
    // Version checks need a registry that is otherwise sound; against a broken
    // one every version error is noise caused by the first.
    // MUTATION: run the version check even when crossRefErrors is non-empty.
    // The orphaned-tombstone message then also appears.
    project.writeType('content--blog_post', [
      title,
      { name: 'author', label: 'Author', type: 'reference', target: 'content--does_not_exist', rel: 'one-to-one', required: false },
      { name: 'legacy', column: 'legacy_col', label: 'Legacy', type: 'text/plain', required: false, removed: true },
    ])

    const result = await run(() => runValidate({}, { cwd: project.root }))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('content--does_not_exist')
    expect(result.stderr).not.toContain(ORPHANED)
  })
})

describe('manguito build — version model', () => {
  it('rejects the same error as validate, before writing any generated file', async () => {
    // The spec's invariant: validate and build reject the same version errors.
    // MUTATION: move build's version check back to after the codegen writes.
    // dist/generated then exists when build exits.
    project.writeType('content--blog_post', [title])
    snapshot(project, 'v1')
    project.writeType('content--blog_post', [{ ...title, type: 'integer' }])

    const result = await run(() => runBuild({}, { cwd: project.root }))

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(TYPE_CHANGED)
    expect(fs.existsSync(path.join(project.root, 'dist', 'generated'))).toBe(false)
  })
})
