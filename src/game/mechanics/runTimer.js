function defaultNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * Formats an elapsed duration in milliseconds as MM:SS.d (e.g. "01:23.4").
 */
export function formatElapsedTime(ms) {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0
  const totalTenths = Math.floor(safeMs / 100)
  const minutes = Math.floor(totalTenths / 600)
  const seconds = Math.floor((totalTenths % 600) / 10)
  const tenths = totalTenths % 10

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

/**
 * Drift-free stopwatch controller for Maze Escape runs.
 * Computes elapsed time from timestamp deltas rather than fixed tick accumulation.
 */
export function createRunTimer(options = {}) {
  const now = typeof options.now === 'function' ? options.now : defaultNow

  let accumulatedMs = 0
  let startedAt = null
  let hasStarted = false
  let isRunning = false
  let isPaused = false

  function getElapsedMs() {
    if (!isRunning || startedAt === null) {
      return accumulatedMs
    }
    const delta = Math.max(0, now() - startedAt)
    return accumulatedMs + delta
  }

  function start() {
    if (isRunning) {
      return getElapsedMs()
    }
    hasStarted = true
    isRunning = true
    isPaused = false
    startedAt = now()
    return accumulatedMs
  }

  function pause() {
    if (isRunning && startedAt !== null) {
      accumulatedMs += Math.max(0, now() - startedAt)
    }
    startedAt = null
    isRunning = false
    isPaused = true
    return accumulatedMs
  }

  function resume() {
    if (!hasStarted) {
      return start()
    }
    if (isRunning) {
      return getElapsedMs()
    }
    isRunning = true
    isPaused = false
    startedAt = now()
    return accumulatedMs
  }

  function reset(resetOptions = {}) {
    accumulatedMs = 0
    startedAt = null
    hasStarted = false
    isRunning = false
    isPaused = false
    if (resetOptions.autoStart) {
      start()
    }
    return 0
  }

  function sync(shouldRun) {
    if (shouldRun) {
      if (!hasStarted) {
        return start()
      }
      if (!isRunning) {
        return resume()
      }
      return getElapsedMs()
    }

    if (isRunning) {
      return pause()
    }
    if (hasStarted) {
      isPaused = true
    }
    return accumulatedMs
  }

  function getFormattedTime() {
    return formatElapsedTime(getElapsedMs())
  }

  function getState() {
    const elapsedMs = getElapsedMs()
    return {
      elapsedMs,
      formatted: formatElapsedTime(elapsedMs),
      hasStarted,
      isRunning,
      isPaused,
    }
  }

  if (options.autoStart) {
    start()
  }

  return {
    start,
    pause,
    resume,
    reset,
    sync,
    getElapsedMs,
    getFormattedTime,
    getState,
  }
}
