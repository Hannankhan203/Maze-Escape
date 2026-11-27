/**
 * Pure state helpers and constants for the Persistent Center-Screen Gameplay Crosshair
 * (MAZE-HAZARD-CEILING-ANIM-003 / MAZE-HAZARD-CEILING-ANIM-004)
 */

export const CROSSHAIR_TARGET_STATES = Object.freeze({
  NORMAL: 'normal',
  VALID_TARGET: 'valid_target',
  CARRYING: 'carrying',
  INVALID_PLACEMENT: 'invalid_placement',
})

/**
 * Pure helper that determines whether the persistent gameplay crosshair should be visible.
 * Visible during all active gameplay (walking, sprinting, carrying rubble, hazard interaction,
 * first-person, third-person Follow, third-person Free Look, pointer-locked or unlocked).
 * Hidden on non-gameplay views, pause/modal screens, game-over/victory, or inter-level transitions.
 */
export function resolveCrosshairVisibility({
  controlsEnabled = true,
  hasWon = false,
  isGameOver = false,
  isPaused = false,
  isTransitioning = false,
  isLevelTransitioning = false,
  isExtractionSequenceActive = false,
  showDiagnosticsModal = false,
} = {}) {
  return Boolean(
    controlsEnabled &&
      !hasWon &&
      !isGameOver &&
      !isPaused &&
      !isTransitioning &&
      !isLevelTransitioning &&
      !isExtractionSequenceActive &&
      !showDiagnosticsModal
  )
}

/**
 * Pure helper that resolves the current crosshair visual state and concise contextual hint
 * from the engine's rubble interaction state snapshot.
 */
export function resolveCrosshairFeedbackState(stealthState = {}) {
  const rubbleState = stealthState?.rubbleState || 'idle'
  const canPickup = Boolean(stealthState?.rubbleCanPickup)
  const canPlace = Boolean(stealthState?.rubbleCanPlace)
  const placementValid = Boolean(stealthState?.rubblePlacementValid)
  const feedback = stealthState?.rubbleFeedback || null
  const targetedPieceId = stealthState?.rubbleTargetedPieceId || null
  const carriedPieceId = stealthState?.rubbleCarriedPieceId || null

  if (feedback || (canPlace && !placementValid)) {
    return {
      targetState: CROSSHAIR_TARGET_STATES.INVALID_PLACEMENT,
      rubbleState,
      targetedPieceId,
      carriedPieceId,
      hintKey: canPlace && !feedback ? 'Right-Click' : null,
      hintText: feedback || 'Placement blocked',
    }
  }

  if (canPlace || rubbleState === 'carrying' || rubbleState === 'placing') {
    return {
      targetState: CROSSHAIR_TARGET_STATES.CARRYING,
      rubbleState,
      targetedPieceId,
      carriedPieceId,
      hintKey: rubbleState === 'placing' ? null : 'Right-Click',
      hintText: rubbleState === 'placing' ? 'Placing rubble…' : 'Place rubble',
    }
  }

  if (canPickup || rubbleState === 'picking_up') {
    return {
      targetState: CROSSHAIR_TARGET_STATES.VALID_TARGET,
      rubbleState,
      targetedPieceId,
      carriedPieceId,
      hintKey: rubbleState === 'picking_up' ? null : 'Left-Click',
      hintText: rubbleState === 'picking_up' ? 'Lifting rubble…' : 'Pick up rubble',
    }
  }

  return {
    targetState: CROSSHAIR_TARGET_STATES.NORMAL,
    rubbleState,
    targetedPieceId: null,
    carriedPieceId: null,
    hintKey: null,
    hintText: null,
  }
}
