// manguito users:promote / users:demote — manage user roles
import type { Command } from 'commander'

export function registerUsers(program: Command): void {
  program
    .command('users:promote')
    .description('Promote a user to admin')
    .option('--env <path>', 'path to .env file to load')
    .option('--email <email>', 'email address of the user to promote')
  // TODO: implement action

  program
    .command('users:demote')
    .description('Demote an admin to a lower role')
    .option('--env <path>', 'path to .env file to load')
    .option('--email <email>', 'email address of the user to demote')
  // TODO: implement action
}
