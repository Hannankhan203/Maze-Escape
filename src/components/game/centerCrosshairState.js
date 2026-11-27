/**
 * Pure state helpers and constants for the Persistent Center-Screen Gameplay Crosshair
 * (MAZE-HAZARD-CEILING-ANIM-003 / MAZE-HAZARD-CEILING-ANIM-004 / MAZE-HAZARD-PIPES-ANIM-001)
 */

export const CROSSHAIR_TARGET_STATES = Object.freeze({
  NORMAL: 'normal',
  VALID_TARGET: 'valid_target',
  CARRYING: 'carrying',
  INVALID_PLACEMENT: 'invalid_placement',
})

/**
 * Pure helper that determines whether the persistent gameplay crosshair should be visible.
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
 * from the engine's interaction state snapshot.
 */
export function resolveCrosshairFeedbackState(stealthState = {}) {
  const rubbleState = stealthState?.rubbleState || 'idle'
  const canPickup = Boolean(stealthState?.rubbleCanPickup)
  const canPlace = Boolean(stealthState?.rubbleCanPlace)
  const placementValid = Boolean(stealthState?.rubblePlacementValid)
  const feedback = stealthState?.rubbleFeedback || null
  const targetedPieceId = stealthState?.rubbleTargetedPieceId || null
  const carriedPieceId = stealthState?.rubbleCarriedPieceId || null

  const furnitureState = stealthState?.furnitureState || 'idle'
  const furnitureCanGrip = Boolean(stealthState?.furnitureCanGrip)
  const furnitureIsHandling = Boolean(stealthState?.furnitureIsHandling)
  const furnitureTargetedHazardId = stealthState?.furnitureTargetedHazardId || null
  const furnitureActiveHazardId = stealthState?.furnitureActiveHazardId || null
  const furnitureFeedback = stealthState?.furnitureFeedback || null

  const pipesState = stealthState?.pipesState || 'idle'
  const pipesCanGrip = Boolean(stealthState?.pipesCanGrip)
  const pipesIsHandling = Boolean(stealthState?.pipesIsHandling)
  const pipesTargetedHazardId = stealthState?.pipesTargetedHazardId || null
  const pipesActiveHazardId = stealthState?.pipesActiveHazardId || null
  const pipesFeedback = stealthState?.pipesFeedback || null

  if (feedback || (canPlace && !placementValid)) {
    return {
      targetState: CROSSHAIR_TARGET_STATES.INVALID_PLACEMENT,
      rubbleState,
      targetedPieceId,
      carriedPieceId,
      furnitureState,
      furnitureTargetedHazardId,
      furnitureActiveHazardId,
      pipesState,
      pipesTargetedHazardId,
      pipesActiveHazardId,
      hintKey: canPlace && !feedback ? 'Right-Click' : null,
      hintText: feedback || 'Placement blocked',
    }
  }

  if (furnitureFeedback) {
    return {
      targetState: CROSSHAIR_TARGET_STATES.INVALID_PLACEMENT,
      rubbleState,
      targetedPieceId,
      carriedPieceId,
      furnitureState,
      furnitureTargetedHazardId,
      furnitureActiveHazardId,
      pipesState,
      pipesTargetedHazardId,
      pipesActiveHazardId,
      hintKey: furnitureIsHandling ? 'Right-Click' : null,
      hintText: furnitureFeedback,
    }
  }

  if (pipesFeedback) {
    return {
      targetState: CROSSHAIR_TARGET_STATES.INVALID_PLACEMENT,
      rubbleState,
      targetedPieceId,
      carriedPieceId,
      furnitureState,
      furnitureTargetedHazardId,
      furnitureActiveHazardId,
      pipesState,
      pipesTargetedHazardId,
      pipesActiveHazardId,
      hintKey: pipesIsHandling ? 'Right-Click' : null,
      hintText: pipesFeedback,
    }
  }

  if (canPlace || rubbleState === 'carrying' || rubbleState === 'placing') {
    return {
      targetState: CROSSHAIR_TARGET_STATES.CARRYING,
      rubbleState,
      targetedPieceId,
      carriedPieceId,
      furnitureState,
      furnitureTargetedHazardId,
      furnitureActiveHazardId,
      pipesState,
      pipesTargetedHazardId,
      pipesActiveHazardId,
      hintKey: rubbleState === 'placing' ? null : 'Right-Click',
      hintText: rubbleState === 'placing' ? 'Placing rubble…' : 'Place rubble',
    }
  }

  if (
    furnitureIsHandling ||
    furnitureState === 'handling' ||
    furnitureState === 'releasing'
  ) {
    return {
      targetState: CROSSHAIR_TARGET_STATES.CARRYING,
      rubbleState,
      targetedPieceId: furnitureTargetedHazardId,
      carriedPieceId: furnitureActiveHazardId,
      furnitureState,
      furnitureTargetedHazardId,
      furnitureActiveHazardId,
      pipesState,
      pipesTargetedHazardId,
      pipesActiveHazardId,
      hintKey: furnitureState === 'releasing' ? null : 'Right-Click',
      hintText:
        furnitureState === 'releasing'
          ? 'Releasing furniture…'
          : 'WASD Push/Drag • Release',
    }
  }

  if (
    pipesIsHandling ||
    pipesState === 'handling' ||
    pipesState === 'releasing'
  ) {
    return {
      targetState: CROSSHAIR_TARGET_STATES.CARRYING,
      rubbleState,
      targetedPieceId: pipesTargetedHazardId,
      carriedPieceId: pipesActiveHazardId,
      furnitureState,
      furnitureTargetedHazardId,
      furnitureActiveHazardId,
      pipesState,
      pipesTargetedHazardId,
      pipesActiveHazardId,
      hintKey: pipesState === 'releasing' ? null : 'Right-Click',
      hintText:
        pipesState === 'releasing'
          ? 'Releasing pipes…'
          : 'WASD Push/Drag • Release',
    }
  }

  if (canPickup || rubbleState === 'picking_up') {
    return {
      targetState: CROSSHAIR_TARGET_STATES.VALID_TARGET,
      rubbleState,
      targetedPieceId,
      carriedPieceId,
      furnitureState,
      furnitureTargetedHazardId,
      furnitureActiveHazardId,
      pipesState,
      pipesTargetedHazardId,
      pipesActiveHazardId,
      hintKey: rubbleState === 'picking_up' ? null : 'Left-Click',
      hintText: rubbleState === 'picking_up' ? 'Lifting rubble…' : 'Pick up rubble',
    }
  }

  if (furnitureCanGrip || furnitureState === 'gripping') {
    return {
      targetState: CROSSHAIR_TARGET_STATES.VALID_TARGET,
      rubbleState,
      targetedPieceId: furnitureTargetedHazardId,
      carriedPieceId: furnitureActiveHazardId,
      furnitureState,
      furnitureTargetedHazardId,
      furnitureActiveHazardId,
      pipesState,
      pipesTargetedHazardId,
      pipesActiveHazardId,
      hintKey: furnitureState === 'gripping' ? null : 'Left-Click',
      hintText:
        furnitureState === 'gripping'
          ? 'Gripping furniture…'
          : 'Grip & push furniture',
    }
  }

  if (pipesCanGrip || pipesState === 'gripping') {
    return {
      targetState: CROSSHAIR_TARGET_STATES.VALID_TARGET,
      rubbleState,
      targetedPieceId: pipesTargetedHazardId,
      carriedPieceId: pipesActiveHazardId,
      furnitureState,
      furnitureTargetedHazardId,
      furnitureActiveHazardId,
      pipesState,
      pipesTargetedHazardId,
      pipesActiveHazardId,
      hintKey: pipesState === 'gripping' ? null : 'Left-Click',
      hintText:
        pipesState === 'gripping'
          ? 'Gripping pipes…'
          : 'Grip & push pipes',
    }
  }

  return {
    targetState: CROSSHAIR_TARGET_STATES.NORMAL,
    rubbleState,
    targetedPieceId: null,
    carriedPieceId: null,
    furnitureState,
    furnitureTargetedHazardId: null,
    furnitureActiveHazardId: null,
    pipesState,
    pipesTargetedHazardId: null,
    pipesActiveHazardId: null,
    hintKey: null,
    hintText: null,
  }
}
