import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import {
  hasLineOfSightInMaze,
  moveWithSubsteps,
  resolveGridCollision,
} from '../world/gridCollision.js'
import { worldToGrid } from '../world/worldCoords.js'
import { getElevatorFloorHeightAtWorld } from './buildElevators.js'
import { CAMERA_MODES } from './CameraRig.js'
import { FALLING_PIPES_HANDLING_LIMITS } from './buildHazards.js'

export const PIPES_HANDLING_STATES = Object.freeze({
  IDLE: 'idle',
  GRIPPING: 'gripping',
  HANDLING: 'handling',
  RELEASING: 'releasing',
})

export const PIPES_ANIM_MODES = Object.freeze({
  NONE: 'none',
  PICKUP: 'pickup',
  CARRY: 'carry',
  PLACE: 'place',
  PUSH_DRAG: 'push_drag',
  GRIP: 'pickup',
  RELEASE: 'place',
})

export const PIPES_INTERACTION_CONFIG = Object.freeze({
  maxRayDistance: 4.2,
  maxEdgeReachDistance: 2.2,
  gripDurationSec: 0.42,
  gripContactProgress: 0.50,
  fixtureGripDurationSec: 0.30,
  fixtureGripContactProgress: 0.45,
  releaseDurationSec: 0.32,
  releaseContactProgress: 0.50,
  fixtureReleaseDurationSec: 0.24,
  fixtureReleaseContactProgress: 0.45,
  movementSpeedScale: 0.62,
  fixtureMovementSpeedScale: 0.78,
  standoffPadding: 0.24,
  handLateralHalfSpread: 0.32,
  soundEmitIntervalSec: 0.45,
  soundEmitRange: 4.8,
})

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

function smoothstep01(t) {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

function shortestAngleDiff(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current))
}

/**
 * Physical Falling Pipes & Fixtures Interaction & Movement Controller
 * (MAZE-HAZARD-PIPES-ANIM-006)
 */
export class FallingPipesController {
  constructor(engine) {
    this.engine = engine || null
    this.isDisposed = false

    this._raycaster = new THREE.Raycaster()
    this._rayNdc = new THREE.Vector2(0, 0)
    this._state = PIPES_HANDLING_STATES.IDLE
    this._stateTimer = 0
    this._stateProgress = 0
    this._gripAttached = false

    this._targetedHazard = null
    this._targetedHitPoint = null
    this._targetedEdgeDistance = Infinity

    this._activeHazard = null
    this._gripLocalSideZ = 1
    this._gripLocalSideX = 0
    this._gripRelLocalX = 0
    this._gripStandoffDist = 0.58
    this._gripStartYaw = 0
    this._gripTargetYaw = 0
    this._leftHandWorld = { x: 0, y: 0.52, z: 0 }
    this._rightHandWorld = { x: 0, y: 0.52, z: 0 }
    this._gripAnchorWorld = { x: 0, y: 0.52, z: 0 }

    this._pickupStartWorldPos = new THREE.Vector3()
    this._pickupStartWorldQuat = new THREE.Quaternion()
    this._placeTarget = null

    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0
    this._isMovingPipes = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0
    this._soundCooldown = 0

    // Scratch math objects (zero per-frame heap allocations)
    this._tmpVecA = new THREE.Vector3()
    this._tmpVecB = new THREE.Vector3()
    this._tmpVecC = new THREE.Vector3()
    this._tmpQuatA = new THREE.Quaternion()
    this._tmpQuatB = new THREE.Quaternion()
    this._tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ')
  }

  getStateName() {
    return this._state
  }

  isActive() {
    return !this.isDisposed && this._state !== PIPES_HANDLING_STATES.IDLE
  }

  isHandling() {
    return (
      !this.isDisposed &&
      (this._state === PIPES_HANDLING_STATES.GRIPPING ||
        this._state === PIPES_HANDLING_STATES.HANDLING)
    )
  }

  isCarrying() {
    return (
      !this.isDisposed &&
      (this._state === PIPES_HANDLING_STATES.HANDLING ||
        (this._state === PIPES_HANDLING_STATES.GRIPPING && this._gripAttached) ||
        (this._state === PIPES_HANDLING_STATES.RELEASING && this._gripAttached))
    )
  }

  isActionLocked() {
    return (
      this._state === PIPES_HANDLING_STATES.GRIPPING ||
      this._state === PIPES_HANDLING_STATES.RELEASING
    )
  }

  isGripAttached() {
    return Boolean(!this.isDisposed && this._gripAttached && this._activeHazard)
  }

  getActiveHazard() {
    return this._activeHazard
  }

  getTargetedHazard() {
    return this._targetedHazard
  }

  getHandContactPoints() {
    return {
      leftHandWorld: { ...this._leftHandWorld },
      rightHandWorld: { ...this._rightHandWorld },
      gripAnchorWorld: { ...this._gripAnchorWorld },
      gripAttached: Boolean(this._gripAttached),
    }
  }

  getPickupDuration() {
    return this._activeHazard?.isSmallFixture
      ? PIPES_INTERACTION_CONFIG.fixtureGripDurationSec
      : PIPES_INTERACTION_CONFIG.gripDurationSec
  }

  getPickupAttachProgress() {
    return this._activeHazard?.isSmallFixture
      ? PIPES_INTERACTION_CONFIG.fixtureGripContactProgress
      : PIPES_INTERACTION_CONFIG.gripContactProgress
  }

