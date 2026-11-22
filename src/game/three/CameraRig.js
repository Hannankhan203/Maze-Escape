import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { getMazeWorldBounds } from '../world/gridCollision.js'
import { CELL_SIZE } from '../world/worldCoords.js'
import {
  CAMERA_MODES,
  DEFAULT_THIRD_PERSON_CAMERA_DISTANCE,
  DEFAULT_THIRD_PERSON_CAMERA_MODE,
  THIRD_PERSON_CAMERA_DISTANCES,
  THIRD_PERSON_CAMERA_MODES,
  getNextThirdPersonCameraDistance,
  getThirdPersonCameraDistanceValue,
  normalizeThirdPersonCameraDistance,
  normalizeThirdPersonCameraMode,
} from './threeConfig.js'

export {
  CAMERA_MODES,
  THIRD_PERSON_CAMERA_DISTANCES,
  THIRD_PERSON_CAMERA_MODES,
}

export const MAX_THIRD_PERSON_HEIGHT = 2.75

export const DEFAULT_CAMERA_CONFIG = {
  mode: CAMERA_MODES.FIRST_PERSON,
  thirdPersonMode: DEFAULT_THIRD_PERSON_CAMERA_MODE,
  cameraDistancePreset: DEFAULT_THIRD_PERSON_CAMERA_DISTANCE,
  eyeHeight: 1.65,
  followDistance: getThirdPersonCameraDistanceValue(
    DEFAULT_THIRD_PERSON_CAMERA_DISTANCE
  ),
  followHeight: 2.2,
  maxCameraHeight: MAX_THIRD_PERSON_HEIGHT,
  shoulderOffset: 0.45,
  lookAheadDistance: 6.0,
  cameraCollisionRadius: 0.35,
  freeLookTargetHeight: 1.05,
  freeLookMinY: 0.16,
  freeLookMinPitch: -(Math.PI / 2 - 0.015),
  freeLookMaxPitch: Math.PI / 2 - 0.015,
  sensitivity: 0.0022,
  invertY: false,
  minPitch: -Math.PI / 2.2,
  maxPitch: Math.PI / 2.2,
  positionSmoothing: 14,
  rotationSmoothing: 18,
  freeLookTurnSpeed: 14,
}

const VALID_MODES = new Set([
  CAMERA_MODES.FIRST_PERSON,
  CAMERA_MODES.THIRD_PERSON,
])

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeMode(mode, fallback = CAMERA_MODES.FIRST_PERSON) {
  return VALID_MODES.has(mode) ? mode : fallback
}

/**
 * Reusable, zero-allocation camera rig supporting first-person and third-person
 * perspectives for a Three.js PerspectiveCamera.
 *
 * Orientation convention (right-handed Y-up):
 *  - `yaw = 0` looks along `-Z` (north / row - 1)
 *  - `yaw = -Math.PI / 2` looks along `+X` (east / col + 1)
 *  - positive `pitch` tilts gaze upward (`+Y`), clamped cleanly
 */
export class CameraRig {
  constructor(camera, config = {}) {
    if (!camera || !camera.position || !camera.quaternion) {
      throw new Error('CameraRig requires a valid Three.js Camera instance.')
    }

    this.camera = camera
    if (this.camera.rotation && 'order' in this.camera.rotation) {
      this.camera.rotation.order = 'YXZ'
    }
    const initialThirdPersonMode = normalizeThirdPersonCameraMode(
      config?.thirdPersonCameraMode ?? config?.thirdPersonMode,
      DEFAULT_CAMERA_CONFIG.thirdPersonMode
    )
    const rawPreset = config?.cameraDistancePreset ?? config?.thirdPersonDistance
    const hasExplicitPreset =
      typeof rawPreset === 'string' &&
      normalizeThirdPersonCameraDistance(rawPreset, '') !== ''
    const initialDistancePreset = normalizeThirdPersonCameraDistance(
      rawPreset,
      DEFAULT_CAMERA_CONFIG.cameraDistancePreset
    )
    const initialFollowDistance = hasExplicitPreset
      ? getThirdPersonCameraDistanceValue(initialDistancePreset)
      : Number.isFinite(config?.followDistance) && config.followDistance > 0
        ? config.followDistance
        : getThirdPersonCameraDistanceValue(initialDistancePreset)

    this.isDisposed = false
    this.config = {
      ...DEFAULT_CAMERA_CONFIG,
      ...(config || {}),
      mode: normalizeMode(config?.mode, DEFAULT_CAMERA_CONFIG.mode),
      thirdPersonMode: initialThirdPersonMode,
      thirdPersonCameraMode: initialThirdPersonMode,
      cameraDistancePreset: initialDistancePreset,
      followDistance: initialFollowDistance,
    }

    this._mode = this.config.mode
    this._thirdPersonMode = initialThirdPersonMode
    this._cameraDistancePreset = initialDistancePreset
    this._distanceTransitionActive = false
    this._yaw = 0
    this._pitch = 0
    this._orbitYaw = 0
    this._orbitPitch = 0
    this._shakeRoll = 0
    this._maze = null
    this._currentFollowDistance = this.config.followDistance
    this._currentShoulderOffset = this.config.shoulderOffset
    this._safeOffsets = {
      followDistance: this.config.followDistance,
      shoulderOffset: this.config.shoulderOffset,
    }

    // Pre-allocated math objects so per-frame updates allocate zero garbage
    this._playerPos = new THREE.Vector3(0, 0, 0)
    this._targetPos = new THREE.Vector3(0, this.config.eyeHeight, 0)
    this._targetLookAt = new THREE.Vector3(0, this.config.eyeHeight, -1)
    this._targetEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    this._targetQuat = new THREE.Quaternion()
    this._shakeQuat = new THREE.Quaternion()
    this._rollAxis = new THREE.Vector3(0, 0, 1)
    this._lookMatrix = new THREE.Matrix4()
    this._up = new THREE.Vector3(0, 1, 0)
    this._transitioning = false
    this._transitionElapsed = 0
    this._transitionDuration = 0.35
    this._transitionStartPos = new THREE.Vector3()
    this._transitionStartQuat = new THREE.Quaternion()
  }

