import { normalizeLevel } from '../mechanics/levelProgression.js'
import { ELEVATOR_TRANSITION_PHASES } from './elevatorLevelTransition.js'
import { SPAWN_SEQUENCE_STAGES } from '../three/ElevatorExitSequence.js'

export const ARRIVAL_SEQUENCE_PHASES = Object.freeze({
  IDLE: 'idle',
  PREPARING: 'preparing',
  ELEVATOR_ARRIVAL: 'elevator_arrival',
  OPENING_DOORS: 'opening_doors',
  CAMERA_HANDOFF: 'camera_handoff',
})

export const ARRIVAL_ENTRY_PATHS = Object.freeze({
  FRESH_GAME: 'fresh_game',
  NEXT_LEVEL: 'next_level',
  REPLAY_LEVEL: 'replay_level',
})

export const DEFAULT_ARRIVAL_CONFIG = Object.freeze({
  maxArrivalTimeoutMs: 12000,
  startOverlayMinMs: 2600,
  reducedMotionStartOverlayMinMs: 320,
  cameraHandoffDoorThreshold: 0.4,
  interLevelCameraBackOffset: 0.26,
  interLevelCameraEyeOffsetY: -0.05,
  interLevelCameraPitchOffset: -0.032,
  interLevelThirdPersonDistanceCap: 0.92,
})

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function smoothstep01(edge0, edge1, x) {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * Resolves effective arrival configuration timings and camera framing offsets,
 * honoring reduced-motion accessibility settings and optional test overrides.
 */
export function resolveArrivalConfig(config = null, reducedMotion = false) {
  const merged = {
    ...DEFAULT_ARRIVAL_CONFIG,
    ...(config && typeof config === 'object' ? config : {}),
  }

  const rawStartMin = reducedMotion
    ? merged.reducedMotionStartOverlayMinMs
    : merged.startOverlayMinMs
  const startOverlayMinMs =
    Number.isFinite(Number(rawStartMin)) && Number(rawStartMin) >= 0
      ? Number(rawStartMin)
      : reducedMotion
        ? DEFAULT_ARRIVAL_CONFIG.reducedMotionStartOverlayMinMs
        : DEFAULT_ARRIVAL_CONFIG.startOverlayMinMs

  const maxArrivalTimeoutMs = Math.max(
    120,
    Number(merged.maxArrivalTimeoutMs) ||
      DEFAULT_ARRIVAL_CONFIG.maxArrivalTimeoutMs
  )

  const cameraHandoffDoorThreshold = clamp01(
    Number.isFinite(Number(merged.cameraHandoffDoorThreshold))
      ? Number(merged.cameraHandoffDoorThreshold)
      : DEFAULT_ARRIVAL_CONFIG.cameraHandoffDoorThreshold
  )

  return {
    maxArrivalTimeoutMs,
    startOverlayMinMs,
    cameraHandoffDoorThreshold,
    interLevelCameraBackOffset: Math.max(
      0,
      Number(merged.interLevelCameraBackOffset) ||
        DEFAULT_ARRIVAL_CONFIG.interLevelCameraBackOffset
    ),
    interLevelCameraEyeOffsetY: Number.isFinite(
      Number(merged.interLevelCameraEyeOffsetY)
    )
      ? Number(merged.interLevelCameraEyeOffsetY)
      : DEFAULT_ARRIVAL_CONFIG.interLevelCameraEyeOffsetY,
    interLevelCameraPitchOffset: Number.isFinite(
      Number(merged.interLevelCameraPitchOffset)
    )
      ? Number(merged.interLevelCameraPitchOffset)
      : DEFAULT_ARRIVAL_CONFIG.interLevelCameraPitchOffset,
    interLevelThirdPersonDistanceCap: Math.max(
      0.55,
      Number(merged.interLevelThirdPersonDistanceCap) ||
        DEFAULT_ARRIVAL_CONFIG.interLevelThirdPersonDistanceCap
    ),
  }
}

export function createIdleArrivalState() {
  return {
    active: false,
    phase: ARRIVAL_SEQUENCE_PHASES.IDLE,
    entryPath: null,
    arrivalId: 0,
    level: 1,
    runId: null,
    doorProgress: 0,
    cameraHandoffProgress: 1,
    timedOut: false,
    error: null,
  }
}

/**
 * Begins an arrival sequence if one is not already active for the same run.
 */
export function beginArrivalSequenceState(
  prevState,
  {
    entryPath = ARRIVAL_ENTRY_PATHS.FRESH_GAME,
    phase = ARRIVAL_SEQUENCE_PHASES.PREPARING,
    level = 1,
    runId = null,
    arrivalId,
    force = false,
  } = {}
) {
  if (
    !force &&
    prevState?.active &&
    prevState.entryPath === entryPath &&
    prevState.runId === runId
  ) {
    return prevState
  }

  const nextId = Number.isInteger(arrivalId)
    ? arrivalId
    : (Number(prevState?.arrivalId) || 0) + 1

  return {
    active: true,
    phase,
    entryPath,
    arrivalId: nextId,
    level: normalizeLevel(level ?? 1),
    runId,
    doorProgress: phase === ARRIVAL_SEQUENCE_PHASES.PREPARING ? 1 : 0,
    cameraHandoffProgress: 0,
    timedOut: false,
    error: null,
  }
}

export function updateArrivalPhaseState(state, phase, patch = null) {
  if (!state?.active) return state
  const nextPhase = phase || state.phase
  const nextDoor =
    patch && Number.isFinite(patch.doorProgress)
      ? clamp01(patch.doorProgress)
      : state.doorProgress
  const nextHandoff =
    patch && Number.isFinite(patch.cameraHandoffProgress)
      ? clamp01(patch.cameraHandoffProgress)
      : state.cameraHandoffProgress

  if (
    nextPhase === state.phase &&
    Math.abs(nextDoor - state.doorProgress) < 1e-4 &&
    Math.abs(nextHandoff - state.cameraHandoffProgress) < 1e-4
  ) {
    return state
  }

  return {
    ...state,
    phase: nextPhase,
    doorProgress: nextDoor,
    cameraHandoffProgress: nextHandoff,
  }
}

export function finishArrivalSequenceState(state) {
  if (!state?.active) return state
  return {
    ...createIdleArrivalState(),
    arrivalId: state.arrivalId,
    entryPath: state.entryPath,
    level: state.level,
    runId: state.runId,
    cameraHandoffProgress: 1,
  }
}

export function cancelArrivalSequenceState(
  state,
  { error = null, timedOut = false } = {}
) {
  const prevId = Number(state?.arrivalId) || 0
  return {
    ...createIdleArrivalState(),
    arrivalId: prevId,
    entryPath: state?.entryPath ?? null,
    level: state?.level ?? 1,
    runId: state?.runId ?? null,
    timedOut: Boolean(timedOut),
    error: error ? String(error?.message || error) : null,
  }
}

/**
 * Maps an active inter-level elevator transition snapshot into its unified
 * arrival phase without introducing overlapping animations.
 */
export function resolveInterLevelArrivalPhase(
  transitionState,
  config = DEFAULT_ARRIVAL_CONFIG
) {
  if (!transitionState?.active) {
    return ARRIVAL_SEQUENCE_PHASES.IDLE
  }
  const phase = transitionState.phase
  if (
    phase === ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS ||
    phase === ELEVATOR_TRANSITION_PHASES.TRAVELING
  ) {
    return ARRIVAL_SEQUENCE_PHASES.PREPARING
  }
  if (phase === ELEVATOR_TRANSITION_PHASES.OPENING_DOORS) {
    const threshold = clamp01(
      config?.cameraHandoffDoorThreshold ??
        DEFAULT_ARRIVAL_CONFIG.cameraHandoffDoorThreshold
    )
    const doorProgress = clamp01(transitionState.doorProgress ?? 1)
    return doorProgress <= threshold
      ? ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF
      : ARRIVAL_SEQUENCE_PHASES.OPENING_DOORS
  }
  return ARRIVAL_SEQUENCE_PHASES.IDLE
}

/**
 * Maps a 3D ElevatorExitSequence stage into its unified arrival phase.
 */
export function resolveSpawnSequenceArrivalPhase(spawnStage) {
  if (!spawnStage || spawnStage === SPAWN_SEQUENCE_STAGES.IDLE) {
    return ARRIVAL_SEQUENCE_PHASES.IDLE
  }
  if (spawnStage === SPAWN_SEQUENCE_STAGES.SETTLE) {
    return ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF
  }
  return ARRIVAL_SEQUENCE_PHASES.ELEVATOR_ARRIVAL
}

/**
 * Computes zero-allocation interior-elevator camera framing offsets for
 * inter-level arrival so the player starts safely inside the elevator behind
 * closed doors and the camera glides smoothly into the normal gameplay view
 * as the doors open.
 */
export function computeInterLevelArrivalCameraPose({
  active = false,
  phase = ELEVATOR_TRANSITION_PHASES.IDLE,
  doorProgress = 1,
  reducedMotion = false,
  config = null,
  target = null,
} = {}) {
  const out = target || {
    active: false,
    backOffset: 0,
    eyeOffsetY: 0,
    pitchOffset: 0,
    followDistanceCap: null,
    shoulderWeight: 1,
    handoffProgress: 1,
  }

  if (
    !active ||
    (phase !== ELEVATOR_TRANSITION_PHASES.TRAVELING &&
      phase !== ELEVATOR_TRANSITION_PHASES.OPENING_DOORS &&
      phase !== ARRIVAL_SEQUENCE_PHASES.OPENING_DOORS &&
      phase !== ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF)
  ) {
    out.active = false
    out.backOffset = 0
    out.eyeOffsetY = 0
    out.pitchOffset = 0
    out.followDistanceCap = null
    out.shoulderWeight = 1
    out.handoffProgress = 1
    return out
  }

  const cfg = resolveArrivalConfig(config, reducedMotion)
  const isTraveling = phase === ELEVATOR_TRANSITION_PHASES.TRAVELING
  const clampedDoor = isTraveling ? 1 : clamp01(doorProgress)
  const openRatio = 1 - clampedDoor
  // Smooth ease from full elevator cabin framing (0) to normal gameplay view (1)
  const handoffProgress = isTraveling ? 0 : smoothstep01(0.12, 1.0, openRatio)
  const cabinWeight = 1 - handoffProgress

  if (cabinWeight <= 1e-4) {
    out.active = false
    out.backOffset = 0
    out.eyeOffsetY = 0
    out.pitchOffset = 0
    out.followDistanceCap = null
    out.shoulderWeight = 1
    out.handoffProgress = 1
    return out
  }

  out.active = true
  out.handoffProgress = handoffProgress
  // Respect reduced-motion by eliminating first-person camera dolly/pitch motion
  out.backOffset = reducedMotion
    ? 0
    : cfg.interLevelCameraBackOffset * cabinWeight
  out.eyeOffsetY = reducedMotion
    ? 0
    : cfg.interLevelCameraEyeOffsetY * cabinWeight
  out.pitchOffset = reducedMotion
    ? 0
    : cfg.interLevelCameraPitchOffset * cabinWeight
  // Keep third-person camera tucked inside the elevator cabin while doors are closed,
  // then smoothly release back to the configured followDistance and shoulderOffset
  const maxReleaseDist = 5.5
  out.followDistanceCap =
    cfg.interLevelThirdPersonDistanceCap +
    (maxReleaseDist - cfg.interLevelThirdPersonDistanceCap) * handoffProgress
  out.shoulderWeight = handoffProgress

  return out
}