  getPlaceDuration() {
    return this._activeHazard?.isSmallFixture
      ? PIPES_INTERACTION_CONFIG.fixtureReleaseDurationSec
      : PIPES_INTERACTION_CONFIG.releaseDurationSec
  }

  getPlaceReleaseProgress() {
    return this._activeHazard?.isSmallFixture
      ? PIPES_INTERACTION_CONFIG.fixtureReleaseContactProgress
      : PIPES_INTERACTION_CONFIG.releaseContactProgress
  }

  getMovementSpeedScale() {
    if (!this.isHandling() && !this.isCarrying()) return 1.0
    if (!this._gripAttached) return 0.0
    const isSmallFixture = Boolean(this._activeHazard?.isSmallFixture)
    return isSmallFixture
      ? PIPES_INTERACTION_CONFIG.fixtureMovementSpeedScale
      : PIPES_INTERACTION_CONFIG.movementSpeedScale
  }

  isSprintDisabled() {
    return this.isHandling() || this.isActive() || this.isCarrying()
  }

  getFirstPersonEyeOffsetY() {
    if (!this.isActive()) return 0
    if (this._state === PIPES_HANDLING_STATES.GRIPPING) {
      const u = clamp(this._stateProgress / 0.50, 0, 1)
      const smooth = u * u * (3 - 2 * u)
      return -0.22 * smooth
    }
    if (this._state === PIPES_HANDLING_STATES.HANDLING) {
      return -0.04
    }
    if (this._state === PIPES_HANDLING_STATES.RELEASING) {
      const u = clamp(this._stateProgress / 0.50, 0, 1)
      const smooth = u * u * (3 - 2 * u)
      return -0.22 * smooth
    }
    return 0
  }

  _getCollapsedPipesHazards() {
    const hazards = this.engine?.hazardManager?.getHazards?.()
    if (!Array.isArray(hazards) || hazards.length === 0) return []
    const out = []
    for (let i = 0; i < hazards.length; i += 1) {
      const h = hazards[i]
      if (
        h &&
        h.type === HAZARD_TYPES.FALLING_PIPES_FIXTURES &&
        h.isCollapsedForPipesHandling?.()
      ) {
        out.push(h)
      }
    }
    return out
  }

  _computeEdgeDistanceAndAnchor(hazard, playerPos) {
    const pose = hazard?.getPipesPose?.()
    if (!pose || !playerPos) return null
    const dx = playerPos.x - pose.baseX
    const dz = playerPos.z - pose.baseZ
    const playerLx = dx * pose.cosYaw - dz * pose.sinYaw
    const playerLz = dx * pose.sinYaw + dz * pose.cosYaw

    const halfW = pose.halfW || 1.935
    const halfD = pose.halfD || 0.152
    const minLx = (pose.minLocalX !== undefined ? pose.minLocalX : -halfW)
    const maxLx = (pose.maxLocalX !== undefined ? pose.maxLocalX : halfW)
    const minLz = (pose.minLocalZ !== undefined ? pose.minLocalZ : -halfD)
    const maxLz = (pose.maxLocalZ !== undefined ? pose.maxLocalZ : halfD)

    const gripLx = clamp(playerLx, minLx + 0.14, maxLx - 0.14)
    const nearEdgeLx = clamp(playerLx, minLx, maxLx)
    const nearEdgeLz = clamp(playerLz, minLz, maxLz)
    const edgeDist = Math.hypot(playerLx - nearEdgeLx, playerLz - nearEdgeLz)

    const sideZ = playerLz >= (pose.centerLocalZ || 0) ? 1 : -1
    const gripLz = sideZ > 0 ? maxLz : minLz

    const anchorWorldX =
      pose.baseX + gripLx * pose.cosYaw + gripLz * pose.sinYaw
    const anchorWorldZ =
      pose.baseZ - gripLx * pose.sinYaw + gripLz * pose.cosYaw

    return {
      pose,
      playerLx,
      playerLz,
      gripLx,
      gripLz,
      sideX: 0,
      sideZ,
      edgeDist,
      anchorWorldX,
      anchorWorldZ,
      anchorWorldY: pose.gripHeightY || 0.35,
    }
  }

  _clearHighlight(exceptHazard = null) {
    const list = this._getCollapsedPipesHazards()
    for (let i = 0; i < list.length; i += 1) {
      const h = list[i]
      if (h !== exceptHazard) {
        h.setPipesHighlighted?.(false)
      }
    }
  }

