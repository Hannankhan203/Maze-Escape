import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import {
  hasLineOfSightInMaze,
  moveWithSubsteps,
} from '../world/gridCollision.js'
import { COLLIDER_KIND_CIRCLE } from '../world/propCollision.js'
import { CELL_SIZE, PLAYER_RADIUS, worldToGrid } from '../world/worldCoords.js'
import { getElevatorFloorHeightAtWorld } from './buildElevators.js'
import { computeMinGroundedCenterY } from './buildHazards.js'
import { CAMERA_MODES } from './CameraRig.js'

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
  gripDurationSec: 0.46,
  gripContactProgress: 0.48,
  fixtureGripDurationSec: 0.32,
  fixtureGripContactProgress: 0.44,
  releaseDurationSec: 0.34,
  releaseContactProgress: 0.52,
  fixtureReleaseDurationSec: 0.24,
  fixtureReleaseContactProgress: 0.46,
  movementSpeedScale: 0.62,
  fixtureMovementSpeedScale: 0.78,
  standoffPadding: 0.24,
  handLateralHalfSpread: 0.32,
  fixtureHandLateralHalfSpread: 0.22,
  wallClearance: 0.03,
  playerClearancePad: 0.08,
  colliderClearancePad: 0.04,
  feedbackDuration: 1.6,
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

function isWalkableGridCell(grid, row, col) {
  if (!Array.isArray(grid) || row < 0 || row >= grid.length) return false
  const line = grid[row]
  if (!Array.isArray(line) || col < 0 || col >= line.length) return false
  return line[col] !== CELL_TYPES.WALL
}

function distancePointToOBB2D(px, pz, cx, cz, halfW, halfD, yaw) {
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  const dx = px - cx
  const dz = pz - cz
  const lx = dx * cosY - dz * sinY
  const lz = dx * sinY + dz * cosY
  const ox = Math.max(0, Math.abs(lx) - halfW)
  const oz = Math.max(0, Math.abs(lz) - halfD)
  return Math.hypot(ox, oz)
}

function obbsOverlap2D(aCx, aCz, aHw, aHd, aYaw, bCx, bCz, bHw, bHd, bYaw, pad = 0) {
  const ax1 = Math.cos(aYaw)
  const az1 = -Math.sin(aYaw)
  const ax2 = Math.sin(aYaw)
  const az2 = Math.cos(aYaw)

  const bx1 = Math.cos(bYaw)
  const bz1 = -Math.sin(bYaw)
  const bx2 = Math.sin(bYaw)
  const bz2 = Math.cos(bYaw)

  const dx = bCx - aCx
  const dz = bCz - aCz

  const ahw = aHw + pad
  const ahd = aHd + pad
  const bhw = bHw + pad
  const bhd = bHd + pad

  for (let i = 0; i < 4; i += 1) {
    const nx = i === 0 ? ax1 : i === 1 ? ax2 : i === 2 ? bx1 : bx2
    const nz = i === 0 ? az1 : i === 1 ? az2 : i === 2 ? bz1 : bz2
    const dist = Math.abs(dx * nx + dz * nz)
    const rA = Math.abs(ax1 * nx + az1 * nz) * ahw + Math.abs(ax2 * nx + az2 * nz) * ahd
    const rB = Math.abs(bx1 * nx + bz1 * nz) * bhw + Math.abs(bx2 * nx + bz2 * nz) * bhd
    if (dist >= rA + rB) {
      return false
    }
  }
  return true
}

const PLACEMENT_YAW_OFFSETS = Object.freeze([0, Math.PI * 0.5, -Math.PI * 0.5])
const PLACEMENT_SIDE_DISTS = Object.freeze([1.18, 1.32, 1.04, 1.46, 0.92, 1.62])
const PLACEMENT_FWD_OFFSETS = Object.freeze([0, 0.35, -0.35, 0.72, -0.72, 1.12, -1.12, 1.32, -1.32])
const PLACEMENT_NEAR_FWD_OFFSETS = Object.freeze([
  0.95, 1.12, 0.78, 1.30, -0.95, -1.12, -1.30, 0.45, -0.45, 0,
])
const PLACEMENT_NEAR_LAT_BASE = Object.freeze([
  0, 0.35, -0.35, 0.68, -0.68, 0.92, -0.92,
])

