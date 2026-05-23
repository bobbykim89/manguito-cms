// manguito build — run codegen, migrations, and compile to dist/
import type { Command } from 'commander'

export function registerBuild(program: Command): void {
  program
    .command('build')
    .description('Run codegen and compile project to dist/')
    .option('--env <path>', 'path to .env file to load')
  // TODO: implement action
}
