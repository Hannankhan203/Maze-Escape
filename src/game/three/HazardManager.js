import { placeHazards } from '../generation/hazardPlacement.js'
import { HazardAgent } from './HazardAgent.js'

const EMPTY_HAZARD_HITS = Object.freeze([])
const EMPTY_UPDATE_RESULT = Object.freeze({
  hazardHits: EMPTY_HAZARD_HITS,
  movementEffects: null,
})

/**
 * Manages multiple environmental hazard agents in the Three.js scene.
 */
export class HazardManager {
  constructor(scene = null) {
    this.scene = scene
    this.maze = null
    this.hazards = new Map()
    this.isDisposed = false
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

  clear() {
    for (const hazard of this.hazards.values()) {
      hazard.dispose()
    }
    this.hazards.clear()
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
  }

  resetHazardStates() {
    if (this.isDisposed) return
    for (const hazard of this.hazards.values()) {
      hazard.resetState()
    }
  }

  update(delta = 0, playerContext = null) {
    if (this.isDisposed || this.hazards.size === 0 || delta <= 0) {
      return EMPTY_UPDATE_RESULT
    }

    let hazardHits = null
    let movementEffects = null
    for (const hazard of this.hazards.values()) {
      const hit = hazard.update(delta, playerContext)
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

    if (!hazardHits && !movementEffects) {
      return EMPTY_UPDATE_RESULT
    }

    return {
      hazardHits: hazardHits || EMPTY_HAZARD_HITS,
      movementEffects,
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
