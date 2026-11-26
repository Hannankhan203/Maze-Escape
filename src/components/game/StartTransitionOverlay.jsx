import { useEffect, useRef, useState } from 'react'
import bgImage from '../../assets/images/start_screen_background_1795627907701.jpg'

export default function StartTransitionOverlay({
  isOpen,
  onComplete,
  isMazeReady,
  reducedMotion = false,
  minDurationMs = null,
}) {
  const [phaseIndex, setPhaseIndex] = useState(0)
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  const phases = [
    { title: "DESCENDING INTO THE FACILITY...", level: "SURFACE LEVEL" },
    { title: "MAINTENANCE CORRIDORS", level: "LEVEL -1" },
    { title: "SUB-VAULT ACCESS", level: "LEVEL -2" },
    { title: "ABANDONED SECTOR", level: "LEVEL -3" },
  ]

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    if (!isOpen) {
      completedRef.current = false
      return undefined
    }

    let stepCount = 0
    const stepMs = reducedMotion ? 90 : 700
    const intervalId = window.setInterval(() => {
      stepCount = Math.min(phases.length - 1, stepCount + 1)
      setPhaseIndex(stepCount)
    }, stepMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isOpen, phases.length, reducedMotion])

  useEffect(() => {
    if (!isOpen) return undefined

    const resolvedMinMs =
      Number.isFinite(Number(minDurationMs)) && Number(minDurationMs) >= 0
        ? Number(minDurationMs)
        : reducedMotion
          ? 320
          : 2600
    const resolvedSafetyMs = Math.max(resolvedMinMs + 1500, 10000)

    let isMinTimeElapsed = resolvedMinMs === 0
    const triggerCompleteOnce = () => {
      if (completedRef.current) return
      completedRef.current = true
      onCompleteRef.current?.()
    }

    if (isMinTimeElapsed && isMazeReady) {
      triggerCompleteOnce()
      return undefined
    }

    const minTimer = window.setTimeout(() => {
      isMinTimeElapsed = true
      if (isMazeReady) {
        triggerCompleteOnce()
      }
    }, resolvedMinMs)

    const checkInterval = window.setInterval(() => {
      if (isMinTimeElapsed && isMazeReady) {
        window.clearInterval(checkInterval)
        triggerCompleteOnce()
      }
    }, Math.min(100, Math.max(16, Math.floor(resolvedMinMs / 4) || 16)))

    const safetyTimer = window.setTimeout(() => {
      triggerCompleteOnce()
    }, resolvedSafetyMs)

    return () => {
      window.clearTimeout(minTimer)
      window.clearInterval(checkInterval)
      window.clearTimeout(safetyTimer)
    }
  }, [isOpen, isMazeReady, reducedMotion, minDurationMs])

  if (!isOpen) return null

  const currentPhase = phases[phaseIndex] || phases[0]

  return (
    <div
      className="lv-start-transition"
      role="dialog"
      aria-label="Descending into facility"
      data-testid="start-transition-overlay"
      data-reduced-motion={String(Boolean(reducedMotion))}
    >
      <div
        className="lv-start-transition__bg"
        style={{
          backgroundImage: `linear-gradient(rgba(5, 7, 11, 0.75), rgba(5, 7, 11, 0.95)), url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div className="lv-start-transition__crt-overlay" />
      <div className="lv-start-transition__flicker" />
      <div className="lv-start-transition__content">
        <div className="lv-start-transition__shaft" />
        <div className="lv-start-transition__elevator-cabin">
          <div className="lv-start-transition__indicator">
            <span className="lv-start-transition__level">{currentPhase.level}</span>
            <div className="lv-start-transition__light-bar" />
          </div>
          <h2 className="lv-start-transition__title">{currentPhase.title}</h2>
          <p className="lv-start-transition__hint">Initializing subterranean environment...</p>
        </div>
      </div>
    </div>
  )
}
