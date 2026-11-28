/**
 * Safe Pointer Capture & Viewport Pointer Interaction Controller
 * (MAZE-HAZARD-CEILING-ANIM-002)
 *
 * Manages the full pointer event lifecycle (`pointerdown`, `pointermove`, `pointerup`,
 * `pointercancel`, `lostpointercapture`, `contextmenu`, and `pointerlockchange`)
 * for the 3D maze viewport without throwing `InvalidStateError` or `NotFoundError`
 * when Pointer Lock is active, transitioning, or when synthetic/inactive pointer IDs occur.
 */

const UI_CONTROL_SELECTOR =
  '[data-touch-control="true"], [data-viewport-control="true"], button, input, select, textarea, a, .maze-preview-bar, .maze-toolbar'

const CLICK_DRAG_THRESHOLD_PX = 6

export function isViewportUiControlTarget(target) {
  return Boolean(target?.closest?.(UI_CONTROL_SELECTOR))
}

/**
 * Checks whether an element is currently in Pointer Lock (or pending pointer lock)
 * within its ownerDocument. Per the W3C Pointer Events specification, calling
 * `Element.setPointerCapture()` while `document.pointerLockElement` is non-null
 * throws `DOMException: InvalidStateError`.
 */
export function isDocumentPointerLocked(element, doc = null) {
  const resolvedDoc =
    doc ||
    element?.ownerDocument ||
    (typeof document !== 'undefined' ? document : null)
  if (!resolvedDoc) return false
  return Boolean(
    resolvedDoc.pointerLockElement ||
      resolvedDoc.webkitPointerLockElement ||
      resolvedDoc.mozPointerLockElement
  )
}

/**
 * Checks whether `element` itself is the active pointer-lock target.
 */
export function isElementPointerLocked(element, doc = null) {
  if (!element) return false
  const resolvedDoc =
    doc ||
    element?.ownerDocument ||
    (typeof document !== 'undefined' ? document : null)
  if (!resolvedDoc) return false
  const lockedEl =
    resolvedDoc.pointerLockElement ||
    resolvedDoc.webkitPointerLockElement ||
    resolvedDoc.mozPointerLockElement ||
    null
  if (!lockedEl) return false
  if (lockedEl === element) return true
  return typeof element.contains === 'function' ? element.contains(lockedEl) : false
}

/**
 * Validates whether `event` and `element` are eligible for `setPointerCapture(pointerId)`.
 */
export function canSafelyCapturePointer(element, event, doc = null) {
  if (!element || typeof element.setPointerCapture !== 'function') {
    return { eligible: false, reason: 'missing_capture_api' }
  }
  if (element.isConnected === false) {
    return { eligible: false, reason: 'disconnected_element' }
  }
  if (!event || typeof event !== 'object') {
    return { eligible: false, reason: 'invalid_event' }
  }
  const pointerId = event.pointerId
  if (!Number.isInteger(pointerId) || pointerId < 0) {
    return { eligible: false, reason: 'invalid_pointer_id' }
  }
  // Never call setPointerCapture while any element holds Pointer Lock (prevents InvalidStateError)
  if (isDocumentPointerLocked(element, doc)) {
    return { eligible: false, reason: 'pointer_locked' }
  }
  // Ensure the pointer actually has an active button/contact depressed
  if (typeof event.buttons === 'number' && event.buttons === 0) {
    return { eligible: false, reason: 'inactive_buttons' }
  }
  if (
    typeof element.hasPointerCapture === 'function' &&
    element.hasPointerCapture(pointerId)
  ) {
    return { eligible: false, reason: 'already_captured', alreadyCaptured: true }
  }
  return { eligible: true, reason: null, pointerId }
}

/**
 * Safely acquires pointer capture on `element` for `event.pointerId` only when eligible.
 * Specifically guards against and handles `InvalidStateError` (Pointer Lock active/pending)
 * and `NotFoundError` (inactive/synthetic pointerId) without throwing uncaught exceptions.
 */
export function trySafeSetPointerCapture(element, event, options = {}) {
  const doc = options?.doc || null
  const onDiagnostic = options?.onDiagnostic || null
  const check = canSafelyCapturePointer(element, event, doc)

  if (!check.eligible) {
    if (check.alreadyCaptured) {
      return { captured: true, alreadyCaptured: true, reason: 'already_captured' }
    }
    return { captured: false, reason: check.reason }
  }

  try {
    element.setPointerCapture(check.pointerId)
    return { captured: true, pointerId: check.pointerId, reason: null }
  } catch (error) {
    const errorName = error?.name || 'Error'
    if (typeof onDiagnostic === 'function') {
      onDiagnostic({
        operation: 'setPointerCapture',
        pointerId: check.pointerId,
        errorName,
        message: error?.message || String(error),
      })
    }
    if (errorName === 'InvalidStateError' || errorName === 'NotFoundError') {
      return {
        captured: false,
        pointerId: check.pointerId,
        reason: errorName,
        error,
      }
    }
    return {
      captured: false,
      pointerId: check.pointerId,
      reason: errorName,
      error,
    }
  }
}

