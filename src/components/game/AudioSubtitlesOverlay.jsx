import { useEffect, useRef, useState } from 'react'
import {
  SUBTITLE_LIFETIME_MS,
  SUBTITLE_MAX_ENTRIES,
  createSubtitleQueueController,
} from './subtitleQueue.js'

export function AudioSubtitlesOverlay({
  audioEngine,
  enabled = false,
  paused = false,
  gameOver = false,
  won = false,
}) {
  const [subtitles, setSubtitles] = useState([])
  const timersRef = useRef(new Map())
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const timersMap = timersRef.current
    const isActive = Boolean(audioEngine && enabled && !paused && !gameOver && !won)

    if (!isActive) {
      for (const timerId of timersMap.values()) {
        clearTimeout(timerId)
      }
      timersMap.clear()
      return undefined
    }

    const controller = createSubtitleQueueController({
      timersMap,
      lifetimeMs: SUBTITLE_LIFETIME_MS,
      maxEntries: SUBTITLE_MAX_ENTRIES,
      onChange: (nextEntries) => {
        if (isMountedRef.current) {
          setSubtitles(nextEntries)
        }
      },
    })

    const unsubscribeSubtitles = audioEngine.subscribeSubtitles((entry) => {
      controller.push(entry)
    })

    const unsubscribeClear =
      typeof audioEngine.subscribeSubtitleClear === 'function'
        ? audioEngine.subscribeSubtitleClear(() => {
            controller.clear({ notify: true })
          })
        : null

    return () => {
      unsubscribeSubtitles?.()
      unsubscribeClear?.()
      controller.clear({ notify: isMountedRef.current })
      controller.dispose()
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