  _getFreeLookMinPitch() {
    return Number.isFinite(this.config.freeLookMinPitch)
      ? this.config.freeLookMinPitch
      : -(Math.PI / 2 - 0.015)
  }

  _getFreeLookMaxPitch() {
    return Number.isFinite(this.config.freeLookMaxPitch)
      ? this.config.freeLookMaxPitch
      : Math.PI / 2 - 0.015
  }

  _getFreeLookMinY() {
    return Number.isFinite(this.config.freeLookMinY)
      ? clamp(this.config.freeLookMinY, 0.08, 0.8)
      : 0.16
  }

  getMode() {
    return this._mode
  }

  getThirdPersonMode() {
    return this._thirdPersonMode
  }

  getThirdPersonCameraMode() {
    return this._thirdPersonMode
  }

  isFreeLookActive() {
    return (
      this._mode === CAMERA_MODES.THIRD_PERSON &&
      this._thirdPersonMode === THIRD_PERSON_CAMERA_MODES.FREE_LOOK
    )
  }

  setMode(mode, options = {}) {
    if (this.isDisposed) return this._mode

    const nextMode = normalizeMode(mode, this._mode)
    if (nextMode === this._mode && !options?.immediate) {
      return this._mode
    }

    if (
      nextMode === CAMERA_MODES.THIRD_PERSON &&
      this._mode !== CAMERA_MODES.THIRD_PERSON
    ) {
      // Align orbit direction to current facing when entering third-person
      this._orbitYaw = this._yaw
      this._orbitPitch = clamp(
        this._pitch,
        this._getFreeLookMinPitch(),
        this._getFreeLookMaxPitch()
      )
    }

    if (options?.immediate) {
      this._mode = nextMode
      this.config.mode = nextMode
      this._currentFollowDistance = this.config.followDistance
      this._currentShoulderOffset = this.config.shoulderOffset
      this._transitioning = false
      this.snap()
      return this._mode
    }

    if (nextMode !== this._mode) {
      if (this.camera && this.camera.position && this.camera.quaternion) {
        this._transitionStartPos.copy(this.camera.position)
        this._transitionStartQuat.copy(this.camera.quaternion)
      } else {
        this._transitionStartPos.copy(this._targetPos)
        this._transitionStartQuat.copy(this._targetQuat)
      }
      this._mode = nextMode
      this.config.mode = nextMode
      this._currentFollowDistance = this.config.followDistance
      this._currentShoulderOffset = this.config.shoulderOffset
      this._transitioning = true
      this._transitionElapsed = 0
    }

    return this._mode
  }

  setThirdPersonMode(mode, options = {}) {
    if (this.isDisposed) return this._thirdPersonMode

    const nextThirdPersonMode = normalizeThirdPersonCameraMode(
      mode,
      this._thirdPersonMode
    )
    const changed = nextThirdPersonMode !== this._thirdPersonMode

    if (!changed && !options?.immediate) {
      return this._thirdPersonMode
    }

    if (changed && this._mode === CAMERA_MODES.THIRD_PERSON) {
      if (nextThirdPersonMode === THIRD_PERSON_CAMERA_MODES.FREE_LOOK) {
        // Preserve current viewing angle seamlessly when activating Free Look
        this._orbitYaw = this._yaw
        this._orbitPitch = clamp(
          this._pitch,
          this._getFreeLookMinPitch(),
          this._getFreeLookMaxPitch()
        )
      }

      if (!options?.immediate) {
        if (this.camera && this.camera.position && this.camera.quaternion) {
          this._transitionStartPos.copy(this.camera.position)
          this._transitionStartQuat.copy(this.camera.quaternion)
        } else {
          this._transitionStartPos.copy(this._targetPos)
          this._transitionStartQuat.copy(this._targetQuat)
        }
        this._transitioning = true
        this._transitionElapsed = 0
      }
    }

    this._thirdPersonMode = nextThirdPersonMode
    this.config.thirdPersonMode = nextThirdPersonMode
    this.config.thirdPersonCameraMode = nextThirdPersonMode

    if (options?.immediate) {
      this._transitioning = false
      this.snap()
    }

    return this._thirdPersonMode
  }