/**
 * Safely releases pointer capture on `element` for `pointerId` if currently held.
 */
export function trySafeReleasePointerCapture(element, pointerId, options = {}) {
  const onDiagnostic = options?.onDiagnostic || null
  if (!element || typeof element.releasePointerCapture !== 'function') {
    return { released: false, reason: 'missing_release_api' }
  }
  if (element.isConnected === false) {
    return { released: false, reason: 'disconnected_element' }
  }
  if (!Number.isInteger(pointerId) || pointerId < 0) {
    return { released: false, reason: 'invalid_pointer_id' }
  }

  try {
    if (typeof element.hasPointerCapture === 'function') {
      if (!element.hasPointerCapture(pointerId)) {
        return { released: false, reason: 'not_captured' }
      }
    }
    element.releasePointerCapture(pointerId)
    return { released: true, pointerId, reason: null }
  } catch (error) {
    const errorName = error?.name || 'Error'
    if (typeof onDiagnostic === 'function') {
      onDiagnostic({
        operation: 'releasePointerCapture',
        pointerId,
        errorName,
        message: error?.message || String(error),
      })
    }
    return {
      released: false,
      pointerId,
      reason: errorName,
      error,
    }
  }
}

/**
 * Creates a self-contained viewport pointer interaction controller that coordinates:
 * - Left-click primary interaction (rubble pickup, furniture/pipes grip, steam pipe repair/valve, hiding entry, hazards, exit)
 * - Right-click secondary interaction (hiding exit, rubble placement, furniture/pipes release) + contextmenu suppression
 * - Unlocked drag-look camera rotation with safe pointer capture
 * - Automatic drag-state cleanup on `pointerup`, `pointercancel`, `lostpointercapture`,
 *   and `pointerlockchange` so drag-look can never become stuck.
 */
