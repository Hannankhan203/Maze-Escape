import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import {
  hasLineOfSightInMaze,
  resolveGridCollision,
} from '../world/gridCollision.js'
import { worldToGrid } from '../world/worldCoords.js'
import { ROTTEN_FURNITURE_HANDLING_LIMITS } from './buildHazards.js'

export const FURNITURE_HANDLING_STATES = Object.freeze({
  IDLE: 'idle',
  GRIPPING: 'gripping',
  HANDLING: 'handling',
  RELEASING: 'releasing',
})

export const FURNITURE_ANIM_MODES = Object.freeze({
  NONE: 'none',
  GRIP: 'grip',
  PUSH_DRAG: 'push_drag',
  RELEASE: 'release',
})

export const FURNITURE_INTERACTION_CONFIG = Object.freeze({
  maxRayDistance: 4.2,
  maxEdgeReachDistance: 1.68,
  gripDurationSec: 0.44,
  gripContactProgress: 0.56,
  releaseDurationSec: 0.34,
  movementSpeedScale: 0.44,
  standoffPadding: 0.24,
  handLateralHalfSpread: 0.24,
  soundEmitIntervalSec: 0.45,
  soundEmitRange: 4.8,
})

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

function shortestAngleDiff(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current))
}

/**
 * Physical Rotten Furniture Collapse Interaction & Movement Controller
 * (MAZE-HAZARD-FURNITURE-ANIM-001)
 *
 * Manages center-screen crosshair targeting, physical approach & two-handed grip contact,
 * coupled WASD player + furniture pushing/dragging at heavy-load speed with sprinting disabled,
 * continuous OBB collision synchronization, wall/obstacle blocking, right-click release,
 * and safe interruption/resumption from the exact current position.
 */
export class RottenFurnitureController {
  constructor(engine) {
    this.engine = engine || null
    this.isDisposed = false

    this._raycaster = new THREE.Raycaster()
    this._rayNdc = new THREE.Vector2(0, 0)
    this._state = FURNITURE_HANDLING_STATES.IDLE
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

    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0
    this._isMovingFurniture = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0
    this._soundCooldown = 0
  }

  getStateName() {
    return this._state
  }

  isActive() {
    return (
      !this.isDisposed &&
      this._state !== FURNITURE_HANDLING_STATES.IDLE
    )
  }

