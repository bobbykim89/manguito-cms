import type { ParsedRole } from '@bobbykim/manguito-cms-core'
import { useAuthStore } from '../stores/auth'
import { useSchemaStore } from '../stores/schema'

export function usePermission() {
  const auth = useAuthStore()
  const schema = useSchemaStore()

  function can(permission: string): boolean {
    return auth.permissions.includes(permission)
  }

  function rolesBelow(): ParsedRole[] {
    return schema.roles.filter(
      r => r.hierarchy_level > auth.hierarchyLevel && r.name !== 'admin'
    )
  }

  return { can, rolesBelow }
}
