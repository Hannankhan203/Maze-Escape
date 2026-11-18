import * as THREE from 'three'
import { isCellWalkable } from '../world/gridCollision.js'
import { worldToGrid } from '../world/worldCoords.js'

export const CAMERA_MODES = {
  FIRST_PERSON: 'first-person',
  THIRD_PERSON: 'third-person',
}

export const DEFAULT_CAMERA_CONFIG = {
  mode: CAMERA_MODES.FIRST_PERSON,
  eyeHeight: 1.65,
  followDistance: 4.2,
  followHeight: 2.6,
  shoulderOffset: 0.45,
  lookAheadDistance: 6.0,
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
    this.isDisposed = false
    this.config = {
      ...DEFAULT_CAMERA_CONFIG,
      ...(config || {}),
      mode: normalizeMode(config?.mode, DEFAULT_CAMERA_CONFIG.mode),
    }

    this._mode = this.config.mode
    this._yaw = 0
    this._pitch = 0
    this._maze = null
    this._currentFollowDistance = this.config.followDistance

    // Pre-allocated math objects so per-frame updates allocate zero garbage
    this._playerPos = new THREE.Vector3(0, 0, 0)
    this._targetPos = new THREE.Vector3(0, this.config.eyeHeight, 0)
    this._targetLookAt = new THREE.Vector3(0, this.config.eyeHeight, -1)
    this._targetEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    this._targetQuat = new THREE.Quaternion()
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
      this._transitioning = true
      this._transitionElapsed = 0
    }

    return this._mode
  }

  setMaze(maze) {
    this._maze = maze || null
    this._currentFollowDistance = this.config.followDistance
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

  _computeSafeFollowDistance(px, py, pz, idealCamX, idealCamY, idealCamZ) {
    const idealDist = this.config.followDistance
    if (!this._maze || !this._maze.grid) {
      return idealDist
    }

    const dx = idealCamX - px
    const dz = idealCamZ - pz
    const totalDist = Math.hypot(dx, dz)
    if (totalDist <= 1e-4) {
      return idealDist
    }

    const ux = dx / totalDist
    const uz = dz / totalDist
    const camRadius = 0.28
    const step = 0.2
    let safeDist = idealDist

    for (let t = step; t <= totalDist; t += step) {
      const sampleX = px + ux * t
      const sampleZ = pz + uz * t
      const gridCell = worldToGrid(sampleX, sampleZ, this._maze)

      if (!gridCell || !isCellWalkable(gridCell.row, gridCell.col, this._maze)) {
        safeDist = Math.max(0.7, t - step - camRadius)
        break
      }
    }

    const finalGrid = worldToGrid(idealCamX, idealCamZ, this._maze)
    if (!finalGrid || !isCellWalkable(finalGrid.row, finalGrid.col, this._maze)) {
      safeDist = Math.min(safeDist, Math.max(0.7, totalDist - 0.4))
    }

    return safeDist
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
        followDistance,
        followHeight,
        shoulderOffset,
        lookAheadDistance,
        eyeHeight,
      } = this.config

      const idealCamX = px - forwardX * followDistance + rightX * shoulderOffset
      const idealCamZ = pz - forwardZ * followDistance + rightZ * shoulderOffset
      const idealCamY = Math.max(
        0.35,
        py + followHeight - Math.sin(this._pitch) * (followDistance * 0.45)
      )

      const safeDist = this._computeSafeFollowDistance(
        px,
        py,
        pz,
        idealCamX,
        idealCamY,
        idealCamZ
      )

      if (delta <= 0) {
        this._currentFollowDistance = safeDist
      } else {
        const followRate = 22.0
        const followAlpha =
          followRate <= 0 ? 1 : 1 - Math.exp(-followRate * delta)
        this._currentFollowDistance +=
          (safeDist - this._currentFollowDistance) * followAlpha
      }

      const camX =
        px - forwardX * this._currentFollowDistance + rightX * shoulderOffset
      const camZ =
        pz - forwardZ * this._currentFollowDistance + rightZ * shoulderOffset
      const camY = Math.max(
        0.35,
        py +
          followHeight -
          Math.sin(this._pitch) * (this._currentFollowDistance * 0.45)
      )
      this._targetPos.set(camX, camY, camZ)

      const lookX =
        px + forwardX * lookAheadDistance + rightX * (shoulderOffset * 0.35)
      const lookY =
        py +
        eyeHeight * 0.8 +
        Math.sin(this._pitch) * (lookAheadDistance * 0.6)
      const lookZ =
        pz + forwardZ * lookAheadDistance + rightZ * (shoulderOffset * 0.35)
      this._targetLookAt.set(lookX, lookY, lookZ)

      this._lookMatrix.lookAt(this._targetPos, this._targetLookAt, this._up)
      this._targetQuat.setFromRotationMatrix(this._lookMatrix)
    } else {
      // First-person pose anchored at eye height using YXZ FPS Euler order
      this._currentFollowDistance = this.config.followDistance
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
    this.camera.quaternion.slerp(this._targetQuat, rotAlpha)
  }

  snap() {
    this._currentFollowDistance = this.config.followDistance
    this._transitioning = false
    this.update(0, { immediate: true })
  }

  dispose() {
    if (this.isDisposed) {
      return false
    }

    this.isDisposed = true
    this.camera = null
    this._playerPos = null
    this._targetPos = null
    this._targetLookAt = null
    this._targetEuler = null
    this._targetQuat = null
    this._lookMatrix = null
    this._up = null
    this._transitionStartPos = null
    this._transitionStartQuat = null

    return true
  }
}