  setThirdPersonCameraMode(mode, options = {}) {
    return this.setThirdPersonMode(mode, options)
  }

  getCameraDistancePreset() {
    return this._cameraDistancePreset
  }

  getFollowDistance() {
    return this.config.followDistance
  }

  getCurrentFollowDistance() {
    return this._currentFollowDistance
  }

  setCameraDistancePreset(preset, options = {}) {
    if (this.isDisposed) return this._cameraDistancePreset

    const nextPreset = normalizeThirdPersonCameraDistance(
      preset,
      this._cameraDistancePreset
    )
    const nextDistance = getThirdPersonCameraDistanceValue(nextPreset)
    const changed =
      nextPreset !== this._cameraDistancePreset ||
      Math.abs(this.config.followDistance - nextDistance) > 1e-5

    this._cameraDistancePreset = nextPreset
    this.config.cameraDistancePreset = nextPreset
    this.config.followDistance = nextDistance

    if (options?.immediate) {
      this._distanceTransitionActive = false
      this._currentFollowDistance = nextDistance
      this.snap()
    } else if (changed && this._mode === CAMERA_MODES.THIRD_PERSON) {
      this._distanceTransitionActive = true
    }

    return this._cameraDistancePreset
  }

  cycleCameraDistance(options = {}) {
    if (this.isDisposed) return this._cameraDistancePreset
    const nextPreset = getNextThirdPersonCameraDistance(this._cameraDistancePreset)
    return this.setCameraDistancePreset(nextPreset, options)
  }

  setMaze(maze) {
    this._maze = maze || null
    this._currentFollowDistance = this.config.followDistance
    this._currentShoulderOffset = this.config.shoulderOffset
  }

  getConfig() {
    return { ...this.config }
  }

  updateConfig(partialConfig = {}) {
    if (this.isDisposed || !partialConfig || typeof partialConfig !== 'object') {
      return this.getConfig()
    }

    const nextMode = partialConfig.mode
      ? normalizeMode(partialConfig.mode, this._mode)
      : this._mode
    const rawThirdPersonMode =
      partialConfig.thirdPersonCameraMode ?? partialConfig.thirdPersonMode
    const nextThirdPersonMode = rawThirdPersonMode
      ? normalizeThirdPersonCameraMode(rawThirdPersonMode, this._thirdPersonMode)
      : this._thirdPersonMode

    if (nextMode !== this._mode) {
      this.setMode(nextMode)
    }
    if (nextThirdPersonMode !== this._thirdPersonMode) {
      this.setThirdPersonMode(nextThirdPersonMode)
    }

    const rawPreset =
      partialConfig.cameraDistancePreset ?? partialConfig.thirdPersonDistance
    const hasExplicitPreset =
      typeof rawPreset === 'string' &&
      normalizeThirdPersonCameraDistance(rawPreset, '') !== ''
    const hasExplicitFollowDistance =
      Number.isFinite(partialConfig.followDistance) &&
      partialConfig.followDistance > 0

    let nextDistancePreset = this._cameraDistancePreset
    let nextFollowDistance = this.config.followDistance

    if (hasExplicitPreset) {
      nextDistancePreset = normalizeThirdPersonCameraDistance(
        rawPreset,
        this._cameraDistancePreset
      )
      nextFollowDistance = getThirdPersonCameraDistanceValue(nextDistancePreset)
      if (
        nextDistancePreset !== this._cameraDistancePreset &&
        this._mode === CAMERA_MODES.THIRD_PERSON
      ) {
        this._distanceTransitionActive = true
      }
    } else if (hasExplicitFollowDistance) {
      nextFollowDistance = partialConfig.followDistance
    }

    this.config = {
      ...this.config,
      ...partialConfig,
      mode: nextMode,
      thirdPersonMode: nextThirdPersonMode,
      thirdPersonCameraMode: nextThirdPersonMode,
      cameraDistancePreset: nextDistancePreset,
      followDistance: nextFollowDistance,
    }
    this._mode = nextMode
    this._thirdPersonMode = nextThirdPersonMode
    this._cameraDistancePreset = nextDistancePreset
    this._pitch = clamp(this._pitch, this.config.minPitch, this.config.maxPitch)
    this._orbitPitch = clamp(
      this._orbitPitch,
      this._getFreeLookMinPitch(),
      this._getFreeLookMaxPitch()
    )

    return this.getConfig()
  }

  /**
   * Updates the tracked player anchor in world coordinates.
   * Accepts `(x, y, z)` numbers or `({ x, y, z })`.
   */
  setPlayerPosition(xOrVec, y = 0, z = 0) {
    if (this.isDisposed) return

    if (xOrVec && typeof xOrVec === 'object') {
      const nextX = Number.isFinite(xOrVec.x) ? xOrVec.x : this._playerPos.x
      const nextY = Number.isFinite(xOrVec.y) ? xOrVec.y : 0
      const nextZ = Number.isFinite(xOrVec.z) ? xOrVec.z : this._playerPos.z
      this._playerPos.set(nextX, nextY, nextZ)
      return
    }

    if (Number.isFinite(xOrVec) && Number.isFinite(y) && Number.isFinite(z)) {
      this._playerPos.set(xOrVec, y, z)
    }
  }

