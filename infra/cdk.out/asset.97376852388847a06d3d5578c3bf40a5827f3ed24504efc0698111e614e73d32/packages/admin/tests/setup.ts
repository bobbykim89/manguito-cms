import { beforeAll, afterEach, afterAll } from 'vitest'
import { server } from '../src/test-utils/server'

export { server, testRoles, testUser } from '../src/test-utils/server'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
