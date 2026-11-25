import { placeHazards } from '../generation/hazardPlacement.js'
import {
  getDynamicCollider,
  registerDynamicCollider,
  unregisterDynamicCollider,
  unregisterDynamicCollidersByOwner,
  updateDynamicCollider,
  validateHazardColliderPlacement,
} from '../world/propCollision.js'
import { HAZARD_STATES, HazardAgent } from './HazardAgent.js'

const EMPTY_HAZARD_HITS = Object.freeze([])
const EMPTY_TRIGGERED_HAZARDS = Object.freeze([])
const EMPTY_UPDATE_RESULT = Object.freeze({
  hazardHits: EMPTY_HAZARD_HITS,
  triggeredHazards: EMPTY_TRIGGERED_HAZARDS,
  movementEffects: null,
  collidersDirty: false,
})
const NOOP_COLLIDER_SYNC = Object.freeze({
  changed: false,
  anyNewlyEnabled: false,
  rejectedIds: null,
})

/**
 * Manages multiple environmental hazard agents in the Three.js scene,
 * synchronizing their dynamic aftermath/dormant colliders and interaction hooks.
 */
export class HazardManager {
  constructor(scene = null) {
    this.scene = scene
    this.maze = null
    this.hazards = new Map()
    this.nearbyInteractable = null
    this.isDisposed = false
    this._syncedCollisionIndex = null
    this._syncedHazardVersions = new Map()
    this._registeredIdsByHazard = new Map()
    this._collidersDirty = false
    this._syncResultOut = {
      changed: false,
      anyNewlyEnabled: false,
      rejectedIds: null,
    }
    this._updateResultOut = {
      hazardHits: EMPTY_HAZARD_HITS,
      triggeredHazards: EMPTY_TRIGGERED_HAZARDS,
      movementEffects: null,
      collidersDirty: false,
    }
  }

  setScene(scene) {
    this.scene = scene || null
  }

  getHazards() {
    return Array.from(this.hazards.values())
  }

  getHazard(id) {
    return this.hazards.get(id) || null
  }

  /**
   * Manually spawns a hazard agent (useful for deterministic tests or custom placements).
   */
  addHazard(spec) {
    if (this.isDisposed || !spec) return null
    const agent = new HazardAgent(spec, this.maze)
    if (this.hazards.has(agent.id)) {
      this.removeHazard(agent.id)
    }
    const mesh = agent.getMesh()
    if (mesh && this.scene) {
      this.scene.add(mesh)
    }
    this.hazards.set(agent.id, agent)
    this._collidersDirty = true
    return agent
  }

  removeHazard(id) {
    const hazard = this.hazards.get(id)
    if (!hazard) return false
    if (this._syncedCollisionIndex) {
      unregisterDynamicCollidersByOwner(this._syncedCollisionIndex, hazard.id)
    }
    this._syncedHazardVersions.delete(hazard.id)
    this._registeredIdsByHazard.delete(hazard.id)
    if (this.nearbyInteractable?.id === hazard.id) {
      this.nearbyInteractable = null
    }
    hazard.dispose()
    this.hazards.delete(id)
    this._collidersDirty = true
    return true
  }

  detachFromCollisionIndex(collisionIndex = null) {
    const targetIndex = collisionIndex || this._syncedCollisionIndex
    if (targetIndex && this._registeredIdsByHazard.size > 0) {
      for (const hazardId of this._registeredIdsByHazard.keys()) {
        unregisterDynamicCollidersByOwner(targetIndex, hazardId)
      }
    }
    this._syncedHazardVersions.clear()
    this._registeredIdsByHazard.clear()
    if (!collisionIndex || collisionIndex === this._syncedCollisionIndex) {
      this._syncedCollisionIndex = null
    }
    this._collidersDirty = this.hazards.size > 0
  }

  clear() {
    this.detachFromCollisionIndex()
    this.nearbyInteractable = null
    for (const hazard of this.hazards.values()) {
      hazard.dispose()
    }
    this.hazards.clear()
    this._collidersDirty = false
  }

  setMaze(maze) {
    if (this.isDisposed) return
    this.clear()
    this.maze = maze || null

    if (!maze) return

    const hazardSpecs = placeHazards(maze)

    for (let i = 0; i < hazardSpecs.length; i += 1) {
      const spec = hazardSpecs[i]
      const agent = new HazardAgent(spec, maze)
      const mesh = agent.getMesh()
      if (mesh && this.scene) {
        this.scene.add(mesh)
      }
      this.hazards.set(spec.id, agent)
    }
    this._collidersDirty = this.hazards.size > 0
  }