  updateTargeting(overrideNdc = null) {
    if (
      this.isDisposed ||
      !this.engine ||
      this.engine.isGameOver ||
      this.engine.hasWon ||
      this.engine.isPaused ||
      this.engine.rubbleController?.isActive?.() ||
      this.engine.furnitureController?.isActive?.()
    ) {
      this._targetedHazard = null
      this._targetedHitPoint = null
      this._targetedEdgeDistance = Infinity
      this._clearHighlight(null)
      return null
    }

    if (this._state !== PIPES_HANDLING_STATES.IDLE) {
      this._clearHighlight(null)
      return null
    }

    const camera = this.engine.camera
    const playerPos = this.engine._playerWorldPos
    const maze = this.engine._currentMaze
    if (!camera || !playerPos || !maze) {
      this._targetedHazard = null
      this._targetedHitPoint = null
      this._targetedEdgeDistance = Infinity
      this._clearHighlight(null)
      return null
    }

    const candidates = this._getCollapsedPipesHazards()
    if (candidates.length === 0) {
      this._targetedHazard = null
      this._targetedHitPoint = null
      this._targetedEdgeDistance = Infinity
      this._clearHighlight(null)
      return null
    }

    const interactiveMeshes = []
    const hazardById = new Map()
    for (let i = 0; i < candidates.length; i += 1) {
      const h = candidates[i]
      hazardById.set(h.id, h)
      h.getMesh?.()?.updateMatrixWorld?.(true)
      const meshes = h.getPipesInteractiveMeshes?.() || []
      for (let m = 0; m < meshes.length; m += 1) {
        if (meshes[m] && meshes[m].visible) {
          interactiveMeshes.push(meshes[m])
        }
      }
    }

    if (interactiveMeshes.length === 0) {
      this._targetedHazard = null
      this._clearHighlight(null)
      return null
    }

    const camToPlayerDist = Math.hypot(
      camera.position.x - playerPos.x,
      camera.position.y - (playerPos.y + 1.0),
      camera.position.z - playerPos.z
    )
    const effectiveMaxRayDistance =
      PIPES_INTERACTION_CONFIG.maxRayDistance + Math.min(6.0, camToPlayerDist)

    camera.updateMatrixWorld?.(true)
    const ndcX = Number.isFinite(overrideNdc?.x) ? overrideNdc.x : 0
    const ndcY = Number.isFinite(overrideNdc?.y) ? overrideNdc.y : 0
    this._rayNdc.set(ndcX, ndcY)
    this._raycaster.setFromCamera(this._rayNdc, camera)
    this._raycaster.near = 0.05
    this._raycaster.far = effectiveMaxRayDistance + 2.5

    const hits = this._raycaster.intersectObjects(interactiveMeshes, true)
    let matchedHazard = null
    let matchedHitPoint = null
    let matchedEdgeInfo = null

    for (let i = 0; i < hits.length; i += 1) {
      const hit = hits[i]
      if (!hit || hit.distance > effectiveMaxRayDistance) {
        continue
      }
      let hazId = hit.object?.userData?.hazardId
      if (!hazId) {
        let cur = hit.object?.parent
        while (cur && !hazId) {
          hazId = cur.userData?.hazardId
          cur = cur.parent
        }
      }
      const haz = hazId ? hazardById.get(hazId) : null
      if (!haz) continue

      const edgeInfo = this._computeEdgeDistanceAndAnchor(haz, playerPos)
      if (
        !edgeInfo ||
        edgeInfo.edgeDist > PIPES_INTERACTION_CONFIG.maxEdgeReachDistance
      ) {
        continue
      }

      if (
        !hasLineOfSightInMaze(
          playerPos.x,
          playerPos.z,
          edgeInfo.anchorWorldX,
          edgeInfo.anchorWorldZ,
          maze
        ) &&
        !hasLineOfSightInMaze(
          playerPos.x,
          playerPos.z,
          hit.point.x,
          hit.point.z,
          maze
        )
      ) {
        continue
      }

      matchedHazard = haz
      matchedHitPoint = {
        x: hit.point.x,
        y: hit.point.y,
        z: hit.point.z,
      }
      matchedEdgeInfo = edgeInfo
      break
    }

    if (!matchedHazard) {
      const camDir = new THREE.Vector3()
      camera.getWorldDirection(camDir)
      for (let i = 0; i < candidates.length; i += 1) {
        const haz = candidates[i]
        const edgeInfo = this._computeEdgeDistanceAndAnchor(haz, playerPos)
        if (
          !edgeInfo ||
          edgeInfo.edgeDist > PIPES_INTERACTION_CONFIG.maxEdgeReachDistance
        ) {
          continue
        }
        const toAnchorX = edgeInfo.anchorWorldX - camera.position.x
        const toAnchorY = edgeInfo.anchorWorldY - camera.position.y
        const toAnchorZ = edgeInfo.anchorWorldZ - camera.position.z
        const len = Math.hypot(toAnchorX, toAnchorY, toAnchorZ)
        let matchedDot = false

        if (len > 1e-4 && len <= effectiveMaxRayDistance) {
          const dot =
            (toAnchorX * camDir.x + toAnchorY * camDir.y + toAnchorZ * camDir.z) /
            len
          if (dot >= 0.82) {
            matchedDot = true
          }
        }

        if (matchedDot) {
          if (
            hasLineOfSightInMaze(
              playerPos.x,
              playerPos.z,
              edgeInfo.anchorWorldX,
              edgeInfo.anchorWorldZ,
              maze
            )
          ) {
            matchedHazard = haz
            matchedHitPoint = {
              x: edgeInfo.anchorWorldX,
              y: edgeInfo.anchorWorldY,
              z: edgeInfo.anchorWorldZ,
            }
            matchedEdgeInfo = edgeInfo
            break
          }
        }
      }
    }

    this._targetedHazard = matchedHazard
    this._targetedHitPoint = matchedHitPoint
    this._targetedEdgeDistance = matchedEdgeInfo
      ? matchedEdgeInfo.edgeDist
      : Infinity
    this._clearHighlight(matchedHazard)
    if (matchedHazard) {
      matchedHazard.setPipesHighlighted?.(true)
    }

    return matchedHazard
      ? {
          hazard: matchedHazard,
          hitPoint: matchedHitPoint,
          edgeDistance: this._targetedEdgeDistance,
        }
      : null
  }

