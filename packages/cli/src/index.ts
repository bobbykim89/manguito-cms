#!/usr/bin/env node
import { Command } from 'commander'
import { registerInit } from './commands/init.js'
import { registerDev } from './commands/dev.js'
import { registerBuild } from './commands/build.js'
import { registerStart } from './commands/start.js'
import { registerMigrate } from './commands/migrate.js'
import { registerValidate } from './commands/validate.js'
import { registerCreatesuperuser } from './commands/createsuperuser.js'
import { registerUsers } from './commands/users.js'

const program = new Command()
  .name('manguito')
  .description('Manguito CMS CLI')
  .version('0.0.1')

registerInit(program)
registerDev(program)
registerBuild(program)
registerStart(program)
registerMigrate(program)
registerValidate(program)
registerCreatesuperuser(program)
registerUsers(program)

program.parse()