  getPlayerPosition(target = null) {
    if (target && typeof target.copy === 'function') {
      return target.copy(this._playerPos)
    }
    return {
      x: this._playerPos.x,
      y: this._playerPos.y,
      z: this._playerPos.z,
    }
  }

  setLookDirection(yaw, pitch = this._pitch) {
    if (this.isDisposed) return
    if (Number.isFinite(yaw)) {
      this._yaw = yaw
      this._orbitYaw = yaw
    }
    if (Number.isFinite(pitch)) {
      this._pitch = clamp(pitch, this.config.minPitch, this.config.maxPitch)
      this._orbitPitch = clamp(
        pitch,
        this._getFreeLookMinPitch(),
        this._getFreeLookMaxPitch()
      )
    }
  }

  /**
   * Updates only the character's facing yaw without altering independent
   * free-look camera orbit angles (`_orbitYaw` / `_orbitPitch`).
   */
  setCharacterYaw(yaw) {
    if (this.isDisposed || !Number.isFinite(yaw)) return
    this._yaw = yaw
  }

  applyLookDelta(deltaX = 0, deltaY = 0, options = {}) {
    if (this.isDisposed) return
    const sens = Number.isFinite(options.sensitivity)
      ? options.sensitivity
      : Number.isFinite(this.config.sensitivity)
        ? this.config.sensitivity
        : DEFAULT_CAMERA_CONFIG.sensitivity

    const invertY = options.invertY ?? this.config.invertY ?? false
    const dy = invertY ? -deltaY : deltaY

    if (this.isFreeLookActive()) {
      if (Number.isFinite(deltaX)) {
        this._orbitYaw -= deltaX * sens
      }
      if (Number.isFinite(dy)) {
        this._orbitPitch = clamp(
          this._orbitPitch - dy * sens,
          this._getFreeLookMinPitch(),
          this._getFreeLookMaxPitch()
        )
      }
      return
    }

    if (Number.isFinite(deltaX)) {
      this._yaw -= deltaX * sens
      this._orbitYaw = this._yaw
    }
    if (Number.isFinite(dy)) {
      this._pitch = clamp(
        this._pitch - dy * sens,
        this.config.minPitch,
        this.config.maxPitch
      )
      this._orbitPitch = clamp(
        this._pitch,
        this._getFreeLookMinPitch(),
        this._getFreeLookMaxPitch()
      )
    }
  }

  getLookDirection() {
    return {
      yaw: this._yaw,
      pitch: this._pitch,
    }
  }

  getCharacterDirection() {
    return {
      yaw: this._yaw,
      pitch: this._pitch,
    }
  }

  getCameraLookDirection() {
    if (this.isFreeLookActive()) {
      return {
        yaw: this._orbitYaw,
        pitch: this._orbitPitch,
      }
    }
    return {
      yaw: this._yaw,
      pitch: this._pitch,
    }
  }

  setShakeRoll(roll = 0) {
    if (this.isDisposed) return
    this._shakeRoll = Number.isFinite(roll) ? roll : 0
  }

  getShakeRoll() {
    return this._shakeRoll
  }

  getForwardVector(target = { x: 0, z: -1 }) {
    target.x = -Math.sin(this._yaw)
    if ('y' in target) target.y = 0
    target.z = -Math.cos(this._yaw)
    return target
  }

  getRightVector(target = { x: 1, z: 0 }) {
    target.x = Math.cos(this._yaw)
    if ('y' in target) target.y = 0
    target.z = -Math.sin(this._yaw)
    return target
  }

  /**
   * Returns the horizontal camera forward unit vector projected onto the
   * ground plane (XZ). Safe across all vertical orbit angles including
   * near-vertical overhead and under-character views.
   */
  getCameraForwardVector(target = { x: 0, z: -1 }) {
    const yaw = this.isFreeLookActive() ? this._orbitYaw : this._yaw
    target.x = -Math.sin(yaw)
    if ('y' in target) target.y = 0
    target.z = -Math.cos(yaw)
    return target
  }

  /**
   * Returns the horizontal camera right unit vector projected onto the
   * ground plane (XZ).
   */
  getCameraRightVector(target = { x: 1, z: 0 }) {
    const yaw = this.isFreeLookActive() ? this._orbitYaw : this._yaw
    target.x = Math.cos(yaw)
    if ('y' in target) target.y = 0
    target.z = -Math.sin(yaw)
    return target
  }

