// Serializes dev reloads. A trigger starts `run` when idle; triggers that
// arrive during a run share one follow-up run, which starts when the current
// run settles. The promise a trigger returns resolves once a run that started
// after the trigger has settled, and never rejects: a failing `run` is the
// caller's to report, and must not stop the queue.
export function createReloadQueue(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined
  let followUp: Promise<void> | undefined

  function start(): Promise<void> {
    const current = (async () => {
      try {
        await run()
      } catch {
        // swallowed on purpose: see above
      }
    })()
    running = current
    void current.then(() => {
      if (running === current) running = undefined
    })
    return current
  }

  return function trigger(): Promise<void> {
    if (running === undefined) return start()
    if (followUp === undefined) {
      followUp = running.then(() => {
        followUp = undefined
        return start()
      })
    }
    return followUp
  }
}
