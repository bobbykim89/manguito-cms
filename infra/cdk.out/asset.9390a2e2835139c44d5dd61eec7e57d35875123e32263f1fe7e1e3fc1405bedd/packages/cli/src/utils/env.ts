import { existsSync } from 'node:fs'
import { config } from 'dotenv'
import { printGuidedError } from './error.js'

export function loadEnvFile(filePath: string | undefined | null): void {
  if (filePath == null) return

  if (!existsSync(filePath)) {
    printGuidedError(
      `Env file not found: ${filePath}`,
      'Check the file path and try again.'
    )
    process.exit(1)
  }

  config({ path: filePath })
}