  _isCircleClear(x, z, radius) {
    const maze = this._maze
    if (!maze?.grid) return true

    const bounds = getMazeWorldBounds(maze, radius)
    if (!bounds) return true

    if (
      x < bounds.minX ||
      x > bounds.maxX ||
      z < bounds.minZ ||
      z > bounds.maxZ
    ) {
      return false
    }

    const minCol = clamp(
      Math.floor((x - radius - bounds.originX) / CELL_SIZE),
      0,
      bounds.cols - 1
    )
    const maxCol = clamp(
      Math.floor((x + radius - bounds.originX) / CELL_SIZE),
      0,
      bounds.cols - 1
    )
    const minRow = clamp(
      Math.floor((z - radius - bounds.originZ) / CELL_SIZE),
      0,
      bounds.rows - 1
    )
    const maxRow = clamp(
      Math.floor((z + radius - bounds.originZ) / CELL_SIZE),
      0,
      bounds.rows - 1
    )

    const radiusSq = radius * radius - 1e-6
    for (let r = minRow; r <= maxRow; r += 1) {
      const cellMinZ = bounds.originZ + r * CELL_SIZE
      const cellMaxZ = cellMinZ + CELL_SIZE
      for (let c = minCol; c <= maxCol; c += 1) {
        if (maze.grid[r][c] !== CELL_TYPES.PATH) {
          const cellMinX = bounds.originX + c * CELL_SIZE
          const cellMaxX = cellMinX + CELL_SIZE
          const nearestX = clamp(x, cellMinX, cellMaxX)
          const nearestZ = clamp(z, cellMinZ, cellMaxZ)
          const dx = x - nearestX
          const dz = z - nearestZ
          if (dx * dx + dz * dz < radiusSq) {
            return false
          }
        }
      }
    }

    return true
  }

  _sweepClearFraction(x0, z0, x1, z1, radius) {
    if (!this._maze?.grid) {
      return 1
    }

    const dx = x1 - x0
    const dz = z1 - z0
    const totalDist = Math.hypot(dx, dz)
    if (totalDist <= 1e-4) {
      return this._isCircleClear(x1, z1, radius) ? 1 : 0
    }

    const stepLen = Math.min(0.18, Math.max(0.06, radius * 0.5))
    const steps = Math.max(1, Math.ceil(totalDist / stepLen))

    for (let i = 1; i <= steps; i += 1) {
      const u = i / steps
      const sx = x0 + dx * u
      const sz = z0 + dz * u
      if (!this._isCircleClear(sx, sz, radius)) {
        let lo = (i - 1) / steps
        let hi = u
        if (i === 1 && !this._isCircleClear(x0, z0, radius)) {
          return 0
        }
        for (let b = 0; b < 6; b += 1) {
          const mid = (lo + hi) * 0.5
          if (this._isCircleClear(x0 + dx * mid, z0 + dz * mid, radius)) {
            lo = mid
          } else {
            hi = mid
          }
        }
        return lo
      }
    }

    return 1
  }

  _getCameraCollisionRadius() {
    return clamp(this.config.cameraCollisionRadius ?? 0.35, 0.2, 0.55)
  }

  _getMaxThirdPersonHeight() {
    const cfgMax = Number.isFinite(this.config.maxCameraHeight)
      ? this.config.maxCameraHeight
      : MAX_THIRD_PERSON_HEIGHT
    return clamp(cfgMax, 1.0, MAX_THIRD_PERSON_HEIGHT)
  }

  _computeSafeCameraOffsets(px, pz, forwardX, forwardZ, rightX, rightZ) {
    const idealDist = Math.max(0, this.config.followDistance)
    const idealShoulder = this.config.shoulderOffset
    const out = this._safeOffsets

    if (!this._maze?.grid) {
      out.followDistance = idealDist
      out.shoulderOffset = idealShoulder
      return out
    }

    const camRadius = this._getCameraCollisionRadius()

    // 1. Clamp lateral shoulder offset right at the player's side
    const lateralFrac =
      Math.abs(idealShoulder) > 1e-4
        ? this._sweepClearFraction(
            px,
            pz,
            px + rightX * idealShoulder,
            pz + rightZ * idealShoulder,
            camRadius
          )
        : 1
    const maxLateralShoulder = idealShoulder * lateralFrac

    // 2. Sweep complete camera arm (followDistance + lateral shoulder)
    const fullFrac = this._sweepClearFraction(
      px,
      pz,
      px - forwardX * idealDist + rightX * maxLateralShoulder,
      pz - forwardZ * idealDist + rightZ * maxLateralShoulder,
      camRadius
    )

    if (fullFrac >= 0.9999) {
      out.followDistance = idealDist
      out.shoulderOffset = maxLateralShoulder
      return out
    }

    // 3. Obstacle detected: check straight centerline behind player
    const centerFrac = this._sweepClearFraction(
      px,
      pz,
      px - forwardX * idealDist,
      pz - forwardZ * idealDist,
      camRadius
    )

    let safeDist
    let safeShoulder

    if (centerFrac > fullFrac) {
      // Side wall or corner on the shoulder flank: preserve open rear corridor
      // distance and find the largest clear shoulder offset.
      safeDist = idealDist * centerFrac
      const shoulderDistanceScale = safeDist < 1.2 ? clamp(safeDist / 1.2, 0, 1) : 1
      const candidateMaxShoulder = maxLateralShoulder * shoulderDistanceScale

      let lo = 0
      let hi = 1
      for (let b = 0; b < 6; b += 1) {
        const mid = (lo + hi) * 0.5
        const testShoulder = candidateMaxShoulder * mid
        const frac = this._sweepClearFraction(
          px,
          pz,
          px - forwardX * safeDist + rightX * testShoulder,
          pz - forwardZ * safeDist + rightZ * testShoulder,
          camRadius
        )
        if (frac >= 0.999) {
          lo = mid
        } else {
          hi = mid
        }
      }
      safeShoulder = candidateMaxShoulder * lo
    } else {
      // Rear wall or inside corner: pull in both followDistance and shoulderOffset
      safeDist = idealDist * fullFrac
      safeShoulder = maxLateralShoulder * fullFrac
      if (safeDist < 1.2) {
        safeShoulder *= clamp(safeDist / 1.2, 0, 1)
      }
      const verifyFrac = this._sweepClearFraction(
        px,
        pz,
        px - forwardX * safeDist + rightX * safeShoulder,
        pz - forwardZ * safeDist + rightZ * safeShoulder,
        camRadius
      )
      if (verifyFrac < 1) {
        safeDist *= verifyFrac
        safeShoulder *= verifyFrac
      }
    }

    out.followDistance = safeDist
    out.shoulderOffset = safeShoulder
    return out
  }