  _updateHandContactPoints(hazard, playerPos) {
    if (!hazard || !playerPos) return
    const info = this._computeEdgeDistanceAndAnchor(hazard, playerPos)
    if (!info) return
    const { pose } = info

    const gripLx = pose.centerLocalX || 0
    const gripLz = this._gripLocalSideZ >= 0 ? pose.maxLocalZ : pose.minLocalZ

    const ax = pose.baseX + gripLx * pose.cosYaw + gripLz * pose.sinYaw
    const az = pose.baseZ - gripLx * pose.sinYaw + gripLz * pose.cosYaw
    const ay = pose.gripHeightY || 0.35

    this._gripAnchorWorld.x = ax
    this._gripAnchorWorld.y = ay
    this._gripAnchorWorld.z = az

    const toAnchorX = ax - playerPos.x
    const toAnchorZ = az - playerPos.z
    const toLen = Math.hypot(toAnchorX, toAnchorZ)
    const fwdX =
      toLen > 1e-4 ? toAnchorX / toLen : -Math.sin(this._gripTargetYaw)
    const fwdZ =
      toLen > 1e-4 ? toAnchorZ / toLen : -Math.cos(this._gripTargetYaw)
    const rightX = -fwdZ
    const rightZ = fwdX
    const halfSpread = PIPES_INTERACTION_CONFIG.handLateralHalfSpread

    this._leftHandWorld.x = ax - rightX * halfSpread
    this._leftHandWorld.y = ay
    this._leftHandWorld.z = az - rightZ * halfSpread

    this._rightHandWorld.x = ax + rightX * halfSpread
    this._rightHandWorld.y = ay
    this._rightHandWorld.z = az + rightZ * halfSpread

    if (toLen > 0.08) {
      this._gripTargetYaw = Math.atan2(-toAnchorX, -toAnchorZ)
    }
  }

  tryStartHandling(options = null) {
    if (
      this.isDisposed ||
      !this.engine ||
      this.engine.isGameOver ||
      this.engine.hasWon ||
      this.engine.isPaused
    ) {
      return { handled: false, reason: 'unavailable' }
    }
    if (
      this.engine.rubbleController?.isActive?.() ||
      this.engine.furnitureController?.isActive?.()
    ) {
      return { handled: false, reason: 'other_interaction_active' }
    }
    if (this._state !== PIPES_HANDLING_STATES.IDLE) {
      return { handled: false, reason: 'already_active' }
    }

    const targetRes = this.updateTargeting(options?.ndc || null)
    const hazard = targetRes?.hazard || this._targetedHazard
    if (!hazard) {
      return { handled: false, reason: 'no_target' }
    }

    const playerPos = this.engine._playerWorldPos
    const info = this._computeEdgeDistanceAndAnchor(hazard, playerPos)
    if (
      !info ||
      info.edgeDist > PIPES_INTERACTION_CONFIG.maxEdgeReachDistance
    ) {
      return { handled: false, reason: 'out_of_range' }
    }

    this._activeHazard = hazard
    this._targetedHazard = null
    this._clearHighlight(null)

    this._gripLocalSideZ = info.sideZ
    this._gripLocalSideX = info.sideX
    const halfW = hazard.getPipesPose?.()?.halfW || 1.935
    this._gripRelLocalX = clamp(info.playerLx, -halfW + 0.24, halfW - 0.24)
    const playerRadius = this.engine.movementConfig?.radius || 0.75
    this._gripStandoffDist = clamp(
      info.edgeDist,
      playerRadius + 0.16,
      playerRadius + 0.56
    )

    const curYaw =
      this.engine._playerGroup?.rotation?.y ??
      this.engine.cameraRig?.getLookDirection?.()?.yaw ??
      0
    this._gripStartYaw = curYaw
    this._updateHandContactPoints(hazard, playerPos)

    // Capture resting starting world transform of pipe mesh before pickup lift begins
    const pipeGroup = hazard.mesh?.userData?.pipeGroup
    if (pipeGroup) {
      pipeGroup.updateMatrixWorld(true)
      pipeGroup.getWorldPosition(this._pickupStartWorldPos)
      pipeGroup.getWorldQuaternion(this._pickupStartWorldQuat)
      pipeGroup.userData.manualState = 'picking_up'
    } else {
      const p = hazard.getPipesPose?.()
      this._pickupStartWorldPos.set(
        p?.worldCx || 0,
        p?.restMinY || 0.152,
        p?.worldCz || 0
      )
      this._pickupStartWorldQuat.setFromEuler(
        new THREE.Euler(0, p?.wallYaw || 0, 0, 'YXZ')
      )
    }

    this._state = PIPES_HANDLING_STATES.GRIPPING
    this._stateTimer = 0
    this._stateProgress = 0
    this._gripAttached = false
    this._placeTarget = null
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0.25
    this._isMovingPipes = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0

    this.engine.syncPlayerVisibility?.()
    this.engine._notifyStealthChange?.(true)

    return {
      handled: true,
      action: 'grip_pipes',
      hazardId: hazard.id,
      state: this._state,
    }
  }

  tryGripTarget(options = null) {
    return this.tryStartHandling(options)
  }

