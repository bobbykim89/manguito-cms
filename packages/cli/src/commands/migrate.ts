// manguito migrate — apply pending database migrations
import type { Command } from 'commander'

export function registerMigrate(program: Command): void {
  program
    .command('migrate')
    .description('Apply pending database migrations')
    .option('--env <path>', 'path to .env file to load')
    .option('--status', 'show migration state without applying')
    .option('--dry-run', 'preview migrations without writing')
    .option('--force', 'skip destructive-change confirmation prompt')
  // TODO: implement action
}
