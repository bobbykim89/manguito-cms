import type { AdminAdapter } from '@bobbykim/manguito-cms-core'

export type AdminAdapterOptions = {
  prefix?: string
}

export function createAdminAdapter(
  options: AdminAdapterOptions = {}
): AdminAdapter {
  const prefix = options.prefix ?? '/admin'

  return { prefix }
}
