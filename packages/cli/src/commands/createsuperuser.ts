// manguito createsuperuser — create initial admin user
import type { Command } from 'commander'

export function registerCreatesuperuser(program: Command): void {
  program
    .command('createsuperuser')
    .description('Create the initial admin user')
    .option('--env <path>', 'path to .env file to load')
  // TODO: implement action
}