  isHandling() {
    return (
      !this.isDisposed &&
      (this._state === FURNITURE_HANDLING_STATES.GRIPPING ||
        this._state === FURNITURE_HANDLING_STATES.HANDLING)
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

  getMovementSpeedScale() {
    if (!this.isHandling()) return 1.0
    if (!this._gripAttached) return 0.0
    return FURNITURE_INTERACTION_CONFIG.movementSpeedScale
  }

  getFirstPersonEyeOffsetY() {
    if (!this.isActive()) return 0
    if (this._state === FURNITURE_HANDLING_STATES.GRIPPING) {
      const u = clamp(this._stateProgress / 0.65, 0, 1)
      const smooth = u * u * (3 - 2 * u)
      return -0.25 * smooth
    }
    if (this._state === FURNITURE_HANDLING_STATES.HANDLING) {
      const pose = this._activeHazard?.getFurniturePose?.()
      const compT = pose ? pose.compactionT : 0
      return -0.25 * (1 - 0.35 * compT)
    }
    if (this._state === FURNITURE_HANDLING_STATES.RELEASING) {
      const u = clamp(this._stateProgress, 0, 1)
      const smooth = u * u * (3 - 2 * u)
      return -0.25 * (1 - smooth)
    }
    return 0
  }

  _getCollapsedFurnitureHazards() {
    const hazards = this.engine?.hazardManager?.getHazards?.()
    if (!Array.isArray(hazards) || hazards.length === 0) return []
    const out = []
    for (let i = 0; i < hazards.length; i += 1) {
      const h = hazards[i]
      if (
        h &&
        h.type === HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE &&
        h.isCollapsedForFurnitureHandling?.()
      ) {
        out.push(h)
      }
    }
    return out
  }

  _computeEdgeDistanceAndAnchor(hazard, playerPos) {
    const pose = hazard?.getFurniturePose?.()
    if (!pose || !playerPos) return null
    const dx = playerPos.x - pose.baseX
    const dz = playerPos.z - pose.baseZ
    const playerLx = dx * pose.cosYaw - dz * pose.sinYaw
    const playerLz = dx * pose.sinYaw + dz * pose.cosYaw

    const clampedLx = clamp(playerLx, pose.minLocalX + 0.14, pose.maxLocalX - 0.14)
    const clampedLz = clamp(playerLz, pose.minLocalZ + 0.08, pose.maxLocalZ - 0.04)

    const nearEdgeLx = clamp(playerLx, pose.minLocalX, pose.maxLocalX)
    const nearEdgeLz = clamp(playerLz, pose.minLocalZ, pose.maxLocalZ)
    const edgeDist = Math.hypot(playerLx - nearEdgeLx, playerLz - nearEdgeLz)

    // Determine primary face (front/rear transverse face vs left/right longitudinal end)
    const distToFrontZ = Math.abs(playerLz - pose.maxLocalZ)
    const distToRearZ = Math.abs(playerLz - pose.minLocalZ)
    const distToMinX = Math.abs(playerLx - pose.minLocalX)
    const distToMaxX = Math.abs(playerLx - pose.maxLocalX)

    let gripLx
    let gripLz
    let sideZ
    let sideX

    const insideXSpan =
      playerLx >= pose.minLocalX - 0.18 && playerLx <= pose.maxLocalX + 0.18
    if (insideXSpan || Math.min(distToFrontZ, distToRearZ) <= Math.min(distToMinX, distToMaxX) + 0.25) {
      if (playerLz >= pose.centerLocalZ || distToFrontZ <= distToRearZ + 0.35) {
        gripLz = pose.maxLocalZ
        sideZ = 1
      } else {
        gripLz = pose.minLocalZ
        sideZ = -1
      }
      gripLx = clampedLx
      sideX = 0
    } else if (playerLx < pose.centerLocalX) {
      gripLx = pose.minLocalX
      gripLz = clampedLz
      sideX = -1
      sideZ = 0
    } else {
      gripLx = pose.maxLocalX
      gripLz = clampedLz
      sideX = 1
      sideZ = 0
    }

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
      sideX,
      sideZ,
      edgeDist,
      anchorWorldX,
      anchorWorldZ,
      anchorWorldY: pose.gripHeightY,
    }
  }

  _clearHighlight(exceptHazard = null) {
    const list = this._getCollapsedFurnitureHazards()
    for (let i = 0; i < list.length; i += 1) {
      const h = list[i]
      if (h !== exceptHazard) {
        h.setFurnitureHighlighted?.(false)
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
      this.engine.electricalWiringController?.isActive?.() ||
      this.engine.floorGrateController?.isActive?.()
    ) {
      this._targetedHazard = null
      this._targetedHitPoint = null
      this._targetedEdgeDistance = Infinity
      this._clearHighlight(null)
      return null
    }

    if (this._state !== FURNITURE_HANDLING_STATES.IDLE) {
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

    const candidates = this._getCollapsedFurnitureHazards()
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
      const meshes = h.getFurnitureInteractiveMeshes?.() || []
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
      FURNITURE_INTERACTION_CONFIG.maxRayDistance + Math.min(6.0, camToPlayerDist)

    camera.updateMatrixWorld?.(true)
    const ndcX = Number.isFinite(overrideNdc?.x) ? overrideNdc.x : 0
    const ndcY = Number.isFinite(overrideNdc?.y) ? overrideNdc.y : 0
    this._rayNdc.set(ndcX, ndcY)
    this._raycaster.setFromCamera(this._rayNdc, camera)
    this._raycaster.near = 0.05
    this._raycaster.far = effectiveMaxRayDistance + 2.5

    const hits = this._raycaster.intersectObjects(interactiveMeshes, false)
    let matchedHazard = null
    let matchedHitPoint = null
    let matchedEdgeInfo = null

    for (let i = 0; i < hits.length; i += 1) {
      const hit = hits[i]
      if (!hit || hit.distance > effectiveMaxRayDistance) {
        continue
      }
      const hazId = hit.object?.userData?.hazardId
      const haz = hazId ? hazardById.get(hazId) : null
      if (!haz) continue

      const edgeInfo = this._computeEdgeDistanceAndAnchor(haz, playerPos)
      if (
        !edgeInfo ||
        edgeInfo.edgeDist > FURNITURE_INTERACTION_CONFIG.maxEdgeReachDistance
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

    // Close-range ergonomic center-look fallback when standing directly beside the fallen rack
    // and aiming toward it within a tight view cone
    if (!matchedHazard) {
      const camDir = new THREE.Vector3()
      camera.getWorldDirection(camDir)
      for (let i = 0; i < candidates.length; i += 1) {
        const haz = candidates[i]
        const edgeInfo = this._computeEdgeDistanceAndAnchor(haz, playerPos)
        if (
          !edgeInfo ||
          edgeInfo.edgeDist > FURNITURE_INTERACTION_CONFIG.maxEdgeReachDistance
        ) {
          continue
        }
        const toAnchorX = edgeInfo.anchorWorldX - camera.position.x
        const toAnchorY = edgeInfo.anchorWorldY - camera.position.y
        const toAnchorZ = edgeInfo.anchorWorldZ - camera.position.z
        const len = Math.hypot(toAnchorX, toAnchorY, toAnchorZ)
        let matchedDot = false
        let hitX = edgeInfo.anchorWorldX
        let hitY = edgeInfo.anchorWorldY
        let hitZ = edgeInfo.anchorWorldZ

        if (len > 1e-4 && len <= effectiveMaxRayDistance) {
          const dot =
            (toAnchorX * camDir.x + toAnchorY * camDir.y + toAnchorZ * camDir.z) / len
          if (dot >= 0.84) {
            matchedDot = true
          }
        }

        // Also allow close-range downward gaze onto the fallen rack's top surface
        if (!matchedDot && edgeInfo.edgeDist <= 1.25 && camDir.y <= -0.1) {
          const { pose } = edgeInfo
          const midLx = edgeInfo.gripLx * 0.45 + pose.centerLocalX * 0.55
          const midLz = edgeInfo.gripLz * 0.45 + pose.centerLocalZ * 0.55
          const midX = pose.baseX + midLx * pose.cosYaw + midLz * pose.sinYaw
          const midZ = pose.baseZ - midLx * pose.sinYaw + midLz * pose.cosYaw
          const midY = Math.max(0.28, pose.gripHeightY * 0.8)
          const tmx = midX - camera.position.x
          const tmy = midY - camera.position.y
          const tmz = midZ - camera.position.z
          const mlen = Math.hypot(tmx, tmy, tmz)
          if (mlen > 1e-4 && mlen <= effectiveMaxRayDistance) {
            const mdot =
              (tmx * camDir.x + tmy * camDir.y + tmz * camDir.z) / mlen
            if (mdot >= 0.9) {
              matchedDot = true
              hitX = midX
              hitY = midY
              hitZ = midZ
            }
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
            matchedHitPoint = { x: hitX, y: hitY, z: hitZ }
            matchedEdgeInfo = edgeInfo
            break
          }
        }
      }
    }

    this._targetedHazard = matchedHazard
    this._targetedHitPoint = matchedHitPoint
    this._targetedEdgeDistance = matchedEdgeInfo ? matchedEdgeInfo.edgeDist : Infinity
    this._clearHighlight(matchedHazard)
    if (matchedHazard) {
      matchedHazard.setFurnitureHighlighted?.(true)
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

    let gripLx = pose.centerLocalX + this._gripRelLocalX
    gripLx = clamp(gripLx, pose.minLocalX + 0.22, pose.maxLocalX - 0.22)
    let gripLz =
      this._gripLocalSideZ >= 0 ? pose.maxLocalZ : pose.minLocalZ
    if (this._gripLocalSideX !== 0) {
      gripLx = this._gripLocalSideX > 0 ? pose.maxLocalX : pose.minLocalX
      gripLz = pose.centerLocalZ
    }

    const ax = pose.baseX + gripLx * pose.cosYaw + gripLz * pose.sinYaw
    const az = pose.baseZ - gripLx * pose.sinYaw + gripLz * pose.cosYaw
    const ay = pose.gripHeightY

    this._gripAnchorWorld.x = ax
    this._gripAnchorWorld.y = ay
    this._gripAnchorWorld.z = az

    const toAnchorX = ax - playerPos.x
    const toAnchorZ = az - playerPos.z
    const toLen = Math.hypot(toAnchorX, toAnchorZ)
    const fwdX = toLen > 1e-4 ? toAnchorX / toLen : -Math.sin(this._gripTargetYaw)
    const fwdZ = toLen > 1e-4 ? toAnchorZ / toLen : -Math.cos(this._gripTargetYaw)
    const rightX = -fwdZ
    const rightZ = fwdX
    const halfSpread = FURNITURE_INTERACTION_CONFIG.handLateralHalfSpread

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
      this.engine.electricalWiringController?.isActive?.() ||
      this.engine.floorGrateController?.isActive?.()
    ) {
      return { handled: false, reason: 'other_interaction_active' }
    }
    if (this._state !== FURNITURE_HANDLING_STATES.IDLE) {
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
      info.edgeDist > FURNITURE_INTERACTION_CONFIG.maxEdgeReachDistance
    ) {
      return { handled: false, reason: 'out_of_range' }
    }

    const { pose } = info
    this._activeHazard = hazard
    this._targetedHazard = null
    this._clearHighlight(null)

    this._gripLocalSideZ = info.sideZ
    this._gripLocalSideX = info.sideX
    this._gripRelLocalX = clamp(
      info.playerLx - pose.centerLocalX,
      -pose.halfW + 0.24,
      pose.halfW - 0.24
    )
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

    this._state = FURNITURE_HANDLING_STATES.GRIPPING
    this._stateTimer = 0
    this._stateProgress = 0
    this._gripAttached = false
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0.25
    this._isMovingFurniture = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0

    this.engine.syncPlayerVisibility?.()
    this.engine._notifyStealthChange?.(true)

    return {
      handled: true,
      action: 'grip_furniture',
      hazardId: hazard.id,
      state: this._state,
    }
  }

  tryRelease() {
    if (this.isDisposed || !this.engine) {
      return { handled: false, reason: 'disposed' }
    }
    if (
      this._state !== FURNITURE_HANDLING_STATES.GRIPPING &&
      this._state !== FURNITURE_HANDLING_STATES.HANDLING
    ) {
      return { handled: false, reason: 'not_handling' }
    }

    const releasedHazardId = this._activeHazard?.id || null
    this._state = FURNITURE_HANDLING_STATES.RELEASING
    this._stateTimer = 0
    this._stateProgress = 0
    this._gripAttached = false
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0
    this._isMovingFurniture = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0

    this.engine._syncHazardColliders?.({ allowPushOut: false })
    this.engine._notifyStealthChange?.(true)

    return {
      handled: true,
      action: 'release_furniture',
      hazardId: releasedHazardId,
      state: this._state,
    }
  }

  interruptHandling({ immediate = false } = {}) {
    if (this._state === FURNITURE_HANDLING_STATES.IDLE) {
      return false
    }
    this._gripAttached = false
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0
    this._isMovingFurniture = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0
    this.engine?._syncHazardColliders?.({ allowPushOut: false })

    if (immediate) {
      this._activeHazard = null
      this._state = FURNITURE_HANDLING_STATES.IDLE
      this._stateTimer = 0
      this._stateProgress = 0
      this.engine?.syncPlayerVisibility?.()
    } else {
      this._state = FURNITURE_HANDLING_STATES.RELEASING
      this._stateTimer = 0
      this._stateProgress = 0
    }
    this.engine?._notifyStealthChange?.(true)
    return true
  }

  _isCandidateFurniturePoseBlocked(hazard, candPose) {
    const maze = this.engine?._currentMaze
    if (!maze?.grid) return true

    // 1. Corridor transverse wall bounds check (mounting wall at -2.0, opposite wall at +2.0)
    if (candPose.minLocalZ < -1.985 || candPose.maxLocalZ > 1.92) {
      return true
    }

    // 2. Check OBB sample points in world space against solid maze wall cells, other props, & enemies
    const sampleFracsX = [-0.96, -0.48, 0, 0.48, 0.96]
    const sampleFracsZ = [-0.92, 0, 0.92]
    const propIndex = this.engine._propCollisionIndex
    const enemies = this.engine.getEnemies?.() || []

    for (let ix = 0; ix < sampleFracsX.length; ix += 1) {
      const lx = candPose.centerLocalX + sampleFracsX[ix] * candPose.halfW
      for (let iz = 0; iz < sampleFracsZ.length; iz += 1) {
        const lz = candPose.centerLocalZ + sampleFracsZ[iz] * candPose.halfD
        const wx = candPose.baseX + lx * candPose.cosYaw + lz * candPose.sinYaw
        const wz = candPose.baseZ - lx * candPose.sinYaw + lz * candPose.cosYaw
        const cell = worldToGrid(wx, wz, maze)
        if (!cell || maze.grid[cell.row]?.[cell.col] === CELL_TYPES.WALL) {
          return true
        }
        for (let e = 0; e < enemies.length; e += 1) {
          const enemy = enemies[e]
          if (!enemy || enemy.isDisposed || !enemy.worldPos) continue
          const eDist = Math.hypot(wx - enemy.worldPos.x, wz - enemy.worldPos.z)
          if (eDist < 0.48) {
            return true
          }
        }
      }
    }

    // 3. Check full rack OBB extents against other dynamic/static prop colliders
    if (Array.isArray(propIndex?.colliders)) {
      for (let i = 0; i < propIndex.colliders.length; i += 1) {
        const col = propIndex.colliders[i]
        if (
          !col ||
          !col.enabled ||
          col.ownerId === hazard.id ||
          col.propId === hazard.id
        ) {
          continue
        }
        const cdx = col.cx - candPose.baseX
        const cdz = col.cz - candPose.baseZ
        const colLx = cdx * candPose.cosYaw - cdz * candPose.sinYaw
        const colLz = cdx * candPose.sinYaw + cdz * candPose.cosYaw
        const colPadX = Math.max(col.radius || 0, col.halfW || 0.3) * 0.75
        const colPadZ = Math.max(col.radius || 0, col.halfD || 0.3) * 0.75
        const nearLx = clamp(colLx, candPose.minLocalX, candPose.maxLocalX)
        const nearLz = clamp(colLz, candPose.minLocalZ, candPose.maxLocalZ)
        if (
          Math.abs(colLx - nearLx) < colPadX &&
          Math.abs(colLz - nearLz) < colPadZ
        ) {
          return true
        }
      }
    }

    return false
  }

  _tryApplyCoupledStep(hazard, curPose, tryDLx, tryDLz) {
    if (Math.abs(tryDLx) <= 1e-6 && Math.abs(tryDLz) <= 1e-6) {
      return null
    }

    const nextDispX = curPose.dispLocalX + tryDLx
    const nextDispZ = clamp(
      curPose.dispLocalZ + tryDLz,
      ROTTEN_FURNITURE_HANDLING_LIMITS.minDispZ,
      ROTTEN_FURNITURE_HANDLING_LIMITS.maxDispZ
    )

    const candPose = hazard.getFurniturePose(nextDispX, nextDispZ)
    const actualDLx = candPose.dispLocalX - curPose.dispLocalX
    const actualDLz = candPose.dispLocalZ - curPose.dispLocalZ
    if (Math.abs(actualDLx) <= 1e-6 && Math.abs(actualDLz) <= 1e-6) {
      return null
    }

    if (this._isCandidateFurniturePoseBlocked(hazard, candPose)) {
      return null
    }

    // Compute how much the gripped edge of the furniture moved in local coordinates
    let edgeDeltaLz
    if (this._gripLocalSideZ > 0) {
      edgeDeltaLz = candPose.maxLocalZ - curPose.maxLocalZ
    } else if (this._gripLocalSideZ < 0) {
      edgeDeltaLz = candPose.minLocalZ - curPose.minLocalZ
    } else {
      edgeDeltaLz = candPose.centerLocalZ - curPose.centerLocalZ
    }

    const worldDx =
      actualDLx * curPose.cosYaw + edgeDeltaLz * curPose.sinYaw
    const worldDz =
      -actualDLx * curPose.sinYaw + edgeDeltaLz * curPose.cosYaw

    const playerPos = this.engine._playerWorldPos
    let candPlayerX = playerPos.x + worldDx
    let candPlayerZ = playerPos.z + worldDz
    const maze = this.engine._currentMaze
    const playerRadius = this.engine.movementConfig?.radius || 0.75

    // Temporarily apply furniture displacement & collider sync to validate coupled player position
    const prevDispX = hazard.furnitureDispLocalX
    const prevDispZ = hazard.furnitureDispLocalZ
    hazard.setFurnitureDisplacement(candPose.dispLocalX, candPose.dispLocalZ)
    this.engine._syncHazardColliders?.({ allowPushOut: false })

    const colCheck = resolveGridCollision(candPlayerX, candPlayerZ, maze, {
      radius: playerRadius - 0.01,
      propColliders: this.engine._propCollisionIndex,
    })

    let blockedByCol = colCheck.collided
    // When pushing from a side end of the rack along the corridor toward a wall,
    // allow the player's body to brace against the corridor wall without clipping
    // as long as their hands still cleanly reach the furniture edge.
    if (
      colCheck.collided &&
      !colCheck.hitProp &&
      this._gripLocalSideX !== 0
    ) {
      const slidEdgeInfo = this._computeEdgeDistanceAndAnchor(hazard, {
        x: colCheck.x,
        z: colCheck.z,
      })
      if (
        slidEdgeInfo &&
        slidEdgeInfo.edgeDist <= FURNITURE_INTERACTION_CONFIG.maxEdgeReachDistance
      ) {
        candPlayerX = colCheck.x
        candPlayerZ = colCheck.z
        blockedByCol = false
      }
    }

    // Also check player against active enemies
    let hitEnemy = false
    const enemies = this.engine.getEnemies?.() || []
    for (let e = 0; e < enemies.length; e += 1) {
      const enemy = enemies[e]
      if (!enemy || enemy.isDisposed || !enemy.worldPos) continue
      if (
        Math.hypot(candPlayerX - enemy.worldPos.x, candPlayerZ - enemy.worldPos.z) <
        playerRadius + 0.34
      ) {
        hitEnemy = true
        break
      }
    }

    if (blockedByCol || hitEnemy) {
      // Revert furniture displacement on player collision
      hazard.setFurnitureDisplacement(prevDispX, prevDispZ)
      this.engine._syncHazardColliders?.({ allowPushOut: false })
      return null
    }

    return {
      pose: candPose,
      worldDx: candPlayerX - playerPos.x,
      worldDz: candPlayerZ - playerPos.z,
      actualDLx,
      actualDLz,
      candPlayerX,
      candPlayerZ,
    }
  }

  /**
   * Advances coupled player + furniture movement when WASD is pressed while handling furniture.
   * Furniture never moves before `gripAttached === true`.
   */
  stepCoupledMovement(worldDeltaX, worldDeltaZ, delta = 0) {
    if (!this.isHandling() || !this._activeHazard || !this.engine) {
      return { moved: false, collided: false }
    }

    // Furniture must NOT move before physical hand contact is established
    if (!this._gripAttached) {
      this._isMovingFurniture = false
      this._pushSign = 0
      this._strafeSign = 0
      return {
        moved: false,
        collided: false,
        waitingForGrip: true,
      }
    }

    const hazard = this._activeHazard
    const curPose = hazard.getFurniturePose()
    if (!curPose) {
      return { moved: false, collided: false }
    }

    const reqMag = Math.hypot(worldDeltaX, worldDeltaZ)
    if (reqMag <= 1e-6) {
      this._isMovingFurniture = false
      this._pushSign = 0
      this._strafeSign = 0
      return { moved: false, collided: false }
    }

    // Project desired world movement into hazard local frame (localX along corridor, localZ across corridor)
    const dLx = worldDeltaX * curPose.cosYaw - worldDeltaZ * curPose.sinYaw
    const dLz = worldDeltaX * curPose.sinYaw + worldDeltaZ * curPose.cosYaw

    // Attempt full 2D movement, then transverse-only (dLz), then longitudinal-only (dLx)
    let applied =
      this._tryApplyCoupledStep(hazard, curPose, dLx, dLz) ||
      this._tryApplyCoupledStep(hazard, curPose, 0, dLz) ||
      this._tryApplyCoupledStep(hazard, curPose, dLx, 0)

    if (!applied) {
      this._isMovingFurniture = false
      this._pushSign = 0
      this._strafeSign = 0
      this._effortLevel = Math.min(1, this._effortLevel + delta * 3.0)
      if (dLz < -1e-4 && curPose.dispLocalZ <= ROTTEN_FURNITURE_HANDLING_LIMITS.minDispZ + 0.04) {
        this._blockedFeedback = 'Furniture pushed flush against wall'
      } else {
        this._blockedFeedback = 'Furniture blocked by obstacle'
      }
      this._blockedFeedbackTimer = 0.85
      return {
        moved: false,
        collided: true,
      }
    }

    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0
    this._isMovingFurniture = true

    const playerPos = this.engine._playerWorldPos
    playerPos.x = applied.candPlayerX
    playerPos.z = applied.candPlayerZ
    this._updateHandContactPoints(hazard, playerPos)

    // Orient character toward the gripped furniture point while pushing/dragging
    if (this.engine._playerGroup) {
      const curYaw = this.engine._playerGroup.rotation.y
      const diff = shortestAngleDiff(this._gripTargetYaw, curYaw)
      const alpha = delta > 0 ? 1 - Math.exp(-14 * delta) : 1
      const nextYaw = curYaw + diff * alpha
      this.engine._playerGroup.rotation.y = nextYaw
      if (this.engine.cameraRig?.isFreeLookActive?.()) {
        this.engine.cameraRig.setCharacterYaw?.(nextYaw)
      }
    }

    // Compute pushSign (+1 when pushing into furniture, -1 when dragging/pulling back) and strafeSign
    const toFurnX = this._gripAnchorWorld.x - playerPos.x
    const toFurnZ = this._gripAnchorWorld.z - playerPos.z
    const toFurnLen = Math.hypot(toFurnX, toFurnZ) || 1
    const normToFurnX = toFurnX / toFurnLen
    const normToFurnZ = toFurnZ / toFurnLen
    const rightFurnX = -normToFurnZ
    const rightFurnZ = normToFurnX

    const moveLen = Math.hypot(applied.worldDx, applied.worldDz) || 1
    const moveDirX = applied.worldDx / moveLen
    const moveDirZ = applied.worldDz / moveLen

    this._pushSign = clamp(
      moveDirX * normToFurnX + moveDirZ * normToFurnZ,
      -1,
      1
    )
    this._strafeSign = clamp(
      moveDirX * rightFurnX + moveDirZ * rightFurnZ,
      -1,
      1
    )
    this._effortLevel = clamp(0.65 + 0.35 * Math.abs(this._pushSign), 0, 1)

    this._soundCooldown = Math.max(0, this._soundCooldown - delta)
    if (this._soundCooldown <= 0) {
      this._soundCooldown = FURNITURE_INTERACTION_CONFIG.soundEmitIntervalSec
      this.engine.emitSound?.(
        { x: applied.pose.worldCx, z: applied.pose.worldCz },
        FURNITURE_INTERACTION_CONFIG.soundEmitRange,
        0.45
      )
    }

    return {
      moved: true,
      collided: false,
      worldDx: applied.worldDx,
      worldDz: applied.worldDz,
      pose: applied.pose,
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

    if (this._state === FURNITURE_HANDLING_STATES.IDLE) {
      this.updateTargeting()
      return
    }

    if (this._state === FURNITURE_HANDLING_STATES.GRIPPING) {
      if (!this._activeHazard || !this._activeHazard.isCollapsedForFurnitureHandling?.()) {
        this.interruptHandling({ immediate: true })
        return
      }
      this._stateTimer += dt
      const dur = FURNITURE_INTERACTION_CONFIG.gripDurationSec
      this._stateProgress = clamp(this._stateTimer / dur, 0, 1)

      const playerPos = this.engine._playerWorldPos
      this._updateHandContactPoints(this._activeHazard, playerPos)

      // Smoothly turn character toward the furniture grip point during approach
      if (this.engine._playerGroup) {
        const turnT = clamp(this._stateProgress / 0.55, 0, 1)
        const smoothTurn = turnT * turnT * (3 - 2 * turnT)
        const diff = shortestAngleDiff(this._gripTargetYaw, this._gripStartYaw)
        const nextYaw = this._gripStartYaw + diff * smoothTurn
        this.engine._playerGroup.rotation.y = nextYaw
        if (this.engine.cameraRig?.isFreeLookActive?.()) {
          this.engine.cameraRig.setCharacterYaw?.(nextYaw)
        }
      }

      if (
        !this._gripAttached &&
        this._stateProgress >= FURNITURE_INTERACTION_CONFIG.gripContactProgress
      ) {
        this._gripAttached = true
        this.engine._notifyStealthChange?.(true)
      }

      if (this._stateProgress >= 1) {
        this._state = FURNITURE_HANDLING_STATES.HANDLING
        this._stateTimer = 0
        this._stateProgress = 1
        this._gripAttached = true
        this.engine._notifyStealthChange?.(true)
      }
      return
    }

    if (this._state === FURNITURE_HANDLING_STATES.HANDLING) {
      if (!this._activeHazard || !this._activeHazard.isCollapsedForFurnitureHandling?.()) {
        this.interruptHandling({ immediate: true })
        return
      }
      const playerPos = this.engine._playerWorldPos
      this._updateHandContactPoints(this._activeHazard, playerPos)
      if (!this._isMovingFurniture) {
        this._pushSign *= Math.exp(-10 * dt)
        this._strafeSign *= Math.exp(-10 * dt)
        this._effortLevel = 0.28 + (this._effortLevel - 0.28) * Math.exp(-8 * dt)
      }
      this._isMovingFurniture = false
      return
    }

    if (this._state === FURNITURE_HANDLING_STATES.RELEASING) {
      this._stateTimer += dt
      const dur = FURNITURE_INTERACTION_CONFIG.releaseDurationSec
      this._stateProgress = clamp(this._stateTimer / dur, 0, 1)
      if (this._stateProgress >= 1) {
        this._activeHazard = null
        this._state = FURNITURE_HANDLING_STATES.IDLE
        this._stateTimer = 0
        this._stateProgress = 0
        this._gripAttached = false
        this.engine.syncPlayerVisibility?.()
        this.updateTargeting()
        this.engine._notifyStealthChange?.(true)
      }
    }
  }

  getAnimatorPayload() {
    if (this.isDisposed || this._state === FURNITURE_HANDLING_STATES.IDLE) {
      return {
        mode: FURNITURE_ANIM_MODES.NONE,
        progress: 0,
        gripAttached: false,
        pushSign: 0,
        strafeSign: 0,
        gripHeightNorm: 0,
        effort: 0,
      }
    }

    const pose = this._activeHazard?.getFurniturePose?.()
    const gripHeightNorm = pose ? clamp(pose.compactionT, 0, 1) : 0

    if (this._state === FURNITURE_HANDLING_STATES.GRIPPING) {
      return {
        mode: FURNITURE_ANIM_MODES.GRIP,
        progress: this._stateProgress,
        gripAttached: this._gripAttached,
        pushSign: this._pushSign,
        strafeSign: this._strafeSign,
        gripHeightNorm,
        effort: this._effortLevel,
      }
    }

    if (this._state === FURNITURE_HANDLING_STATES.HANDLING) {
      return {
        mode: FURNITURE_ANIM_MODES.PUSH_DRAG,
        progress: 1,
        gripAttached: true,
        pushSign: this._pushSign,
        strafeSign: this._strafeSign,
        gripHeightNorm,
        effort: this._effortLevel,
      }
    }

    return {
      mode: FURNITURE_ANIM_MODES.RELEASE,
      progress: this._stateProgress,
      gripAttached: false,
      pushSign: 0,
      strafeSign: 0,
      gripHeightNorm,
      effort: 0,
    }
  }

  getInteractionSnapshot() {
    const canGrip = Boolean(
      this._state === FURNITURE_HANDLING_STATES.IDLE && this._targetedHazard
    )
    const isHandling =
      this._state === FURNITURE_HANDLING_STATES.GRIPPING ||
      this._state === FURNITURE_HANDLING_STATES.HANDLING
    const pose = (this._activeHazard || this._targetedHazard)?.getFurniturePose?.()

    return {
      state: this._state,
      canGrip,
      isHandling,
      gripAttached: Boolean(this._gripAttached),
      targetedHazardId: this._targetedHazard ? this._targetedHazard.id : null,
      activeHazardId: this._activeHazard ? this._activeHazard.id : null,
      pushProgress: pose ? Math.round(pose.pushProgress * 100) / 100 : 0,
      corridorClearance: pose ? Math.round(pose.corridorClearance * 100) / 100 : 0,
      feedbackMessage: this._blockedFeedback || null,
    }
  }

  reset() {
    this._clearHighlight(null)
    this._targetedHazard = null
    this._targetedHitPoint = null
    this._targetedEdgeDistance = Infinity
    this._activeHazard = null
    this._state = FURNITURE_HANDLING_STATES.IDLE
    this._stateTimer = 0
    this._stateProgress = 0
    this._gripAttached = false
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0
    this._isMovingFurniture = false
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
