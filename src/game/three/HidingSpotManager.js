import { placeHidingSpotsWithReport } from '../generation/hidingSpotPlacement.js'
import {
  getDynamicCollider,
  registerDynamicCollider,
  unregisterDynamicCollider,
  unregisterDynamicCollidersByOwner,
  updateDynamicCollider,
} from '../world/propCollision.js'
import { HidingSpotAgent } from './HidingSpotAgent.js'

const EMPTY_UPDATE_RESULT = Object.freeze({
  ejected: null,
  warningTriggered: false,
  collidersDirty: false,
})

/**
 * Manages all procedural hiding spots in the active 3D maze scene,
 * coordinating dynamic colliders, occupancy transitions, audio cue metadata,
 * and enemy perception context.
 */
export class HidingSpotManager {
  constructor(scene = null) {
    this.scene = scene
    this.maze = null
    this.spots = new Map()
    this.activeSpotId = null
    this.isDisposed = false
    this._syncedCollisionIndex = null
    this._syncedVersions = new Map()
    this._registeredColliderIds = new Map()
    this._collidersDirty = false
    this._qualityPreset = 'high'
    this.selectedTypes = []
    this.placementReport = null
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

  getActiveSpot() {
    return this.activeSpotId ? this.spots.get(this.activeSpotId) || null : null
  }

  isPlayerHiding() {
    const active = this.getActiveSpot()
    return Boolean(active && !active.isDisposed && active.isOccupied)
  }

  getSelectedTypes() {
    return [...this.selectedTypes]
  }

  getPlacementReport() {
    return this.placementReport
  }

  addHidingSpot(spec) {
    if (this.isDisposed || !spec) return null
    const agent = new HidingSpotAgent(spec, this.maze)
    if (this._qualityPreset) {
      agent.syncQuality(this._qualityPreset)
    }
    if (this.spots.has(agent.id)) {
      this.removeHidingSpot(agent.id)
    }
    const mesh = agent.getMesh()
    if (mesh && this.scene) {
      this.scene.add(mesh)
    }
    this.spots.set(agent.id, agent)
    this._collidersDirty = true
    return agent
  }

  removeHidingSpot(id) {
    const spot = this.spots.get(id)
    if (!spot) return false
    if (this.activeSpotId === id) {
      this.activeSpotId = null
    }
    if (this._syncedCollisionIndex) {
      unregisterDynamicCollidersByOwner(this._syncedCollisionIndex, spot.id)
    }
    this._syncedVersions.delete(spot.id)
    this._registeredColliderIds.delete(spot.id)
    spot.dispose()
    this.spots.delete(id)
    this._collidersDirty = true
    return true
  }

  detachFromCollisionIndex(collisionIndex = null) {
    const targetIndex = collisionIndex || this._syncedCollisionIndex
    if (targetIndex && this._registeredColliderIds.size > 0) {
      for (const spotId of this._registeredColliderIds.keys()) {
        unregisterDynamicCollidersByOwner(targetIndex, spotId)
      }
    }
    this._syncedVersions.clear()
    this._registeredColliderIds.clear()
    if (!collisionIndex || collisionIndex === this._syncedCollisionIndex) {
      this._syncedCollisionIndex = null
    }
    this._collidersDirty = this.spots.size > 0
  }

  clear() {
    this.detachFromCollisionIndex()
    this.activeSpotId = null
    for (const spot of this.spots.values()) {
      spot.dispose()
    }
    this.spots.clear()
    this.selectedTypes = []
    this.placementReport = null
    this._collidersDirty = false
  }

  setMaze(maze, options = undefined) {
    if (this.isDisposed) return
    this.clear()
    this.maze = maze || null
    if (!maze) return

    const hasExplicitPlacementOptions = Boolean(
      options &&
        (Array.isArray(options.hidingSpots) ||
          Array.isArray(options.hazards) ||
          options.hidingConfig !== undefined ||
          options.hidingSpotSelection !== undefined ||
          options.hidingSpotAllocation !== undefined ||
          options.seed !== undefined ||
          options.level !== undefined)
    )

    let specs
    if (Array.isArray(options?.hidingSpots)) {
      specs = options.hidingSpots
      this.placementReport = null
      this.selectedTypes = Array.from(new Set(specs.map((s) => s?.type).filter(Boolean)))
    } else if (!hasExplicitPlacementOptions && Array.isArray(maze.hidingSpots)) {
      specs = maze.hidingSpots
      this.placementReport = maze.hidingSpotPlacementReport || null
      this.selectedTypes = Array.isArray(maze.hidingSpotSelection?.selectedTypes)
        ? [...maze.hidingSpotSelection.selectedTypes]
        : Array.from(new Set(specs.map((s) => s?.type).filter(Boolean)))
    } else {
      const placed = placeHidingSpotsWithReport(maze, options)
      specs = placed.hidingSpots
      this.placementReport = placed.report
      this.selectedTypes = Array.isArray(placed.selection?.selectedTypes)
        ? [...placed.selection.selectedTypes]
        : Array.from(new Set(specs.map((s) => s?.type).filter(Boolean)))
    }

    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i]
      const agent = new HidingSpotAgent(spec, maze)
      if (this._qualityPreset) {
        agent.syncQuality(this._qualityPreset)
      }
      const mesh = agent.getMesh()
      if (mesh && this.scene) {
        this.scene.add(mesh)
      }
      this.spots.set(agent.id, agent)
    }
    this._collidersDirty = this.spots.size > 0
  }

  resetStates() {
    if (this.isDisposed) return
    this.activeSpotId = null
    for (const spot of this.spots.values()) {
      spot.resetState()
    }
    this._collidersDirty = true
    if (this._syncedCollisionIndex) {
      this.syncCollidersToIndex(this._syncedCollisionIndex, this.maze)
    }
  }

  syncQuality(qualityPreset = 'high') {
    this._qualityPreset = qualityPreset || 'high'
    for (const spot of this.spots.values()) {
      spot.syncQuality(this._qualityPreset)
    }
  }

  syncCollidersToIndex(collisionIndex) {
    if (this.isDisposed || !collisionIndex) {
      return { changed: false }
    }

    const indexChanged = collisionIndex !== this._syncedCollisionIndex
    if (indexChanged) {
      if (this._syncedCollisionIndex) {
        this.detachFromCollisionIndex(this._syncedCollisionIndex)
      }
      this._syncedCollisionIndex = collisionIndex
      this._collidersDirty = true
    }

    if (!this._collidersDirty) {
      let drift = false
      for (const spot of this.spots.values()) {
        if (this._syncedVersions.get(spot.id) !== spot.getColliderVersion()) {
          drift = true
          break
        }
      }
      if (!drift) {
        return { changed: false }
      }
    }

    let changed = false
    for (const spot of this.spots.values()) {
      const version = spot.getColliderVersion()
      if (!indexChanged && this._syncedVersions.get(spot.id) === version) {
        continue
      }
      const specs = spot.getColliderSpecs()
      let registeredIds = this._registeredColliderIds.get(spot.id)
      if (!registeredIds) {
        registeredIds = new Set()
        this._registeredColliderIds.set(spot.id, registeredIds)
      }
      const seen = new Set()

      for (let i = 0; i < specs.length; i += 1) {
        const spec = specs[i]
        seen.add(spec.id)
        const existing = getDynamicCollider(collisionIndex, spec.id)
        if (!existing) {
          const ok = registerDynamicCollider(collisionIndex, {
            id: spec.id,
            ownerId: spot.id,
            propId: spot.id,
            propType: `hiding_${spot.type}`,
            row: spec.row,
            col: spec.col,
            kind: spec.kind,
            cx: spec.cx,
            cz: spec.cz,
            halfW: spec.halfW,
            halfD: spec.halfD,
            yaw: spec.yaw,
            enabled: Boolean(spec.enabled),
            allowCorridorBlock: false,
            traversable: false,
            stepHeight: 0,
          })
          if (ok) {
            registeredIds.add(spec.id)
            changed = true
          }
        } else {
          const res = updateDynamicCollider(collisionIndex, spec.id, {
            enabled: Boolean(spec.enabled),
          })
          if (res.updated) changed = true
        }
      }

      for (const oldId of registeredIds) {
        if (!seen.has(oldId)) {
          unregisterDynamicCollider(collisionIndex, oldId)
          registeredIds.delete(oldId)
          changed = true
        }
      }
      this._syncedVersions.set(spot.id, version)
    }

    this._collidersDirty = false
    return { changed }
  }

  findNearestInteractable(playerWorldPos, playerGridCell = null, options = null) {
    if (this.isDisposed) return null
    const active = this.getActiveSpot()
    if (active && active.isOccupied) {
      return active.getInteractableDescriptor()
    }
    if (!playerWorldPos) return null

    const px = playerWorldPos.x
    const pz = playerWorldPos.z
    let bestSpot = null
    let bestDist = Infinity
    for (const spot of this.spots.values()) {
      const wp = spot.worldPos
      if (wp && (Math.abs(wp.x - px) > 5.0 || Math.abs(wp.z - pz) > 5.0)) {
        continue
      }
      if (!spot.canPlayerInteract(playerWorldPos, playerGridCell, options)) {
        continue
      }
      const dist = spot.getDistanceToPlayer(playerWorldPos)
      if (dist < bestDist) {
        bestDist = dist
        bestSpot = spot
      }
    }

    return bestSpot ? bestSpot.getInteractableDescriptor() : null
  }

  enterSpot(spotId, options = {}) {
    if (this.isDisposed) return { handled: false, action: null }
    const target = this.spots.get(spotId)
    if (!target || target.isDisposed || this.isPlayerHiding()) {
      return { handled: false, action: null }
    }
    const res = target.enter(options)
    if (!res.entered) return { handled: false, action: null }
    this.activeSpotId = target.id
    this._collidersDirty = true
    return {
      handled: true,
      action: 'enter',
      spot: target,
      ...res,
    }
  }

  exitActiveSpot(options = {}) {
    const active = this.getActiveSpot()
    if (!active || !active.isOccupied) {
      this.activeSpotId = null
      return { handled: false, action: null }
    }
    const res = active.exit(options)
    this.activeSpotId = null
    this._collidersDirty = true
    return {
      handled: Boolean(res.exited),
      action: res.forced ? 'forced_exit' : 'exit',
      spot: active,
      ...res,
    }
  }

  interact(context = {}) {
    if (this.isDisposed) return { handled: false, action: null }
    if (this.isPlayerHiding()) {
      return this.exitActiveSpot({ forced: false })
    }
    const nearest = this.findNearestInteractable(
      context.playerWorldPos,
      context.playerGridCell,
      context
    )
    if (!nearest) return { handled: false, action: null }
    return this.enterSpot(nearest.id, {
      spottedEntering: Boolean(context.spottedEntering),
    })
  }

  getEnemyPerceptionContext(flashlightActive = false) {
    const active = this.getActiveSpot()
    if (!active || !active.isOccupied) {
      return null
    }
    const status = active.getStatusSnapshot()
    return {
      active: true,
      spotId: status.spotId,
      spotType: status.spotType,
      concealment: status.concealment,
      exposure: status.exposure,
      compromised: status.compromised,
      spottedEntering: status.spottedEntering,
      flashlightExposed: Boolean(flashlightActive),
      flashlightDetectRange: status.flashlightDetectRange,
      noiseDamping: status.noiseDamping,
      closeDiscoveryRadius: status.closeDiscoveryRadius,
    }
  }

  getStealthStatus() {
    const active = this.getActiveSpot()
    if (!active || !active.isOccupied) {
      return {
        isHiding: false,
        hidingSpotId: null,
        hidingSpotType: null,
        hidingSpotLabel: null,
        hidingExposure: 0,
        hidingTimeRemainingSec: 0,
        hidingWarning: false,
        hidingFlashlightLeak: false,
        hidingCompromised: false,
      }
    }
    const s = active.getStatusSnapshot()
    return {
      isHiding: true,
      hidingSpotId: s.spotId,
      hidingSpotType: s.spotType,
      hidingSpotLabel: s.label,
      hidingExposure: s.exposure,
      hidingTimeRemainingSec: s.timeRemainingSec,
      hidingWarning: s.warning,
      hidingFlashlightLeak: s.flashlightLeak,
      hidingCompromised: s.compromised,
    }
  }

  update(delta = 0, context = null) {
    if (this.isDisposed || !Number.isFinite(delta) || delta <= 0) {
      return EMPTY_UPDATE_RESULT
    }

    let ejected = null
    let warningTriggered = false

    for (const spot of this.spots.values()) {
      const res = spot.update(delta, context)
      if (res.warningEntered && spot.id === this.activeSpotId) {
        warningTriggered = true
      }
      if (res.ejectRequired && spot.id === this.activeSpotId) {
        ejected = this.exitActiveSpot({ forced: true, cooldownSec: 1.1 })
      }
    }

    if (!ejected && !warningTriggered && !this._collidersDirty) {
      return EMPTY_UPDATE_RESULT
    }

    return {
      ejected,
      warningTriggered,
      collidersDirty: this._collidersDirty,
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
