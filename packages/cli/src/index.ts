#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import { registerInit } from './commands/init.js'
import { registerBuild } from './commands/build.js'
import { registerDev } from './commands/dev.js'
import { registerStart } from './commands/start.js'
import { registerMigrate } from './commands/migrate.js'
import { registerValidate } from './commands/validate.js'
import { registerCreateSuperuser } from './commands/createsuperuser.js'
import { registerUsers } from './commands/users.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

const program = new Command()
  .name('manguito')
  .description('Manguito CMS — developer lifecycle CLI')
  .version(version)

registerInit(program)
registerBuild(program)
registerDev(program)
registerStart(program)
registerMigrate(program)
registerValidate(program)
registerCreateSuperuser(program)
registerUsers(program)

program.parse()