  resetHazardStates() {
    if (this.isDisposed) return
    this.nearbyInteractable = null
    for (const hazard of this.hazards.values()) {
      hazard.resetState()
    }
    this._collidersDirty = true
    if (this._syncedCollisionIndex) {
      this.syncCollidersToIndex(this._syncedCollisionIndex, this.maze)
    }
  }

  /**
   * Synchronizes dynamic hazard colliders into `collisionIndex` incrementally.
   * Performs an O(1) zero-allocation early return whenever no hazard collider
   * version changed since the last sync.
   */
  syncCollidersToIndex(collisionIndex, maze = null) {
    if (this.isDisposed || !collisionIndex) {
      return NOOP_COLLIDER_SYNC
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
      let anyVersionDrift = false
      for (const hazard of this.hazards.values()) {
        if (this._syncedHazardVersions.get(hazard.id) !== hazard.getColliderVersion()) {
          anyVersionDrift = true
          break
        }
      }
      if (!anyVersionDrift) {
        return NOOP_COLLIDER_SYNC
      }
    }

    const targetMaze = maze || this.maze
    let changed = false
    let anyNewlyEnabled = false
    let rejectedIds = null

    for (const hazard of this.hazards.values()) {
      const version = hazard.getColliderVersion()
      if (!indexChanged && this._syncedHazardVersions.get(hazard.id) === version) {
        continue
      }

      const specs = hazard.getColliderSpecs()
      let registeredIds = this._registeredIdsByHazard.get(hazard.id)
      if (!registeredIds) {
        registeredIds = new Set()
        this._registeredIdsByHazard.set(hazard.id, registeredIds)
      }

      // Track active spec IDs so stale custom collider IDs are cleanly unregistered
      const seenIds = registeredIds.size > 0 ? new Set() : null

      for (let i = 0; i < specs.length; i += 1) {
        const spec = specs[i]
        if (!spec || !spec.id) continue
        if (seenIds) seenIds.add(spec.id)

        const existing = getDynamicCollider(collisionIndex, spec.id)
        const wasEnabled = Boolean(existing && existing.enabled)
        let shouldEnable = Boolean(spec.enabled)

        if (shouldEnable && targetMaze) {
          const check = validateHazardColliderPlacement(targetMaze, spec, {
            index: collisionIndex,
            ignoreOwnerId: hazard.id,
          })
          if (!check.valid) {
            shouldEnable = false
            if (!rejectedIds) rejectedIds = []
            rejectedIds.push(spec.id)
          }
        }

        if (!existing) {
          const registered = registerDynamicCollider(collisionIndex, {
            id: spec.id,
            ownerId: hazard.id,
            propId: hazard.id,
            propType: hazard.type,
            row: spec.row,
            col: spec.col,
            kind: spec.kind,
            cx: spec.cx,
            cz: spec.cz,
            halfW: spec.halfW,
            halfD: spec.halfD,
            radius: spec.radius,
            yaw: spec.yaw,
            enabled: shouldEnable,
            allowCorridorBlock: Boolean(spec.allowCorridorBlock),
            traversable: Boolean(spec.traversable),
            stepHeight:
              Number.isFinite(spec.stepHeight) && spec.stepHeight > 0
                ? spec.stepHeight
                : 0,
          })
          if (registered) {
            registeredIds.add(spec.id)
            changed = true
            if (shouldEnable) {
              anyNewlyEnabled = true
            }
          }
        } else {
          const res = updateDynamicCollider(collisionIndex, spec.id, {
            row: spec.row,
            col: spec.col,
            kind: spec.kind,
            cx: spec.cx,
            cz: spec.cz,
            halfW: spec.halfW,
            halfD: spec.halfD,
            radius: spec.radius,
            yaw: spec.yaw,
            enabled: shouldEnable,
            allowCorridorBlock: Boolean(spec.allowCorridorBlock),
            traversable: Boolean(spec.traversable),
            stepHeight:
              Number.isFinite(spec.stepHeight) && spec.stepHeight > 0
                ? spec.stepHeight
                : 0,
          })
          if (res.updated) {
            changed = true
            if (!wasEnabled && shouldEnable) {
              anyNewlyEnabled = true
            }
          }
        }
      }

      if (seenIds) {
        for (const oldId of registeredIds) {
          if (!seenIds.has(oldId)) {
            if (unregisterDynamicCollider(collisionIndex, oldId)) {
              changed = true
            }
            registeredIds.delete(oldId)
          }
        }
      }

      this._syncedHazardVersions.set(hazard.id, version)
    }

    this._collidersDirty = false
    const out = this._syncResultOut
    out.changed = changed
    out.anyNewlyEnabled = anyNewlyEnabled
    out.rejectedIds = rejectedIds
    return out
  }

