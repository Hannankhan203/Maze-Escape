import { getNextLevel, normalizeLevel } from '../mechanics/levelProgression.js'

export const ELEVATOR_TRANSITION_PHASES = Object.freeze({
  IDLE: 'idle',
  CLOSING_DOORS: 'closing_doors',
  TRAVELING: 'traveling',
  OPENING_DOORS: 'opening_doors',
})

export const DEFAULT_ELEVATOR_TRANSITION_CONFIG = Object.freeze({
  doorsCloseDurationMs: 520,
  travelMinDurationMs: 680,
  doorsOpenDurationMs: 560,
  maxTravelTimeoutMs: 4500,
  reducedMotionCloseMs: 160,
  reducedMotionTravelMs: 200,
  reducedMotionOpenMs: 160,
})

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Smooth cubic ease-in-out curve for metallic bi-parting elevator doors.
 */
export function easeElevatorDoorProgress(t) {
  const u = clamp01(t)
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}

/**
 * Resolves effective durations for the inter-level elevator transition,
 * honoring reduced-motion accessibility preferences and optional overrides.
 */
export function resolveElevatorTransitionTimings(config = null, reducedMotion = false) {
  const merged = {
    ...DEFAULT_ELEVATOR_TRANSITION_CONFIG,
    ...(config && typeof config === 'object' ? config : {}),
  }

  const doorsCloseDurationMs = Math.max(
    16,
    Number(
      reducedMotion ? merged.reducedMotionCloseMs : merged.doorsCloseDurationMs
    ) || DEFAULT_ELEVATOR_TRANSITION_CONFIG.doorsCloseDurationMs
  )
  const travelMinDurationMs = Math.max(
    16,
    Number(
      reducedMotion ? merged.reducedMotionTravelMs : merged.travelMinDurationMs
    ) || DEFAULT_ELEVATOR_TRANSITION_CONFIG.travelMinDurationMs
  )
  const doorsOpenDurationMs = Math.max(
    16,
    Number(
      reducedMotion ? merged.reducedMotionOpenMs : merged.doorsOpenDurationMs
    ) || DEFAULT_ELEVATOR_TRANSITION_CONFIG.doorsOpenDurationMs
  )
  const maxTravelTimeoutMs = Math.max(
    travelMinDurationMs + 100,
    Number(merged.maxTravelTimeoutMs) ||
      DEFAULT_ELEVATOR_TRANSITION_CONFIG.maxTravelTimeoutMs
  )

  return {
    doorsCloseDurationMs,
    travelMinDurationMs,
    doorsOpenDurationMs,
    maxTravelTimeoutMs,
  }
}

export function createIdleElevatorTransitionState() {
  return {
    active: false,
    phase: ELEVATOR_TRANSITION_PHASES.IDLE,
    transitionId: 0,
    sourceRunId: null,
    fromLevel: 1,
    toLevel: 2,
    doorProgress: 0,
    travelProgress: 0,
    mazeCommitted: false,
    sceneReady: false,
    error: null,
  }
}

/**
 * Starts a new inter-level elevator transition if none is currently active.
 * Returns the unchanged state if a transition is already running.
 */
export function beginElevatorTransitionState(
  prevState,
  { fromLevel, toLevel, sourceRunId = null, transitionId } = {}
) {
  if (prevState?.active) {
    return prevState
  }

  const resolvedFrom = normalizeLevel(fromLevel ?? 1)
  const resolvedTo = normalizeLevel(toLevel ?? getNextLevel(resolvedFrom))
  const nextId = Number.isInteger(transitionId)
    ? transitionId
    : (Number(prevState?.transitionId) || 0) + 1

  return {
    active: true,
    phase: ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS,
    transitionId: nextId,
    sourceRunId,
    fromLevel: resolvedFrom,
    toLevel: resolvedTo,
    doorProgress: 0,
    travelProgress: 0,
    mazeCommitted: false,
    sceneReady: false,
    error: null,
  }
}

export function updateElevatorDoorProgress(state, doorProgress) {
  if (!state?.active) return state
  const clamped = clamp01(doorProgress)
  if (Math.abs(clamped - (state.doorProgress ?? 0)) < 1e-4) {
    return state
  }
  return {
    ...state,
    doorProgress: clamped,
  }
}

export function updateElevatorTravelProgress(state, travelProgress) {
  if (!state?.active || state.phase !== ELEVATOR_TRANSITION_PHASES.TRAVELING) {
    return state
  }
  const clamped = clamp01(travelProgress)
  if (Math.abs(clamped - (state.travelProgress ?? 0)) < 1e-4) {
    return state
  }
  return {
    ...state,
    travelProgress: clamped,
  }
}

export function advanceElevatorTransitionToTraveling(state) {
  if (!state?.active || state.phase !== ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS) {
    return state
  }
  return {
    ...state,
    phase: ELEVATOR_TRANSITION_PHASES.TRAVELING,
    doorProgress: 1,
    travelProgress: 0,
  }
}

export function markElevatorTransitionMazeCommitted(state) {
  if (
    !state?.active ||
    state.phase !== ELEVATOR_TRANSITION_PHASES.TRAVELING ||
    state.mazeCommitted
  ) {
    return state
  }
  return {
    ...state,
    mazeCommitted: true,
  }
}

export function markElevatorTransitionSceneReady(state) {
  if (
    !state?.active ||
    state.phase !== ELEVATOR_TRANSITION_PHASES.TRAVELING ||
    state.sceneReady
  ) {
    return state
  }
  return {
    ...state,
    sceneReady: true,
  }
}

export function advanceElevatorTransitionToOpening(state, { force = false } = {}) {
  if (!state?.active || state.phase !== ELEVATOR_TRANSITION_PHASES.TRAVELING) {
    return state
  }
  if (!force && (!state.mazeCommitted || !state.sceneReady)) {
    return state
  }
  return {
    ...state,
    phase: ELEVATOR_TRANSITION_PHASES.OPENING_DOORS,
    doorProgress: 1,
    travelProgress: 1,
  }
}

export function finishElevatorTransitionState(state) {
  if (!state?.active) return state
  return {
    ...createIdleElevatorTransitionState(),
    transitionId: state.transitionId,
    fromLevel: state.fromLevel,
    toLevel: state.toLevel,
  }
}

export function cancelElevatorTransitionState(state, error = null) {
  const prevId = Number(state?.transitionId) || 0
  return {
    ...createIdleElevatorTransitionState(),
    transitionId: prevId,
    error: error ? String(error?.message || error) : null,
  }
}
