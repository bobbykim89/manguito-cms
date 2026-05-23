export function printGuidedError(message: string, hint?: string): void {
  process.stderr.write(`✖ ${message}\n`)
  if (hint !== undefined) {
    process.stderr.write(`  ${hint}\n`)
  }
}

export function printWarning(message: string, hint?: string): void {
  process.stdout.write(`⚠ ${message}\n`)
  if (hint !== undefined) {
    process.stdout.write(`  ${hint}\n`)
  }
}

export function printSuccess(message: string): void {
  process.stdout.write(`✔ ${message}\n`)
}