/**
 * Physical Falling Pipes & Fixtures Pickup, Carrying, Movement, and Placement Controller
 * (MAZE-HAZARD-PIPES-ANIM-006 / 008)
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
    this._priorHandlingState = 'idle'
    this._gripLocalSideZ = 1
    this._gripLocalSideX = 0
    this._gripRelLocalX = 0
    this._gripStandoffDist = 0.58
    this._gripStartYaw = 0
    this._gripTargetYaw = 0
    this._carryYawOffset = 0
    this._leftHandWorld = { x: 0, y: 0.52, z: 0 }
    this._rightHandWorld = { x: 0, y: 0.52, z: 0 }
    this._gripAnchorWorld = { x: 0, y: 0.52, z: 0 }

    this._pickupStartWorldPos = new THREE.Vector3()
    this._pickupStartWorldQuat = new THREE.Quaternion()
    this._placeStartWorldPos = new THREE.Vector3()
    this._placeStartWorldQuat = new THREE.Quaternion()
    this._placeTargetQuat = new THREE.Quaternion()
    this._placeTarget = null
    this._placeSideSign = 1
    this._placeStartYaw = 0
    this._placeTargetYaw = 0
    this._lastPlacementValid = true

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
    this._tmpCamDir = new THREE.Vector3()
    this._tmpQuatA = new THREE.Quaternion()
    this._tmpQuatB = new THREE.Quaternion()
    this._tmpParentQuatInv = new THREE.Quaternion()
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
      (this._state === PIPES_HANDLING_STATES.GRIPPING && !this._gripAttached) ||
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
    if (!this._gripAttached) return 1.0
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
      const attachP = this.getPickupAttachProgress()
      if (this._stateProgress <= attachP) {
        const u = smoothstep01(this._stateProgress / Math.max(0.01, attachP))
        return -0.08 - 0.16 * u
      }
      const liftU = smoothstep01(
        (this._stateProgress - attachP) / Math.max(0.01, 1 - attachP)
      )
      return -0.24 + 0.20 * liftU
    }
    if (this._state === PIPES_HANDLING_STATES.HANDLING) {
      return -0.04
    }
    if (this._state === PIPES_HANDLING_STATES.RELEASING) {
      const relP = this.getPlaceReleaseProgress()
      if (this._stateProgress <= relP) {
        const u = smoothstep01(this._stateProgress / Math.max(0.01, relP))
        return -0.04 - 0.20 * u
      }
      const riseU = smoothstep01(
        (this._stateProgress - relP) / Math.max(0.01, 1 - relP)
      )
      return -0.24 * (1 - riseU)
    }
    return 0
  }

  _getPlayerFacingYaw() {
    return (
      this.engine?._playerGroup?.rotation?.y ??
      this.engine?.cameraRig?.getCharacterDirection?.()?.yaw ??
      this.engine?.cameraRig?.getLookDirection?.()?.yaw ??
      0
    )
  }

  _getCarriedYaw(hazard = this._activeHazard) {
    if (this._activeHazard && hazard === this._activeHazard) {
      return this._getPlayerFacingYaw() + (this._carryYawOffset || 0)
    }
    if (hazard && Number.isFinite(hazard.carriedYaw)) {
      return hazard.carriedYaw
    }
    return this._getPlayerFacingYaw()
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
    const minLx = pose.minLocalX !== undefined ? pose.minLocalX : -halfW
    const maxLx = pose.maxLocalX !== undefined ? pose.maxLocalX : halfW
    const minLz = pose.minLocalZ !== undefined ? pose.minLocalZ : -halfD
    const maxLz = pose.maxLocalZ !== undefined ? pose.maxLocalZ : halfD

    const gripLx = clamp(playerLx, minLx + 0.14, maxLx - 0.14)
    const nearEdgeLx = clamp(playerLx, minLx, maxLx)
    const nearEdgeLz = clamp(playerLz, minLz, maxLz)
    const edgeDist = Math.hypot(playerLx - nearEdgeLx, playerLz - nearEdgeLz)

    const sideZ = playerLz >= (pose.centerLocalZ || 0) ? 1 : -1
    const gripLz = sideZ > 0 ? maxLz : minLz

    const anchorWorldX = pose.baseX + gripLx * pose.cosYaw + gripLz * pose.sinYaw
    const anchorWorldZ = pose.baseZ - gripLx * pose.sinYaw + gripLz * pose.cosYaw

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
      this.engine.furnitureController?.isActive?.() ||
      this.engine.electricalWiringController?.isActive?.() ||
      this.engine.floorGrateController?.isActive?.()
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
      camera.getWorldDirection(this._tmpCamDir)
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
            (toAnchorX * this._tmpCamDir.x +
              toAnchorY * this._tmpCamDir.y +
              toAnchorZ * this._tmpCamDir.z) /
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
    const halfSpread = hazard.isSmallFixture
      ? PIPES_INTERACTION_CONFIG.fixtureHandLateralHalfSpread
      : PIPES_INTERACTION_CONFIG.handLateralHalfSpread

    const pipeGroup = hazard.mesh?.userData?.pipeGroup
    if (this._gripAttached && pipeGroup) {
      pipeGroup.updateMatrixWorld(true)
      pipeGroup.getWorldPosition(this._tmpVecA)
      pipeGroup.getWorldQuaternion(this._tmpQuatA)
      this._tmpVecB.set(1, 0, 0).applyQuaternion(this._tmpQuatA).normalize()
      const handSign = this._carryYawOffset !== 0 ? -1 : 1

      this._gripAnchorWorld.x = this._tmpVecA.x
      this._gripAnchorWorld.y = this._tmpVecA.y
      this._gripAnchorWorld.z = this._tmpVecA.z

      this._leftHandWorld.x = this._tmpVecA.x - this._tmpVecB.x * halfSpread * handSign
      this._leftHandWorld.y = this._tmpVecA.y - this._tmpVecB.y * halfSpread * handSign
      this._leftHandWorld.z = this._tmpVecA.z - this._tmpVecB.z * halfSpread * handSign

      this._rightHandWorld.x = this._tmpVecA.x + this._tmpVecB.x * halfSpread * handSign
      this._rightHandWorld.y = this._tmpVecA.y + this._tmpVecB.y * halfSpread * handSign
      this._rightHandWorld.z = this._tmpVecA.z + this._tmpVecB.z * halfSpread * handSign
      return
    }

    const info = this._computeEdgeDistanceAndAnchor(hazard, playerPos)
    if (!info) return
    const { pose } = info

    const minGripX = (pose.minLocalX ?? -1.935) + 0.42
    const maxGripX = (pose.maxLocalX ?? 1.935) - 0.42
    const gripLx =
      Math.abs(info.playerLz) >= 0.45 && minGripX <= maxGripX
        ? clamp(info.playerLx, minGripX, maxGripX)
        : pose.centerLocalX || 0
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

    this._leftHandWorld.x = ax - rightX * halfSpread
    this._leftHandWorld.y = ay
    this._leftHandWorld.z = az - rightZ * halfSpread

    this._rightHandWorld.x = ax + rightX * halfSpread
    this._rightHandWorld.y = ay
    this._rightHandWorld.z = az + rightZ * halfSpread

    if (toLen > 0.08) {
      const towardYaw = Math.atan2(-toAnchorX, -toAnchorZ)
      const baseYaw = Number.isFinite(this._gripStartYaw)
        ? this._gripStartYaw
        : towardYaw
      this._gripTargetYaw =
        baseYaw + clamp(shortestAngleDiff(towardYaw, baseYaw), -0.25, 0.25)
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
      this.engine.furnitureController?.isActive?.() ||
      this.engine.electricalWiringController?.isActive?.() ||
      this.engine.floorGrateController?.isActive?.()
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
    this._priorHandlingState =
      hazard.pipesHandlingState === 'placed' ? 'placed' : 'idle'
    this._targetedHazard = null
    this._clearHighlight(null)

    this._gripLocalSideZ = info.sideZ
    this._gripLocalSideX = info.sideX
    const halfW = hazard.getPipesPose?.()?.halfW || 1.935
    this._gripRelLocalX = clamp(info.playerLx, -halfW + 0.24, halfW - 0.24)
    const playerRadius = this.engine.movementConfig?.radius || PLAYER_RADIUS
    this._gripStandoffDist = clamp(
      info.edgeDist,
      playerRadius + 0.16,
      playerRadius + 0.56
    )

    const curYaw = this._getPlayerFacingYaw()
    this._gripStartYaw = curYaw
    this._gripTargetYaw = curYaw
    this._carryYawOffset = 0
    this._gripAttached = false
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
        p?.restMinY || 0.144,
        p?.worldCz || 0
      )
      this._tmpEuler.set(0, p?.wallYaw || 0, 0, 'YXZ')
      this._pickupStartWorldQuat.setFromEuler(this._tmpEuler)
    }

    // Preserve closest axial orientation (0 or Math.PI) relative to the player's
    // two-handed cradle so lifting from the opposite side never spins the pipe 180°.
    this._tmpEuler.setFromQuaternion(this._pickupStartWorldQuat, 'YXZ')
    const diffFromGrip = shortestAngleDiff(this._tmpEuler.y, this._gripTargetYaw)
    this._carryYawOffset =
      Math.abs(diffFromGrip) > Math.PI * 0.5 + 1e-4 ? Math.PI : 0

    this._state = PIPES_HANDLING_STATES.GRIPPING
    this._stateTimer = 0
    this._stateProgress = 0
    this._placeTarget = null
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0.3
    this._isMovingPipes = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0
    this._lastPlacementValid = true

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

  validatePlacementCandidate(cx, cz, yaw, hazard = this._activeHazard) {
    const engine = this.engine
    const maze = engine?._currentMaze
    const playerPos = engine?._playerWorldPos
    if (!maze?.grid || !playerPos || !hazard) {
      return { valid: false, reason: 'missing_context' }
    }

    const pose = hazard.getPipesPose?.()
    const halfW = pose?.halfW || hazard.aftermathHalfW || 1.935
    const halfD = pose?.halfD || hazard.aftermathHalfD || 0.152
    const halfY = hazard.isSmallFixture ? 0.12 : 0.144

    const grid = maze.grid
    const rows = grid.length
    const cols = grid[0].length
    const originX = -(cols * CELL_SIZE) / 2
    const originZ = -(rows * CELL_SIZE) / 2

    const centerCell = worldToGrid(cx, cz, maze)
    if (!centerCell || !isWalkableGridCell(grid, centerCell.row, centerCell.col)) {
      return { valid: false, reason: 'inside_wall' }
    }

    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)
    const ux = cosY
    const uz = -sinY
    const vx = sinY
    const vz = cosY
    const wallPad = PIPES_INTERACTION_CONFIG.wallClearance

    const envX = Math.abs(ux) * halfW + Math.abs(vx) * halfD + wallPad
    const envZ = Math.abs(uz) * halfW + Math.abs(vz) * halfD + wallPad
    const minX = cx - envX
    const maxX = cx + envX
    const minZ = cz - envZ
    const maxZ = cz + envZ

    const minCol = Math.floor((minX - originX) / CELL_SIZE)
    const maxCol = Math.floor((maxX - originX) / CELL_SIZE)
    const minRow = Math.floor((minZ - originZ) / CELL_SIZE)
    const maxRow = Math.floor((maxZ - originZ) / CELL_SIZE)

    for (let r = minRow; r <= maxRow; r += 1) {
      for (let c = minCol; c <= maxCol; c += 1) {
        if (!isWalkableGridCell(grid, r, c)) {
          return { valid: false, reason: 'wall_intersection' }
        }
      }
    }

    if (!hasLineOfSightInMaze(playerPos.x, playerPos.z, cx, cz, maze)) {
      return { valid: false, reason: 'wall_occluded' }
    }

    const playerRadius = Number.isFinite(engine.movementConfig?.radius)
      ? engine.movementConfig.radius
      : PLAYER_RADIUS
    const distToPlayer = distancePointToOBB2D(
      playerPos.x,
      playerPos.z,
      cx,
      cz,
      halfW,
      halfD,
      yaw
    )
    if (distToPlayer < playerRadius + PIPES_INTERACTION_CONFIG.playerClearancePad) {
      return { valid: false, reason: 'player_overlap' }
    }

    const colIndex = engine._propCollisionIndex
    if (colIndex && Array.isArray(colIndex.colliders)) {
      const pad = PIPES_INTERACTION_CONFIG.colliderClearancePad
      const hazPrefix = `${hazard.id}:`
      for (let i = 0; i < colIndex.colliders.length; i += 1) {
        const col = colIndex.colliders[i]
        if (!col || !col.enabled) continue
        if (col.ownerId === hazard.id || col.id?.startsWith?.(hazPrefix)) continue
        if (
          maxX + pad < col.minX ||
          minX - pad > col.maxX ||
          maxZ + pad < col.minZ ||
          minZ - pad > col.maxZ
        ) {
          continue
        }
        if (col.kind === COLLIDER_KIND_CIRCLE) {
          const d = distancePointToOBB2D(col.cx, col.cz, cx, cz, halfW, halfD, yaw)
          if (d < col.radius + pad) {
            return { valid: false, reason: 'collider_overlap' }
          }
        } else if (
          obbsOverlap2D(
            cx,
            cz,
            halfW,
            halfD,
            yaw,
            col.cx,
            col.cz,
            col.halfW,
            col.halfD,
            col.yaw,
            pad
          )
        ) {
          return { valid: false, reason: 'collider_overlap' }
        }
      }
    }

    const enemies = engine.enemyManager?.getEnemies?.()
    if (Array.isArray(enemies)) {
      for (let i = 0; i < enemies.length; i += 1) {
        const enemy = enemies[i]
        const ePos = enemy?.getPosition?.() || enemy?.position
        if (!ePos) continue
        const d = distancePointToOBB2D(ePos.x, ePos.z, cx, cz, halfW, halfD, yaw)
        if (d < 0.55) {
          return { valid: false, reason: 'enemy_overlap' }
        }
      }
    }

    const floorY = getElevatorFloorHeightAtWorld(cx, cz, maze) || 0
    const restY =
      floorY +
      computeMinGroundedCenterY(halfW, halfY, halfD, 0, yaw, 0)

    return {
      valid: true,
      reason: null,
      x: cx,
      y: restY,
      z: cz,
      yaw,
      row: centerCell.row,
      col: centerCell.col,
    }
  }

  findValidPlacement(hazard = this._activeHazard) {
    if (!hazard || !this.engine?._playerWorldPos || !this.engine?._currentMaze) {
      return { valid: false, reason: 'missing_context' }
    }
    const maze = this.engine._currentMaze
    const playerPos = this.engine._playerWorldPos
    const curYaw = this._getPlayerFacingYaw()
    const carriedYaw = this._getCarriedYaw(hazard)
    const fwdX = -Math.sin(curYaw)
    const fwdZ = -Math.cos(curYaw)
    const rightX = Math.cos(curYaw)
    const rightZ = -Math.sin(curYaw)

    const grid = maze.grid
    let cellRightDelta = 0
    let tileCenterX = null
    let tileCenterZ = null
    if (Array.isArray(grid) && grid.length > 0 && Array.isArray(grid[0])) {
      const playerCell = worldToGrid(playerPos.x, playerPos.z, maze)
      if (playerCell) {
        tileCenterX = (playerCell.col + 0.5 - grid[0].length * 0.5) * CELL_SIZE
        tileCenterZ = (playerCell.row + 0.5 - grid.length * 0.5) * CELL_SIZE
        cellRightDelta =
          (tileCenterX - playerPos.x) * rightX + (tileCenterZ - playerPos.z) * rightZ
      }
    }

    // Determine intended placement side dynamically from player strafe input, relative position to tile center, or previous side sign
    let intendedSide = 1
    if (this._strafeSign < -0.05) {
      intendedSide = -1
    } else if (this._strafeSign > 0.05) {
      intendedSide = 1
    } else if (Number.isFinite(cellRightDelta)) {
      intendedSide = cellRightDelta < 0 ? -1 : 1
    } else if (Number.isFinite(this._placeSideSign)) {
      intendedSide = this._placeSideSign !== 0 ? this._placeSideSign : 1
    }
    const sideSigns = [intendedSide, -intendedSide]

    // Always try preserving the carried orientation (yawOffset = 0) across all
    // reachable side, forward/backward, and corridor-aligned floor spots BEFORE
    // falling back to ±90° only when physical clearance strictly demands it.
    for (let yi = 0; yi < PLACEMENT_YAW_OFFSETS.length; yi += 1) {
      const candYaw = carriedYaw + PLACEMENT_YAW_OFFSETS[yi]

      // Pass A: Side-first placement beside the player (prioritizing intended side)
      for (let fi = 0; fi < PLACEMENT_FWD_OFFSETS.length; fi += 1) {
        const df = PLACEMENT_FWD_OFFSETS[fi]
        for (let di = 0; di < PLACEMENT_SIDE_DISTS.length; di += 1) {
          const sd = PLACEMENT_SIDE_DISTS[di]
          for (let si = 0; si < sideSigns.length; si += 1) {
            const sign = sideSigns[si]
            const dl = sign * sd
            const cx = playerPos.x + rightX * dl + fwdX * df
            const cz = playerPos.z + rightZ * dl + fwdZ * df
            const res = this.validatePlacementCandidate(cx, cz, candYaw, hazard)
            if (res.valid) {
              return { ...res, sideSign: sign }
            }
          }
        }
      }

      // Pass B: Corridor-centered and forward/backward spots (handles narrow 4m corridors
      // and tight wall-adjacent positions without forcing a 90° rotation)
      for (let fi = 0; fi < PLACEMENT_NEAR_FWD_OFFSETS.length; fi += 1) {
        const df = PLACEMENT_NEAR_FWD_OFFSETS[fi]
        for (let li = -1; li < PLACEMENT_NEAR_LAT_BASE.length; li += 1) {
          const dl = li === -1 ? cellRightDelta : PLACEMENT_NEAR_LAT_BASE[li]
          if (li === -1 && Math.abs(cellRightDelta) < 0.02) continue
          if (Math.hypot(df, dl) > 2.15) continue
          const cx = playerPos.x + fwdX * df + rightX * dl
          const cz = playerPos.z + fwdZ * df + rightZ * dl
          const res = this.validatePlacementCandidate(cx, cz, candYaw, hazard)
          if (res.valid) {
            return {
              ...res,
              sideSign: dl > 0.15 ? 1 : dl < -0.15 ? -1 : 0,
            }
          }
        }
      }

      if (tileCenterX !== null && tileCenterZ !== null) {
        const perpX = Math.sin(candYaw)
        const perpZ = Math.cos(candYaw)
        for (let fi = 0; fi < PLACEMENT_NEAR_FWD_OFFSETS.length; fi += 1) {
          const df = PLACEMENT_NEAR_FWD_OFFSETS[fi]
          const cx = tileCenterX - perpX * df
          const cz = tileCenterZ - perpZ * df
          if (Math.hypot(cx - playerPos.x, cz - playerPos.z) > 2.15) continue
          const res = this.validatePlacementCandidate(cx, cz, candYaw, hazard)
          if (res.valid) {
            const latDot = (cx - playerPos.x) * rightX + (cz - playerPos.z) * rightZ
            return {
              ...res,
              sideSign: latDot > 0.15 ? 1 : latDot < -0.15 ? -1 : 0,
            }
          }
        }
      }
    }

    return { valid: false, reason: 'no_clear_space' }
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

    if (this._state === PIPES_HANDLING_STATES.GRIPPING && !this._gripAttached) {
      this.interruptHandling({ immediate: true })
      return {
        handled: true,
        action: 'cancel_grip_pipes',
        state: this._state,
      }
    }

    const hazard = this._activeHazard
    const releasedHazardId = hazard?.id || null
    const placement = this.findValidPlacement(hazard)
    if (!placement.valid) {
      this._blockedFeedback = 'No clear floor space to place pipe'
      this._blockedFeedbackTimer = PIPES_INTERACTION_CONFIG.feedbackDuration
      this._lastPlacementValid = false
      this.engine._notifyStealthChange?.(true)
      return {
        handled: false,
        reason: placement.reason || 'invalid_placement',
        hazardId: releasedHazardId,
      }
    }

    this._lastPlacementValid = true
    this._tmpEuler.set(0, placement.yaw, 0, 'YXZ')
    this._placeTargetQuat.setFromEuler(this._tmpEuler)
    this._placeTarget = {
      x: placement.x,
      y: placement.y,
      z: placement.z,
      yaw: placement.yaw,
      row: placement.row,
      col: placement.col,
      sideSign: placement.sideSign ?? 1,
      quat: this._placeTargetQuat,
    }
    this._placeSideSign = this._placeTarget.sideSign

    const pipeGroup = hazard?.mesh?.userData?.pipeGroup
    if (pipeGroup) {
      pipeGroup.updateMatrixWorld(true)
      pipeGroup.getWorldPosition(this._placeStartWorldPos)
      pipeGroup.getWorldQuaternion(this._placeStartWorldQuat)
      pipeGroup.userData.manualState = 'placing'
    } else {
      this._computeHandGripWorldPose(
        this._placeStartWorldPos,
        this._placeStartWorldQuat,
        hazard
      )
    }

    const curYaw = this._getPlayerFacingYaw()
    this._placeStartYaw = curYaw
    const playerPos = this.engine._playerWorldPos
    if (playerPos) {
      const dx = placement.x - playerPos.x
      const dz = placement.z - playerPos.z
      if (dx * dx + dz * dz > 1e-4) {
        const towardYaw = Math.atan2(-dx, -dz)
        const diff = shortestAngleDiff(towardYaw, curYaw)
        this._placeTargetYaw = curYaw + clamp(diff, -0.58, 0.58)
      } else {
        this._placeTargetYaw = curYaw
      }
    } else {
      this._placeTargetYaw = curYaw
    }

    this._state = PIPES_HANDLING_STATES.RELEASING
    this._stateTimer = 0
    this._stateProgress = 0
    this._gripAttached = true
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0.55
    this._isMovingPipes = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0

    this.engine._notifyStealthChange?.(true)

    return {
      handled: true,
      action: 'release_pipes',
      hazardId: releasedHazardId,
      state: this._state,
      target: {
        x: placement.x,
        y: placement.y,
        z: placement.z,
        yaw: placement.yaw,
      },
    }
  }

  releasePipe() {
    return this.tryRelease()
  }

  onMovementInput(hasMovementInput) {
    if (!hasMovementInput || this.isDisposed) return false

    if (this._state === PIPES_HANDLING_STATES.GRIPPING) {
      if (!this._gripAttached) {
        this.interruptHandling({ immediate: true })
        return true
      }
      // Once hands are attached to the pipe, WASD promotes smoothly to full carrying
      this._state = PIPES_HANDLING_STATES.HANDLING
      this._stateTimer = 0
      this._stateProgress = 1
      if (this._activeHazard) {
        this._activeHazard.setPipesCarried?.(true)
        const pipeGroup = this._activeHazard.mesh?.userData?.pipeGroup
        if (pipeGroup) {
          pipeGroup.userData.manualState = 'carried'
        }
      }
      this.engine?._notifyStealthChange?.(true)
      return true
    }

    if (this._state === PIPES_HANDLING_STATES.RELEASING) {
      if (this._gripAttached) {
        // Cancel placement before release and continue carrying smoothly
        this._state = PIPES_HANDLING_STATES.HANDLING
        this._stateTimer = 0
        this._stateProgress = 1
        this._placeTarget = null
        if (this._activeHazard) {
          this._activeHazard.setPipesCarried?.(true)
          const pipeGroup = this._activeHazard.mesh?.userData?.pipeGroup
          if (pipeGroup) {
            pipeGroup.userData.manualState = 'carried'
          }
        }
        this.engine?._notifyStealthChange?.(true)
        return true
      }

      // Already set on floor; finish immediately so player can walk away freely
      this._activeHazard = null
      this._placeTarget = null
      this._state = PIPES_HANDLING_STATES.IDLE
      this._stateTimer = 0
      this._stateProgress = 0
      this._gripAttached = false
      this.engine?.syncPlayerVisibility?.()
      this.updateTargeting()
      this.engine?._notifyStealthChange?.(true)
      return true
    }

    return false
  }

  interruptHandling({ immediate = false } = {}) {
    if (this._state === PIPES_HANDLING_STATES.IDLE) {
      return false
    }
    const wasPreAttach =
      this._state === PIPES_HANDLING_STATES.GRIPPING && !this._gripAttached
    const hazard = this._activeHazard

    this._gripAttached = false
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0
    this._isMovingPipes = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0

    if (hazard) {
      if (wasPreAttach) {
        const pipeGroup = hazard.mesh?.userData?.pipeGroup
        if (pipeGroup) {
          this._applyWorldPoseToPieceMesh(
            pipeGroup,
            this._pickupStartWorldPos,
            this._pickupStartWorldQuat
          )
        }
      }
      hazard.setPipesCarried?.(false, this._priorHandlingState || 'idle')
    }
    this.engine?._syncHazardColliders?.({ allowPushOut: false })

    if (immediate || wasPreAttach) {
      this._activeHazard = null
      this._placeTarget = null
      this._carryYawOffset = 0
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

  _clampCarriedWorldPos(pos, hazard) {
    const maze = this.engine?._currentMaze
    if (!maze || !pos) return
    const floorY = getElevatorFloorHeightAtWorld(pos.x, pos.z, maze) || 0
    const halfY = hazard?.isSmallFixture ? 0.12 : 0.144
    if (pos.y < floorY + halfY + 0.04) {
      pos.y = floorY + halfY + 0.04
    }
  }

  _computeHandGripWorldPose(outPos, outQuat, hazard) {
    const engine = this.engine
    const playerGroup = engine?._playerGroup
    const rig = playerGroup?.userData?.rig
    const playerPos = engine?._playerWorldPos
    const isFirstPerson =
      engine?.cameraRig?.getMode?.() === CAMERA_MODES.FIRST_PERSON
    const isSmallFixture = Boolean(hazard?.isSmallFixture)
    const curYaw = this._getPlayerFacingYaw()
    const carriedYaw = this._getCarriedYaw(hazard)
    const tiltSign = this._carryYawOffset !== 0 ? -1 : 1

    const fwdX = -Math.sin(curYaw)
    const fwdZ = -Math.cos(curYaw)

    if (playerGroup) {
      playerGroup.updateMatrixWorld(true)
    }

    if (rig?.leftWristPivot && rig?.rightWristPivot) {
      rig.leftWristPivot.getWorldPosition(this._tmpVecA)
      rig.rightWristPivot.getWorldPosition(this._tmpVecB)
      outPos.copy(this._tmpVecA).add(this._tmpVecB).multiplyScalar(0.5)
      const palmOffset = isSmallFixture ? 0.14 : 0.18
      outPos.x += fwdX * palmOffset
      outPos.y -= 0.02
      outPos.z += fwdZ * palmOffset

      let tiltX = this._state === PIPES_HANDLING_STATES.HANDLING ? 0.06 : 0.03
      if (isFirstPerson) {
        const pitch = engine?.cameraRig?.getLookDirection?.()?.pitch || 0
        tiltX += clamp(pitch * 0.35, -0.22, 0.18)
      }
      this._tmpEuler.set(tiltX * tiltSign, carriedYaw, 0, 'YXZ')
      outQuat.setFromEuler(this._tmpEuler)
      this._clampCarriedWorldPos(outPos, hazard)
      return
    }

    if (isFirstPerson && engine?.camera) {
      const cam = engine.camera
      const pitch = engine?.cameraRig?.getLookDirection?.()?.pitch || 0
      const forwardDist = isSmallFixture ? 0.54 : 0.62
      const downOffset = isSmallFixture ? -0.32 : -0.36
      const cosP = Math.cos(pitch)
      const sinP = Math.sin(pitch)

      outPos.set(
        cam.position.x + fwdX * forwardDist * cosP,
        cam.position.y + downOffset + sinP * forwardDist * 0.55,
        cam.position.z + fwdZ * forwardDist * cosP
      )
      this._tmpEuler.set((pitch * 0.55 + 0.05) * tiltSign, carriedYaw, 0, 'YXZ')
      outQuat.setFromEuler(this._tmpEuler)
      this._clampCarriedWorldPos(outPos, hazard)
      return
    }

    const baseY = Number.isFinite(playerPos?.y) ? playerPos.y : 0
    outPos.set(
      (playerPos?.x || 0) + fwdX * 0.52,
      baseY + 0.92,
      (playerPos?.z || 0) + fwdZ * 0.52
    )
    this._tmpEuler.set(0.05 * tiltSign, carriedYaw, 0, 'YXZ')
    outQuat.setFromEuler(this._tmpEuler)
    this._clampCarriedWorldPos(outPos, hazard)
  }

  _applyWorldPoseToPieceMesh(mesh, worldPos, worldQuat) {
    if (!mesh) return
    const parent = mesh.parent
    if (parent) {
      parent.updateMatrixWorld(true)
      this._tmpVecC.copy(worldPos)
      parent.worldToLocal(this._tmpVecC)
      mesh.position.copy(this._tmpVecC)

      parent.getWorldQuaternion(this._tmpParentQuatInv)
      this._tmpParentQuatInv.invert()
      mesh.quaternion.copy(this._tmpParentQuatInv).multiply(worldQuat)
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

    const carriedYaw = this._getCarriedYaw(this._activeHazard)

    if (this._state === PIPES_HANDLING_STATES.GRIPPING) {
      if (!this._gripAttached) {
        this._applyWorldPoseToPieceMesh(
          pipeGroup,
          this._pickupStartWorldPos,
          this._pickupStartWorldQuat
        )
        return
      }
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
      this._tmpEuler.setFromQuaternion(this._tmpQuatB, 'YXZ')
      this._activeHazard.setPipesCarriedPose?.(this._tmpVecB, this._tmpEuler.y)
      this._updateHandContactPoints(this._activeHazard, this.engine?._playerWorldPos)
      return
    }

    if (this._state === PIPES_HANDLING_STATES.HANDLING) {
      this._computeHandGripWorldPose(
        this._tmpVecA,
        this._tmpQuatA,
        this._activeHazard
      )
      this._applyWorldPoseToPieceMesh(pipeGroup, this._tmpVecA, this._tmpQuatA)
      this._activeHazard.setPipesCarriedPose?.(this._tmpVecA, carriedYaw)
      this._updateHandContactPoints(this._activeHazard, this.engine?._playerWorldPos)
      return
    }

    if (this._state === PIPES_HANDLING_STATES.RELEASING && this._placeTarget) {
      if (this._gripAttached) {
        const relP = this.getPlaceReleaseProgress()
        const lowerT = smoothstep01(
          this._stateProgress / Math.max(0.01, relP)
        )
        this._tmpVecA.set(
          this._placeTarget.x,
          this._placeTarget.y,
          this._placeTarget.z
        )
        this._tmpVecB.lerpVectors(this._placeStartWorldPos, this._tmpVecA, lowerT)
        this._tmpQuatB
          .copy(this._placeStartWorldQuat)
          .slerp(this._placeTarget.quat, lowerT)
        this._applyWorldPoseToPieceMesh(pipeGroup, this._tmpVecB, this._tmpQuatB)
        this._updateHandContactPoints(this._activeHazard, this.engine?._playerWorldPos)
      } else {
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

    const colOptions = this.engine._moveCollisionOptions || {
      radius: this.engine.movementConfig?.radius || PLAYER_RADIUS,
      propColliders: this.engine._propCollisionIndex,
      allowStepOver: true,
      maxStepHeight: 0.35,
    }

    const moveRes =
      typeof moveWithSubsteps === 'function' && maze
        ? moveWithSubsteps(
            startX,
            startZ,
            worldDeltaX,
            worldDeltaZ,
            maze,
            colOptions
          )
        : {
            x: startX + worldDeltaX,
            z: startZ + worldDeltaZ,
            collided: false,
          }

    playerPos.x = moveRes.x
    playerPos.z = moveRes.z

    const actualDx = moveRes.x - startX
    const actualDz = moveRes.z - startZ
    const actualDist = Math.hypot(actualDx, actualDz)
    const moved = actualDist > 1e-5

    this._isMovingPipes = moved

    const curPose = hazard.getPipesPose?.()
    const cosY = curPose?.cosYaw ?? 1
    const sinY = curPose?.sinYaw ?? 0
    const dLx = actualDx * cosY - actualDz * sinY
    const dLz = actualDx * sinY + actualDz * cosY

    const nextDispX = (hazard.pipesDispLocalX || 0) + dLx
    const nextDispZ = (hazard.pipesDispLocalZ || 0) + dLz
    hazard.pipesDispLocalX = nextDispX
    hazard.pipesDispLocalZ = nextDispZ
    hazard.setPipesDisplacement?.(nextDispX, nextDispZ)

    const curYaw = this._getPlayerFacingYaw()
    const fwdX = -Math.sin(curYaw)
    const fwdZ = -Math.cos(curYaw)
    const rightX = -fwdZ
    const rightZ = fwdX

    const fwdDot = actualDx * fwdX + actualDz * fwdZ
    const strafeDot = actualDx * rightX + actualDz * rightZ

    this._pushSign = clamp(fwdDot / Math.max(1e-4, reqMag), -1, 1)
    this._strafeSign = clamp(strafeDot / Math.max(1e-4, reqMag), -1, 1)
    this._effortLevel = clamp(0.45 + 0.35 * Math.abs(this._pushSign), 0, 1)

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

    if (this.engine._playerGroup) {
      this.engine._playerGroup.position.set(
        playerPos.x,
        playerPos.y,
        playerPos.z
      )
    }

    this._updateHandContactPoints(hazard, playerPos)
    this.syncCarriedMeshToHands()

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
      collided: Boolean(moveRes.collided),
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
        const turnT = smoothstep01(this._stateProgress / 0.5)
        const diff = shortestAngleDiff(this._gripTargetYaw, this._gripStartYaw)
        const nextYaw = this._gripStartYaw + diff * turnT
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
        this._lastPlacementValid = this.findValidPlacement(
          this._activeHazard
        ).valid
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
      if (
        this.engine._playerGroup &&
        this.engine.cameraRig?.getLookDirection &&
        !this.engine.cameraRig?.isFreeLookActive?.()
      ) {
        const targetYaw = this.engine.cameraRig.getLookDirection().yaw
        const curYaw = this.engine._playerGroup.rotation.y
        const diff = shortestAngleDiff(targetYaw, curYaw)
        const turnAlpha = dt > 0 ? 1 - Math.exp(-14 * dt) : 1
        this.engine._playerGroup.rotation.y = curYaw + diff * turnAlpha
      }
      const playerPos = this.engine._playerWorldPos
      this._updateHandContactPoints(this._activeHazard, playerPos)
      this._lastPlacementValid = this.findValidPlacement(
        this._activeHazard
      ).valid
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
      if (this.engine._playerGroup) {
        if (this._stateProgress <= releaseP) {
          const turnT = smoothstep01(
            this._stateProgress / Math.max(0.01, releaseP)
          )
          const diff = shortestAngleDiff(
            this._placeTargetYaw,
            this._placeStartYaw
          )
          const nextYaw = this._placeStartYaw + diff * turnT
          this.engine._playerGroup.rotation.y = nextYaw
          if (this.engine.cameraRig?.isFreeLookActive?.()) {
            this.engine.cameraRig.setCharacterYaw?.(nextYaw)
          }
        } else {
          const returnT = smoothstep01(
            (this._stateProgress - releaseP) / Math.max(0.01, 1 - releaseP)
          )
          const restoreYaw = this.engine.cameraRig?.isFreeLookActive?.()
            ? this._placeStartYaw
            : (this.engine.cameraRig?.getLookDirection?.()?.yaw ??
              this._placeStartYaw)
          const diff = shortestAngleDiff(restoreYaw, this._placeTargetYaw)
          const nextYaw = this._placeTargetYaw + diff * returnT
          this.engine._playerGroup.rotation.y = nextYaw
          if (this.engine.cameraRig?.isFreeLookActive?.()) {
            this.engine.cameraRig.setCharacterYaw?.(nextYaw)
          }
        }
      }

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
        this._priorHandlingState = 'idle'
        this._carryYawOffset = 0
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
        placeSideSign: 1,
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
        placeSideSign: 1,
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
        placeSideSign: 1,
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
      placeSideSign: Number.isFinite(this._placeSideSign) ? this._placeSideSign : 1,
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
      canPlaceValid: Boolean(
        this._state === PIPES_HANDLING_STATES.HANDLING
          ? this._lastPlacementValid
          : false
      ),
      feedbackMessage: this._blockedFeedback || null,
    }
  }

  reset() {
    this._clearHighlight(null)
    if (this._activeHazard) {
      this._activeHazard.setPipesCarried?.(false, this._priorHandlingState || 'idle')
    }
    this._targetedHazard = null
    this._targetedHitPoint = null
    this._targetedEdgeDistance = Infinity
    this._activeHazard = null
    this._priorHandlingState = 'idle'
    this._carryYawOffset = 0
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
    this._lastPlacementValid = true
  }

  dispose() {
    if (this.isDisposed) return
    this.isDisposed = true
    this.reset()
    this.engine = null
  }
}
