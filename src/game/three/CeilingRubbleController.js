import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { hasLineOfSightInMaze } from '../world/gridCollision.js'
import {
  COLLIDER_KIND_CIRCLE,
  hasUnobstructedPropLineOfSight,
} from '../world/propCollision.js'
import {
  CELL_SIZE,
  PLAYER_RADIUS,
  WALL_HEIGHT,
  worldToGrid,
} from '../world/worldCoords.js'
import { getElevatorFloorHeightAtWorld } from './buildElevators.js'
import { computeMinGroundedCenterY } from './buildHazards.js'
import { CAMERA_MODES } from './CameraRig.js'
import { RUBBLE_ANIM_MODES } from './PlayerAnimator.js'

export const RUBBLE_CONTROLLER_STATES = {
  IDLE: 'idle',
  PICKING_UP: 'picking_up',
  CARRYING: 'carrying',
  PLACING: 'placing',
}

export const RUBBLE_HANDLING_CONSTANTS = Object.freeze({
  interactionRange: 2.65,
  pickupDuration: 0.92,
  pickupAttachProgress: 0.52,
  placeDuration: 0.84,
  placeReleaseProgress: 0.55,
  carrySpeedMultiplier: 0.64,
  wallClearance: 0.04,
  playerClearancePad: 0.06,
  colliderClearancePad: 0.02,
  maxPlacementSearchRadius: 0.68,
  feedbackDuration: 1.45,
})

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

