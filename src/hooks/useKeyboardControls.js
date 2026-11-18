import { useEffect, useRef } from 'react'

const KEY_TO_DIRECTION = {
  w: 'up',
  arrowup: 'up',
  s: 'down',
  arrowdown: 'down',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
}

function isEditableTarget(target) {
  if (!target || typeof target.tagName !== 'string') return false
  const tag = target.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    Boolean(target.isContentEditable)
  )
}

/**
 * Attaches window keyboard listeners for WASD and Arrow movement.
 * Prevents default browser scrolling for movement keys during active gameplay
 * and ignores OS key-repeat events and modifier shortcuts.
 */
export function useKeyboardControls({ enabled = true, onMove }) {
  const onMoveRef = useRef(onMove)

  useEffect(() => {
    onMoveRef.current = onMove
  }, [onMove])

  useEffect(() => {
    if (!enabled) return undefined

    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      const normalizedKey = event.key.toLowerCase()
      const direction = KEY_TO_DIRECTION[normalizedKey]
      if (!direction) return

      event.preventDefault()

      // Ignore held-key OS repeat so each deliberate key press moves one tile
      if (event.repeat) return

      onMoveRef.current?.(direction)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled])
}
