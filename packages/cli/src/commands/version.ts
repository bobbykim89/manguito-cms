// manguito version:diff / version:cut / version:retire — the schema version lifecycle
import fs from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import {
  loadVersionSnapshots,
  computeVersionModel,
  describeSchemaChange,
  type SchemaRegistry,
  type VersionModel,
  type VersionSnapshot,
  type ResolvedSchemaConfig,
  type ParseError,
} from '@bobbykim/manguito-cms-core'
import { loadEnvFile } from '../utils/env.js'
import { resolveConfig } from '../utils/config.js'
import { loadWorkingRegistry } from '../utils/registry.js'
import { resolveSchemaConfig } from '../utils/schema-config.js'
import { printValidationErrors, printSuccess, printGuidedError } from '../utils/error.js'
import { createPromptAdapter, type PromptAdapter } from '../utils/prompt.js'
import { formatSchemaChange } from './version-report.js'
import { copySnapshotFolders, retireSnapshotDir } from './version-fs.js'

/**
 * The snapshot the working schema is a successor to: the HIGHEST-numbered
 * one, not the last created. The live set can have gaps once versions are
 * retired, and `current` is derived from the highest.
 *
 * loadVersionSnapshots already returns them ordered by numeric version, so
 * this is the last element — but it is written to not depend on that, because
 * a caller passing an unordered array should still get the right answer.
 */
export function highestSnapshot(snapshots: VersionSnapshot[]): VersionSnapshot | null {
  let best: VersionSnapshot | null = null
  let bestN = -1
  for (const s of snapshots) {
    const n = Number.parseInt(s.version.replace(/^v/, ''), 10)
    if (Number.isNaN(n) || n <= bestN) continue
    best = s
    bestN = n
  }
  return best
}

type VersionContext = {
  schema: ResolvedSchemaConfig
  registry: SchemaRegistry
  snapshots: VersionSnapshot[]
  model: VersionModel
}

/**
 * The preamble every version command shares: env, config, working registry,
 * snapshots, model. Exits 1 with the model's own errors when it is invalid —
 * which is also what makes cutting safe to offer, since a blocker would be
 * failing here rather than appearing after the cut.
 */
async function loadVersionContext(
  options: { env?: string },
  deps: { cwd: string },
  command: string
): Promise<VersionContext> {
  loadEnvFile(options.env)
  const config = await resolveConfig(deps.cwd)
  const schema = resolveSchemaConfig(deps.cwd, config)
  const registry = loadWorkingRegistry(deps.cwd, config, command)

  const snapshots = loadVersionSnapshots(schema, registry)
  if (!snapshots.ok) {
    printValidationErrors(snapshots.errors, 'Snapshot errors', command)
    process.exit(1)
  }

  const model = computeVersionModel({ current: registry, snapshots: snapshots.value })
  if (!model.ok) {
    printValidationErrors(model.errors, 'Version model errors', command)
    process.exit(1)
  }

  return { schema, registry, snapshots: snapshots.value, model: model.value }
}

/**
 * The tombstones that retiring `retiring` would orphan — computed BEFORE
 * anything is deleted, by recomputing the model without that snapshot and
 * reading its ORPHANED_TOMBSTONE errors.
 *
 * Removing a snapshot can only ever introduce that one error class: fewer
 * live versions means fewer columns to satisfy and fewer types to compare,
 * so VERSION_COLUMN_MISSING and FIELD_TYPE_CHANGED_WHILE_LIVE cannot newly
 * appear. Every other error is filtered out rather than reported, so a
 * pre-existing problem elsewhere is not blamed on the retirement.
 */
export function orphanedTombstoneErrors(input: {
  registry: SchemaRegistry
  snapshots: VersionSnapshot[]
  retiring: string
}): ParseError[] {
  const remaining = input.snapshots.filter((s) => s.version !== input.retiring)
  const model = computeVersionModel({ current: input.registry, snapshots: remaining })
  if (model.ok) return []
  return model.errors.filter((e) => e.code === 'ORPHANED_TOMBSTONE')
}