  findNearestInteractable(playerWorldPos, playerGridCell = null, options = null) {
    if (this.isDisposed || !playerWorldPos || this.hazards.size === 0) {
      this.nearbyInteractable = null
      return null
    }

    let nearest = null
    let nearestDist = Infinity

    for (const hazard of this.hazards.values()) {
      const desc = hazard.getInteractableDescriptor(playerWorldPos, playerGridCell, options)
      if (!desc) continue
      if (desc.distance < nearestDist) {
        nearestDist = desc.distance
        nearest = desc
      }
    }

    this.nearbyInteractable = nearest
    return nearest
  }

  interactWithHazard(hazardOrId = null, context = null) {
    if (this.isDisposed) {
      return { handled: false, action: null, hazard: null, clearAftermath: false, emitSoundRange: 0 }
    }

    const interactOptions = context?.propColliders
      ? { propColliders: context.propColliders }
      : null

    let hazard = null
    if (hazardOrId) {
      hazard = typeof hazardOrId === 'string' ? this.getHazard(hazardOrId) : hazardOrId
    } else if (context?.playerWorldPos) {
      const nearest = this.findNearestInteractable(
        context.playerWorldPos,
        context.playerGridCell || null,
        interactOptions
      )
      hazard = nearest ? this.getHazard(nearest.id) : null
    }

    if (!hazard || hazard.isDisposed || !this.hazards.has(hazard.id)) {
      return { handled: false, action: null, hazard: null, clearAftermath: false, emitSoundRange: 0 }
    }

    const prevVersion = hazard.getColliderVersion()
    const result = hazard.interact(context)
    if (hazard.getColliderVersion() !== prevVersion) {
      this._collidersDirty = true
      if (this._syncedCollisionIndex) {
        this.syncCollidersToIndex(this._syncedCollisionIndex, this.maze)
      }
    }

    if (context?.playerWorldPos) {
      this.findNearestInteractable(
        context.playerWorldPos,
        context.playerGridCell || null,
        interactOptions
      )
    } else if (result.handled && this.nearbyInteractable?.id === hazard.id) {
      this.nearbyInteractable = null
    }

    return result
  }

  update(delta = 0, playerContext = null) {
    if (this.isDisposed || this.hazards.size === 0 || delta <= 0) {
      return EMPTY_UPDATE_RESULT
    }

    let hazardHits = null
    let triggeredHazards = null
    let movementEffects = null
    let collidersDirty = this._collidersDirty

    for (const hazard of this.hazards.values()) {
      const prevVersion = hazard.getColliderVersion()
      const prevState = hazard.getState()
      const hit = hazard.update(delta, playerContext)
      if (prevState !== HAZARD_STATES.ACTIVE && hazard.getState() === HAZARD_STATES.ACTIVE) {
        if (!triggeredHazards) triggeredHazards = []
        triggeredHazards.push(hazard)
      }
      if (hazard.getColliderVersion() !== prevVersion) {
        collidersDirty = true
      }
      if (hit) {
        if (!hazardHits) hazardHits = []
        hazardHits.push(hit)
      }
      const moveEffect = hazard.lastMovementEffect
      if (moveEffect && Number.isFinite(moveEffect.speedMultiplier) && moveEffect.speedMultiplier < 1) {
        if (!movementEffects || moveEffect.speedMultiplier < movementEffects.speedMultiplier) {
          movementEffects = moveEffect
        }
      }
    }

    if (collidersDirty) {
      this._collidersDirty = true
    }

    if (!hazardHits && !triggeredHazards && !movementEffects && !collidersDirty) {
      return EMPTY_UPDATE_RESULT
    }

    const out = this._updateResultOut
    out.hazardHits = hazardHits || EMPTY_HAZARD_HITS
    out.triggeredHazards = triggeredHazards || EMPTY_TRIGGERED_HAZARDS
    out.movementEffects = movementEffects
    out.collidersDirty = collidersDirty
    return out
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