  findValidPlacement(hazard) {
    if (!hazard || !this.engine) {
      return {
        valid: false,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        quat: new THREE.Quaternion(),
      }
    }
    const playerPos = this.engine._playerWorldPos
    const maze = this.engine._currentMaze
    if (!playerPos || !maze) {
      return {
        valid: false,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        quat: new THREE.Quaternion(),
      }
    }

    const curYaw =
      this.engine._playerGroup?.rotation?.y ??
      this.engine.cameraRig?.getLookDirection?.()?.yaw ??
      0
    const fwdX = -Math.sin(curYaw)
    const fwdZ = -Math.cos(curYaw)

    const searchDists = [0.85, 0.72, 0.60, 0.50]
    let chosenX = playerPos.x + fwdX * 0.85
    let chosenZ = playerPos.z + fwdZ * 0.85
    let validSpot = false

    for (let i = 0; i < searchDists.length; i += 1) {
      const d = searchDists[i]
      const tx = playerPos.x + fwdX * d
      const tz = playerPos.z + fwdZ * d
      const cell = worldToGrid(tx, tz, maze)
      if (cell && maze.grid[cell.row]?.[cell.col] !== CELL_TYPES.WALL) {
        chosenX = tx
        chosenZ = tz
        validSpot = true
        break
      }
    }

    const floorY =
      getElevatorFloorHeightAtWorld(chosenX, chosenZ, this.engine) || 0
    const restMinY = 0.152
    const targetYaw = curYaw
    const targetQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, targetYaw, 0, 'YXZ')
    )

    return {
      valid: validSpot,
      x: chosenX,
      y: floorY + restMinY,
      z: chosenZ,
      yaw: targetYaw,
      quat: targetQuat,
    }
  }

  tryRelease() {
    if (this.isDisposed || !this.engine) {
      return { handled: false, reason: 'disposed' }
    }
    if (
      this._state !== PIPES_HANDLING_STATES.GRIPPING &&
      this._state !== PIPES_HANDLING_STATES.HANDLING
    ) {
      return { handled: false, reason: 'not_handling' }
    }

    const hazard = this._activeHazard
    const releasedHazardId = hazard?.id || null
    this._placeTarget = this.findValidPlacement(hazard)

    this._state = PIPES_HANDLING_STATES.RELEASING
    this._stateTimer = 0
    this._stateProgress = 0
    this._gripAttached = true // Still attached at start of placing animation
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0.5
    this._isMovingPipes = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0

    const pipeGroup = hazard?.mesh?.userData?.pipeGroup
    if (pipeGroup) {
      pipeGroup.userData.manualState = 'placing'
    }

    this.engine._notifyStealthChange?.(true)

    return {
      handled: true,
      action: 'release_pipes',
      hazardId: releasedHazardId,
      state: this._state,
    }
  }

  releasePipe() {
    return this.tryRelease()
  }

  interruptHandling({ immediate = false } = {}) {
    if (this._state === PIPES_HANDLING_STATES.IDLE) {
      return false
    }
    this._gripAttached = false
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0
    this._isMovingPipes = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0

    if (this._activeHazard) {
      this._activeHazard.setPipesCarried?.(false)
      const pipeGroup = this._activeHazard.mesh?.userData?.pipeGroup
      if (pipeGroup && pipeGroup.userData) {
        delete pipeGroup.userData.manualState
      }
    }
    this.engine?._syncHazardColliders?.({ allowPushOut: false })

    if (immediate) {
      this._activeHazard = null
      this._placeTarget = null
      this._state = PIPES_HANDLING_STATES.IDLE
      this._stateTimer = 0
      this._stateProgress = 0
      this.engine?.syncPlayerVisibility?.()
    } else {
      this._state = PIPES_HANDLING_STATES.RELEASING
      this._stateTimer = 0
      this._stateProgress = 0
    }
    this.engine?._notifyStealthChange?.(true)
    return true
  }

  _computeHandGripWorldPose(outPos, outQuat, hazard) {
    const cam = this.engine?.camera
    const rig = this.engine?._playerAnimator?.rig
    const playerPos = this.engine?._playerWorldPos
    const isFirstPerson =
      this.engine?.cameraRig?.getMode?.() === CAMERA_MODES.FIRST_PERSON
    const isSmallFixture = Boolean(hazard?.isSmallFixture)
    const curYaw =
      this.engine?._playerGroup?.rotation?.y ??
      this.engine?.cameraRig?.getLookDirection?.()?.yaw ??
      0

    const fwdX = -Math.sin(curYaw)
    const fwdZ = -Math.cos(curYaw)

    if (isFirstPerson && cam) {
      const pitch = this.engine?.cameraRig?.getLookDirection?.()?.pitch || 0
      const forwardDist = isSmallFixture ? 0.52 : 0.62
      const downOffset = isSmallFixture ? -0.28 : -0.34
      const cosP = Math.cos(pitch)
      const sinP = Math.sin(pitch)

      outPos.set(
        cam.position.x + fwdX * forwardDist * cosP,
        cam.position.y + downOffset + sinP * forwardDist * 0.55,
        cam.position.z + fwdZ * forwardDist * cosP
      )
      this._tmpEuler.set(pitch * 0.65 + 0.05, curYaw, 0, 'YXZ')
      outQuat.setFromEuler(this._tmpEuler)
      return
    }

    if (rig?.leftWristPivot && rig?.rightWristPivot) {
      rig.leftWristPivot.getWorldPosition(this._tmpVecA)
      rig.rightWristPivot.getWorldPosition(this._tmpVecB)
      outPos.copy(this._tmpVecA).add(this._tmpVecB).multiplyScalar(0.5)
      // Slight forward offset into palms
      const palmOffset = isSmallFixture ? 0.12 : 0.16
      outPos.x += fwdX * palmOffset
      outPos.y -= 0.02
      outPos.z += fwdZ * palmOffset

      const tiltX =
        this._state === PIPES_HANDLING_STATES.HANDLING ? 0.06 : 0.02
      this._tmpEuler.set(tiltX, curYaw, 0, 'YXZ')
      outQuat.setFromEuler(this._tmpEuler)
      return
    }

    // Fallback cradle pose anchored in front of torso
    const baseY = Number.isFinite(playerPos?.y) ? playerPos.y : 0
    outPos.set(
      (playerPos?.x || 0) + fwdX * 0.52,
      baseY + 0.88,
      (playerPos?.z || 0) + fwdZ * 0.52
    )
    this._tmpEuler.set(0.05, curYaw, 0, 'YXZ')
    outQuat.setFromEuler(this._tmpEuler)
  }

  _applyWorldPoseToPieceMesh(mesh, worldPos, worldQuat) {
    if (!mesh) return
    const parent = mesh.parent
    if (parent) {
      parent.updateMatrixWorld(true)
      this._tmpVecC.copy(worldPos)
      parent.worldToLocal(this._tmpVecC)
      mesh.position.copy(this._tmpVecC)

      parent.getWorldQuaternion(this._tmpQuatB)
      this._tmpQuatB.invert()
      mesh.quaternion.copy(this._tmpQuatB).multiply(worldQuat)
    } else {
      mesh.position.copy(worldPos)
      mesh.quaternion.copy(worldQuat)
    }
    mesh.updateMatrixWorld(true)
  }

  syncCarriedMeshToHands() {
    if (this.isDisposed || !this._activeHazard) return
    const pipeGroup = this._activeHazard.mesh?.userData?.pipeGroup
    if (!pipeGroup) return

    if (this._state === PIPES_HANDLING_STATES.GRIPPING) {
      if (!this._gripAttached) {
        // Before hands contact: pipe stays completely stationary on the floor (ZERO movement!)
        this._applyWorldPoseToPieceMesh(
          pipeGroup,
          this._pickupStartWorldPos,
          this._pickupStartWorldQuat
        )
        return
      }
      // Smoothly lift from floor into hands cradle
      const attachP = this.getPickupAttachProgress()
      const liftT = smoothstep01(
        (this._stateProgress - attachP) / Math.max(0.01, 1 - attachP)
      )
      this._computeHandGripWorldPose(
        this._tmpVecA,
        this._tmpQuatA,
        this._activeHazard
      )
      this._tmpVecB.lerpVectors(this._pickupStartWorldPos, this._tmpVecA, liftT)
      this._tmpQuatB.copy(this._pickupStartWorldQuat).slerp(this._tmpQuatA, liftT)
      this._applyWorldPoseToPieceMesh(pipeGroup, this._tmpVecB, this._tmpQuatB)
      return
    }

    if (this._state === PIPES_HANDLING_STATES.HANDLING) {
      this._computeHandGripWorldPose(
        this._tmpVecA,
        this._tmpQuatA,
        this._activeHazard
      )
      this._applyWorldPoseToPieceMesh(pipeGroup, this._tmpVecA, this._tmpQuatA)
      return
    }

    if (this._state === PIPES_HANDLING_STATES.RELEASING && this._placeTarget) {
      if (this._gripAttached) {
        // Controlled lowering from carry hands down to floor target
        const relP = this.getPlaceReleaseProgress()
        const lowerT = smoothstep01(
          this._stateProgress / Math.max(0.01, relP)
        )
        this._computeHandGripWorldPose(
          this._tmpVecA,
          this._tmpQuatA,
          this._activeHazard
        )
        this._tmpVecB.set(
          this._placeTarget.x,
          this._placeTarget.y,
          this._placeTarget.z
        )
        this._tmpVecA.lerp(this._tmpVecB, lowerT)
        this._tmpQuatA.slerp(this._placeTarget.quat, lowerT)
        this._applyWorldPoseToPieceMesh(pipeGroup, this._tmpVecA, this._tmpQuatA)
      } else {
        // Hands released: solidly resting on floor
        this._tmpVecA.set(
          this._placeTarget.x,
          this._placeTarget.y,
          this._placeTarget.z
        )
        this._applyWorldPoseToPieceMesh(
          pipeGroup,
          this._tmpVecA,
          this._placeTarget.quat
        )
      }
    }
  }

  stepCoupledMovement(worldDeltaX, worldDeltaZ, delta = 0) {
    if (!this.isHandling() || !this._activeHazard || !this.engine) {
      return { moved: false, collided: false }
    }

    if (!this._gripAttached) {
      this._isMovingPipes = false
      this._pushSign = 0
      this._strafeSign = 0
      return {
        moved: false,
        collided: false,
        waitingForGrip: true,
      }
    }

    const reqMag = Math.hypot(worldDeltaX, worldDeltaZ)
    if (reqMag <= 1e-6) {
      this._isMovingPipes = false
      this._pushSign = 0
      this._strafeSign = 0
      return { moved: false, collided: false }
    }

    const hazard = this._activeHazard
    const playerPos = this.engine._playerWorldPos
    const startX = playerPos.x
    const startZ = playerPos.z
    const maze = this.engine._currentMaze

    // Standard substep collision movement for player with carry speed
    const colOptions = this.engine._moveCollisionOptions || {
      radius: this.engine.movementConfig?.radius || 0.75,
      propColliders: this.engine._propCollisionIndex,
      allowStepOver: true,
      maxStepHeight: 0.35,
    }

    let moveRes
    if (typeof moveWithSubsteps === 'function' && maze) {
      moveRes = moveWithSubsteps(
        startX,
        startZ,
        worldDeltaX,
        worldDeltaZ,
        maze,
        colOptions
      )
    } else {
      moveRes = {
        x: startX + worldDeltaX,
        z: startZ + worldDeltaZ,
        collided: false,
      }
    }

    playerPos.x = moveRes.x
    playerPos.z = moveRes.z

    const actualDx = moveRes.x - startX
    const actualDz = moveRes.z - startZ
    const actualDist = Math.hypot(actualDx, actualDz)
    const moved = actualDist > 1e-5

    this._isMovingPipes = moved

    // Project displacement onto hazard local coordinates and update pipesDispLocalX/Z
    const curPose = hazard.getPipesPose?.()
    const cosY = curPose?.cosYaw ?? 1
    const sinY = curPose?.sinYaw ?? 0
    const dLx = actualDx * cosY - actualDz * sinY
    const dLz = actualDx * sinY + actualDz * cosY

    const curDispX = hazard.pipesDispLocalX || 0
    const curDispZ = hazard.pipesDispLocalZ || 0
    hazard.pipesDispLocalX = curDispX + dLx
    hazard.pipesDispLocalZ = curDispZ + dLz
    if (typeof hazard.setPipesDisplacement === 'function') {
      hazard.setPipesDisplacement(hazard.pipesDispLocalX, hazard.pipesDispLocalZ)
    }

    // Project movement onto character local axes for push/strafe animation signs
    const curYaw = this.engine._playerGroup?.rotation?.y ?? 0
    const fwdX = -Math.sin(curYaw)
    const fwdZ = -Math.cos(curYaw)
    const rightX = -fwdZ
    const rightZ = fwdX

    const fwdDot = actualDx * fwdX + actualDz * fwdZ
    const strafeDot = actualDx * rightX + actualDz * rightZ

    this._pushSign = clamp(
      fwdDot / Math.max(1e-4, Math.hypot(worldDeltaX, worldDeltaZ)),
      -1,
      1
    )
    this._strafeSign = clamp(
      strafeDot / Math.max(1e-4, Math.hypot(worldDeltaX, worldDeltaZ)),
      -1,
      1
    )
    this._effortLevel = clamp(0.45 + 0.35 * Math.abs(this._pushSign), 0, 1)

    // Smoothly turn character with camera look in third-person follow
    if (
      this.engine._playerGroup &&
      this.engine.cameraRig?.getLookDirection &&
      !this.engine.cameraRig?.isFreeLookActive?.()
    ) {
      const targetYaw = this.engine.cameraRig.getLookDirection().yaw
      const currentYaw = this.engine._playerGroup.rotation.y
      const diff = shortestAngleDiff(targetYaw, currentYaw)
      const turnAlpha = delta > 0 ? 1 - Math.exp(-12 * delta) : 1
      this.engine._playerGroup.rotation.y = currentYaw + diff * turnAlpha
    }

    if (moved) {
      this._soundCooldown = Math.max(0, this._soundCooldown - delta)
      if (this._soundCooldown <= 0) {
        this._soundCooldown = PIPES_INTERACTION_CONFIG.soundEmitIntervalSec
        this.engine.emitSound?.(
          { x: moveRes.x, z: moveRes.z },
          PIPES_INTERACTION_CONFIG.soundEmitRange,
          0.38
        )
      }
    }

    return {
      moved,
      collided: moveRes.collided,
      worldDx: actualDx,
      worldDz: actualDz,
    }
  }

  update(delta = 0) {
    if (this.isDisposed || !this.engine) return
    const dt = Number.isFinite(delta) && delta > 0 ? delta : 0

    if (this._blockedFeedbackTimer > 0) {
      this._blockedFeedbackTimer = Math.max(0, this._blockedFeedbackTimer - dt)
      if (this._blockedFeedbackTimer <= 0) {
        this._blockedFeedback = null
      }
    }

    if (this._state === PIPES_HANDLING_STATES.IDLE) {
      this.updateTargeting()
      return
    }

    if (this._state === PIPES_HANDLING_STATES.GRIPPING) {
      if (
        !this._activeHazard ||
        !this._activeHazard.isCollapsedForPipesHandling?.()
      ) {
        this.interruptHandling({ immediate: true })
        return
      }
      this._stateTimer += dt
      const dur = this.getPickupDuration()
      this._stateProgress = clamp(this._stateTimer / dur, 0, 1)

      const playerPos = this.engine._playerWorldPos
      this._updateHandContactPoints(this._activeHazard, playerPos)

      if (this.engine._playerGroup) {
        const turnT = clamp(this._stateProgress / 0.50, 0, 1)
        const smoothTurn = turnT * turnT * (3 - 2 * turnT)
        const diff = shortestAngleDiff(this._gripTargetYaw, this._gripStartYaw)
        const nextYaw = this._gripStartYaw + diff * smoothTurn
        this.engine._playerGroup.rotation.y = nextYaw
        if (this.engine.cameraRig?.isFreeLookActive?.()) {
          this.engine.cameraRig.setCharacterYaw?.(nextYaw)
        }
      }

      const attachP = this.getPickupAttachProgress()
      if (!this._gripAttached && this._stateProgress >= attachP) {
        this._gripAttached = true
        this._activeHazard.setPipesCarried?.(true)
        this.engine._syncHazardColliders?.({ allowPushOut: false })
        this.engine.emitSound?.(
          this.engine._playerWorldPos,
          PIPES_INTERACTION_CONFIG.soundEmitRange,
          0.45
        )
        this.engine._notifyStealthChange?.(true)
      }

      if (this._stateProgress >= 1) {
        this._state = PIPES_HANDLING_STATES.HANDLING
        this._stateTimer = 0
        this._stateProgress = 1
        this._gripAttached = true
        const pipeGroup = this._activeHazard.mesh?.userData?.pipeGroup
        if (pipeGroup) {
          pipeGroup.userData.manualState = 'carried'
        }
        this.engine._notifyStealthChange?.(true)
      }
      return
    }

    if (this._state === PIPES_HANDLING_STATES.HANDLING) {
      if (
        !this._activeHazard ||
        !this._activeHazard.isCollapsedForPipesHandling?.()
      ) {
        this.interruptHandling({ immediate: true })
        return
      }
      const playerPos = this.engine._playerWorldPos
      this._updateHandContactPoints(this._activeHazard, playerPos)
      if (!this._isMovingPipes) {
        this._pushSign *= Math.exp(-10 * dt)
        this._strafeSign *= Math.exp(-10 * dt)
        this._effortLevel =
          0.28 + (this._effortLevel - 0.28) * Math.exp(-8 * dt)
      }
      this._isMovingPipes = false
      return
    }

    if (this._state === PIPES_HANDLING_STATES.RELEASING) {
      this._stateTimer += dt
      const dur = this.getPlaceDuration()
      this._stateProgress = clamp(this._stateTimer / dur, 0, 1)

      const releaseP = this.getPlaceReleaseProgress()
      if (this._gripAttached && this._stateProgress >= releaseP) {
        this._gripAttached = false
        if (this._placeTarget && this._activeHazard) {
          this._activeHazard.setPlacedPipesPose?.(
            this._placeTarget,
            this._placeTarget.yaw
          )
          this.engine._syncHazardColliders?.({ allowPushOut: false })
          this.engine.emitSound?.(
            { x: this._placeTarget.x, z: this._placeTarget.z },
            PIPES_INTERACTION_CONFIG.soundEmitRange,
            0.55
          )
        }
        this.engine._notifyStealthChange?.(true)
      }

      if (this._stateProgress >= 1) {
        this._activeHazard = null
        this._state = PIPES_HANDLING_STATES.IDLE
        this._stateTimer = 0
        this._stateProgress = 0
        this._gripAttached = false
        this._placeTarget = null
        this.engine.syncPlayerVisibility?.()
        this.updateTargeting()
        this.engine._notifyStealthChange?.(true)
      }
    }
  }

  getAnimatorPayload() {
    if (this.isDisposed || this._state === PIPES_HANDLING_STATES.IDLE) {
      return {
        mode: PIPES_ANIM_MODES.NONE,
        progress: 0,
        gripAttached: false,
        pushSign: 0,
        strafeSign: 0,
        gripWidth: 0.52,
        isHeavy: true,
        effort: 0,
      }
    }

    const isSmallFixture = Boolean(this._activeHazard?.isSmallFixture)
    const isHeavy = !isSmallFixture
    const gripWidth = isSmallFixture ? 0.36 : 0.58

    if (this._state === PIPES_HANDLING_STATES.GRIPPING) {
      return {
        mode: PIPES_ANIM_MODES.PICKUP,
        progress: this._stateProgress,
        gripAttached: this._gripAttached,
        pushSign: this._pushSign,
        strafeSign: this._strafeSign,
        gripWidth,
        isHeavy,
        effort: this._effortLevel,
      }
    }

    if (this._state === PIPES_HANDLING_STATES.HANDLING) {
      return {
        mode: PIPES_ANIM_MODES.CARRY,
        progress: 1,
        gripAttached: true,
        pushSign: this._pushSign,
        strafeSign: this._strafeSign,
        gripWidth,
        isHeavy,
        effort: this._effortLevel,
      }
    }

    return {
      mode: PIPES_ANIM_MODES.PLACE,
      progress: this._stateProgress,
      gripAttached: this._gripAttached,
      pushSign: 0,
      strafeSign: 0,
      gripWidth,
      isHeavy,
      effort: this._effortLevel,
    }
  }

  getInteractionSnapshot() {
    const canGrip = Boolean(
      this._state === PIPES_HANDLING_STATES.IDLE && this._targetedHazard
    )
    const isHandling =
      this._state === PIPES_HANDLING_STATES.GRIPPING ||
      this._state === PIPES_HANDLING_STATES.HANDLING
    const pose = (this._activeHazard || this._targetedHazard)?.getPipesPose?.()

    return {
      state: this._state,
      canGrip,
      isHandling,
      isCarrying: this.isCarrying(),
      gripAttached: Boolean(this._gripAttached),
      targetedHazardId: this._targetedHazard ? this._targetedHazard.id : null,
      activeHazardId: this._activeHazard ? this._activeHazard.id : null,
      pushProgress: pose ? Math.round(pose.pushProgress * 100) / 100 : 0,
      corridorClearance: pose
        ? Math.round(pose.corridorClearance * 100) / 100
        : 0,
      feedbackMessage: this._blockedFeedback || null,
    }
  }

  reset() {
    this._clearHighlight(null)
    if (this._activeHazard) {
      this._activeHazard.setPipesCarried?.(false)
      const pipeGroup = this._activeHazard.mesh?.userData?.pipeGroup
      if (pipeGroup && pipeGroup.userData) {
        delete pipeGroup.userData.manualState
      }
    }
    this._targetedHazard = null
    this._targetedHitPoint = null
    this._targetedEdgeDistance = Infinity
    this._activeHazard = null
    this._placeTarget = null
    this._state = PIPES_HANDLING_STATES.IDLE
    this._stateTimer = 0
    this._stateProgress = 0
    this._gripAttached = false
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0
    this._isMovingPipes = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0
    this._soundCooldown = 0
  }

  dispose() {
    if (this.isDisposed) return
    this.isDisposed = true
    this.reset()
    this.engine = null
  }
}