export function createViewportPointerController({
  canvasHost,
  doc = null,
  getEngine = () => null,
  getLatestProps = () => ({}),
  resolveLookInputConfig = () => ({ sensitivity: 0.0022, invertY: false }),
  onTouchControlsChange = null,
  onDiagnostic = null,
} = {}) {
  const resolvedDoc =
    doc ||
    canvasHost?.ownerDocument ||
    (typeof document !== 'undefined' ? document : null)

  let draggingPointerId = null
  let draggingPointerType = null
  let hasActiveCapture = false
  let lastX = 0
  let lastY = 0
  let downX = 0
  let downY = 0
  let dragDistance = 0
  let handledPrimaryOnDown = false

  function isGameplayInteractive(props = getLatestProps()) {
    if (!props) return false
    return Boolean(
      props.controlsEnabled &&
        !props.showDiagnosticsModal &&
        !props.hasWon &&
        !props.isGameOver &&
        !props.isArrivalLocked
    )
  }

  function clearDragState({ releaseCapture = true } = {}) {
    const activeId = draggingPointerId
    const wasCaptured = hasActiveCapture
    draggingPointerId = null
    draggingPointerType = null
    hasActiveCapture = false
    dragDistance = 0
    if (releaseCapture && wasCaptured && activeId !== null) {
      trySafeReleasePointerCapture(canvasHost, activeId, { onDiagnostic })
    }
  }

  function dispatchPrimaryAction(ndc = { x: 0, y: 0 }) {
    const engine = getEngine()
    if (!engine || typeof engine.handlePrimaryAction !== 'function') {
      return { handled: false, reason: 'no_engine' }
    }
    engine.unlockAudio?.()
    return engine.handlePrimaryAction({ ndc }) || { handled: false }
  }

  function handleContextMenu(event) {
    if (!isGameplayInteractive()) return
    if (isViewportUiControlTarget(event?.target)) return
    event?.preventDefault?.()
  }

  function handlePointerDown(event) {
    if (!event) return

    if (event.pointerType === 'touch') {
      onTouchControlsChange?.(true)
    } else if (
      event.pointerType === 'mouse' &&
      !event.target?.closest?.('[data-touch-control="true"]')
    ) {
      onTouchControlsChange?.(false)
    }

    if (!isGameplayInteractive()) {
      return
    }
    if (isViewportUiControlTarget(event.target)) {
      return
    }

    // Right-click (button 2): exit active hiding spot, place carried rubble, or release pipes/furniture
    if (event.button === 2) {
      event.preventDefault?.()
      const engine = getEngine()
      engine?.unlockAudio?.()
      engine?.handleSecondaryAction?.()
      return
    }

    if (typeof event.button === 'number' && event.button !== 0) {
      return
    }

    const rect = canvasHost?.getBoundingClientRect?.()
    const hasRect = rect && rect.width > 0 && rect.height > 0
    const ndcX = hasRect && Number.isFinite(event.clientX) ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : 0
    const ndcY = hasRect && Number.isFinite(event.clientY) ? -((event.clientY - rect.top) / rect.height) * 2 + 1 : 0
    const clickNdc = { x: ndcX, y: ndcY }

    // When Pointer Lock is active on the document/viewport, never start drag-look or
    // call setPointerCapture (which throws InvalidStateError under Pointer Lock).
    if (
      isElementPointerLocked(canvasHost, resolvedDoc) ||
      isDocumentPointerLocked(canvasHost, resolvedDoc)
    ) {
      clearDragState({ releaseCapture: true })
      handledPrimaryOnDown = true
      dispatchPrimaryAction({ x: 0, y: 0 })
      return
    }

    // When unlocked, if the center or clicked position targets a valid reachable
    // rubble piece, fallen furniture, or fallen pipes on a mouse left-click, trigger primary action immediately
    const pointerType = event.pointerType || 'mouse'
    if (pointerType === 'mouse') {
      const engine = getEngine()
      const rubbleCtrl = engine?.getRubbleController?.()
      if (rubbleCtrl && rubbleCtrl.getStateName?.() === 'idle') {
        const centerTarget = rubbleCtrl.updateTargeting?.(clickNdc)
        if (centerTarget?.piece) {
          clearDragState({ releaseCapture: true })
          handledPrimaryOnDown = true
          dispatchPrimaryAction(clickNdc)
          return
        }
      }
      const furnCtrl = engine?.getFurnitureController?.()
      if (furnCtrl && furnCtrl.getStateName?.() === 'idle') {
        const furnTarget = furnCtrl.updateTargeting?.(clickNdc)
        if (furnTarget?.hazard) {
          clearDragState({ releaseCapture: true })
          handledPrimaryOnDown = true
          dispatchPrimaryAction(clickNdc)
          return
        }
      }
      const pipesCtrl = engine?.getPipesController?.()
      if (pipesCtrl && pipesCtrl.getStateName?.() === 'idle') {
        const pipesTarget =
          pipesCtrl.updateTargeting?.(clickNdc) ||
          pipesCtrl.updateTargeting?.({ x: 0, y: 0 })
        if (pipesTarget?.hazard) {
          clearDragState({ releaseCapture: true })
          handledPrimaryOnDown = true
          dispatchPrimaryAction(clickNdc)
          return
        }
      }
      const wiringCtrl = engine?.getElectricalWiringController?.()
      if (wiringCtrl && !wiringCtrl.isActive?.() && wiringCtrl.canQuickStart?.(clickNdc)) {
        clearDragState({ releaseCapture: true })
        handledPrimaryOnDown = true
        dispatchPrimaryAction(clickNdc)
        return
      }
    }

    handledPrimaryOnDown = false
    const pointerId = Number.isInteger(event.pointerId) ? event.pointerId : 0
    draggingPointerId = pointerId
    draggingPointerType = pointerType
    lastX = Number.isFinite(event.clientX) ? event.clientX : 0
    lastY = Number.isFinite(event.clientY) ? event.clientY : 0
    downX = lastX
    downY = lastY
    dragDistance = 0

    const captureRes = trySafeSetPointerCapture(canvasHost, event, {
      doc: resolvedDoc,
      onDiagnostic,
    })
    hasActiveCapture = Boolean(captureRes.captured)
  }

  function handlePointerMove(event) {
    if (draggingPointerId === null || !event) return
    if (
      event.pointerId !== undefined &&
      event.pointerId !== draggingPointerId
    ) {
      return
    }
    if (
      !isGameplayInteractive() ||
      isElementPointerLocked(canvasHost, resolvedDoc) ||
      isDocumentPointerLocked(canvasHost, resolvedDoc)
    ) {
      clearDragState({ releaseCapture: true })
      return
    }

    const clientX = Number.isFinite(event.clientX) ? event.clientX : lastX
    const clientY = Number.isFinite(event.clientY) ? event.clientY : lastY
    const dx = clientX - lastX
    const dy = clientY - lastY
    lastX = clientX
    lastY = clientY
    dragDistance += Math.hypot(dx, dy)

    const props = getLatestProps() || {}
    const cfg = props.engineConfig || {}
    const { sensitivity: mouseSens, invertY } = resolveLookInputConfig(cfg)
    const isTouchDrag =
      draggingPointerType === 'touch' || event.pointerType === 'touch'
    const touchLookSens =
      Number.isFinite(cfg.touchLookSensitivity) && cfg.touchLookSensitivity > 0
        ? cfg.touchLookSensitivity
        : 1.8
    const sensitivity = isTouchDrag ? touchLookSens * 0.0022 : mouseSens
    getEngine()?.applyLookDelta?.(dx, dy, { sensitivity, invertY })
  }

  function handlePointerUp(event) {
    if (handledPrimaryOnDown) {
      handledPrimaryOnDown = false
      clearDragState({ releaseCapture: true })
      return
    }
    if (draggingPointerId === null) return
    if (
      event?.pointerId !== undefined &&
      event.pointerId !== draggingPointerId
    ) {
      return
    }

    const endX = Number.isFinite(event?.clientX) ? event.clientX : downX
    const endY = Number.isFinite(event?.clientY) ? event.clientY : downY
    const wasMouseClick =
      event?.type === 'pointerup' &&
      draggingPointerType === 'mouse' &&
      dragDistance <= CLICK_DRAG_THRESHOLD_PX &&
      Math.hypot(endX - downX, endY - downY) <= CLICK_DRAG_THRESHOLD_PX

    clearDragState({ releaseCapture: true })

    if (
      wasMouseClick &&
      isGameplayInteractive() &&
      !isViewportUiControlTarget(event?.target)
    ) {
      const rect = canvasHost?.getBoundingClientRect?.()
      const hasRect = rect && rect.width > 0 && rect.height > 0
      const ndcX =
        hasRect && Number.isFinite(endX)
          ? ((endX - rect.left) / rect.width) * 2 - 1
          : 0
      const ndcY =
        hasRect && Number.isFinite(endY)
          ? -((endY - rect.top) / rect.height) * 2 + 1
          : 0
      dispatchPrimaryAction({ x: ndcX, y: ndcY })
    }
  }

  function handlePointerCancel(event) {
    handledPrimaryOnDown = false
    if (draggingPointerId === null) return
    if (
      event?.pointerId !== undefined &&
      event.pointerId !== draggingPointerId
    ) {
      return
    }
    clearDragState({ releaseCapture: true })
  }

  function handleLostPointerCapture(event) {
    if (draggingPointerId === null) return
    if (
      event?.pointerId !== undefined &&
      event.pointerId !== draggingPointerId
    ) {
      return
    }
    // Browser has already released pointer capture; reset drag state cleanly so look never sticks
    hasActiveCapture = false
    clearDragState({ releaseCapture: false })
  }

  function handlePointerLockChange() {
    // If pointer lock engages or disengages mid-drag, clear unlocked drag state cleanly
    if (draggingPointerId !== null) {
      clearDragState({ releaseCapture: true })
    }
  }

  function attach() {
    if (!canvasHost || typeof canvasHost.addEventListener !== 'function') {
      return
    }
    canvasHost.addEventListener('contextmenu', handleContextMenu)
    canvasHost.addEventListener('pointerdown', handlePointerDown)
    canvasHost.addEventListener('pointermove', handlePointerMove)
    canvasHost.addEventListener('pointerup', handlePointerUp)
    canvasHost.addEventListener('pointercancel', handlePointerCancel)
    canvasHost.addEventListener('lostpointercapture', handleLostPointerCapture)
    resolvedDoc?.addEventListener?.('pointerlockchange', handlePointerLockChange)
  }

  function detach() {
    clearDragState({ releaseCapture: true })
    handledPrimaryOnDown = false
    if (!canvasHost || typeof canvasHost.removeEventListener !== 'function') {
      return
    }
    canvasHost.removeEventListener('contextmenu', handleContextMenu)
    canvasHost.removeEventListener('pointerdown', handlePointerDown)
    canvasHost.removeEventListener('pointermove', handlePointerMove)
    canvasHost.removeEventListener('pointerup', handlePointerUp)
    canvasHost.removeEventListener('pointercancel', handlePointerCancel)
    canvasHost.removeEventListener('lostpointercapture', handleLostPointerCapture)
    resolvedDoc?.removeEventListener?.('pointerlockchange', handlePointerLockChange)
  }

  function getState() {
    return {
      draggingPointerId,
      draggingPointerType,
      hasActiveCapture,
      dragDistance,
      lastX,
      lastY,
    }
  }

  return {
    attach,
    detach,
    getState,
    clearDragState,
    handleContextMenu,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleLostPointerCapture,
    handlePointerLockChange,
  }
}
