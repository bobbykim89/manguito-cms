import { readFileSync } from 'node:fs'
import path from 'node:path'

export type DestructiveOperation = {
  file: string
  operation: string
  pattern: 'DROP_COLUMN' | 'DROP_TABLE' | 'ALTER_COLUMN_TYPE'
}

export type ScanResult = {
  hasDestructiveOperations: boolean
  operations: DestructiveOperation[]
}

function formatDropColumn(line: string): string {
  const upper = line.toUpperCase()
  const tableStart = upper.indexOf('ALTER TABLE') + 'ALTER TABLE'.length
  const dropIdx = upper.indexOf('DROP COLUMN')
  const colStart = dropIdx + 'DROP COLUMN'.length

  if (tableStart < 0 || dropIdx < 0) return line.trim()

  const tableName = line.slice(tableStart, dropIdx).trim().replace(/"/g, '').replace(/;/g, '')
  const colName = (line.slice(colStart).trim().replace(/"/g, '').split(/\s+/)[0] ?? '').replace(/;/g, '')

  if (!tableName || !colName) return line.trim()

  return `DROP COLUMN ${tableName}.${colName}`
}

function formatDropTable(line: string): string {
  const upper = line.toUpperCase()
  const tableStart = upper.indexOf('DROP TABLE') + 'DROP TABLE'.length

  if (tableStart < 'DROP TABLE'.length) return line.trim()

  const tableName = (line.slice(tableStart).trim().replace(/"/g, '').split(/\s+/)[0] ?? '').replace(/;/g, '')

  if (!tableName) return line.trim()

  return `DROP TABLE ${tableName}`
}

function formatAlterColumnType(line: string): string {
  const upper = line.toUpperCase()
  const tableStart = upper.indexOf('ALTER TABLE') + 'ALTER TABLE'.length
  const alterColIdx = upper.indexOf('ALTER COLUMN')
  const colStart = alterColIdx + 'ALTER COLUMN'.length
  const typeIdx = upper.indexOf(' TYPE ', colStart)

  if (tableStart < 0 || alterColIdx < 0 || typeIdx < 0) return line.trim()

  const tableName = line.slice(tableStart, alterColIdx).trim().replace(/"/g, '')
  const colName = line.slice(colStart, typeIdx).trim().replace(/"/g, '')
  const newType = (line.slice(typeIdx + ' TYPE '.length).trim().split(/\s+/)[0] ?? '').replace(/;/g, '')

  if (!tableName || !colName || !newType) return line.trim()

  return `ALTER COLUMN ${tableName}.${colName} TYPE ${newType}`
}

export function scanMigrationFiles(filePaths: string[]): ScanResult {
  const operations: DestructiveOperation[] = []

  for (const filePath of filePaths) {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const filename = path.basename(filePath)

    for (const line of lines) {
      const upper = line.trim().toUpperCase()

      if (upper.includes('DROP COLUMN')) {
        operations.push({
          file: filename,
          operation: formatDropColumn(line),
          pattern: 'DROP_COLUMN',
        })
      } else if (upper.includes('DROP TABLE')) {
        operations.push({
          file: filename,
          operation: formatDropTable(line),
          pattern: 'DROP_TABLE',
        })
      } else if (upper.includes('ALTER COLUMN') && upper.includes(' TYPE ')) {
        operations.push({
          file: filename,
          operation: formatAlterColumnType(line),
          pattern: 'ALTER_COLUMN_TYPE',
        })
      }
    }
  }

  return {
    hasDestructiveOperations: operations.length > 0,
    operations,
  }
}
