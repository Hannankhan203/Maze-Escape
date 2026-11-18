export function createFlashlightPointerState() {
  return {
    pointerId: null,
    pointerTriggered: false,
    resetTimerId: null,
  }
}

export function clearFlashlightResetTimer(state) {
  if (state && state.resetTimerId !== null) {
    clearTimeout(state.resetTimerId)
    state.resetTimerId = null
  }
}

export function isPointerReleasedOutsideElement(event, element) {
  if (
    !event ||
    !element ||
    typeof element.getBoundingClientRect !== 'function' ||
    !Number.isFinite(event.clientX) ||
    !Number.isFinite(event.clientY)
  ) {
    return false
  }

  const rect = element.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false
  }

  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
}

export function applyFlashlightPointerDown(state, event, { enabled = true } = {}) {
  if (!state || !enabled) return false
  if (typeof event?.button === 'number' && event.button !== 0) return false
  if (state.pointerId !== null) return false

  clearFlashlightResetTimer(state)
  const pointerId = event?.pointerId ?? 0
  state.pointerId = pointerId
  state.pointerTriggered = true
  return pointerId
}

export function applyFlashlightPointerEnd(
  state,
  event,
  { element = null, scheduleReset = null } = {}
) {
  if (!state || state.pointerId === null) {
    return { ended: false, pointerId: null }
  }

  const pointerId = event?.pointerId ?? 0
  if (pointerId !== state.pointerId) {
    return { ended: false, pointerId: null }
  }

  state.pointerId = null

  if (event?.type === 'pointercancel') {
    clearFlashlightResetTimer(state)
    state.pointerTriggered = false
    return { ended: true, pointerId, clearedImmediately: true }
  }

  if (isPointerReleasedOutsideElement(event, element)) {
    clearFlashlightResetTimer(state)
    state.pointerTriggered = false
    return { ended: true, pointerId, clearedImmediately: true }
  }

  clearFlashlightResetTimer(state)
  const schedule =
    typeof scheduleReset === 'function'
      ? scheduleReset
      : (cb) => setTimeout(cb, 0)
  state.resetTimerId = schedule(() => {
    state.resetTimerId = null
    state.pointerTriggered = false
  })

  return { ended: true, pointerId, clearedImmediately: false }
}

export function applyFlashlightKeyDown(state, event) {
  if (!state || !event) return false
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    clearFlashlightResetTimer(state)
    state.pointerTriggered = false
    return true
  }
  return false
}

export function applyFlashlightClick(state, { enabled = true } = {}) {
  if (!state) return false
  clearFlashlightResetTimer(state)

  if (!enabled) {
    state.pointerTriggered = false
    return false
  }

  if (state.pointerTriggered) {
    state.pointerTriggered = false
    return false
  }

  return true
}
