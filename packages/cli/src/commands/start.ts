// manguito start — run the production server from dist/
import type { Command } from 'commander'

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('Start the production server from dist/')
    .option('--env <path>', 'path to .env file to load')
  // TODO: implement action
}
