function getDefaultDocument() {
  return typeof document !== 'undefined' ? document : null
}

function getDefaultWindow() {
  return typeof window !== 'undefined' ? window : null
}

function getRequestFullscreenMethod(element) {
  if (!element) return null
  return (
    element.requestFullscreen ||
    element.webkitRequestFullscreen ||
    element.mozRequestFullScreen ||
    element.msRequestFullscreen ||
    null
  )
}

function getExitFullscreenMethod(doc) {
  if (!doc) return null
  return (
    doc.exitFullscreen ||
    doc.webkitExitFullscreen ||
    doc.mozCancelFullScreen ||
    doc.msExitFullscreen ||
    null
  )
}

/**
 * Returns the active fullscreen element across standard and vendor-prefixed properties.
 */
export function getFullscreenElement(doc = getDefaultDocument()) {
  if (!doc) return null
  return (
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement ||
    null
  )
}

/**
 * Checks whether the browser Fullscreen API is supported and enabled for `element`.
 */
export function isFullscreenSupported(element, doc = getDefaultDocument()) {
  if (!element || !doc) return false

  if (doc.fullscreenEnabled === false || doc.webkitFullscreenEnabled === false) {
    return false
  }

  return Boolean(getRequestFullscreenMethod(element) && getExitFullscreenMethod(doc))
}

/**
 * Determines whether 3D touch controls should render.
 * Touch controls are always hidden during fullscreen and restored per `touchControlsMode`
 * once fullscreen exits.
 */
export function resolveShowTouchControls({
  touchControlsMode = 'auto',
  isInteractive = true,
  isFullscreen = false,
} = {}) {
  if (isFullscreen) return false
  return touchControlsMode !== 'off' && Boolean(isInteractive)
}

export const DEFAULT_ESC_HINT_DURATION_MS = 3000

/**
 * Framework-agnostic Fullscreen API controller for the 3D maze viewport.
 * Synchronizes state via `fullscreenchange`, manages the transient ESC hint timer,
 * coordinates Escape exit when Pointer Lock is active without altering normal
 * pointer-lock behavior outside fullscreen, and triggers renderer/camera resize updates.
 */
