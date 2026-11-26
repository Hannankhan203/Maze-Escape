import { normalizeEnemyType, placeEnemies } from '../generation/enemyPlacement.js'
import { exploreReachableCells } from '../generation/pathfinder.js'
import { isCellWalkable } from '../world/gridCollision.js'
import { CELL_SIZE } from '../world/worldCoords.js'
import { setEnemySensorLightEnabled } from './buildEnemy.js'
import {
  ECHO_PULSE_RADIUS_TILES,
  ECHO_PULSE_STUN_DURATION_SEC,
  EnemyAgent,
} from './EnemyAgent.js'

const EMPTY_ENEMY_ATTACK_HITS = Object.freeze([])
const EMPTY_ENEMY_UPDATE_RESULT = Object.freeze({
  attackHits: EMPTY_ENEMY_ATTACK_HITS,
})

/**
 * Manages multiple 3D enemy agents in the Three.js scene.
 * Coordinates autonomous spawning, updates against player context,
 * safe maze transitions, and leak-free resource disposal.
 */
export class EnemyManager {
  constructor(scene = null, config = {}) {
    this.scene = scene
    this.config = {
      autoSpawn: false,
      count: 1,
      particlesEnabled: true,
      reducedMotion: false,
      ...(config || {}),
    }

    this.maze = null
    this.enemies = new Map()
    this.isDisposed = false
    this._nextEnemyId = 1
    this._repathBudget = { remaining: 1 }
    this._appliedEchoPulseIds = new Set()
    this._runtimeFrameOptions = {
      repathBudget: this._repathBudget,
      particlesEnabled: Boolean(this.config.particlesEnabled),
      reducedMotion: Boolean(this.config.reducedMotion),
    }
  }

  setScene(scene) {
    this.scene = scene || null
  }

  getEnemies() {
    return Array.from(this.enemies.values())
  }

  getEnemy(id) {
    return this.enemies.get(id) || null
  }

  /**
   * Selects a spawn cell for an enemy that is safely distant from the player start.
   */
  _pickSpawnCell(maze, preferredMinDistance = 6) {
    if (!maze?.grid) return null

    const start = maze.start || { row: 1, col: 1 }
    const reachable = exploreReachableCells(maze.grid, start)

    if (reachable.valid && reachable.farthestCell) {
      // If exit exists and is reachable, spawn near exit or farthest cell
      if (maze.exit && isCellWalkable(maze.exit.row, maze.exit.col, maze)) {
        return { row: maze.exit.row, col: maze.exit.col }
      }
      return reachable.farthestCell
    }

    // Fallback: pick any walkable cell with distance >= minDistance
    const rows = maze.grid.length
    const cols = maze.grid[0].length
    for (let r = rows - 2; r >= 1; r -= 1) {
      for (let c = cols - 2; c >= 1; c -= 1) {
        if (maze.grid[r][c] === 0) {
          const d = Math.abs(r - start.row) + Math.abs(c - start.col)
          if (d >= preferredMinDistance) {
            return { row: r, col: c }
          }
        }
      }
    }

    return null
  }

  /**
   * Spawns a new enemy agent and mounts its 3D procedural mesh to the scene.
   */
  spawnEnemy(options = {}) {
    if (this.isDisposed) return null

    const enemyType = normalizeEnemyType(options?.type || options?.archetype)
    const id = options?.id || `${enemyType}-${this._nextEnemyId++}`
    const spawnCell =
      options?.spawnCell ||
      (this.maze ? this._pickSpawnCell(this.maze) : null)

    const explicitLightSetting =
      typeof options?.sensorLightEnabled === 'boolean'
        ? options.sensorLightEnabled
        : undefined
    let activeLightCount = 0
    if (explicitLightSetting === undefined && Number.isFinite(this.config.maxEnemyLights)) {
      for (const existing of this.enemies.values()) {
        if (existing?.getMesh?.()?.userData?.rig?.sensorLight) {
          activeLightCount += 1
        }
      }
    }
    const sensorLightEnabled =
      explicitLightSetting !== undefined
        ? explicitLightSetting
        : Number.isFinite(this.config.maxEnemyLights)
          ? activeLightCount < Math.max(0, Math.floor(this.config.maxEnemyLights))
          : true

    const agent = new EnemyAgent(id, {
      maze: this.maze,
      type: enemyType,
      difficulty: options?.difficulty ?? this.maze?.difficulty ?? null,
      level: options?.level ?? this.maze?.level ?? 1,
      enemyConfig: options?.enemyConfig ?? this.maze?.enemyConfig ?? null,
      spawnCell,
      position: options?.position,
      yaw: options?.yaw,
      sensorLightEnabled,
      particlesEnabled:
        typeof options?.particlesEnabled === 'boolean'
          ? options.particlesEnabled
          : Boolean(this.config.particlesEnabled),
      reducedMotion:
        typeof options?.reducedMotion === 'boolean'
          ? options.reducedMotion
          : Boolean(this.config.reducedMotion),
      config: options?.config,
      patrolRoute: options?.patrolRoute,
    })

    const mesh = agent.getMesh()
    if (mesh && this.scene) {
      this.scene.add(mesh)
    }

    this.enemies.set(id, agent)
    this._syncRepathSlots()
    return agent
  }

