// manguito validate — parse and validate all schemas, config, roles, routes
import type { Command } from 'commander'

export function registerValidate(program: Command): void {
  program
    .command('validate')
    .description('Parse and validate all schemas, config, roles, and routes')
    .option('--env <path>', 'path to .env file to load')
  // TODO: implement action
}
