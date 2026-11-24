import { useEffect, useState } from 'react'

export function AudioSubtitlesOverlay({ audioEngine, enabled = false, paused = false, gameOver = false, won = false }) {
  const [subtitles, setSubtitles] = useState([])

  useEffect(() => {
    if (!audioEngine || !enabled || paused || gameOver || won) {
      return undefined
    }

    const unsubscribe = audioEngine.subscribeSubtitles((entry) => {
      setSubtitles((prev) => {
        const next = [...prev, entry]
        if (next.length > 6) {
          next.shift()
        }
        return next
      })

      const timerId = setTimeout(() => {
        setSubtitles((prev) => prev.filter((s) => s.id !== entry.id))
      }, 4500)

      return () => {
        clearTimeout(timerId)
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [audioEngine, enabled, paused, gameOver, won])

  if (!enabled || !audioEngine || paused || gameOver || won || subtitles.length === 0) {
    return null
  }

  return (
    <div
      className="maze-subtitles-overlay"
      role="status"
      aria-live="polite"
      aria-label="Audio subtitles"
      data-subtitles-overlay="true"
    >
      {subtitles.map((sub) => (
        <div key={sub.id} className="maze-subtitle-item" data-subtitle-id={sub.id}>
          <span className="maze-subtitle-item__text">{sub.text}</span>
        </div>
      ))}
    </div>
  )
}

export default AudioSubtitlesOverlay
