import { useEffect, useState } from 'react'

export default function StartTransitionOverlay({
  isOpen,
  onComplete,
  isMazeReady,
}) {
  const [phaseIndex, setPhaseIndex] = useState(0)
  const phases = [
    { title: "DESCENDING INTO THE FACILITY...", level: "SURFACE LEVEL" },
    { title: "MAINTENANCE CORRIDORS", level: "LEVEL -1" },
    { title: "SUB-VAULT ACCESS", level: "LEVEL -2" },
    { title: "ABANDONED SECTOR", level: "LEVEL -3" },
  ]

  useEffect(() => {
    if (!isOpen) return undefined

    const intervalId = window.setInterval(() => {
      setPhaseIndex((prev) => (prev < phases.length - 1 ? prev + 1 : prev))
    }, 700)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isOpen, phases.length])

  useEffect(() => {
    if (!isOpen) return undefined

    let isMinTimeElapsed = false
    const minTimer = window.setTimeout(() => {
      isMinTimeElapsed = true
      if (isMazeReady) {
        onComplete?.()
      }
    }, 2600)

    const checkInterval = window.setInterval(() => {
      if (isMinTimeElapsed && isMazeReady) {
        window.clearInterval(checkInterval)
        onComplete?.()
      }
    }, 100)

    const safetyTimer = window.setTimeout(() => {
      onComplete?.()
    }, 10000)

    return () => {
      window.clearTimeout(minTimer)
      window.clearInterval(checkInterval)
      window.clearTimeout(safetyTimer)
    }
  }, [isOpen, isMazeReady, onComplete])

  if (!isOpen) return null

  const currentPhase = phases[phaseIndex]

  return (
    <div className="lv-start-transition" role="dialog" aria-label="Descending into facility">
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
