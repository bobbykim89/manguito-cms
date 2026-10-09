import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '../error'

function appThrowing(err: unknown) {
  const app = new Hono()
  app.get('/boom', () => {
    throw err
  })
  app.onError(errorHandler)
  return app
}

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

describe('errorHandler', () => {
  it('hides an uncoded error behind a generic message, and still logs it', async () => {
    // MUTATION: keep `message: err.message`. The response then carries the SQL
    // and its parameter values, as the relation probe measured.
    const res = await appThrowing(new Error('Failed query: DELETE FROM "secret_table" params: 42')).request('/boom')
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
    expect(text).not.toContain('secret_table')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('hides a driver error whose code is a Postgres SQLSTATE', async () => {
    // MUTATION: pass through any error with a `code`. "23503" is a code too.
    const res = await appThrowing(Object.assign(new Error('violates foreign key "fk_x"'), { code: '23503' })).request('/boom')
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('fk_x')
  })

  it('keeps the message of a deliberately coded error', async () => {
    // MUTATION: hide every message. Clients lose "Not found" and every 4xx reason.
    const res = await appThrowing(Object.assign(new Error('No such post'), { code: 'NOT_FOUND' })).request('/boom')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'No such post' } })
  })
})
