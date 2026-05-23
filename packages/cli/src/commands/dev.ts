// manguito dev — start dev server with schema watching and Vite admin panel
import type { Command } from 'commander'

export function registerDev(program: Command): void {
  program
    .command('dev')
    .description('Start dev server with file watching and auto-migration')
    .option('--env <path>', 'path to .env file to load')
  // TODO: implement action
}
