import { placeHidingSpots } from '../generation/hidingSpotPlacement.js'
import { HidingSpotAgent } from './HidingSpotAgent.js'

/**
 * Orchestrates multiple 3D hiding spots, proximity interaction targeting,
 * occupied stealth tracking, maze replacement, and resource disposal.
 */
export class HidingSpotManager {
  constructor(scene = null) {
    this.scene = scene
    this.maze = null
    this.spots = new Map()
    this.activeSpotId = null
    this.nearbySpotId = null
    this.entryPlayerPos = null
    this.entryYaw = 0
    this.isDisposed = false
  }

  setScene(scene) {
    this.scene = scene || null
  }

  getHidingSpots() {
    return Array.from(this.spots.values())
  }

  getHidingSpot(id) {
    return this.spots.get(id) || null
  }

  getActiveHidingSpot() {
    return this.activeSpotId ? this.spots.get(this.activeSpotId) || null : null
  }

  isPlayerHidden() {
    return Boolean(this.activeSpotId && this.spots.has(this.activeSpotId))
  }

  /**
   * Manually spawns a hiding spot (useful for unit tests or custom placements).
   */
  addHidingSpot(spotSpec) {
    if (this.isDisposed || !spotSpec) return null
    const agent = new HidingSpotAgent(spotSpec, this.maze)
    const mesh = agent.getMesh()
    if (mesh && this.scene) {
      this.scene.add(mesh)
    }
    this.spots.set(agent.id, agent)
    return agent
  }

  findNearestInteractable(playerWorldPos, playerGridCell = null) {
    if (this.isDisposed || !playerWorldPos || this.spots.size === 0) {
      return null
    }

    let nearest = null
    let nearestDist = Infinity

    for (const spot of this.spots.values()) {
      if (!spot.isPlayerInRange(playerWorldPos, playerGridCell)) {
        continue
      }
      const dist = spot.getInteractDistance(playerWorldPos)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = spot
      }
    }

    return nearest
  }

  enterHidingSpot(spotOrId, playerWorldPos = null, playerYaw = 0) {
    if (this.isDisposed || this.isPlayerHidden()) {
      return null
    }

    const spot =
      typeof spotOrId === 'string' ? this.getHidingSpot(spotOrId) : spotOrId
    if (!spot || spot.isDisposed || !this.spots.has(spot.id)) {
      return null
    }

    this.activeSpotId = spot.id
    this.nearbySpotId = spot.id
    this.entryPlayerPos = playerWorldPos
      ? {
          x: Number(playerWorldPos.x) || 0,
          y: Number(playerWorldPos.y) || 0,
          z: Number(playerWorldPos.z) || 0,
        }
      : spot.getSafeExitPosition()
    this.entryYaw = Number.isFinite(playerYaw) ? playerYaw : spot.facingYaw

    for (const s of this.spots.values()) {
      s.setOccupied(s.id === spot.id)
      s.setHighlighted(false)
    }

    return {
      spot,
      interiorPos: {
        x: spot.worldPos.x,
        y: spot.config.hiddenEyeOffsetY,
        z: spot.worldPos.z,
      },
      facingYaw: spot.facingYaw,
    }
  }

  exitHidingSpot() {
    if (this.isDisposed || !this.isPlayerHidden()) {
      return null
    }

    const spot = this.getActiveHidingSpot()
    const preferredReturn = this.entryPlayerPos

    this.activeSpotId = null
    this.entryPlayerPos = null

    if (!spot) {
      return null
    }

    spot.setOccupied(false)
    const exitPos = spot.getSafeExitPosition(preferredReturn)

    return {
      spot,
      exitPos,
      restoreYaw: this.entryYaw,
    }
  }

  resetStates() {
    if (this.isDisposed) return
    this.activeSpotId = null
    this.nearbySpotId = null
    this.entryPlayerPos = null
    this.entryYaw = 0
    for (const spot of this.spots.values()) {
      spot.resetState()
    }
  }

  clear() {
    this.activeSpotId = null
    this.nearbySpotId = null
    this.entryPlayerPos = null
    this.entryYaw = 0

    for (const spot of this.spots.values()) {
      spot.dispose()
    }
    this.spots.clear()
  }

  setMaze(maze, options = {}) {
    if (this.isDisposed) return
    this.clear()
    this.maze = maze || null

    if (!maze) return

    const specs = placeHidingSpots(maze, options)
    for (let i = 0; i < specs.length; i += 1) {
      const agent = new HidingSpotAgent(specs[i], maze)
      const mesh = agent.getMesh()
      if (mesh && this.scene) {
        this.scene.add(mesh)
      }
      this.spots.set(agent.id, agent)
    }
  }

  update(delta = 0.016, playerContext = null) {
    if (this.isDisposed || this.spots.size === 0) {
      this.nearbySpotId = null
      return {
        isHidden: false,
        canInteract: false,
        nearbySpotId: null,
        nearbySpotType: null,
        occupiedSpotId: null,
      }
    }

    const hidden = this.isPlayerHidden()
    let nearest = null
    if (!hidden && playerContext?.playerWorldPos) {
      nearest = this.findNearestInteractable(
        playerContext.playerWorldPos,
        playerContext.playerGridCell
      )
    }

    this.nearbySpotId = hidden ? this.activeSpotId : nearest?.id || null

    for (const spot of this.spots.values()) {
      const isOccupied = hidden && spot.id === this.activeSpotId
      const isHighlighted = !hidden && nearest && spot.id === nearest.id
      spot.setOccupied(isOccupied)
      spot.setHighlighted(Boolean(isHighlighted))
      spot.update(delta)
    }

    const activeSpot = this.getActiveHidingSpot()
    return {
      isHidden: hidden,
      canInteract: hidden || Boolean(nearest),
      nearbySpotId: this.nearbySpotId,
      nearbySpotType: activeSpot?.type || nearest?.type || null,
      occupiedSpotId: this.activeSpotId,
    }
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this.clear()
    this.scene = null
    this.maze = null
    return true
  }
}