function smoothstep01(t) {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

function isWalkableGridCell(grid, row, col) {
  if (!Array.isArray(grid) || row < 0 || row >= grid.length) return false
  const rowArr = grid[row]
  if (!Array.isArray(rowArr) || col < 0 || col >= rowArr.length) return false
  const cell = rowArr[col]
  return (
    cell === CELL_TYPES.PATH ||
    cell === CELL_TYPES.START ||
    cell === CELL_TYPES.EXIT
  )
}

function distancePointToOBB2D(px, pz, cx, cz, halfW, halfD, yaw) {
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  const dx = px - cx
  const dz = pz - cz
  // Inverse Three.js rotation.y: localX = dx*cos - dz*sin, localZ = dx*sin + dz*cos
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

  const axes = [
    [ax1, az1],
    [ax2, az2],
    [bx1, bz1],
    [bx2, bz2],
  ]

  for (let i = 0; i < 4; i += 1) {
    const nx = axes[i][0]
    const nz = axes[i][1]
    const dist = Math.abs(dx * nx + dz * nz)
    const rA =
      Math.abs(ax1 * nx + az1 * nz) * ahw + Math.abs(ax2 * nx + az2 * nz) * ahd
    const rB =
      Math.abs(bx1 * nx + bz1 * nz) * bhw + Math.abs(bx2 * nx + bz2 * nz) * bhd
    if (dist >= rA + rB) {
      return false
    }
  }
  return true
}

function isObjectDescendantOf(obj, ancestor) {
  if (!obj || !ancestor) return false
  let cur = obj
  while (cur) {
    if (cur === ancestor) return true
    cur = cur.parent
  }
  return false
}

function isMeshSolidRaycastOccluder(obj) {
  if (!obj || !obj.isMesh || !obj.visible) return false
  if (obj.userData?.isCeilingRubblePiece) return false
  if (obj.userData?.ignoreRubbleRaycast) return false
  // Ignore translucent volumetric/particle effects (steam clouds, dust puffs, glow halos)
  const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material
  if (mat && mat.transparent && (mat.opacity ?? 1) < 0.72) {
    return false
  }
  // Ignore ceiling/floor dust or warning pebble helpers by name
  const name = obj.name || ''
  if (
    name.includes('dust') ||
    name.includes('steam') ||
    name.includes('fog') ||
    name.includes('glow') ||
    name.includes('beam') ||
    name.includes('spark') ||
    name.includes('pebble')
  ) {
    return false
  }
  return true
}

/**
 * Dedicated physical manual rubble-handling controller for the Ceiling Collapse hazard.
 *
 * Responsibilities cleanly separated from input & animation:
 *  - Accurate Three.js camera raycasting with wall/prop/unrelated-geometry occlusion.
 *  - Pickup -> Carry -> Placement state machine with exact lift-contact & release timing.
 *  - Stable hand-grip attachment in both third-person and first-person camera modes.
 *  - Strict floor/wall/player/collider placement validation (never auto-teleporting).
 *  - Safe WASD movement interruption across every animation phase without resetting placed rubble.
 */
export class CeilingRubbleController {
  constructor(engine) {
    this.engine = engine
    this.isDisposed = false

    this.state = RUBBLE_CONTROLLER_STATES.IDLE
    this.progress = 0
    this.attached = false
    this.released = false

    this.targetedHazard = null
    this.targetedPiece = null
    this._highlightedMesh = null

    this.activeHazard = null
    this.activePiece = null
    this._priorPieceState = 'fallen'

    this._pickupStartWorldPos = new THREE.Vector3()
    this._pickupStartWorldQuat = new THREE.Quaternion()
    this._placeStartWorldPos = new THREE.Vector3()
    this._placeStartWorldQuat = new THREE.Quaternion()
    this._placeTarget = null

    this._feedbackMessage = null
    this._feedbackTimer = 0
    this._lastPlacementValid = false
    this._lastStateVersion = 0

    // Reusable scratch objects (zero per-frame heap allocations)
    this._raycaster = new THREE.Raycaster()
    this._raycaster.near = 0.05
    this._raycaster.far = 14
    this._ndc = new THREE.Vector2(0, 0)
    this._tmpVecA = new THREE.Vector3()
    this._tmpVecB = new THREE.Vector3()
    this._tmpVecC = new THREE.Vector3()
    this._tmpQuatA = new THREE.Quaternion()
    this._tmpQuatB = new THREE.Quaternion()
    this._tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    this._tmpForward = { x: 0, z: -1 }
    this._tmpRight = { x: 1, z: 0 }
    this._raycastTargets = []
    this._lastOcclMazeRef = null
    this._cachedMazeOccluders = []

    this._animOutput = {
      mode: RUBBLE_ANIM_MODES.NONE,
      progress: 0,
      slabHalfX: 0.34,
      slabHalfY: 0.08,
      slabHalfZ: 0.32,
      attached: false,
      released: false,
    }
  }

  getStateName() {
    return this.state
  }

  isActive() {
    return this.state !== RUBBLE_CONTROLLER_STATES.IDLE
  }

  isCarrying() {
    return (
      this.state === RUBBLE_CONTROLLER_STATES.CARRYING ||
      (this.state === RUBBLE_CONTROLLER_STATES.PICKING_UP && this.attached) ||
      (this.state === RUBBLE_CONTROLLER_STATES.PLACING && !this.released)
    )
  }

  isActionLocked() {
    return (
      this.state === RUBBLE_CONTROLLER_STATES.PICKING_UP ||
      this.state === RUBBLE_CONTROLLER_STATES.PLACING
    )
  }

  getMovementSpeedScale() {
    if (this.isCarrying()) {
      return RUBBLE_HANDLING_CONSTANTS.carrySpeedMultiplier
    }
    return 1.0
  }

  getAnimatorPayload() {
    const out = this._animOutput
    if (this.state === RUBBLE_CONTROLLER_STATES.PICKING_UP) {
      out.mode = RUBBLE_ANIM_MODES.PICKUP
      out.progress = this.progress
    } else if (this.state === RUBBLE_CONTROLLER_STATES.CARRYING) {
      out.mode = RUBBLE_ANIM_MODES.CARRY
      out.progress = 1
    } else if (this.state === RUBBLE_CONTROLLER_STATES.PLACING) {
      out.mode = RUBBLE_ANIM_MODES.PLACE
      out.progress = this.progress
    } else {
      out.mode = RUBBLE_ANIM_MODES.NONE
      out.progress = 0
    }
    out.slabHalfX = this.activePiece?.halfW ?? 0.34
    out.slabHalfY = this.activePiece?.halfY ?? 0.08
    out.slabHalfZ = this.activePiece?.halfD ?? 0.32
    out.attached = this.attached
    out.released = this.released
    return out
  }

  getInteractionSnapshot() {
    return {
      state: this.state,
      progress: Math.round(this.progress * 100) / 100,
      attached: this.attached,
      released: this.released,
      isCarrying: this.isCarrying(),
      targetedPieceId: this.targetedPiece?.pieceId || null,
      targetedHazardId: this.targetedHazard?.id || null,
      carriedPieceId: this.activePiece?.pieceId || null,
      carriedHazardId: this.activeHazard?.id || null,
      canPickup: Boolean(
        this.state === RUBBLE_CONTROLLER_STATES.IDLE && this.targetedPiece
      ),
      canPlace: Boolean(
        this.state === RUBBLE_CONTROLLER_STATES.CARRYING && this.activePiece
      ),
      placementValid: Boolean(
        this.state === RUBBLE_CONTROLLER_STATES.CARRYING && this._lastPlacementValid
      ),
      feedbackMessage: this._feedbackTimer > 0 ? this._feedbackMessage : null,
    }
  }

  _clearHighlight() {
    if (this._highlightedMesh) {
      const baseMat = this._highlightedMesh.userData?.baseMaterial
      if (baseMat && this._highlightedMesh.material !== baseMat) {
        this._highlightedMesh.material = baseMat
      }
      this._highlightedMesh = null
    }
  }

  _setHighlight(mesh) {
    if (this._highlightedMesh === mesh) return
    this._clearHighlight()
    if (!mesh) return
    const highlightMat = mesh.userData?.highlightMaterial
    if (highlightMat) {
      mesh.material = highlightMat
      this._highlightedMesh = mesh
    }
  }

  _rebuildMazeOccluderCache() {
    const mazeGroup = this.engine?._mazeGroup || null
    if (mazeGroup === this._lastOcclMazeRef) return
    this._lastOcclMazeRef = mazeGroup
    this._cachedMazeOccluders.length = 0
    if (!mazeGroup) return
    mazeGroup.traverse((obj) => {
      if (isMeshSolidRaycastOccluder(obj)) {
        this._cachedMazeOccluders.push(obj)
      }
    })
  }

  _collectRaycastTargets() {
    const targets = this._raycastTargets
    targets.length = 0

    const hazardManager = this.engine?.hazardManager
    if (!hazardManager) return false

    let hasAnyRubble = false
    const hazards = hazardManager.getHazards()
    for (let i = 0; i < hazards.length; i += 1) {
      const haz = hazards[i]
      if (!haz || haz.isDisposed) continue
      if (
        haz.type === HAZARD_TYPES.CEILING_COLLAPSE &&
        haz.isCollapsedForRubbleHandling()
      ) {
        const pieces = haz.getRubblePieces()
        for (let j = 0; j < pieces.length; j += 1) {
          const piece = pieces[j]
          if (
            piece &&
            piece.mesh &&
            piece.mesh.visible &&
            (piece.state === 'fallen' || piece.state === 'placed')
          ) {
            targets.push(piece.mesh)
            hasAnyRubble = true
          }
        }
      } else if (haz.mesh && haz.mesh.visible) {
        haz.mesh.traverse((obj) => {
          if (isMeshSolidRaycastOccluder(obj)) {
            targets.push(obj)
          }
        })
      }
    }

    if (!hasAnyRubble) {
      targets.length = 0
      return false
    }

    this._rebuildMazeOccluderCache()
    for (let i = 0; i < this._cachedMazeOccluders.length; i += 1) {
      targets.push(this._cachedMazeOccluders[i])
    }

    const hidingManager = this.engine?.hidingSpotManager
    if (hidingManager?.getHidingSpots) {
      const spots = hidingManager.getHidingSpots()
      for (let i = 0; i < spots.length; i += 1) {
        const spot = spots[i]
        if (!spot?.mesh || !spot.mesh.visible) continue
        spot.mesh.traverse((obj) => {
          if (isMeshSolidRaycastOccluder(obj)) {
            targets.push(obj)
          }
        })
      }
    }

    return true
  }

  _isGameplayBlocked() {
    const engine = this.engine
    if (
      !engine ||
      engine.isDisposed ||
      engine.isPaused ||
      engine.isGameOver ||
      engine.hasWon ||
      !engine._currentMaze ||
      engine.isSpawnSequenceActive?.() ||
      engine.isExtractionSequenceActive?.() ||
      engine.isLevelTransitionActive?.() ||
      engine._arrivalActive ||
      engine.hidingSpotManager?.isPlayerHiding?.() ||
      engine.electricalWiringController?.isActive?.()
    ) {
      return true
    }
    return false
  }

  /**
   * Casts a single Three.js ray at normalized screen coordinates (ndcX, ndcY)
   * and validates rubble eligibility, range, and analytical wall/prop LOS.
   */
  _raycastSingleNdc(ndcX, ndcY, camera, playerPos, maze, playerGroup) {
    this._ndc.set(ndcX, ndcY)
    this._raycaster.setFromCamera(this._ndc, camera)

    const hits = this._raycaster.intersectObjects(this._raycastTargets, false)
    let firstValidHit = null
    for (let i = 0; i < hits.length; i += 1) {
      const hit = hits[i]
      if (!hit?.object) continue
      if (playerGroup && isObjectDescendantOf(hit.object, playerGroup)) {
        continue
      }
      firstValidHit = hit
      break
    }

    if (!firstValidHit) return null

    const hitObj = firstValidHit.object
    const hitData = hitObj.userData
    if (
      !hitData?.isCeilingRubblePiece ||
      !hitData.isLargeRubble ||
      !hitData.hazardId ||
      !hitData.pieceId
    ) {
      // Closest hit was a wall, solid prop, floor, or unrelated geometry — blocked!
      return null
    }

    const engine = this.engine
    const hazard = engine.hazardManager.getHazard(hitData.hazardId)
    if (!hazard || !hazard.isCollapsedForRubbleHandling()) {
      return null
    }

    const piece = hazard.getRubblePiece(hitData.pieceId)
    if (!piece || (piece.state !== 'fallen' && piece.state !== 'placed')) {
      return null
    }

    // Distance check from player footprint to closest edge of the targeted slab
    const distToPiece = distancePointToOBB2D(
      playerPos.x,
      playerPos.z,
      piece.worldPos.x,
      piece.worldPos.z,
      piece.halfW,
      piece.halfD,
      piece.worldYaw
    )
    if (distToPiece > RUBBLE_HANDLING_CONSTANTS.interactionRange) {
      return null
    }

    // Analytical maze & prop line-of-sight guard prevents picking through walls or solid props
    const targetX = firstValidHit.point ? firstValidHit.point.x : piece.worldPos.x
    const targetZ = firstValidHit.point ? firstValidHit.point.z : piece.worldPos.z
    if (!hasLineOfSightInMaze(playerPos.x, playerPos.z, targetX, targetZ, maze)) {
      return null
    }
    if (
      engine._propCollisionIndex &&
      !hasUnobstructedPropLineOfSight(
        playerPos.x,
        playerPos.z,
        targetX,
        targetZ,
        engine._propCollisionIndex,
        { ignoreOwnerId: hazard.id }
      )
    ) {
      return null
    }

    return {
      hazard,
      piece,
      distance: distToPiece,
      hitPoint: firstValidHit.point,
    }
  }

  /**
   * Performs a Three.js camera raycast from the exact center crosshair (0, 0)
   * (with wall/prop occlusion and distance checks) to determine the single valid
   * Ceiling Collapse large rubble piece currently targeted.
   */
  updateTargeting() {
    if (
      this.isDisposed ||
      this._isGameplayBlocked() ||
      this.state !== RUBBLE_CONTROLLER_STATES.IDLE
    ) {
      this.targetedHazard = null
      this.targetedPiece = null
      this._clearHighlight()
      return null
    }

    const engine = this.engine
    const camera = engine.cameraRig?.camera || engine.camera
    const playerPos = engine._playerWorldPos
    const maze = engine._currentMaze
    if (!camera || !playerPos || !maze) {
      this.targetedHazard = null
      this.targetedPiece = null
      this._clearHighlight()
      return null
    }

    if (!this._collectRaycastTargets()) {
      this.targetedHazard = null
      this.targetedPiece = null
      this._clearHighlight()
      return null
    }

    // Ensure world matrices on camera, maze, and collapsed hazards are up-to-date before raycast
    camera.updateMatrixWorld(true)
    const hazards = engine.hazardManager.getHazards()
    for (let i = 0; i < hazards.length; i += 1) {
      if (hazards[i]?.type === HAZARD_TYPES.CEILING_COLLAPSE && hazards[i].mesh) {
        hazards[i].mesh.updateMatrixWorld(true)
      }
    }

    const playerGroup = engine._playerGroup

    // Single source of truth: always raycast from the exact center crosshair (NDC 0, 0)
    let result = this._raycastSingleNdc(
      0,
      0,
      camera,
      playerPos,
      maze,
      playerGroup
    )

    // In third-person mode, CameraRig's look-ahead point sits ~5.5m ahead of the
    // player with a floor-height clamp, so low floor slabs directly in front of the
    // character's feet project slightly below exact NDC (0, 0). When the player is looking
    // downward along the center crosshair axis, probe a tight vertical center-line column
    // (X === 0) using the exact same occluded Three.js raycaster so floor-level slabs right
    // ahead remain targetable while walls, solid props, range, and facing direction are
    // still strictly enforced.
    if (
      !result &&
      engine.cameraRig?.getMode?.() === CAMERA_MODES.THIRD_PERSON
    ) {
      const look =
        engine.cameraRig?.getCameraLookDirection?.() ||
        engine.cameraRig?.getLookDirection?.() ||
        { yaw: 0, pitch: 0 }
      if (look.pitch <= 0.12) {
        const fwdX = -Math.sin(look.yaw)
        const fwdZ = -Math.cos(look.yaw)
        const probeYs = [
          -0.05, -0.1, -0.15, -0.2, -0.25, -0.3, -0.35, -0.4, -0.45, -0.5,
        ]
        for (let p = 0; p < probeYs.length; p += 1) {
          const candidate = this._raycastSingleNdc(
            0,
            probeYs[p],
            camera,
            playerPos,
            maze,
            playerGroup
          )
          if (!candidate) continue
          const toX = candidate.piece.worldPos.x - playerPos.x
          const toZ = candidate.piece.worldPos.z - playerPos.z
          const toLen = Math.hypot(toX, toZ)
          if (toLen > 1e-4) {
            const dot = (toX * fwdX + toZ * fwdZ) / toLen
            if (dot < 0.7) continue
          }
          result = candidate
          break
        }
      }
    }

    if (!result) {
      this.targetedHazard = null
      this.targetedPiece = null
      this._clearHighlight()
      return null
    }

    this.targetedHazard = result.hazard
    this.targetedPiece = result.piece
    this._setHighlight(result.piece.mesh)
    return result
  }

  /**
   * Left-click primary action: begins physical pickup sequence on the center-crosshair targeted slab.
   */
  tryPickup() {
    if (this.isDisposed || this._isGameplayBlocked()) {
      return { handled: false, reason: 'blocked' }
    }
    if (this.state !== RUBBLE_CONTROLLER_STATES.IDLE) {
      return { handled: false, reason: 'busy' }
    }

    const hitInfo = this.updateTargeting()
    if (!hitInfo || !hitInfo.piece || !hitInfo.hazard) {
      return { handled: false, reason: 'no_valid_target' }
    }

    const { hazard, piece } = hitInfo
    this.activeHazard = hazard
    this.activePiece = piece
    this._priorPieceState = piece.state === 'placed' ? 'placed' : 'fallen'
    this.state = RUBBLE_CONTROLLER_STATES.PICKING_UP
    this.progress = 0
    this.attached = false
    this.released = false
    this._placeTarget = null
    this._feedbackMessage = null
    this._feedbackTimer = 0

    this._clearHighlight()
    this.targetedHazard = null
    this.targetedPiece = null

    piece.mesh.updateMatrixWorld(true)
    piece.mesh.getWorldPosition(this._pickupStartWorldPos)
    piece.mesh.getWorldQuaternion(this._pickupStartWorldQuat)

    // Keep slab grounded & solid on floor until actual lift-contact attach point (t = 0.52)
    hazard.setRubblePieceState(piece.pieceId, 'picking_up')

    this.engine.syncPlayerVisibility?.()
    this.engine._notifyStealthChange?.(true)
    return {
      handled: true,
      action: 'pickup_rubble',
      hazardId: hazard.id,
      pieceId: piece.pieceId,
    }
  }

  /**
   * Validates whether a rubble slab can be physically placed at (cx, cz, yaw) without
   * intersecting walls, the player, neighboring rubble, solid props, or enemies.
   */
  validatePlacementCandidate(cx, cz, yaw, piece) {
    const engine = this.engine
    const maze = engine?._currentMaze
    const playerPos = engine?._playerWorldPos
    if (!maze?.grid || !playerPos || !piece) {
      return { valid: false, reason: 'missing_context' }
    }

    const grid = maze.grid
    const rows = grid.length
    const cols = grid[0].length
    const originX = -(cols * CELL_SIZE) / 2
    const originZ = -(rows * CELL_SIZE) / 2

    const centerCell = worldToGrid(cx, cz, maze)
    if (!centerCell || !isWalkableGridCell(grid, centerCell.row, centerCell.col)) {
      return { valid: false, reason: 'inside_wall' }
    }

    const hw = piece.halfW
    const hd = piece.halfD
    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)
    const ux = cosY
    const uz = -sinY
    const vx = sinY
    const vz = cosY
    const wallPad = RUBBLE_HANDLING_CONSTANTS.wallClearance

    // 1. Verify all 4 slab corners + wall-clearance padded envelope stay strictly outside solid wall tiles
    const envX = Math.abs(ux) * hw + Math.abs(vx) * hd + wallPad
    const envZ = Math.abs(uz) * hw + Math.abs(vz) * hd + wallPad
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

    // Also verify line-of-sight from player to placement center (never place through a wall!)
    if (!hasLineOfSightInMaze(playerPos.x, playerPos.z, cx, cz, maze)) {
      return { valid: false, reason: 'wall_occluded' }
    }

    // 2. Verify slab never overlaps the player's own collision footprint
    const playerRadius = Number.isFinite(engine.movementConfig?.radius)
      ? engine.movementConfig.radius
      : PLAYER_RADIUS
    const distToPlayer = distancePointToOBB2D(
      playerPos.x,
      playerPos.z,
      cx,
      cz,
      hw,
      hd,
      yaw
    )
    if (distToPlayer < playerRadius + RUBBLE_HANDLING_CONSTANTS.playerClearancePad) {
      return { valid: false, reason: 'player_overlap' }
    }

    // 3. Verify slab never overlaps any enabled solid prop, hazard, hiding spot, or neighboring rubble
    const colIndex = engine._propCollisionIndex
    if (colIndex && Array.isArray(colIndex.colliders)) {
      const pad = RUBBLE_HANDLING_CONSTANTS.colliderClearancePad
      for (let i = 0; i < colIndex.colliders.length; i += 1) {
        const col = colIndex.colliders[i]
        if (!col || !col.enabled) continue
        if (col.id === piece.colliderId) continue
        // Fast AABB reject
        if (
          maxX + pad < col.minX ||
          minX - pad > col.maxX ||
          maxZ + pad < col.minZ ||
          minZ - pad > col.maxZ
        ) {
          continue
        }
        if (col.kind === COLLIDER_KIND_CIRCLE) {
          const d = distancePointToOBB2D(col.cx, col.cz, cx, cz, hw, hd, yaw)
          if (d < col.radius + pad) {
            return { valid: false, reason: 'collider_overlap' }
          }
        } else {
          if (
            obbsOverlap2D(
              cx,
              cz,
              hw,
              hd,
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
    }

    // 4. Verify slab never overlaps any active enemy
    const enemies = engine.enemyManager?.getEnemies?.()
    if (Array.isArray(enemies)) {
      for (let i = 0; i < enemies.length; i += 1) {
        const enemy = enemies[i]
        const ePos = enemy?.getPosition?.() || enemy?.position
        if (!ePos) continue
        const d = distancePointToOBB2D(ePos.x, ePos.z, cx, cz, hw, hd, yaw)
        if (d < 0.65) {
          return { valid: false, reason: 'enemy_overlap' }
        }
      }
    }

    const floorY = getElevatorFloorHeightAtWorld(cx, cz, maze)
    const restY =
      floorY +
      computeMinGroundedCenterY(piece.halfW, piece.halfY, piece.halfD, 0, yaw, 0)

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

  /**
   * Computes a valid local placement spot directly in front of the player (supporting
   * neat placement right against corridor walls, without ever teleporting to unrelated spots).
   */
  findValidPlacement(piece = this.activePiece) {
    const engine = this.engine
    const playerPos = engine?._playerWorldPos
    if (!piece || !playerPos) {
      return { valid: false, reason: 'missing_context' }
    }

    const yaw = this._getPlayerFacingYaw()
    const fwdX = -Math.sin(yaw)
    const fwdZ = -Math.cos(yaw)
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)

    const playerRadius = Number.isFinite(engine.movementConfig?.radius)
      ? engine.movementConfig.radius
      : PLAYER_RADIUS
    const preferredForward =
      playerRadius +
      Math.max(piece.halfW, piece.halfD) +
      RUBBLE_HANDLING_CONSTANTS.playerClearancePad +
      0.16

    const baseX = playerPos.x + fwdX * preferredForward
    const baseZ = playerPos.z + fwdZ * preferredForward

    // 1. First test the exact requested forward spot directly in front of player
    const direct = this.validatePlacementCandidate(baseX, baseZ, yaw, piece)
    if (direct.valid) {
      return direct
    }

    // 2. Bounded local adjustment around the requested spot (allows placing flush against a wall
    //    or beside another placed slab without ever teleporting across the corridor)
    const forwardDeltas = [0, -0.08, -0.16, -0.24, 0.12, 0.22, -0.32, 0.32]
    const lateralDeltas = [0, 0.18, -0.18, 0.34, -0.34, 0.48, -0.48]
    const yawCandidates = [yaw, yaw + Math.PI * 0.5]
    const maxOffset = RUBBLE_HANDLING_CONSTANTS.maxPlacementSearchRadius

    let bestCandidate = null
    let bestDistSq = Infinity

    for (let yi = 0; yi < yawCandidates.length; yi += 1) {
      const candYaw = yawCandidates[yi]
      for (let fi = 0; fi < forwardDeltas.length; fi += 1) {
        const df = forwardDeltas[fi]
        for (let li = 0; li < lateralDeltas.length; li += 1) {
          const dl = lateralDeltas[li]
          if (yi === 0 && fi === 0 && li === 0) continue
          const offsetDistSq = df * df + dl * dl
          if (offsetDistSq > maxOffset * maxOffset) continue
          if (offsetDistSq >= bestDistSq) continue

          const cx = baseX + fwdX * df + rightX * dl
          const cz = baseZ + fwdZ * df + rightZ * dl
          const res = this.validatePlacementCandidate(cx, cz, candYaw, piece)
          if (res.valid) {
            bestCandidate = res
            bestDistSq = offsetDistSq
          }
        }
      }
      if (bestCandidate) break
    }

    if (bestCandidate) {
      return bestCandidate
    }

    return { valid: false, reason: direct.reason || 'no_valid_placement' }
  }

  /**
   * Right-click secondary action: initiates controlled lowering & placement of carried rubble.
   */
  tryPlace() {
    if (this.isDisposed || this._isGameplayBlocked()) {
      return { handled: false, reason: 'blocked' }
    }
    if (this.state !== RUBBLE_CONTROLLER_STATES.CARRYING || !this.activePiece) {
      return { handled: false, reason: 'not_carrying' }
    }

    const placement = this.findValidPlacement(this.activePiece)
    if (!placement.valid) {
      // Refuse cleanly without losing or dropping the carried slab
      this._feedbackMessage = 'No clear floor space to place rubble'
      this._feedbackTimer = RUBBLE_HANDLING_CONSTANTS.feedbackDuration
      this._lastPlacementValid = false
      this.engine._notifyStealthChange?.(true)
      return {
        handled: false,
        reason: placement.reason || 'invalid_placement',
        pieceId: this.activePiece.pieceId,
      }
    }

    this._placeTarget = {
      x: placement.x,
      y: placement.y,
      z: placement.z,
      yaw: placement.yaw,
      row: placement.row,
      col: placement.col,
      quat: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, placement.yaw, 0, 'YXZ')
      ),
    }

    this.activePiece.mesh.updateMatrixWorld(true)
    this.activePiece.mesh.getWorldPosition(this._placeStartWorldPos)
    this.activePiece.mesh.getWorldQuaternion(this._placeStartWorldQuat)

    this.state = RUBBLE_CONTROLLER_STATES.PLACING
    this.progress = 0
    this.released = false
    this._feedbackMessage = null
    this._feedbackTimer = 0
    this.activeHazard?.setRubblePieceState(this.activePiece.pieceId, 'placing')

    this.engine._notifyStealthChange?.(true)
    return {
      handled: true,
      action: 'place_rubble',
      hazardId: this.activeHazard?.id || null,
      pieceId: this.activePiece.pieceId,
      target: {
        x: placement.x,
        y: placement.y,
        z: placement.z,
        yaw: placement.yaw,
      },
    }
  }

  /**
   * Handles WASD movement input during pickup or placement animations safely:
   *  - Pickup before attach  -> cleanly cancels; piece remains untouched in world.
   *  - Pickup after attach   -> transitions smoothly into CARRYING.
   *  - Placement before rel. -> cleanly cancels; piece stays in hands (CARRYING).
   *  - Placement after rel.  -> transitions smoothly to IDLE; placed piece stays permanently placed.
   */
  onMovementInput(hasMovementInput) {
    if (!hasMovementInput || this.isDisposed) return false

    if (this.state === RUBBLE_CONTROLLER_STATES.PICKING_UP) {
      if (!this.attached) {
        // Interrupted before hand-attach: restore piece cleanly at its untouched location
        if (this.activeHazard && this.activePiece) {
          this._applyWorldPoseToPieceMesh(
            this.activePiece.mesh,
            this._pickupStartWorldPos,
            this._pickupStartWorldQuat
          )
          this.activeHazard.setRubblePieceState(
            this.activePiece.pieceId,
            this._priorPieceState
          )
          this.engine._syncHazardColliders?.({ allowPushOut: false })
        }
        this.activeHazard = null
        this.activePiece = null
        this.state = RUBBLE_CONTROLLER_STATES.IDLE
        this.progress = 0
        this.attached = false
        this.released = false
        this.engine.syncPlayerVisibility?.()
        this.engine._notifyStealthChange?.(true)
        return true
      }

      // Interrupted after hand-attach: transition smoothly straight into carrying state
      this.state = RUBBLE_CONTROLLER_STATES.CARRYING
      this.progress = 1
      this.engine.syncPlayerVisibility?.()
      this.engine._notifyStealthChange?.(true)
      return true
    }

    if (this.state === RUBBLE_CONTROLLER_STATES.PLACING) {
      if (!this.released) {
        // Interrupted before release: cancel placement, keep slab securely carried in hands
        if (this.activeHazard && this.activePiece) {
          this.activeHazard.setRubblePieceState(this.activePiece.pieceId, 'carried')
          this.engine._syncHazardColliders?.({ allowPushOut: false })
        }
        this._placeTarget = null
        this.state = RUBBLE_CONTROLLER_STATES.CARRYING
        this.progress = 1
        this.engine.syncPlayerVisibility?.()
        this.engine._notifyStealthChange?.(true)
        return true
      }

      // Interrupted after release: placed piece stays permanently at its placed transform!
      this.activeHazard = null
      this.activePiece = null
      this._placeTarget = null
      this.state = RUBBLE_CONTROLLER_STATES.IDLE
      this.progress = 0
      this.attached = false
      this.released = false
      this.engine.syncPlayerVisibility?.()
      this.engine._notifyStealthChange?.(true)
      return true
    }

    return false
  }

  _getPlayerFacingYaw() {
    const engine = this.engine
    if (engine?._playerGroup && Number.isFinite(engine._playerGroup.rotation?.y)) {
      const isThirdFreeLook =
        engine.cameraRig?.getMode?.() === CAMERA_MODES.THIRD_PERSON &&
        engine.cameraRig?.isFreeLookActive?.()
      if (isThirdFreeLook) {
        return engine._playerGroup.rotation.y
      }
    }
    if (engine?.cameraRig?.getLookDirection) {
      return engine.cameraRig.getLookDirection().yaw
    }
    return engine?._playerGroup?.rotation?.y || 0
  }

  _applyWorldPoseToPieceMesh(mesh, worldPos, worldQuat) {
    if (!mesh || !mesh.parent) return
    const parent = mesh.parent
    parent.updateMatrixWorld(true)

    // Convert world position into parent local coordinates
    this._tmpVecC.copy(worldPos)
    parent.worldToLocal(this._tmpVecC)
    mesh.position.copy(this._tmpVecC)

    // Convert world quaternion into parent local orientation
    parent.getWorldQuaternion(this._tmpQuatB)
    this._tmpQuatB.invert().multiply(worldQuat)
    mesh.quaternion.copy(this._tmpQuatB)
    mesh.updateMatrixWorld(true)
  }

  _clampCarriedWorldPos(pos, piece) {
    const engine = this.engine
    const maze = engine?._currentMaze
    const playerPos = engine?._playerWorldPos
    if (!maze?.grid || !playerPos || !piece) return

    const floorY = getElevatorFloorHeightAtWorld(pos.x, pos.z, maze)
    const minY = floorY + piece.halfY + 0.08
    const maxY = floorY + WALL_HEIGHT - piece.halfY - 0.14
    pos.y = clamp(pos.y, minY, maxY)

    // Prevent carried slab from poking into adjacent solid maze walls
    const cell = worldToGrid(playerPos.x, playerPos.z, maze)
    if (!cell) return
    const grid = maze.grid
    const rows = grid.length
    const cols = grid[0].length
    const originX = -(cols * CELL_SIZE) / 2
    const originZ = -(rows * CELL_SIZE) / 2
    const cellMinX = originX + cell.col * CELL_SIZE
    const cellMaxX = cellMinX + CELL_SIZE
    const cellMinZ = originZ + cell.row * CELL_SIZE
    const cellMaxZ = cellMinZ + CELL_SIZE

    const margin = Math.max(piece.halfW, piece.halfD) + 0.06
    if (!isWalkableGridCell(grid, cell.row, cell.col - 1)) {
      pos.x = Math.max(pos.x, cellMinX + margin)
    }
    if (!isWalkableGridCell(grid, cell.row, cell.col + 1)) {
      pos.x = Math.min(pos.x, cellMaxX - margin)
    }
    if (!isWalkableGridCell(grid, cell.row - 1, cell.col)) {
      pos.z = Math.max(pos.z, cellMinZ + margin)
    }
    if (!isWalkableGridCell(grid, cell.row + 1, cell.col)) {
      pos.z = Math.min(pos.z, cellMaxZ - margin)
    }
  }

  _computeHandGripWorldPose(outPos, outQuat, piece) {
    const engine = this.engine
    const playerGroup = engine?._playerGroup
    const playerPos = engine?._playerWorldPos
    const rig = playerGroup?.userData?.rig
    const yaw = this._getPlayerFacingYaw()
    const fwdX = -Math.sin(yaw)
    const fwdZ = -Math.cos(yaw)
    const isFirstPerson = engine?.cameraRig?.getMode?.() === CAMERA_MODES.FIRST_PERSON

    if (playerGroup) {
      playerGroup.updateMatrixWorld(true)
    }

    if (isFirstPerson && engine?.cameraRig?.camera) {
      // First-person camera-safe cradle: keeps slab + hands comfortably visible in lower-forward view
      // without clipping the camera near plane or obscuring the entire corridor ahead
      const cam = engine.cameraRig.camera
      cam.updateMatrixWorld(true)
      const look = engine.cameraRig.getLookDirection?.() || { yaw, pitch: 0 }
      const carryPitch = clamp(look.pitch * 0.45, -0.35, 0.28)
      const forwardDist = 0.62
      const downOffset = -0.36

      const cosP = Math.cos(carryPitch)
      const sinP = Math.sin(carryPitch)
      outPos.set(
        cam.position.x + fwdX * forwardDist * cosP,
        cam.position.y + downOffset + sinP * forwardDist * 0.55,
        cam.position.z + fwdZ * forwardDist * cosP
      )
      this._tmpEuler.set(carryPitch * 0.65 + 0.08, yaw, 0, 'YXZ')
      outQuat.setFromEuler(this._tmpEuler)
      this._clampCarriedWorldPos(outPos, piece)
      return
    }

    if (rig?.leftWristPivot && rig?.rightWristPivot) {
      rig.leftWristPivot.getWorldPosition(this._tmpVecA)
      rig.rightWristPivot.getWorldPosition(this._tmpVecB)
      outPos.copy(this._tmpVecA).add(this._tmpVecB).multiplyScalar(0.5)
      // Offset slightly forward into palms so fingers wrap cleanly around slab edges
      const palmForward = Math.max(0.08, (piece?.halfD || 0.3) * 0.34)
      outPos.x += fwdX * palmForward
      outPos.y -= 0.02
      outPos.z += fwdZ * palmForward

      const carryTiltX = this.state === RUBBLE_CONTROLLER_STATES.CARRYING ? 0.08 : 0.04
      this._tmpEuler.set(carryTiltX, yaw, 0, 'YXZ')
      outQuat.setFromEuler(this._tmpEuler)
      this._clampCarriedWorldPos(outPos, piece)
      return
    }

    // Fallback cradle pose anchored in front of player torso
    const baseY = Number.isFinite(playerPos?.y) ? playerPos.y : 0
    outPos.set(
      (playerPos?.x || 0) + fwdX * 0.52,
      baseY + 0.96,
      (playerPos?.z || 0) + fwdZ * 0.52
    )
    this._tmpEuler.set(0.08, yaw, 0, 'YXZ')
    outQuat.setFromEuler(this._tmpEuler)
    this._clampCarriedWorldPos(outPos, piece)
  }

  /**
   * Advances state machine timers and targeting BEFORE PlayerAnimator updates the rig.
   */
  update(delta = 0) {
    if (this.isDisposed) return

    const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0

    if (this._feedbackTimer > 0) {
      this._feedbackTimer = Math.max(0, this._feedbackTimer - dt)
      if (this._feedbackTimer <= 0) {
        this._feedbackMessage = null
      }
    }

    if (this._isGameplayBlocked()) {
      this._clearHighlight()
      this.targetedHazard = null
      this.targetedPiece = null
      return
    }

    if (this.state === RUBBLE_CONTROLLER_STATES.IDLE) {
      this.updateTargeting()
      return
    }

    if (this.state === RUBBLE_CONTROLLER_STATES.PICKING_UP) {
      if (!this.activeHazard || !this.activePiece || this.activeHazard.isDisposed) {
        this.reset()
        return
      }

      // Gently turn character toward targeted slab during anticipation/reach
      if (this.progress < 0.45 && this.engine?._playerGroup && this.engine._playerWorldPos) {
        const dx = this._pickupStartWorldPos.x - this.engine._playerWorldPos.x
        const dz = this._pickupStartWorldPos.z - this.engine._playerWorldPos.z
        if (dx * dx + dz * dz > 1e-4) {
          const targetYaw = Math.atan2(-dx, -dz)
          const curYaw = this.engine._playerGroup.rotation.y
          const diff = Math.atan2(
            Math.sin(targetYaw - curYaw),
            Math.cos(targetYaw - curYaw)
          )
          const turnAlpha = dt > 0 ? 1 - Math.exp(-10 * dt) : 1
          const nextYaw = curYaw + diff * turnAlpha
          this.engine._playerGroup.rotation.y = nextYaw
          if (this.engine.cameraRig?.isFreeLookActive?.()) {
            this.engine.cameraRig.setCharacterYaw?.(nextYaw)
          }
        }
      }

      this.progress = Math.min(
        1,
        this.progress + dt / RUBBLE_HANDLING_CONSTANTS.pickupDuration
      )

      if (
        !this.attached &&
        this.progress >= RUBBLE_HANDLING_CONSTANTS.pickupAttachProgress
      ) {
        // Exact lift-contact moment: attach piece to hands & remove floor collider for THIS piece only
        this.attached = true
        this.activeHazard.setRubblePieceState(this.activePiece.pieceId, 'carried')
        this.engine._syncHazardColliders?.({ allowPushOut: false })
        this.engine._notifyStealthChange?.(true)
      }

      if (this.progress >= 1) {
        this.state = RUBBLE_CONTROLLER_STATES.CARRYING
        this.progress = 1
        this._lastPlacementValid = this.findValidPlacement(this.activePiece).valid
        this.engine._notifyStealthChange?.(true)
      }
      return
    }

    if (this.state === RUBBLE_CONTROLLER_STATES.CARRYING) {
      if (!this.activeHazard || !this.activePiece || this.activeHazard.isDisposed) {
        this.reset()
        return
      }
      // Smoothly align character body with camera heading while carrying in follow mode
      // so turning toward a corridor wall naturally rotates hands and held rubble together.
      if (
        this.engine?._playerGroup &&
        this.engine.cameraRig?.getLookDirection &&
        !this.engine.cameraRig?.isFreeLookActive?.()
      ) {
        const targetYaw = this.engine.cameraRig.getLookDirection().yaw
        const curYaw = this.engine._playerGroup.rotation.y
        const diff = Math.atan2(
          Math.sin(targetYaw - curYaw),
          Math.cos(targetYaw - curYaw)
        )
        const turnAlpha = dt > 0 ? 1 - Math.exp(-12 * dt) : 1
        this.engine._playerGroup.rotation.y = curYaw + diff * turnAlpha
      }
      // Keep live placement validity indicator fresh for subtle aiming feedback
      this._lastPlacementValid = this.findValidPlacement(this.activePiece).valid
      return
    }

    if (this.state === RUBBLE_CONTROLLER_STATES.PLACING) {
      if (
        !this.activeHazard ||
        !this.activePiece ||
        !this._placeTarget ||
        this.activeHazard.isDisposed
      ) {
        this.reset()
        return
      }

      if (
        this.progress < 0.45 &&
        this.engine?._playerGroup &&
        this.engine._playerWorldPos
      ) {
        const dx = this._placeTarget.x - this.engine._playerWorldPos.x
        const dz = this._placeTarget.z - this.engine._playerWorldPos.z
        if (dx * dx + dz * dz > 1e-4) {
          const targetYaw = Math.atan2(-dx, -dz)
          const curYaw = this.engine._playerGroup.rotation.y
          const diff = Math.atan2(
            Math.sin(targetYaw - curYaw),
            Math.cos(targetYaw - curYaw)
          )
          const turnAlpha = dt > 0 ? 1 - Math.exp(-12 * dt) : 1
          this.engine._playerGroup.rotation.y = curYaw + diff * turnAlpha
        }
      }

      this.progress = Math.min(
        1,
        this.progress + dt / RUBBLE_HANDLING_CONSTANTS.placeDuration
      )

      if (
        !this.released &&
        this.progress >= RUBBLE_HANDLING_CONSTANTS.placeReleaseProgress
      ) {
        // Exact release moment: place slab solidly on floor & restore world-space collision
        this.released = true
        const target = this._placeTarget
        this._tmpVecA.set(target.x, target.y, target.z)
        this._applyWorldPoseToPieceMesh(
          this.activePiece.mesh,
          this._tmpVecA,
          target.quat
        )
        this.activeHazard.setRubblePieceState(this.activePiece.pieceId, 'placed', {
          x: target.x,
          y: target.y,
          z: target.z,
          yaw: target.yaw,
        })
        this.engine._syncHazardColliders?.({ allowPushOut: false })
        this.engine._notifyStealthChange?.(true)
      }

      if (this.progress >= 1) {
        this.activeHazard = null
        this.activePiece = null
        this._placeTarget = null
        this.state = RUBBLE_CONTROLLER_STATES.IDLE
        this.progress = 0
        this.attached = false
        this.released = false
        this.engine.syncPlayerVisibility?.()
        this.engine._notifyStealthChange?.(true)
      }
    }
  }

  /**
   * Synchronizes the actively lifted/carried/lowered rubble slab transform to the freshly-posed
   * character hands. MUST be called right after `PlayerAnimator.update(...)`.
   */
  syncCarriedMeshToHands() {
    if (this.isDisposed || !this.activePiece?.mesh) return

    const piece = this.activePiece
    const mesh = piece.mesh

    if (this.state === RUBBLE_CONTROLLER_STATES.PICKING_UP) {
      if (!this.attached) {
        // Before attach moment: slab stays solidly resting on the floor (zero teleport!)
        this._applyWorldPoseToPieceMesh(
          mesh,
          this._pickupStartWorldPos,
          this._pickupStartWorldQuat
        )
        return
      }
      // Smoothly lift slab from floor contact pose into full hand-grip cradle
      const attachP = RUBBLE_HANDLING_CONSTANTS.pickupAttachProgress
      const liftT = smoothstep01((this.progress - attachP) / Math.max(0.01, 1 - attachP))
      this._computeHandGripWorldPose(this._tmpVecA, this._tmpQuatA, piece)
      this._tmpVecB.lerpVectors(this._pickupStartWorldPos, this._tmpVecA, liftT)
      this._tmpQuatB.copy(this._pickupStartWorldQuat).slerp(this._tmpQuatA, liftT)
      this._applyWorldPoseToPieceMesh(mesh, this._tmpVecB, this._tmpQuatB)
      return
    }

    if (this.state === RUBBLE_CONTROLLER_STATES.CARRYING) {
      this._computeHandGripWorldPose(this._tmpVecA, this._tmpQuatA, piece)
      this._applyWorldPoseToPieceMesh(mesh, this._tmpVecA, this._tmpQuatA)
      return
    }

    if (this.state === RUBBLE_CONTROLLER_STATES.PLACING && this._placeTarget) {
      if (!this.released) {
        // Controlled lowering from carry hands all the way down to validated floor target
        const relP = RUBBLE_HANDLING_CONSTANTS.placeReleaseProgress
        const lowerT = smoothstep01(this.progress / Math.max(0.01, relP))
        this._computeHandGripWorldPose(this._tmpVecA, this._tmpQuatA, piece)
        // Track current player hand grip at start and blend smoothly onto target floor spot
        this._tmpVecB.set(
          this._placeTarget.x,
          this._placeTarget.y,
          this._placeTarget.z
        )
        this._tmpVecA.lerp(this._tmpVecB, lowerT)
        this._tmpQuatA.slerp(this._placeTarget.quat, lowerT)
        this._applyWorldPoseToPieceMesh(mesh, this._tmpVecA, this._tmpQuatA)
      } else {
        // After release: firmly grounded at exact placed transform
        this._tmpVecA.set(
          this._placeTarget.x,
          this._placeTarget.y,
          this._placeTarget.z
        )
        this._applyWorldPoseToPieceMesh(mesh, this._tmpVecA, this._placeTarget.quat)
      }
    }
  }

  /**
   * Cancels any active handling and clears transient targeting/carry state (used on reset/death/maze swap).
   */
  reset() {
    this._clearHighlight()
    if (
      this.activeHazard &&
      this.activePiece &&
      !this.activeHazard.isDisposed &&
      this.state !== RUBBLE_CONTROLLER_STATES.IDLE &&
      !this.released
    ) {
      // Restore carried/in-progress piece to its hazard state if hazard wasn't already reset
      const restoreState =
        this.activePiece.state === 'carried' ||
        this.activePiece.state === 'picking_up' ||
        this.activePiece.state === 'placing'
          ? this._priorPieceState
          : this.activePiece.state
      if (restoreState === 'fallen' || restoreState === 'placed') {
        this._applyWorldPoseToPieceMesh(
          this.activePiece.mesh,
          this._pickupStartWorldPos,
          this._pickupStartWorldQuat
        )
        this.activeHazard.setRubblePieceState(this.activePiece.pieceId, restoreState)
      }
    }

    this.state = RUBBLE_CONTROLLER_STATES.IDLE
    this.progress = 0
    this.attached = false
    this.released = false
    this.targetedHazard = null
    this.targetedPiece = null
    this.activeHazard = null
    this.activePiece = null
    this._placeTarget = null
    this._feedbackMessage = null
    this._feedbackTimer = 0
    this._lastPlacementValid = false
    this._lastOcclMazeRef = null
    this._cachedMazeOccluders.length = 0
    this._raycastTargets.length = 0
  }

  dispose() {
    if (this.isDisposed) return
    this.reset()
    this.isDisposed = true
    this.engine = null
  }
}