export function registerVersion(program: Command): void {
  program
    .command('version:diff')
    .description('Show what cutting a new version would freeze')
    .option('--env <path>', 'path to .env file to load')
    .action(async (options: { env?: string }) => {
      await runVersionDiff(options, { cwd: process.cwd() })
    })

  program
    .command('version:cut')
    .description('Freeze the working schema as a new version')
    .option('--env <path>', 'path to .env file to load')
    .option('--yes', 'skip the confirmation prompt')
    .action(async (options: { env?: string; yes?: boolean }) => {
      await runVersionCut(options, { cwd: process.cwd(), prompt: createPromptAdapter() })
    })

  program
    .command('version:retire <version>')
    .description('Stop serving a cut version and delete its snapshot')
    .option('--env <path>', 'path to .env file to load')
    .option('--yes', 'skip the confirmation prompt')
    .action(async (version: string, options: { env?: string; yes?: boolean }) => {
      await runVersionRetire(version, options, { cwd: process.cwd(), prompt: createPromptAdapter() })
    })
}

export async function runVersionDiff(
  options: { env?: string },
  deps: { cwd: string }
): Promise<void> {
  const ctx = await loadVersionContext(options, deps, 'manguito version:diff')
  const from = highestSnapshot(ctx.snapshots)

  const change = describeSchemaChange({
    from,
    to: { version: ctx.model.current, registry: ctx.registry },
  })

  process.stdout.write(`${formatSchemaChange(change)}\n`)

  if (change.identical) {
    process.stdout.write(`\nNothing to cut — ${ctx.model.current} would expose the same contract.\n`)
    return
  }
  printSuccess(`Cutting now would create ${ctx.schema.base_path}/versions/${ctx.model.current}/`)
}

export async function runVersionCut(
  options: { env?: string; yes?: boolean },
  deps: { cwd: string; prompt: PromptAdapter }
): Promise<void> {
  const ctx = await loadVersionContext(options, deps, 'manguito version:cut')
  const from = highestSnapshot(ctx.snapshots)
  const version = ctx.model.current

  const change = describeSchemaChange({
    from,
    to: { version, registry: ctx.registry },
  })

  if (change.identical) {
    printGuidedError(
      `Nothing has changed since ${from?.version ?? 'the last cut'} — cutting ${version} would freeze an identical contract.`,
      'A live version commits you to retaining every column it exposes. Change the schema first, or run `manguito version:retire <version>` if you meant to shrink the live set.'
    )
    process.exit(1)
  }

  const versionsDir = path.join(ctx.schema.base_path, 'versions')
  const target = path.join(versionsDir, version)

  // Near-unreachable: `current` is one past the highest snapshot, so `target`
  // cannot already be a snapshot directory. But a FILE named `v3` is skipped
  // by snapshot discovery while still blocking mkdir, so it is checked rather
  // than assumed.
  if (fs.existsSync(target)) {
    printGuidedError(
      `${target} already exists.`,
      'A snapshot directory is never overwritten. Remove or rename it, then run version:cut again.'
    )
    process.exit(1)
  }

  process.stdout.write(`${formatSchemaChange(change)}\n\n`)
  const live = [...ctx.model.live.filter((v) => v !== version), version].join(' ')
  process.stdout.write(
    `After cutting, ${live} are live. Every column those versions expose must stay in the\n` +
      `schema — as a live field or a tombstone — until you retire them.\n\n`
  )

  if (options.yes !== true) {
    const ok = await deps.prompt.confirm(`Freeze the working schema as ${version}?`)
    if (!ok) {
      process.stdout.write('Cancelled. Nothing was written.\n')
      return
    }
  }

  // Written to a temp name and renamed, so the snapshot exists whole or not
  // at all: a PARTIAL snapshot parses as a valid but incomplete version,
  // which silently drops columns from the union. The temp name deliberately
  // does not match /^v\d+$/, so a leftover from a crash is invisible to
  // snapshot discovery instead of being read as a broken version.
  const staging = path.join(versionsDir, `.${version}.tmp`)
  fs.rmSync(staging, { recursive: true, force: true })
  try {
    copySnapshotFolders({ fromRoot: ctx.schema.base_path, toDir: staging, folders: ctx.schema.folders })
    fs.renameSync(staging, target)
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true })
    printGuidedError(
      `Failed to write ${target}: ${err instanceof Error ? err.message : String(err)}`,
      'Nothing was left behind — the snapshot is written to a temporary directory and renamed into place only once it is complete.'
    )
    process.exit(1)
  }

  printSuccess(`Froze the working schema as ${version} at ${target}`)
  process.stdout.write(`Live: ${live}.  Working schema is now v${Number.parseInt(version.slice(1), 10) + 1}.\n`)
}

