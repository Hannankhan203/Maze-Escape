import { resolveGridCollision } from '../world/gridCollision.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld, worldToGrid } from '../world/worldCoords.js'
import { HIDING_SPOT_TYPES } from '../generation/hidingSpotPlacement.js'
import {
  buildHidingSpotMesh,
  disposeHidingSpotMesh,
  updateHidingSpotVisualState,
} from './buildHidingSpots.js'

export const DEFAULT_HIDING_SPOT_CONFIG = {
  interactRange: 2.65,
  wallOffsetDistance: 1.15,
  exitForwardDistance: 1.05,
  hiddenEyeOffsetY: -0.22,
}

/**
 * Autonomous hiding spot entity in the 3D maze supporting interaction range
 * checks, occupied state, visual highlighting, and leak-free disposal.
 */
export class HidingSpotAgent {
  constructor(spotData = {}, maze = null, options = {}) {
    this.id =
      spotData.id ||
      `hide-${spotData.type || 'locker'}-${spotData.row ?? 0}-${spotData.col ?? 0}`
    this.type = spotData.type || HIDING_SPOT_TYPES.CONTAINMENT_LOCKER
    this.row = spotData.row
    this.col = spotData.col
    this.maze = maze
    this.isDisposed = false

    this.config = {
      ...DEFAULT_HIDING_SPOT_CONFIG,
      ...(spotData?.config || {}),
      ...(options?.config || {}),
    }

    this.facingYaw = Number.isFinite(spotData.facingYaw) ? spotData.facingYaw : 0
    this.offsetDir = spotData.offsetDir || { dRow: 0, dCol: 0 }

    const cellCenter = gridToWorld(this.row, this.col, this.maze)
    this.cellWorldPos = cellCenter
      ? { x: cellCenter.x, y: 0, z: cellCenter.z }
      : { x: 0, y: 0, z: 0 }

    const offsetMag = Math.min(
      CELL_SIZE * 0.32,
      Math.max(0, Number(this.config.wallOffsetDistance) || 0)
    )
    this.worldPos = {
      x: this.cellWorldPos.x + (this.offsetDir.dCol || 0) * offsetMag,
      y: 0,
      z: this.cellWorldPos.z + (this.offsetDir.dRow || 0) * offsetMag,
    }

    this.isHighlighted = false
    this.isOccupied = false

    this.mesh = buildHidingSpotMesh({
      id: this.id,
      type: this.type,
    })

    if (this.mesh) {
      this.mesh.position.set(this.worldPos.x, 0, this.worldPos.z)
      this.mesh.rotation.y = this.facingYaw
      updateHidingSpotVisualState(this.mesh, {
        isHighlighted: false,
        isOccupied: false,
        delta: 1,
      })
    }
  }

  getMesh() {
    return this.mesh
  }

  getPosition() {
    return { ...this.worldPos }
  }

  getInteractDistance(playerWorldPos) {
    if (!playerWorldPos) return Infinity
    return Math.hypot(
      playerWorldPos.x - this.worldPos.x,
      playerWorldPos.z - this.worldPos.z
    )
  }

  isPlayerInRange(playerWorldPos, playerGridCell = null) {
    if (this.isDisposed || !playerWorldPos) return false
    const dist = this.getInteractDistance(playerWorldPos)
    if (dist <= this.config.interactRange) {
      return true
    }

    const cell =
      playerGridCell ||
      (this.maze ? worldToGrid(playerWorldPos.x, playerWorldPos.z, this.maze) : null)
    return Boolean(
      cell &&
        Number.isInteger(this.row) &&
        Number.isInteger(this.col) &&
        cell.row === this.row &&
        cell.col === this.col
    )
  }

  getSafeExitPosition(preferredReturnPos = null) {
    if (!this.maze) {
      return { ...this.cellWorldPos }
    }

    if (
      preferredReturnPos &&
      Number.isFinite(preferredReturnPos.x) &&
      Number.isFinite(preferredReturnPos.z)
    ) {
      const resolved = resolveGridCollision(
        preferredReturnPos.x,
        preferredReturnPos.z,
        this.maze,
        { radius: PLAYER_RADIUS }
      )
      return { x: resolved.x, y: 0, z: resolved.z }
    }

    const forwardX = -Math.sin(this.facingYaw)
    const forwardZ = -Math.cos(this.facingYaw)
    const dist = this.config.exitForwardDistance || 1.05
    const resolved = resolveGridCollision(
      this.worldPos.x + forwardX * dist,
      this.worldPos.z + forwardZ * dist,
      this.maze,
      { radius: PLAYER_RADIUS }
    )
    return { x: resolved.x, y: 0, z: resolved.z }
  }

  setHighlighted(highlighted) {
    this.isHighlighted = Boolean(highlighted)
  }

  setOccupied(occupied) {
    this.isOccupied = Boolean(occupied)
  }

  resetState() {
    if (this.isDisposed) return
    this.isHighlighted = false
    this.isOccupied = false
    if (this.mesh) {
      updateHidingSpotVisualState(this.mesh, {
        isHighlighted: false,
        isOccupied: false,
        delta: 1,
      })
    }
  }

  update(delta = 0.016) {
    if (this.isDisposed || !this.mesh) return
    updateHidingSpotVisualState(this.mesh, {
      isHighlighted: this.isHighlighted,
      isOccupied: this.isOccupied,
      delta,
    })
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this.isHighlighted = false
    this.isOccupied = false

    if (this.mesh) {
      disposeHidingSpotMesh(this.mesh)
      this.mesh = null
    }
    this.maze = null
    return true
  }
}