  _syncRepathSlots() {
    const count = Math.max(1, this.enemies.size)
    let slot = 0
    for (const agent of this.enemies.values()) {
      agent.setRepathStagger?.(slot, count)
      slot += 1
    }
  }

  removeEnemy(id) {
    const agent = this.enemies.get(id)
    if (!agent) return false

    agent.dispose()
    this.enemies.delete(id)
    this._syncRepathSlots()
    return true
  }

  clear() {
    for (const agent of this.enemies.values()) {
      agent.dispose()
    }
    this.enemies.clear()
    this._appliedEchoPulseIds.clear()
  }

  /**
   * Resets and updates all enemies for a new maze instance.
   */
  setMaze(maze, options = {}) {
    this.clear()
    this.maze = maze || null
    this._nextEnemyId = 1

    if (typeof options?.particlesEnabled === 'boolean') {
      this.config.particlesEnabled = options.particlesEnabled
      this._runtimeFrameOptions.particlesEnabled = options.particlesEnabled
    }
    if (typeof options?.reducedMotion === 'boolean') {
      this.config.reducedMotion = options.reducedMotion
      this._runtimeFrameOptions.reducedMotion = options.reducedMotion
    }

    if (!maze) return

    const shouldAutoSpawn =
      typeof options?.autoSpawn === 'boolean'
        ? options.autoSpawn
        : Boolean(this.config.autoSpawn)

    if (!shouldAutoSpawn) return

    const maxEnemyLights = Number.isFinite(options?.maxEnemyLights)
      ? Math.max(0, Math.floor(options.maxEnemyLights))
      : Number.isFinite(this.config.maxEnemyLights)
        ? Math.max(0, Math.floor(this.config.maxEnemyLights))
        : Infinity

    const explicitCount = Number.isInteger(options?.count)
      ? options.count
      : Number.isInteger(this.config.count) && options?.useLegacyCount
        ? this.config.count
        : undefined

    const hasExplicitOverrides =
      Number.isInteger(options?.count) ||
      (Array.isArray(options?.archetypes) && options.archetypes.length > 0)

    const generatedEnemies =
      !hasExplicitOverrides && Array.isArray(maze.enemies) ? maze.enemies : null
    const placements = generatedEnemies && generatedEnemies.length > 0
      ? generatedEnemies
      : placeEnemies(maze, {
          count: explicitCount,
          archetypes: options?.archetypes || this.config.archetypes,
          enemyAllocation: hasExplicitOverrides ? null : options?.enemyAllocation,
        })

    if (placements.length > 0) {
      for (let i = 0; i < placements.length; i += 1) {
        const placement = placements[i]
        this.spawnEnemy({
          id: placement.id,
          type: placement.type,
          spawnCell: placement.spawnCell,
          patrolRoute: placement.patrolRoute,
          sensorLightEnabled: i < maxEnemyLights,
          config: options?.config,
        })
      }
      return
    }

    // Fallback for tiny test mazes with explicit positive count
    const fallbackCount = Number.isInteger(explicitCount) ? explicitCount : 0
    for (let i = 0; i < fallbackCount; i += 1) {
      this.spawnEnemy({
        id: `stalker-${i + 1}`,
        sensorLightEnabled: i < maxEnemyLights,
        config: options?.config,
      })
    }
  }

  /**
   * Resets attack timers and AI states for all managed enemies.
   */
  resetEnemyStates() {
    if (this.isDisposed) return
    this._appliedEchoPulseIds.clear()
    for (const agent of this.enemies.values()) {
      agent.resetAttackState()
    }
  }

  /**
   * Clears temporary collectible effects (Time Fragment slow, Watcher's Eye reveal,
   * Echo Pulse stun) without resetting core enemy positions or patrol routes.
   */
  clearTemporaryEffects() {
    if (this.isDisposed) return
    for (const agent of this.enemies.values()) {
      agent.clearTemporaryEffects?.()
    }
  }

