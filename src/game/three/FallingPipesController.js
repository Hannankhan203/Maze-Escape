import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import {
  hasLineOfSightInMaze,
  resolveGridCollision,
} from '../world/gridCollision.js'
import { worldToGrid } from '../world/worldCoords.js'
import { FALLING_PIPES_HANDLING_LIMITS } from './buildHazards.js'

export const PIPES_HANDLING_STATES = Object.freeze({
  IDLE: 'idle',
  GRIPPING: 'gripping',
  HANDLING: 'handling',
  RELEASING: 'releasing',
})

export const PIPES_ANIM_MODES = Object.freeze({
  NONE: 'none',
  GRIP: 'grip',
  CARRY: 'carry',
  PUSH_DRAG: 'push_drag',
  RELEASE: 'release',
})

export const PIPES_INTERACTION_CONFIG = Object.freeze({
  maxRayDistance: 4.2,
  maxEdgeReachDistance: 1.68,
  gripDurationSec: 0.42,
  gripContactProgress: 0.55,
  releaseDurationSec: 0.32,
  movementSpeedScale: 0.45,
  standoffPadding: 0.24,
  handLateralHalfSpread: 0.26,
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
 * Physical Falling Pipes & Fixtures Interaction & Movement Controller
 * (MAZE-HAZARD-PIPES-ANIM-001)
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

    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0
    this._isMovingPipes = false
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
      this._state !== PIPES_HANDLING_STATES.IDLE
    )
  }

  isHandling() {
    return (
      !this.isDisposed &&
      (this._state === PIPES_HANDLING_STATES.GRIPPING ||
        this._state === PIPES_HANDLING_STATES.HANDLING)
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
    const isSmallFixture = Boolean(this._activeHazard?.isSmallFixture)
    return isSmallFixture ? 0.75 : PIPES_INTERACTION_CONFIG.movementSpeedScale
  }

  getFirstPersonEyeOffsetY() {
    if (!this.isActive()) return 0
    if (this._state === PIPES_HANDLING_STATES.GRIPPING) {
      const u = clamp(this._stateProgress / 0.65, 0, 1)
      const smooth = u * u * (3 - 2 * u)
      return -0.2 * smooth
    }
    if (this._state === PIPES_HANDLING_STATES.HANDLING) {
      const pose = this._activeHazard?.getPipesPose?.()
      const compT = pose ? pose.compactionT : 0
      return -0.2 * (1 - 0.35 * compT)
    }
    if (this._state === PIPES_HANDLING_STATES.RELEASING) {
      const u = clamp(this._stateProgress, 0, 1)
      const smooth = u * u * (3 - 2 * u)
      return -0.2 * (1 - smooth)
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
    const dx = playerPos.x - pose.curPivotX
    const dz = playerPos.z - pose.curPivotZ
    const playerLx = dx * pose.cosYaw - dz * pose.sinYaw
    const playerLz = dx * pose.sinYaw + dz * pose.cosYaw

    const gripLx = clamp(playerLx, pose.minLocalX + 0.14, pose.maxLocalX - 0.14)

    const nearEdgeLx = clamp(playerLx, pose.minLocalX, pose.maxLocalX)
    const nearEdgeLz = clamp(playerLz, pose.minLocalZ, pose.maxLocalZ)
    const edgeDist = Math.hypot(playerLx - nearEdgeLx, playerLz - nearEdgeLz)

    const sideZ = playerLz >= pose.centerLocalZ ? 1 : -1
    const gripLz = sideZ > 0 ? pose.maxLocalZ : pose.minLocalZ

    const anchorWorldX =
      pose.curPivotX + gripLx * pose.cosYaw + (gripLz - pose.curPivotZ) * pose.sinYaw
    const anchorWorldZ =
      pose.curPivotZ - gripLx * pose.sinYaw + (gripLz - pose.curPivotZ) * pose.cosYaw

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
      anchorWorldY: pose.gripHeightY,
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
            (toAnchorX * camDir.x + toAnchorY * camDir.y + toAnchorZ * camDir.z) / len
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
    this._targetedEdgeDistance = matchedEdgeInfo ? matchedEdgeInfo.edgeDist : Infinity
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

    const gripLx = pose.centerLocalX
    const gripLz = this._gripLocalSideZ >= 0 ? pose.maxLocalZ : pose.minLocalZ

    const ax = pose.curPivotX + gripLx
    const az = gripLz
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
    if (this.engine.rubbleController?.isActive?.() || this.engine.furnitureController?.isActive?.()) {
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
    this._gripRelLocalX = clamp(
      info.playerLx,
      -hazard.getPipesPose().halfW + 0.24,
      hazard.getPipesPose().halfW - 0.24
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

    this._state = PIPES_HANDLING_STATES.GRIPPING
    this._stateTimer = 0
    this._stateProgress = 0
    this._gripAttached = false
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

    const releasedHazardId = this._activeHazard?.id || null
    this._state = PIPES_HANDLING_STATES.RELEASING
    this._stateTimer = 0
    this._stateProgress = 0
    this._gripAttached = false
    this._pushSign = 0
    this._strafeSign = 0
    this._effortLevel = 0
    this._isMovingPipes = false
    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0

    this.engine._syncHazardColliders?.({ allowPushOut: false })
    this.engine._notifyStealthChange?.(true)

    return {
      handled: true,
      action: 'release_pipes',
      hazardId: releasedHazardId,
      state: this._state,
    }
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
    this.engine?._syncHazardColliders?.({ allowPushOut: false })

    if (immediate) {
      this._activeHazard = null
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

  _isCandidatePipesPoseBlocked(hazard, candPose) {
    const maze = this.engine?._currentMaze
    if (!maze?.grid) return true

    if (candPose.curPivotX < -1.74 || candPose.curPivotX > 0.05) {
      return true
    }

    const sampleFracsX = [-0.94, 0, 0.94]
    const sampleFracsZ = [-0.85, 0, 0.85]
    const enemies = this.engine.getEnemies?.() || []

    for (let ix = 0; ix < sampleFracsX.length; ix += 1) {
      const wx = candPose.curPivotX + sampleFracsX[ix] * candPose.halfW
      for (let iz = 0; iz < sampleFracsZ.length; iz += 1) {
        const wz = candPose.curPivotZ + sampleFracsZ[iz] * candPose.halfD
        const cell = worldToGrid(wx, wz, maze)
        if (!cell || maze.grid[cell.row]?.[cell.col] === CELL_TYPES.WALL) {
          return true
        }
        for (let e = 0; e < enemies.length; e += 1) {
          const enemy = enemies[e]
          if (!enemy || enemy.isDisposed || !enemy.worldPos) continue
          if (Math.hypot(wx - enemy.worldPos.x, wz - enemy.worldPos.z) < 0.45) {
            return true
          }
        }
      }
    }

    return false
  }

  _tryApplyCoupledStep(hazard, curPose, tryDLx, tryDLz) {
    if (Math.abs(tryDLx) <= 1e-6 && Math.abs(tryDLz) <= 1e-6) {
      return null
    }

    const nextDispX = clamp(
      curPose.dispLocalX + tryDLx,
      FALLING_PIPES_HANDLING_LIMITS.minDispX,
      FALLING_PIPES_HANDLING_LIMITS.maxDispX
    )
    const nextDispZ = clamp(
      curPose.dispLocalZ + tryDLz,
      FALLING_PIPES_HANDLING_LIMITS.minDispZ,
      FALLING_PIPES_HANDLING_LIMITS.maxDispZ
    )

    const candPose = hazard.getPipesPose(nextDispX, nextDispZ)
    const actualDLx = candPose.dispLocalX - curPose.dispLocalX
    const actualDLz = candPose.dispLocalZ - curPose.dispLocalZ
    if (Math.abs(actualDLx) <= 1e-6 && Math.abs(actualDLz) <= 1e-6) {
      return null
    }

    if (this._isCandidatePipesPoseBlocked(hazard, candPose)) {
      return null
    }

    const worldDx = actualDLx
    const worldDz = actualDLz

    const playerPos = this.engine._playerWorldPos
    let candPlayerX = playerPos.x + worldDx
    let candPlayerZ = playerPos.z + worldDz
    const maze = this.engine._currentMaze
    const playerRadius = this.engine.movementConfig?.radius || 0.75

    const prevDispX = hazard.pipesDispLocalX || 0
    const prevDispZ = hazard.pipesDispLocalZ || 0
    hazard.setPipesDisplacement(candPose.dispLocalX, candPose.dispLocalZ)
    this.engine._syncHazardColliders?.({ allowPushOut: false })

    const colCheck = resolveGridCollision(candPlayerX, candPlayerZ, maze, {
      radius: playerRadius - 0.01,
      propColliders: this.engine._propCollisionIndex,
    })

    let blockedByCol = colCheck.collided
    let hitEnemy = false
    const enemies = this.engine.getEnemies?.() || []
    for (let e = 0; e < enemies.length; e += 1) {
      const enemy = enemies[e]
      if (!enemy || enemy.isDisposed || !enemy.worldPos) continue
      if (
        Math.hypot(candPlayerX - enemy.worldPos.x, candPlayerZ - enemy.worldPos.z) <
        playerRadius + 0.32
      ) {
        hitEnemy = true
        break
      }
    }

    if (blockedByCol || hitEnemy) {
      hazard.setPipesDisplacement(prevDispX, prevDispZ)
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

    const hazard = this._activeHazard
    const curPose = hazard.getPipesPose()
    if (!curPose) {
      return { moved: false, collided: false }
    }

    const reqMag = Math.hypot(worldDeltaX, worldDeltaZ)
    if (reqMag <= 1e-6) {
      this._isMovingPipes = false
      this._pushSign = 0
      this._strafeSign = 0
      return { moved: false, collided: false }
    }

    const dLx = worldDeltaX
    const dLz = worldDeltaZ

    let applied =
      this._tryApplyCoupledStep(hazard, curPose, dLx, dLz) ||
      this._tryApplyCoupledStep(hazard, curPose, 0, dLz) ||
      this._tryApplyCoupledStep(hazard, curPose, dLx, 0)

    if (!applied) {
      this._isMovingPipes = false
      this._pushSign = 0
      this._strafeSign = 0
      this._effortLevel = Math.min(1, this._effortLevel + delta * 3.0)
      this._blockedFeedback = 'Pipes blocked by obstacle'
      this._blockedFeedbackTimer = 0.85
      return {
        moved: false,
        collided: true,
      }
    }

    this._blockedFeedback = null
    this._blockedFeedbackTimer = 0
    this._isMovingPipes = true

    const playerPos = this.engine._playerWorldPos
    playerPos.x = applied.candPlayerX
    playerPos.z = applied.candPlayerZ
    this._updateHandContactPoints(hazard, playerPos)

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

    this._pushSign = clamp(applied.worldDx, -1, 1)
    this._strafeSign = clamp(applied.worldDz, -1, 1)
    this._effortLevel = clamp(0.65 + 0.35 * Math.abs(this._pushSign), 0, 1)

    this._soundCooldown = Math.max(0, this._soundCooldown - delta)
    if (this._soundCooldown <= 0) {
      this._soundCooldown = PIPES_INTERACTION_CONFIG.soundEmitIntervalSec
      this.engine.emitSound?.(
        { x: applied.pose.curPivotX, z: applied.pose.curPivotZ },
        PIPES_INTERACTION_CONFIG.soundEmitRange,
        0.42
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

    if (this._state === PIPES_HANDLING_STATES.IDLE) {
      this.updateTargeting()
      return
    }

    if (this._state === PIPES_HANDLING_STATES.GRIPPING) {
      if (!this._activeHazard || !this._activeHazard.isCollapsedForPipesHandling?.()) {
        this.interruptHandling({ immediate: true })
        return
      }
      this._stateTimer += dt
      const dur = PIPES_INTERACTION_CONFIG.gripDurationSec
      this._stateProgress = clamp(this._stateTimer / dur, 0, 1)

      const playerPos = this.engine._playerWorldPos
      this._updateHandContactPoints(this._activeHazard, playerPos)

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
        this._stateProgress >= PIPES_INTERACTION_CONFIG.gripContactProgress
      ) {
        this._gripAttached = true
        this.engine._notifyStealthChange?.(true)
      }

      if (this._stateProgress >= 1) {
        this._state = PIPES_HANDLING_STATES.HANDLING
        this._stateTimer = 0
        this._stateProgress = 1
        this._gripAttached = true
        this.engine._notifyStealthChange?.(true)
      }
      return
    }

    if (this._state === PIPES_HANDLING_STATES.HANDLING) {
      if (!this._activeHazard || !this._activeHazard.isCollapsedForPipesHandling?.()) {
        this.interruptHandling({ immediate: true })
        return
      }
      const playerPos = this.engine._playerWorldPos
      this._updateHandContactPoints(this._activeHazard, playerPos)
      if (!this._isMovingPipes) {
        this._pushSign *= Math.exp(-10 * dt)
        this._strafeSign *= Math.exp(-10 * dt)
        this._effortLevel = 0.28 + (this._effortLevel - 0.28) * Math.exp(-8 * dt)
      }
      this._isMovingPipes = false
      return
    }

    if (this._state === PIPES_HANDLING_STATES.RELEASING) {
      this._stateTimer += dt
      const dur = PIPES_INTERACTION_CONFIG.releaseDurationSec
      this._stateProgress = clamp(this._stateTimer / dur, 0, 1)
      if (this._stateProgress >= 1) {
        this._activeHazard = null
        this._state = PIPES_HANDLING_STATES.IDLE
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
    if (this.isDisposed || this._state === PIPES_HANDLING_STATES.IDLE) {
      return {
        mode: PIPES_ANIM_MODES.NONE,
        progress: 0,
        gripAttached: false,
        pushSign: 0,
        strafeSign: 0,
        gripHeightNorm: 0,
        effort: 0,
      }
    }

    const pose = this._activeHazard?.getPipesPose?.()
    const gripHeightNorm = pose ? clamp(pose.compactionT, 0, 1) : 0
    const isSmallFixture = Boolean(this._activeHazard?.isSmallFixture)
    const animMode = isSmallFixture ? PIPES_ANIM_MODES.CARRY : PIPES_ANIM_MODES.PUSH_DRAG

    if (this._state === PIPES_HANDLING_STATES.GRIPPING) {
      return {
        mode: PIPES_ANIM_MODES.GRIP,
        progress: this._stateProgress,
        gripAttached: this._gripAttached,
        pushSign: this._pushSign,
        strafeSign: this._strafeSign,
        gripHeightNorm,
        effort: this._effortLevel,
      }
    }

    if (this._state === PIPES_HANDLING_STATES.HANDLING) {
      return {
        mode: animMode,
        progress: 1,
        gripAttached: true,
        pushSign: this._pushSign,
        strafeSign: this._strafeSign,
        gripHeightNorm,
        effort: this._effortLevel,
      }
    }

    return {
      mode: PIPES_ANIM_MODES.RELEASE,
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
