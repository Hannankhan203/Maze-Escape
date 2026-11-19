import { useCallback, useEffect, useRef } from 'react'
import { createRunTimer, formatElapsedTime } from '../game/mechanics/runTimer.js'

/**
 * React hook driving a zero-drift elapsed run timer that updates a DOM ref
 * directly at 100ms intervals without triggering React component re-renders.
 *
 * Automatically pauses when menus/modals open, when the browser tab becomes
 * hidden, or when the run ends in victory or game over.
 */
export function useRunTimer({
  resetKey,
  isPaused = false,
  hasWon = false,
  isGameOver = false,
  onVictoryTime = null,
  onGameOverTime = null,
}) {
  const timeDisplayRef = useRef(null)
  const timerRef = useRef(null)
  const prevResetKeyRef = useRef(null)
  const recordedWinKeyRef = useRef(null)
  const recordedGameOverKeyRef = useRef(null)
  const onVictoryTimeRef = useRef(onVictoryTime)
  const onGameOverTimeRef = useRef(onGameOverTime)

  useEffect(() => {
    onVictoryTimeRef.current = onVictoryTime
  }, [onVictoryTime])

  useEffect(() => {
    onGameOverTimeRef.current = onGameOverTime
  }, [onGameOverTime])

  useEffect(() => {
    if (!timerRef.current) {
      timerRef.current = createRunTimer()
    }
    const timer = timerRef.current

    if (prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey
      timer.reset({ autoStart: false })
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = formatElapsedTime(0)
      }
    }

    const updateDomText = () => {
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = timer.getFormattedTime()
      }
    }

    const isTabHidden = () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden'

    let intervalId = null

    const stopTickInterval = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    const syncTimerLifecycle = () => {
      const shouldRun = !isPaused && !hasWon && !isGameOver && !isTabHidden()
      timer.sync(shouldRun)
      updateDomText()

      if (shouldRun) {
        if (intervalId === null && typeof window !== 'undefined') {
          intervalId = window.setInterval(updateDomText, 100)
        }
      } else {
        stopTickInterval()
      }
    }

    syncTimerLifecycle()

    if (hasWon && recordedWinKeyRef.current !== resetKey) {
      recordedWinKeyRef.current = resetKey
      const frozenElapsedMs = Math.round(timer.getElapsedMs())
      const targetKey = resetKey
      queueMicrotask(() => {
        onVictoryTimeRef.current?.(frozenElapsedMs, targetKey)
      })
    }

    if (isGameOver && recordedGameOverKeyRef.current !== resetKey) {
      recordedGameOverKeyRef.current = resetKey
      const frozenElapsedMs = Math.round(timer.getElapsedMs())
      const targetKey = resetKey
      queueMicrotask(() => {
        onGameOverTimeRef.current?.(frozenElapsedMs, targetKey)
      })
    }

    const handleVisibilityChange = () => {
      syncTimerLifecycle()
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      stopTickInterval()
      if (
        typeof document !== 'undefined' &&
        typeof document.removeEventListener === 'function'
      ) {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [resetKey, isPaused, hasWon, isGameOver])

  const getFormattedTime = useCallback(
    () => (timerRef.current ? timerRef.current.getFormattedTime() : formatElapsedTime(0)),
    []
  )

  return {
    timeDisplayRef,
    getFormattedTime,
  }
}