export function createFullscreenController({
  getElement = () => null,
  getCanvasHost = () => null,
  doc = getDefaultDocument(),
  win = getDefaultWindow(),
  escHintDurationMs = DEFAULT_ESC_HINT_DURATION_MS,
  onStateChange = null,
  onResize = null,
  autoAttach = true,
} = {}) {
  let isDisposed = false
  let attached = false
  let escHintTimerId = null
  let resizeRafId = null

  const state = {
    supported: isFullscreenSupported(getElement(), doc),
    isFullscreen: false,
    showEscHint: false,
  }

  function emitState() {
    onStateChange?.({ ...state })
  }

  function clearEscHintTimer() {
    if (escHintTimerId !== null) {
      clearTimeout(escHintTimerId)
      escHintTimerId = null
    }
  }

  function clearResizeRaf() {
    if (resizeRafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(resizeRafId)
      resizeRafId = null
    }
  }

  function triggerResize() {
    if (isDisposed || typeof onResize !== 'function') return
    const host = getCanvasHost() || getElement()
    if (!host) return
    const width = Number(host.clientWidth) || 0
    const height = Number(host.clientHeight) || 0
    if (width > 0 && height > 0) {
      onResize({ width, height })
    }
  }

  function scheduleResize() {
    triggerResize()
    if (typeof requestAnimationFrame === 'function') {
      clearResizeRaf()
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null
        triggerResize()
      })
    }
  }

  function isTargetFullscreen() {
    const el = getElement()
    const fsEl = getFullscreenElement(doc)
    if (!el || !fsEl) return false
    if (fsEl === el) return true
    return typeof el.contains === 'function' ? el.contains(fsEl) : false
  }

  function releaseOwnedPointerLock() {
    if (!doc || !doc.pointerLockElement) return
    const el = getElement()
    const host = getCanvasHost()
    const lockedEl = doc.pointerLockElement
    const ownsLock =
      lockedEl === host ||
      lockedEl === el ||
      Boolean(el && typeof el.contains === 'function' && el.contains(lockedEl))

    if (ownsLock && typeof doc.exitPointerLock === 'function') {
      try {
        doc.exitPointerLock()
      } catch {
        // Ignore pointer lock exit restrictions
      }
    }
  }

  function syncFromDocument({ forceResize = false } = {}) {
    if (isDisposed) return { ...state }

    const el = getElement()
    const nextSupported = isFullscreenSupported(el, doc)
    const nextFullscreen = isTargetFullscreen()
    const wasFullscreen = state.isFullscreen

    let changed = nextSupported !== state.supported || nextFullscreen !== wasFullscreen
    state.supported = nextSupported
    state.isFullscreen = nextFullscreen

    if (nextFullscreen && !wasFullscreen) {
      clearEscHintTimer()
      state.showEscHint = true
      changed = true

      const delay = Math.max(0, Number(escHintDurationMs) || DEFAULT_ESC_HINT_DURATION_MS)
      escHintTimerId = setTimeout(() => {
        escHintTimerId = null
        if (isDisposed || !state.showEscHint) return
        state.showEscHint = false
        emitState()
      }, delay)
    } else if (!nextFullscreen && (wasFullscreen || state.showEscHint)) {
      clearEscHintTimer()
      if (state.showEscHint) {
        state.showEscHint = false
        changed = true
      }
    }

    if (nextFullscreen !== wasFullscreen || forceResize) {
      scheduleResize()
    }

    if (changed) {
      emitState()
    }

    return { ...state }
  }

  async function enterFullscreen() {
    if (isDisposed) return { ok: false, reason: 'disposed' }
    const el = getElement()
    const supported = isFullscreenSupported(el, doc)
    if (supported !== state.supported) {
      state.supported = supported
      emitState()
    }
    if (!supported) {
      return { ok: false, reason: 'unsupported' }
    }

    const requestMethod = getRequestFullscreenMethod(el)
    if (!requestMethod) {
      return { ok: false, reason: 'unsupported' }
    }

    try {
      const maybePromise = requestMethod.call(el)
      if (maybePromise && typeof maybePromise.then === 'function') {
        await maybePromise
      }
      syncFromDocument({ forceResize: true })
      return { ok: true }
    } catch (error) {
      syncFromDocument()
      return {
        ok: false,
        reason: 'error',
        error,
      }
    }
  }

  async function exitFullscreen() {
    if (isDisposed) return { ok: false, reason: 'disposed' }
    if (!doc) return { ok: false, reason: 'unsupported' }

    releaseOwnedPointerLock()

    const exitMethod = getExitFullscreenMethod(doc)
    const activeFsEl = getFullscreenElement(doc)
    if (!exitMethod) {
      return { ok: false, reason: 'unsupported' }
    }

    if (!activeFsEl) {
      syncFromDocument()
      return { ok: true }
    }

    try {
      const maybePromise = exitMethod.call(doc)
      if (maybePromise && typeof maybePromise.then === 'function') {
        await maybePromise
      }
      syncFromDocument({ forceResize: true })
      return { ok: true }
    } catch (error) {
      syncFromDocument()
      return {
        ok: false,
        reason: 'error',
        error,
      }
    }
  }

  async function toggleFullscreen() {
    if (state.isFullscreen) {
      return exitFullscreen()
    }
    return enterFullscreen()
  }

  function handleFullscreenChange() {
    syncFromDocument({ forceResize: true })
  }

  function handleKeyDown(event) {
    if (isDisposed || !event) return
    const isEscape = event.key === 'Escape' || event.code === 'Escape'
    if (!isEscape) return

    // Preserve normal pointer-lock / modal Escape behavior outside fullscreen
    if (!state.isFullscreen) return

    // If Pointer Lock is active alongside fullscreen, release pointer lock and exit fullscreen
    releaseOwnedPointerLock()
    void exitFullscreen()
  }

  function attach() {
    if (isDisposed || attached) return
    attached = true
    doc?.addEventListener?.('fullscreenchange', handleFullscreenChange)
    doc?.addEventListener?.('webkitfullscreenchange', handleFullscreenChange)
    win?.addEventListener?.('keydown', handleKeyDown, true)
    const beforeSupported = state.supported
    syncFromDocument()
    if (beforeSupported === state.supported) {
      emitState()
    }
  }

  function detach() {
    if (!attached) return
    attached = false
    doc?.removeEventListener?.('fullscreenchange', handleFullscreenChange)
    doc?.removeEventListener?.('webkitfullscreenchange', handleFullscreenChange)
    win?.removeEventListener?.('keydown', handleKeyDown, true)
  }

  function dispose() {
    if (isDisposed) return
    isDisposed = true
    detach()
    clearEscHintTimer()
    clearResizeRaf()
    state.isFullscreen = false
    state.showEscHint = false
  }

  if (autoAttach) {
    attach()
  }

  return {
    attach,
    detach,
    dispose,
    syncFromDocument,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
    handleFullscreenChange,
    handleKeyDown,
    getState: () => ({ ...state }),
  }
}
