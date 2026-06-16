import type { MiddlewareHandler } from 'hono'

export const mustChangePasswordCheck: MiddlewareHandler = async (c, next) => {
  const user = c.get('user') as { must_change_password: boolean } | undefined

  if (
    user?.must_change_password === true &&
    c.req.path !== '/admin/api/users/change-password'
  ) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'You must change your password before continuing.',
        },
      },
      403,
    )
  }

  await next()
}
