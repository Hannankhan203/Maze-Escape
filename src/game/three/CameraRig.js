import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { getMazeWorldBounds } from '../world/gridCollision.js'
import { CELL_SIZE } from '../world/worldCoords.js'
import { CAMERA_MODES } from './threeConfig.js'

export { CAMERA_MODES }

export const MAX_THIRD_PERSON_HEIGHT = 2.75

export const DEFAULT_CAMERA_CONFIG = {
  mode: CAMERA_MODES.FIRST_PERSON,
  eyeHeight: 1.65,
  followDistance: 4.2,
  followHeight: 2.2,
  maxCameraHeight: MAX_THIRD_PERSON_HEIGHT,
  shoulderOffset: 0.45,
  lookAheadDistance: 6.0,
  cameraCollisionRadius: 0.35,
  sensitivity: 0.0022,
  invertY: false,
  minPitch: -Math.PI / 2.2,
  maxPitch: Math.PI / 2.2,
  positionSmoothing: 14,
  rotationSmoothing: 18,
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
    this.isDisposed = false
    this.config = {
      ...DEFAULT_CAMERA_CONFIG,
      ...(config || {}),
      mode: normalizeMode(config?.mode, DEFAULT_CAMERA_CONFIG.mode),
    }

    this._mode = this.config.mode
    this._yaw = 0
    this._pitch = 0
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

  getMode() {
    return this._mode
  }

  setMode(mode, options = {}) {
    if (this.isDisposed) return this._mode

    const nextMode = normalizeMode(mode, this._mode)
    if (nextMode === this._mode && !options?.immediate) {
      return this._mode
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

    this.config = {
      ...this.config,
      ...partialConfig,
      mode: nextMode,
    }
    this._mode = nextMode
    this._pitch = clamp(this._pitch, this.config.minPitch, this.config.maxPitch)

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
    }
    if (Number.isFinite(pitch)) {
      this._pitch = clamp(pitch, this.config.minPitch, this.config.maxPitch)
    }
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

    if (Number.isFinite(deltaX)) {
      this._yaw -= deltaX * sens
    }
    if (Number.isFinite(dy)) {
      this._pitch = clamp(
        this._pitch - dy * sens,
        this.config.minPitch,
        this.config.maxPitch
      )
    }
  }

  getLookDirection() {
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

    if (this._mode === CAMERA_MODES.THIRD_PERSON) {
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
      const maxHeight = this._getMaxThirdPersonHeight()
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
      } else {
        const shrinkRate = 24.0
        const expandRate = 12.0
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

      const camY = clamp(
        py +
          followHeight -
          Math.sin(this._pitch) * (this._currentFollowDistance * 0.45),
        0.35,
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
        0.2,
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
      const maxHeight = this._getMaxThirdPersonHeight()
      this.camera.position.y = clamp(this.camera.position.y, 0.35, maxHeight)
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
