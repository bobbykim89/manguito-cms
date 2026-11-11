import { describe, it, expect, vi } from 'vitest'
import { createReloadQueue } from '../reload-queue.js'

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void }

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Lets queued microtasks (the follow-up start) run.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('createReloadQueue', () => {
  it('never runs two reloads at once', async () => {
    // MUTATION: call `run` on every trigger. Two triggers then overlap and
    // the active count reaches 2.
    let active = 0
    let maxActive = 0
    const gates: Deferred[] = []
    const run = vi.fn(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      const gate = deferred()
      gates.push(gate)
      await gate.promise
      active--
    })
    const trigger = createReloadQueue(run)

    const first = trigger()
    const second = trigger()
    await flush()
    gates[0]!.resolve()
    await flush()
    gates[1]!.resolve()
    await Promise.all([first, second])

    expect(maxActive).toBe(1)
  })

  it('collapses triggers during a run into one more run', async () => {
    // MUTATION: queue every trigger as its own follow-up. Four triggers then
    // run 4 times instead of 2.
    const gates: Deferred[] = []
    const run = vi.fn(async () => {
      const gate = deferred()
      gates.push(gate)
      await gate.promise
    })
    const trigger = createReloadQueue(run)

    const promises = [trigger(), trigger(), trigger(), trigger()]
    await flush()
    gates[0]!.resolve()
    await flush()
    gates[1]?.resolve()
    await Promise.all(promises)

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('starts a new run for a trigger after the queue goes idle', async () => {
    // MUTATION: never reset the pending flag after the follow-up. A trigger
    // during the follow-up run is then treated as already covered, and the
    // run it asked for never happens.
    const gates: Deferred[] = []
    const run = vi.fn(async () => {
      const gate = deferred()
      gates.push(gate)
      await gate.promise
    })
    const trigger = createReloadQueue(run)

    const first = trigger()
    const second = trigger() // follow-up
    await flush()
    gates[0]!.resolve()
    await flush() // the follow-up is now the run in flight
    const third = trigger() // marks one more run
    gates[1]!.resolve()
    await flush()
    gates[2]!.resolve()
    await Promise.all([first, second, third])
    expect(run).toHaveBeenCalledTimes(3)

    const fourth = trigger() // idle again: starts at once
    await flush()
    gates[3]!.resolve()
    await fourth
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('keeps going after a run that rejects', async () => {
    // MUTATION: no catch around `run`. The rejection skips the follow-up and
    // the trigger promises reject.
    const gate = deferred()
    const run = vi.fn<() => Promise<void>>()
    run.mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined)
    const trigger = createReloadQueue(run)

    const first = trigger()
    const second = trigger()
    gate.reject(new Error('reload blew up'))

    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledTimes(2)
  })
})