export async function runVersionRetire(
  version: string,
  options: { env?: string; yes?: boolean },
  deps: { cwd: string; prompt: PromptAdapter }
): Promise<void> {
  if (!/^v\d+$/.test(version)) {
    printGuidedError(`"${version}" is not a version name.`, 'Expected v<number>, for example v1.')
    process.exit(1)
  }

  const ctx = await loadVersionContext(options, deps, 'manguito version:retire')

  if (!ctx.snapshots.some((s) => s.version === version)) {
    const existing = ctx.snapshots.map((s) => s.version).join(', ')
    printGuidedError(
      `${version} is not a cut version.`,
      existing === ''
        ? 'No versions have been cut yet — run `manguito version:cut` first.'
        : `Cut versions: ${existing}.`
    )
    process.exit(1)
  }

  // `current` is derived as highest + 1, so retiring the HIGHEST snapshot
  // renumbers the working schema backwards onto a number that was already
  // published — a consumer pinned to it would silently receive a different
  // contract. A version number has to mean one contract forever.
  const highest = highestSnapshot(ctx.snapshots)
  if (highest !== null && highest.version === version) {
    printGuidedError(
      `${version} is the newest cut version and cannot be retired.`,
      `The working schema is ${ctx.model.current} because ${version} is the highest snapshot — retiring it would renumber the working schema back onto ${version}, and anyone pinned to ${version} would get a different contract. Run \`manguito version:cut\` first; that makes ${version} retirable.`
    )
    process.exit(1)
  }

  const orphans = orphanedTombstoneErrors({
    registry: ctx.registry,
    snapshots: ctx.snapshots,
    retiring: version,
  })

  process.stdout.write(`Retiring ${version} will delete ${path.join(ctx.schema.base_path, 'versions', version)}\n\n`)
  if (orphans.length > 0) {
    process.stdout.write(
      `${orphans.length} tombstone${orphans.length === 1 ? '' : 's'} will be orphaned — their columns are no\n` +
        `longer exposed by any live version. You must then delete these fields:\n\n`
    )
    for (const o of orphans) {
      process.stdout.write(`  ${o.file}\n    ${o.message}\n\n`)
    }
    process.stdout.write(
      'Until you do, `manguito validate` will report ORPHANED_TOMBSTONE. Deleting them\n' +
        'shrinks the union and lets the next migration DROP those columns.\n\n'
    )
  }

  if (options.yes !== true) {
    const ok = await deps.prompt.confirm(`Retire ${version}?`)
    if (!ok) {
      process.stdout.write('Cancelled. Nothing was deleted.\n')
      return
    }
  }

  const versionsDir = path.join(ctx.schema.base_path, 'versions')
  try {
    retireSnapshotDir(versionsDir, version)
  } catch (err) {
    printGuidedError(
      `Failed to retire ${version}: ${err instanceof Error ? err.message : String(err)}`,
      'The snapshot is renamed out of the way before it is deleted, so the version is either fully retired or untouched.'
    )
    process.exit(1)
  }

  printSuccess(`Retired ${version}`)
  if (orphans.length > 0) {
    process.stdout.write(`\nDelete the ${orphans.length} orphaned tombstone field(s) listed above.\n`)
  }
}