  _computeTargetPose(delta = 0) {
    const px = this._playerPos.x
    const py = this._playerPos.y
    const pz = this._playerPos.z

    if (this._mode === CAMERA_MODES.THIRD_PERSON && this.isFreeLookActive()) {
      const targetHeight = clamp(
        Number.isFinite(this.config.freeLookTargetHeight)
          ? this.config.freeLookTargetHeight
          : 1.05,
        0.4,
        1.8
      )
      const pivotY = py + targetHeight

      const cosPitch = Math.cos(this._orbitPitch)
      const sinPitch = Math.sin(this._orbitPitch)
      const sinYaw = Math.sin(this._orbitYaw)
      const cosYaw = Math.cos(this._orbitYaw)

      // Camera forward vector matching YXZ Euler (pitch, yaw, 0)
      const fwdX = -sinYaw * cosPitch
      const fwdY = sinPitch
      const fwdZ = -cosYaw * cosPitch

      // Ray from centered character pivot toward orbit camera
      const rayX = -fwdX
      const rayY = -fwdY
      const rayZ = -fwdZ

      const idealDist = Math.max(0.5, this.config.followDistance)
      const camRadius = this._getCameraCollisionRadius()
      const shaftElevOffset = py > 0.25 ? Math.max(0, py - 0.06) : 0
      const maxHeight = this._getMaxThirdPersonHeight() + shaftElevOffset
      const minFloorY = this._getFreeLookMinY() + shaftElevOffset

      let safeDist = idealDist
      if (this._maze?.grid) {
        if (rayY < -1e-4) {
          const tFloor = Math.max(0.35, (minFloorY - pivotY) / rayY)
          safeDist = Math.min(safeDist, tFloor)
        } else if (rayY > 1e-4) {
          const tCeil = Math.max(0.35, (maxHeight - pivotY) / rayY)
          safeDist = Math.min(safeDist, tCeil)
        }

        const candX = px + rayX * safeDist
        const candZ = pz + rayZ * safeDist
        const wallFrac = this._sweepClearFraction(px, pz, candX, candZ, camRadius)
        safeDist *= wallFrac
      }
      if (py > 2.15) {
        const horizLen = Math.hypot(rayX, rayZ) * safeDist
        const maxShaftRadius = Math.max(0.45, 1.48 - camRadius)
        if (horizLen > maxShaftRadius) {
          safeDist *= maxShaftRadius / horizLen
        }
      }

      if (delta <= 0) {
        this._currentFollowDistance = safeDist
        this._distanceTransitionActive = false
      } else {
        const shrinkRate = this._distanceTransitionActive ? 11.0 : 24.0
        const expandRate = this._distanceTransitionActive ? 11.0 : 12.0
        const distRate =
          safeDist < this._currentFollowDistance ? shrinkRate : expandRate
        const distAlpha = 1 - Math.exp(-distRate * delta)
        this._currentFollowDistance +=
          (safeDist - this._currentFollowDistance) * distAlpha
        if (Math.abs(safeDist - this._currentFollowDistance) <= 0.01) {
          this._distanceTransitionActive = false
        }
      }
      this._currentShoulderOffset = 0

      // Keep active distance bounded along the 3D ray so the character stays
      // centered on screen while avoiding floor, ceiling, and wall clipping.
      let activeDist = this._currentFollowDistance
      if (this._maze?.grid) {
        if (rayY < -1e-4) {
          const tFloor = Math.max(0.35, (minFloorY - pivotY) / rayY)
          if (activeDist > tFloor) activeDist = tFloor
        } else if (rayY > 1e-4) {
          const tCeil = Math.max(0.35, (maxHeight - pivotY) / rayY)
          if (activeDist > tCeil) activeDist = tCeil
        }

        const armClear = this._sweepClearFraction(
          px,
          pz,
          px + rayX * activeDist,
          pz + rayZ * activeDist,
          camRadius
        )
        if (armClear < 1) {
          activeDist *= armClear
        }
      }
      if (py > 2.15) {
        const horizLen = Math.hypot(rayX, rayZ) * activeDist
        const maxShaftRadius = Math.max(0.45, 1.48 - camRadius)
        if (horizLen > maxShaftRadius) {
          activeDist *= maxShaftRadius / horizLen
        }
      }
      this._currentFollowDistance = activeDist

      const camX = px + rayX * activeDist
      const camY = pivotY + rayY * activeDist
      const camZ = pz + rayZ * activeDist

      this._targetPos.set(camX, camY, camZ)
      this._targetLookAt.set(px, pivotY, pz)

      // Pole-safe YXZ Euler orientation pointing directly along fwd at character center
      this._targetEuler.set(this._orbitPitch, this._orbitYaw, 0, 'YXZ')
      this._targetQuat.setFromEuler(this._targetEuler)
    } else if (this._mode === CAMERA_MODES.THIRD_PERSON) {
      const forwardX = -Math.sin(this._yaw)
      const forwardZ = -Math.cos(this._yaw)
      const rightX = Math.cos(this._yaw)
      const rightZ = -Math.sin(this._yaw)

      const {
        followHeight,
        lookAheadDistance,
        eyeHeight,
      } = this.config

      const camRadius = this._getCameraCollisionRadius()
      const shaftElevOffset = py > 0.25 ? Math.max(0, py - 0.06) : 0
      const maxHeight = this._getMaxThirdPersonHeight() + shaftElevOffset
      const minFollowFloorY = 0.35 + shaftElevOffset
      const minLookFloorY = 0.2 + shaftElevOffset
      const safeOffsets = this._computeSafeCameraOffsets(
        px,
        pz,
        forwardX,
        forwardZ,
        rightX,
        rightZ
      )

      if (delta <= 0) {
        this._currentFollowDistance = safeOffsets.followDistance
        this._currentShoulderOffset = safeOffsets.shoulderOffset
        this._distanceTransitionActive = false
      } else {
        const shrinkRate = this._distanceTransitionActive ? 11.0 : 24.0
        const expandRate = this._distanceTransitionActive ? 11.0 : 12.0
        const distRate =
          safeOffsets.followDistance < this._currentFollowDistance
            ? shrinkRate
            : expandRate
        const shoulderRate =
          Math.abs(safeOffsets.shoulderOffset) <
          Math.abs(this._currentShoulderOffset)
            ? shrinkRate
            : expandRate

        const distAlpha = 1 - Math.exp(-distRate * delta)
        const shoulderAlpha = 1 - Math.exp(-shoulderRate * delta)

        this._currentFollowDistance +=
          (safeOffsets.followDistance - this._currentFollowDistance) * distAlpha
        this._currentShoulderOffset +=
          (safeOffsets.shoulderOffset - this._currentShoulderOffset) *
          shoulderAlpha
        if (
          Math.abs(safeOffsets.followDistance - this._currentFollowDistance) <=
          0.01
        ) {
          this._distanceTransitionActive = false
        }
      }

      let camX =
        px -
        forwardX * this._currentFollowDistance +
        rightX * this._currentShoulderOffset
      let camZ =
        pz -
        forwardZ * this._currentFollowDistance +
        rightZ * this._currentShoulderOffset

      if (this._maze?.grid) {
        const armClear = this._sweepClearFraction(px, pz, camX, camZ, camRadius)
        if (armClear < 1) {
          camX = px + (camX - px) * armClear
          camZ = pz + (camZ - pz) * armClear
          this._currentFollowDistance *= armClear
          this._currentShoulderOffset *= armClear
        }
      }
      if (py > 2.15) {
        const offX = camX - px
        const offZ = camZ - pz
        const horizLen = Math.hypot(offX, offZ)
        const maxShaftRadius = Math.max(0.45, 1.48 - camRadius)
        if (horizLen > maxShaftRadius) {
          const clampScale = maxShaftRadius / horizLen
          camX = px + offX * clampScale
          camZ = pz + offZ * clampScale
        }
      }

      const camY = clamp(
        py +
          followHeight -
          Math.sin(this._pitch) * (this._currentFollowDistance * 0.45),
        minFollowFloorY,
        maxHeight
      )
      this._targetPos.set(camX, camY, camZ)

      // Clamp forward look-at target so it never passes through forward walls
      const idealLookX =
        px +
        forwardX * lookAheadDistance +
        rightX * (this._currentShoulderOffset * 0.35)
      const idealLookZ =
        pz +
        forwardZ * lookAheadDistance +
        rightZ * (this._currentShoulderOffset * 0.35)
      const lookClear = this._maze?.grid
        ? this._sweepClearFraction(px, pz, idealLookX, idealLookZ, 0.22)
        : 1
      const lookX = px + (idealLookX - px) * lookClear
      const lookZ = pz + (idealLookZ - pz) * lookClear
      const effectiveLookAhead = lookAheadDistance * lookClear
      const lookY = clamp(
        py +
          eyeHeight * 0.8 +
          Math.sin(this._pitch) * (effectiveLookAhead * 0.6),
        minLookFloorY,
        maxHeight
      )
      this._targetLookAt.set(lookX, lookY, lookZ)

      this._lookMatrix.lookAt(this._targetPos, this._targetLookAt, this._up)
      this._targetQuat.setFromRotationMatrix(this._lookMatrix)
    } else {
      // First-person pose anchored at eye height using YXZ FPS Euler order
      this._currentFollowDistance = this.config.followDistance
      this._currentShoulderOffset = this.config.shoulderOffset
      this._targetPos.set(px, py + this.config.eyeHeight, pz)
      this._targetEuler.set(this._pitch, this._yaw, 0, 'YXZ')
      this._targetQuat.setFromEuler(this._targetEuler)
    }

    if (this._transitioning && delta > 0) {
      this._transitionElapsed += delta
      const t = Math.min(1, this._transitionElapsed / this._transitionDuration)
      const tSmooth = t * t * (3 - 2 * t)

      this._targetPos.lerpVectors(this._transitionStartPos, this._targetPos, tSmooth)
      this._targetQuat.slerpQuaternions(this._transitionStartQuat, this._targetQuat, tSmooth)

      if (t >= 1) {
        this._transitioning = false
      }
    }

    if (this._shakeRoll !== 0) {
      this._shakeQuat.setFromAxisAngle(this._rollAxis, this._shakeRoll)
      this._targetQuat.multiply(this._shakeQuat)
    }
  }

