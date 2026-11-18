import { exploreReachableCells } from '../generation/pathfinder.js'
import { isCellWalkable } from '../world/gridCollision.js'
import { EnemyAgent } from './EnemyAgent.js'

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
      ...(config || {}),
    }

    this.maze = null
    this.enemies = new Map()
    this.isDisposed = false
    this._nextEnemyId = 1
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

    const id = options?.id || `stalker-${this._nextEnemyId++}`
    const spawnCell =
      options?.spawnCell ||
      (this.maze ? this._pickSpawnCell(this.maze) : null)

    const agent = new EnemyAgent(id, {
      maze: this.maze,
      spawnCell,
      position: options?.position,
      yaw: options?.yaw,
      config: options?.config,
      patrolRoute: options?.patrolRoute,
    })

    const mesh = agent.getMesh()
    if (mesh && this.scene) {
      this.scene.add(mesh)
    }

    this.enemies.set(id, agent)
    return agent
  }

  removeEnemy(id) {
    const agent = this.enemies.get(id)
    if (!agent) return false

    agent.dispose()
    this.enemies.delete(id)
    return true
  }

  clear() {
    for (const agent of this.enemies.values()) {
      agent.dispose()
    }
    this.enemies.clear()
  }

  /**
   * Resets and updates all enemies for a new maze instance.
   */
  setMaze(maze, options = {}) {
    this.clear()
    this.maze = maze || null

    if (!maze) return

    const shouldAutoSpawn =
      typeof options?.autoSpawn === 'boolean'
        ? options.autoSpawn
        : Boolean(this.config.autoSpawn)

    const count = Number.isInteger(options?.count)
      ? options.count
      : this.config.count || 1

    if (shouldAutoSpawn && count > 0) {
      for (let i = 0; i < count; i += 1) {
        this.spawnEnemy({ id: `stalker-${i + 1}` })
      }
    }
  }

  /**
   * Updates all active enemy agents in the scene animation loop.
   */
  update(delta = 0, playerContext = null) {
    if (this.isDisposed || this.enemies.size === 0 || delta <= 0) {
      return
    }

    for (const agent of this.enemies.values()) {
      agent.update(delta, playerContext)
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
