import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { printGuidedError, printWarning, printSuccess } from '../utils/error.js'

describe('printGuidedError', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('output starts with ✖', () => {
    printGuidedError('something went wrong')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/^✖/))
  })

  it('includes the message text', () => {
    printGuidedError('something went wrong')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('something went wrong'))
  })

  it('with hint prints hint on next line indented two spaces', () => {
    printGuidedError('main error', 'run migrate first')
    const calls = (stderrSpy.mock.calls as [string][]).map(([arg]) => arg)
    const hintCall = calls.find((s) => s.includes('run migrate first'))
    expect(hintCall).toBeDefined()
    expect(hintCall).toMatch(/^ {2}/)
  })

  it('without hint prints only one line', () => {
    printGuidedError('no hint here')
    expect(stderrSpy).toHaveBeenCalledTimes(1)
  })
})

describe('printWarning', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('output starts with ⚠', () => {
    printWarning('watch out')
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringMatching(/^⚠/))
  })
})

describe('printSuccess', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('output starts with ✔', () => {
    printSuccess('done')
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringMatching(/^✔/))
  })
})