  /**
   * Advances camera position and orientation toward the target pose using
   * frame-rate-independent exponential damping (or snaps when `immediate`).
   */
  update(delta = 0, options = {}) {
    if (this.isDisposed || !this.camera) {
      return
    }

    const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0
    this._computeTargetPose(options?.immediate ? 0 : dt)

    if (options?.immediate) {
      this.camera.position.copy(this._targetPos)
      this.camera.quaternion.copy(this._targetQuat)
      return
    }

    if (dt === 0) {
      return
    }

    const posRate = this.config.positionSmoothing
    const rotRate = this.config.rotationSmoothing

    const posAlpha = posRate <= 0 ? 1 : 1 - Math.exp(-posRate * dt)
    const rotAlpha = rotRate <= 0 ? 1 : 1 - Math.exp(-rotRate * dt)

    this.camera.position.lerp(this._targetPos, posAlpha)
    if (this._mode === CAMERA_MODES.THIRD_PERSON) {
      const shaftElevOffset =
        this._playerPos.y > 0.25 ? Math.max(0, this._playerPos.y - 0.06) : 0
      if (this.isFreeLookActive()) {
        if (this._maze?.grid) {
          const maxHeight = this._getMaxThirdPersonHeight() + shaftElevOffset
          const minFloorY = this._getFreeLookMinY() + shaftElevOffset
          this.camera.position.y = clamp(
            this.camera.position.y,
            minFloorY,
            maxHeight
          )
          const camRadius = this._getCameraCollisionRadius()
          const camClear = this._sweepClearFraction(
            this._playerPos.x,
            this._playerPos.z,
            this.camera.position.x,
            this.camera.position.z,
            camRadius
          )
          if (camClear < 1) {
            this.camera.position.x =
              this._playerPos.x +
              (this.camera.position.x - this._playerPos.x) * camClear
            this.camera.position.z =
              this._playerPos.z +
              (this.camera.position.z - this._playerPos.z) * camClear
          }
        }
      } else {
        const maxHeight = this._getMaxThirdPersonHeight() + shaftElevOffset
        this.camera.position.y = clamp(
          this.camera.position.y,
          0.35 + shaftElevOffset,
          maxHeight
        )
        if (this._maze?.grid) {
          const camRadius = this._getCameraCollisionRadius()
          const camClear = this._sweepClearFraction(
            this._playerPos.x,
            this._playerPos.z,
            this.camera.position.x,
            this.camera.position.z,
            camRadius
          )
          if (camClear < 1) {
            this.camera.position.x =
              this._playerPos.x +
              (this.camera.position.x - this._playerPos.x) * camClear
            this.camera.position.z =
              this._playerPos.z +
              (this.camera.position.z - this._playerPos.z) * camClear
          }
        }
      }
      if (this._playerPos.y > 2.15) {
        const camRadius = this._getCameraCollisionRadius()
        const maxShaftRadius = Math.max(0.45, 1.48 - camRadius)
        const offX = this.camera.position.x - this._playerPos.x
        const offZ = this.camera.position.z - this._playerPos.z
        const horizLen = Math.hypot(offX, offZ)
        if (horizLen > maxShaftRadius) {
          const clampScale = maxShaftRadius / horizLen
          this.camera.position.x = this._playerPos.x + offX * clampScale
          this.camera.position.z = this._playerPos.z + offZ * clampScale
        }
      }
    }
    this.camera.quaternion.slerp(this._targetQuat, rotAlpha)
  }

  snap() {
    this._currentFollowDistance = this.config.followDistance
    this._currentShoulderOffset = this.config.shoulderOffset
    this._transitioning = false
    this.update(0, { immediate: true })
  }

  dispose() {
    if (this.isDisposed) {
      return false
    }

    this.isDisposed = true
    this.camera = null
    this._safeOffsets = null
    this._playerPos = null
    this._targetPos = null
    this._targetLookAt = null
    this._targetEuler = null
    this._targetQuat = null
    this._shakeQuat = null
    this._rollAxis = null
    this._lookMatrix = null
    this._up = null
    this._transitionStartPos = null
    this._transitionStartQuat = null

    return true
  }
}