  /**
   * Applies an Echo Pulse stun centered at `originWorldPos`, affecting enemies within
   * `radiusTiles` without allowing duplicate application from a single eventId.
   */
  applyEchoPulse(originWorldPos, options = {}) {
    if (this.isDisposed || !originWorldPos) {
      return { stunnedCount: 0, stunnedIds: [], duplicate: false }
    }

    const eventId = options?.eventId ?? null
    if (eventId !== null && eventId !== undefined) {
      if (this._appliedEchoPulseIds.has(eventId)) {
        return { stunnedCount: 0, stunnedIds: [], duplicate: true }
      }
      this._appliedEchoPulseIds.add(eventId)
      if (this._appliedEchoPulseIds.size > 64) {
        const oldest = this._appliedEchoPulseIds.values().next().value
        this._appliedEchoPulseIds.delete(oldest)
      }
    }

    const radiusTiles =
      Number.isFinite(Number(options?.radiusTiles)) && Number(options.radiusTiles) > 0
        ? Number(options.radiusTiles)
        : ECHO_PULSE_RADIUS_TILES
    const durationSec =
      Number.isFinite(Number(options?.durationSec)) && Number(options.durationSec) > 0
        ? Number(options.durationSec)
        : ECHO_PULSE_STUN_DURATION_SEC
    const radiusWorld = radiusTiles * CELL_SIZE

    const stunnedIds = []
    for (const agent of this.enemies.values()) {
      const pos = agent.worldPos
      if (!pos) continue
      const dist = Math.hypot(pos.x - originWorldPos.x, pos.z - originWorldPos.z)
      if (dist <= radiusWorld) {
        if (agent.applyStun?.(durationSec, eventId)) {
          stunnedIds.push(agent.id)
        }
      }
    }

    return {
      stunnedCount: stunnedIds.length,
      stunnedIds,
      duplicate: false,
    }
  }

  /**
   * Dynamically adjusts the active enemy ocular PointLight budget without
   * rebuilding enemies or interrupting AI states.
   */
  setMaxEnemyLights(maxLights) {
    if (this.isDisposed) return 0
    const limit = Number.isFinite(maxLights)
      ? Math.max(0, Math.floor(maxLights))
      : Infinity
    this.config.maxEnemyLights = limit

    let activeCount = 0
    for (const agent of this.enemies.values()) {
      const enabled = activeCount < limit
      if (setEnemySensorLightEnabled(agent.getMesh(), enabled)) {
        activeCount += 1
      }
    }
    return activeCount
  }

  setParticlesEnabled(enabled) {
    if (this.isDisposed) return false
    const next = Boolean(enabled)
    this.config.particlesEnabled = next
    this._runtimeFrameOptions.particlesEnabled = next
    for (const agent of this.enemies.values()) {
      agent.setParticlesEnabled?.(next)
    }
    return next
  }

  setReducedMotion(enabled) {
    if (this.isDisposed) return false
    const next = Boolean(enabled)
    this.config.reducedMotion = next
    this._runtimeFrameOptions.reducedMotion = next
    for (const agent of this.enemies.values()) {
      agent.setReducedMotion?.(next)
    }
    return next
  }

  /**
   * Updates all active enemy agents in the scene animation loop, collecting any attack hits.
   */
  update(delta = 0, playerContext = null, runtimeOptions = null) {
    if (this.isDisposed || this.enemies.size === 0 || delta <= 0) {
      return EMPTY_ENEMY_UPDATE_RESULT
    }

    if (typeof runtimeOptions?.reducedMotion === 'boolean') {
      const rm = Boolean(runtimeOptions.reducedMotion)
      if (rm !== this.config.reducedMotion) {
        this.setReducedMotion(rm)
      }
    }
    if (typeof runtimeOptions?.particlesEnabled === 'boolean') {
      const pe = Boolean(runtimeOptions.particlesEnabled)
      if (pe !== this.config.particlesEnabled) {
        this.setParticlesEnabled(pe)
      }
    }

    const maxRepathsPerFrame = Number.isInteger(this.config.maxRepathsPerFrame)
      ? Math.max(1, this.config.maxRepathsPerFrame)
      : 1
    this._repathBudget.remaining = maxRepathsPerFrame

    let attackHits = null
    for (const agent of this.enemies.values()) {
      const res = agent.update(delta, playerContext, this._runtimeFrameOptions)
      if (res?.attackHit) {
        if (!attackHits) attackHits = []
        attackHits.push(res.attackHit)
      }
    }

    return attackHits ? { attackHits } : EMPTY_ENEMY_UPDATE_RESULT
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
