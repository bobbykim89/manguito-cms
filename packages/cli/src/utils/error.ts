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

export function printValidationErrors(
  errors: Array<{ file: string; message: string }>,
  title: string,
  command: string
): void {
  process.stderr.write(`✖ ${title}:\n\n`)

  const byFile = new Map<string, string[]>()
  for (const error of errors) {
    const list = byFile.get(error.file)
    if (list !== undefined) {
      list.push(error.message)
    } else {
      byFile.set(error.file, [error.message])
    }
  }

  for (const [file, messages] of byFile) {
    process.stderr.write(`  ${file}\n`)
    for (const msg of messages) {
      process.stderr.write(`    ${msg}\n`)
    }
    process.stderr.write('\n')
  }

  const noun = errors.length === 1 ? 'error' : 'errors'
  process.stderr.write(
    `${errors.length} ${noun} found. Fix the above and run \`${command}\` again.\n`
  )
}
