import {
  ENEMY_ARCHETYPES,
  ENEMY_TYPES,
  getEnemyArchetypeConfig,
  normalizeEnemyType,
} from '../generation/enemyPlacement.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { isCellWalkable, resolveGridCollision } from '../world/gridCollision.js'
import { gridToWorld, worldToGrid } from '../world/worldCoords.js'
import { buildEnemy, disposeEnemy, updateEnemyVisualState } from './buildEnemy.js'

export { ENEMY_ARCHETYPES, ENEMY_TYPES }

export const ENEMY_STATES = {
  IDLE: 'idle',
  PATROL: 'patrol',
  INVESTIGATE: 'investigate',
  CHASE: 'chase',
  SEARCH: 'search',
  ATTACK: 'attack',
}

export const DEFAULT_ENEMY_CONFIG = ENEMY_ARCHETYPES[ENEMY_TYPES.STALKER]


/**
 * Checks whether line of sight is clear between two world positions on the maze grid.
 * Samples along the 2D ray in small intervals to detect any blocking wall cells.
 */
export function checkLineOfSight(fromPos, toPos, maze) {
  if (!maze?.grid || !fromPos || !toPos) return false

  const dx = toPos.x - fromPos.x
  const dz = toPos.z - fromPos.z
  const dist = Math.hypot(dx, dz)
  if (dist < 0.25) return true

  const step = 0.35
  const steps = Math.floor(dist / step)
  const ux = dx / dist
  const uz = dz / dist

  for (let i = 1; i < steps; i += 1) {
    const sx = fromPos.x + ux * (i * step)
    const sz = fromPos.z + uz * (i * step)
    const cell = worldToGrid(sx, sz, maze)
    if (!cell || !isCellWalkable(cell.row, cell.col, maze)) {
      return false
    }
  }

  const endCell = worldToGrid(toPos.x, toPos.z, maze)
  if (!endCell || !isCellWalkable(endCell.row, endCell.col, maze)) {
    return false
  }

  return true
}

/**
 * Generates an automatic 3-4 node patrol loop in the maze across different quadrants.
 */
export function generateDefaultPatrolRoute(maze, startCell = null) {
  if (!maze?.grid) return []

  const rows = maze.grid.length
  const cols = maze.grid[0].length
  const midRow = Math.floor(rows / 2)
  const midCol = Math.floor(cols / 2)

  const quadrants = [
    { minR: 1, maxR: midRow, minC: 1, maxC: midCol },
    { minR: 1, maxR: midRow, minC: midCol, maxC: cols - 2 },
    { minR: midRow, maxR: rows - 2, minC: midCol, maxC: cols - 2 },
    { minR: midRow, maxR: rows - 2, minC: 1, maxC: midCol },
  ]

  const waypoints = []
  if (startCell && isCellWalkable(startCell.row, startCell.col, maze)) {
    waypoints.push({ row: startCell.row, col: startCell.col })
  }

  for (let q = 0; q < quadrants.length; q += 1) {
    const quad = quadrants[q]
    let found = null
    for (let r = quad.minR; r <= quad.maxR; r += 1) {
      for (let c = quad.minC; c <= quad.maxC; c += 1) {
        if (maze.grid[r][c] === 0) {
          found = { row: r, col: c }
          break
        }
      }
      if (found) break
    }
    if (found) {
      // Only add if not identical to last
      const last = waypoints[waypoints.length - 1]
      if (!last || last.row !== found.row || last.col !== found.col) {
        waypoints.push(found)
      }
    }
  }

  return waypoints.length >= 2 ? waypoints : [{ row: 1, col: 1 }]
}

/**
 * Reusable, autonomous EnemyAgent for 3D maze gameplay.
 * Supports IDLE, PATROL, INVESTIGATE, CHASE, and SEARCH states with authoritative
 * grid pathfinding, vision/hearing detection, and zero-allocation updates.
 */
export class EnemyAgent {
  constructor(id = 'stalker-1', options = {}) {
    this.id = id
    this.isDisposed = false
    this.type = normalizeEnemyType(options?.type || options?.archetype)
    this._configOverrides =
      options?.config && typeof options.config === 'object'
        ? { ...options.config }
        : null
    const difficulty = options?.difficulty ?? options?.maze?.difficulty ?? null
    const archetypeConfig = getEnemyArchetypeConfig(this.type, difficulty)
    this.config = {
      ...archetypeConfig,
      ...(this._configOverrides || {}),
    }

    this.maze = options?.maze || null
    this.state = ENEMY_STATES.PATROL
    this.worldPos = { x: 0, y: 0, z: 0 }
    this.yaw = Number.isFinite(options?.yaw) ? options.yaw : 0

    // Navigation and pathing
    this.patrolRoute = Array.isArray(options?.patrolRoute)
      ? [...options.patrolRoute]
      : []
    this.currentPatrolIndex = 0
    this.currentPathWaypoints = [] // array of { x, z }
    this.currentPathIndex = 0
    this.targetGridCell = null
    this.repathCooldown = 0
    this._repathSlot = Number.isInteger(options?.repathSlot) ? Math.max(0, options.repathSlot) : 0
    this._repathSlotCount = Number.isInteger(options?.repathSlotCount)
      ? Math.max(1, options.repathSlotCount)
      : 1
    this._needsImmediateRepath = false
    this._deferredRepathFrames = 0
    this._chaseStuckCount = 0

    // Perception & AI state timers
    this.awareness = 0
    this.idleTimer = 0
    this.searchTimer = 0
    this.loseSightTimer = 0
    this.lastKnownPlayerPos = null
    this.lastKnownPlayerCell = null
    this.investigateTarget = null
    this.stridePhase = 0
    this.hoverPhase = 0
    this._hidingSearchQueue = []
    this._checkedHidingKeys = new Set()

    // Combat & Attack state
    this.attackTimer = 0
    this.attackCooldownTimer = 0
    this.hasDealtDamageInAttack = false

    // Procedural 3D Mesh
    this.mesh = buildEnemy({
      id: this.id,
      type: this.type,
      maze: this.maze,
      spawnCell: options?.spawnCell,
      position: options?.position,
      yaw: this.yaw,
      sensorLightEnabled: options?.sensorLightEnabled,
      config: options?.modelConfig,
    })

    if (this.mesh) {
      this.worldPos.x = this.mesh.position.x
      this.worldPos.y = this.mesh.position.y
      this.worldPos.z = this.mesh.position.z
    }

    if (this.maze && this.patrolRoute.length === 0) {
      const curCell = this.getGridCell()
      this.patrolRoute = generateDefaultPatrolRoute(this.maze, curCell)
    }
  }

  getType() {
    return this.type
  }

  getMesh() {
    return this.mesh
  }

  getState() {
    return this.state
  }

  getPosition() {
    return { ...this.worldPos }
  }

  getGridCell() {
    if (!this.maze) return null
    return worldToGrid(this.worldPos.x, this.worldPos.z, this.maze)
  }

  resetAttackState() {
    this.attackTimer = 0
    this.attackCooldownTimer = 0
    this.hasDealtDamageInAttack = false
    this._needsImmediateRepath = false
    this._deferredRepathFrames = 0
    this._chaseStuckCount = 0
    this._hidingSearchQueue = []
    this._checkedHidingKeys.clear()
    if (this.state === ENEMY_STATES.ATTACK) {
      this.state = ENEMY_STATES.PATROL
    }
    const rig = this.mesh?.userData?.rig
    if (rig?.upperBodyPivot) {
      rig.upperBodyPivot.rotation.set(0, 0, 0)
      if (rig.restPose?.hipHeight !== undefined) {
        rig.upperBodyPivot.position.y = rig.restPose.hipHeight
      }
    }
    if (rig?.lowerRobePivot) rig.lowerRobePivot.rotation.set(0, 0, 0)
    if (rig?.shroudPivot) {
      rig.shroudPivot.rotation.set(0, 0, 0)
      rig.shroudPivot.scale.set(1, 1, 1)
    }
    if (rig?.particleInner) {
      rig.particleInner.rotation.set(0, 0, 0)
      rig.particleInner.position.set(0, 0, 0)
    }
    if (rig?.particleOuter) {
      rig.particleOuter.rotation.set(0, 0, 0)
      rig.particleOuter.position.set(0, 0, 0)
    }
    if (rig?.neckPivot) rig.neckPivot.rotation.set(0, 0, 0)
    if (rig?.headPivot) rig.headPivot.rotation.set(0, 0, 0)
    if (rig?.leftElbowPivot) rig.leftElbowPivot.rotation.set(0, 0, 0)
    if (rig?.rightElbowPivot) rig.rightElbowPivot.rotation.set(0, 0, 0)
    if (rig?.leftWristPivot) rig.leftWristPivot.rotation.set(0, 0, 0)
    if (rig?.rightWristPivot) rig.rightWristPivot.rotation.set(0, 0, 0)
    if (rig?.leftKneePivot) rig.leftKneePivot.rotation.set(0, 0, 0)
    if (rig?.rightKneePivot) rig.rightKneePivot.rotation.set(0, 0, 0)
    if (rig?.leftArmPivot) rig.leftArmPivot.rotation.z = 0
    if (rig?.rightArmPivot) rig.rightArmPivot.rotation.z = 0
    if (rig?.leftLegPivot) rig.leftLegPivot.rotation.z = 0
    if (rig?.rightLegPivot) rig.rightLegPivot.rotation.z = 0
    this._dampLimbs(0.1)
  }

  setRepathStagger(slot = 0, slotCount = 1) {
    this._repathSlot = Number.isInteger(slot) ? Math.max(0, slot) : 0
    this._repathSlotCount = Number.isInteger(slotCount) ? Math.max(1, slotCount) : 1
  }

  _getChaseRepathInterval() {
    if (this._repathSlotCount <= 1) {
      return 0.35
    }
    return 0.29 + (this._repathSlot % 8) * 0.0175
  }

  setMaze(maze, options = {}) {
    this.maze = maze || null
    if (options?.config && typeof options.config === 'object') {
      this._configOverrides = { ...options.config }
    }
    const difficulty = options?.difficulty ?? maze?.difficulty ?? null
    this.config = {
      ...getEnemyArchetypeConfig(this.type, difficulty),
      ...(this._configOverrides || {}),
    }
    this.currentPathWaypoints = []
    this.currentPathIndex = 0
    this.targetGridCell = null
    this.repathCooldown = 0
    this._needsImmediateRepath = false
    this._deferredRepathFrames = 0
    this._chaseStuckCount = 0
    this.awareness = 0
    this.resetAttackState()
    this.state = ENEMY_STATES.PATROL

    if (maze) {
      if (options?.spawnCell) {
        this.setGridPosition(options.spawnCell.row, options.spawnCell.col)
      }
      this.patrolRoute = options?.patrolRoute || generateDefaultPatrolRoute(maze, this.getGridCell())
      this.currentPatrolIndex = 0
    }
  }

  setPosition(x, y = 0, z = 0, yaw = undefined) {
    if (this.isDisposed) return
    this.worldPos.x = Number.isFinite(x) ? x : this.worldPos.x
    this.worldPos.y = Number.isFinite(y) ? y : this.worldPos.y
    this.worldPos.z = Number.isFinite(z) ? z : this.worldPos.z

    if (Number.isFinite(yaw)) {
      this.yaw = yaw
    }

    if (this.mesh) {
      this.mesh.position.set(this.worldPos.x, this.worldPos.y, this.worldPos.z)
      this.mesh.rotation.y = this.yaw
    }
  }

  setGridPosition(row, col, options = {}) {
    if (!this.maze) return
    const pos = gridToWorld(row, col, this.maze)
    if (pos) {
      this.setPosition(pos.x, 0, pos.z, options?.yaw)
    }
  }

  setPatrolRoute(route) {
    if (Array.isArray(route) && route.length > 0) {
      this.patrolRoute = [...route]
      this.currentPatrolIndex = 0
      this.currentPathWaypoints = []
      this.currentPathIndex = 0
    }
  }

  /**
   * Coordinates staggered repath scheduling when running under EnemyManager,
   * while allowing urgent/immediate repaths and starvation-capped fallbacks.
   */
  _tryNavigateToCell(targetCell, options = {}) {
    if (!this.maze || !targetCell) return false
    const currentCell = this.getGridCell()
    if (!currentCell) return false

    if (currentCell.row === targetCell.row && currentCell.col === targetCell.col) {
      this._deferredRepathFrames = 0
      this.currentPathWaypoints = []
      this.currentPathIndex = 0
      this.targetGridCell = targetCell
      return true
    }

    const budget = options?.runtimeOptions?.repathBudget || null
    const urgent = Boolean(options?.urgent)

    if (!urgent && budget) {
      const maxDeferFrames = Math.max(2, Math.min(8, this._repathSlotCount))
      if (budget.remaining > 0) {
        budget.remaining -= 1
        this._deferredRepathFrames = 0
      } else if (this._deferredRepathFrames >= maxDeferFrames) {
        this._deferredRepathFrames = 0
      } else {
        this._deferredRepathFrames += 1
        return false
      }
    } else {
      this._deferredRepathFrames = 0
      if (budget && budget.remaining > 0) {
        budget.remaining -= 1
      }
    }

    return this._navigateToCell(targetCell, currentCell)
  }

  /**
   * Plans a path from current grid cell to destination grid cell using BFS pathfinder.
   */
  _navigateToCell(targetCell, precomputedCurrentCell = null) {
    if (!this.maze || !targetCell) return false
    const currentCell = precomputedCurrentCell || this.getGridCell()
    if (!currentCell) return false

    if (currentCell.row === targetCell.row && currentCell.col === targetCell.col) {
      this.currentPathWaypoints = []
      this.currentPathIndex = 0
      this.targetGridCell = targetCell
      return true
    }

    const pathResult = findShortestPath(this.maze.grid, currentCell, targetCell)
    if (!pathResult.found || pathResult.path.length <= 1) {
      return false
    }

    // Convert cell path (skipping current starting cell) to world coordinates
    const waypoints = []
    for (let i = 1; i < pathResult.path.length; i += 1) {
      const cell = pathResult.path[i]
      const wp = gridToWorld(cell.row, cell.col, this.maze)
      if (wp) {
        waypoints.push(wp)
      }
    }

    this.currentPathWaypoints = waypoints
    this.currentPathIndex = 0
    this.targetGridCell = targetCell
    return true
  }

  /**
   * Evaluates vision and hearing perception against the player.
   */
  _checkPerception(playerContext) {
    if (!playerContext?.playerWorldPos || !this.maze) {
      return { canSee: false, canHear: false, heardCell: null, isHidden: false, dist: Infinity }
    }

    const isHidden = Boolean(playerContext.playerHidden || playerContext.isHidden)
    const px = playerContext.playerWorldPos.x
    const pz = playerContext.playerWorldPos.z
    const ex = this.worldPos.x
    const ez = this.worldPos.z

    const dx = px - ex
    const dz = pz - ez
    const dist = Math.hypot(dx, dz)

    // Check hearing first (enemies can still hear relevant sounds while player is hidden)
    let canHear = false
    let heardCell = null

    if (playerContext.soundEvent?.position) {
      const sPos = playerContext.soundEvent.position
      const sDist = Math.hypot(sPos.x - ex, sPos.z - ez)
      const sRange = Number.isFinite(playerContext.soundEvent.range)
        ? playerContext.soundEvent.range
        : this.config.hearingWalkRange
      if (sDist <= sRange) {
        canHear = true
        heardCell =
          playerContext.soundEvent.cell ||
          worldToGrid(sPos.x, sPos.z, this.maze)
      }
    }

    const isSprinting = Boolean(playerContext.playerMotion?.isSprinting)
    const isMoving = Boolean(playerContext.playerMotion?.moved)

    if (!canHear) {
      if (isSprinting && dist <= this.config.hearingSprintRange) {
        canHear = true
        heardCell =
          playerContext.playerGridCell ||
          worldToGrid(px, pz, this.maze)
      } else if (isMoving && dist <= this.config.hearingWalkRange) {
        canHear = true
        heardCell =
          playerContext.playerGridCell ||
          worldToGrid(px, pz, this.maze)
      }
    }

    // Check vision (completely blocked when player is inside a hiding spot)
    let canSee = false
    if (!isHidden) {
      if (dist <= this.config.closeProximityRange) {
        // Omnidirectional sensing at extremely close proximity
        canSee = checkLineOfSight(this.worldPos, playerContext.playerWorldPos, this.maze)
      } else if (dist <= this.config.visionRange) {
        // Vision cone FOV check
        const forwardX = -Math.sin(this.yaw)
        const forwardZ = -Math.cos(this.yaw)
        const toPx = dx / dist
        const toPz = dz / dist
        const dot = forwardX * toPx + forwardZ * toPz
        const minDot = Math.cos(this.config.visionFov / 2)

        if (dot >= minDot) {
          canSee = checkLineOfSight(this.worldPos, playerContext.playerWorldPos, this.maze)
        }
      }
    }

    return { canSee, canHear, heardCell, isHidden, dist }
  }

  /**
   * Advances position towards current target waypoint, rotating smoothly and avoiding walls.
   */
  _moveAlongPath(speed, delta) {
    if (this.currentPathIndex >= this.currentPathWaypoints.length) {
      return { arrived: true, moved: false }
    }

    const targetWp = this.currentPathWaypoints[this.currentPathIndex]
    const dx = targetWp.x - this.worldPos.x
    const dz = targetWp.z - this.worldPos.z
    const dist = Math.hypot(dx, dz)

    if (dist < 0.28) {
      this.currentPathIndex += 1
      if (this.currentPathIndex >= this.currentPathWaypoints.length) {
        return { arrived: true, moved: false }
      }
    }

    const stepDist = Math.min(dist, speed * delta)
    const dirX = dx / Math.max(1e-5, dist)
    const dirZ = dz / Math.max(1e-5, dist)

    // Target yaw
    const targetYaw = Math.atan2(-dirX, -dirZ)
    let diff = targetYaw - this.yaw
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    const turnAlpha = 1 - Math.exp(-this.config.turnSpeed * delta)
    this.yaw += diff * turnAlpha

    // Move forward with authoritative grid collision check
    const rawNextX = this.worldPos.x + dirX * stepDist
    const rawNextZ = this.worldPos.z + dirZ * stepDist

    const col = resolveGridCollision(rawNextX, rawNextZ, this.maze, {
      radius: this.config.radius,
    })

    const actualMoveDist = Math.hypot(col.x - this.worldPos.x, col.z - this.worldPos.z)
    this.worldPos.x = col.x
    this.worldPos.z = col.z

    if (this.mesh) {
      this.mesh.position.x = this.worldPos.x
      this.mesh.position.z = this.worldPos.z
      this.mesh.rotation.y = this.yaw
    }

    // Articulate limbs during locomotion
    if (actualMoveDist > 1e-4) {
      this.stridePhase = (this.stridePhase + (actualMoveDist / 1.5) * (Math.PI * 2)) % (Math.PI * 2)
      this._animateLimbs(this.stridePhase, speed > 4 ? 0.7 : 0.45)
    } else {
      this._dampLimbs(delta)
    }

    return { arrived: false, moved: actualMoveDist > 1e-4 }
  }

  _updatePhantomSpectralEffects(isChase = false, isAlert = false) {
    const rig = this.mesh?.userData?.rig
    if (!rig) return

    const amp = isChase ? 0.075 : isAlert ? 0.055 : 0.042
    const phase = this.hoverPhase

    if (rig.shroudPivot) {
      const sx = 1 + Math.sin(phase * 2.15) * amp
      const sy = 1 + Math.cos(phase * 1.55) * (amp * 0.6)
      const sz = 1 - Math.sin(phase * 2.15) * amp
      rig.shroudPivot.scale.set(sx, sy, sz)
      rig.shroudPivot.rotation.z = Math.sin(phase * 1.35) * (isChase ? 0.07 : 0.045)
    }

    if (rig.particleInner) {
      rig.particleInner.rotation.y = phase * (isChase ? 2.05 : 1.35)
      rig.particleInner.position.y = Math.sin(phase * 1.75) * (isChase ? 0.075 : 0.055)
    }

    if (rig.particleOuter) {
      rig.particleOuter.rotation.y = -phase * (isChase ? 1.15 : 0.72)
      rig.particleOuter.rotation.x = Math.sin(phase * 0.8) * 0.06
      rig.particleOuter.position.y = Math.cos(phase * 1.2) * (isChase ? 0.08 : 0.065)
    }
  }

  _animateLimbs(phase, amplitude) {
    const rig = this.mesh?.userData?.rig
    if (!rig) return

    if (this.type === ENEMY_TYPES.STALKER) {
      const sinP = Math.sin(phase)
      const cosP = Math.cos(phase)
      const isChase = this.state === ENEMY_STATES.CHASE
      const isAlert =
        this.state === ENEMY_STATES.INVESTIGATE || this.state === ENEMY_STATES.SEARCH
      const hipY = rig.restPose?.hipHeight ?? 1.08

      // Spectral hover float instead of heavy footsteps
      if (rig.upperBodyPivot) {
        rig.upperBodyPivot.position.y =
          hipY + Math.sin(this.hoverPhase * (isChase ? 2.4 : 1.25)) * (isChase ? 0.042 : 0.028)
        rig.upperBodyPivot.rotation.x = isChase ? 0.34 : isAlert ? 0.24 : 0.14
        rig.upperBodyPivot.rotation.z = Math.sin(phase * 0.5) * (isChase ? 0.055 : 0.032)
      }

      if (rig.neckPivot) {
        rig.neckPivot.rotation.x = isChase ? 0.16 : isAlert ? 0.22 : 0.12
        rig.neckPivot.rotation.z = Math.sin(this.hoverPhase * 0.7) * 0.08
      }
      if (rig.headPivot) {
        rig.headPivot.rotation.x = isChase ? -0.18 : -0.06
        rig.headPivot.rotation.z =
          Math.sin(this.hoverPhase * (isChase ? 2.6 : 0.95) + 0.7) * (isChase ? 0.09 : 0.13)
      }

      // Dissolving lower mist & shredded robes trail cleanly behind forward glide
      const trailX = isChase ? 0.36 : isAlert ? 0.24 : 0.18
      if (rig.leftLegPivot) {
        rig.leftLegPivot.rotation.x = trailX + sinP * (amplitude * 0.32)
        rig.leftLegPivot.rotation.z = Math.cos(this.hoverPhase * 1.1) * 0.06
      }
      if (rig.rightLegPivot) {
        rig.rightLegPivot.rotation.x = trailX - sinP * (amplitude * 0.32)
        rig.rightLegPivot.rotation.z = -Math.cos(this.hoverPhase * 1.1) * 0.06
      }
      if (rig.lowerRobePivot) {
        rig.lowerRobePivot.rotation.x = isChase ? 0.22 : 0.12
        rig.lowerRobePivot.rotation.z = -sinP * 0.06
      }

      // Long thin clawed arms reach forward when chasing, drift eerily when patrolling
      if (isChase) {
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = -0.82 + sinP * 0.24
          rig.leftArmPivot.rotation.z = -0.08
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = -0.82 - sinP * 0.24
          rig.rightArmPivot.rotation.z = 0.08
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.44 + cosP * 0.12
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.44 - cosP * 0.12
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = -0.26
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = -0.26
      } else if (isAlert) {
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = -0.34 - sinP * 0.16
          rig.leftArmPivot.rotation.z = -0.06
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = -0.34 + sinP * 0.16
          rig.rightArmPivot.rotation.z = 0.06
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.58
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.58
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = -0.18
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = -0.18
      } else {
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = 0.06 + sinP * 0.16
          rig.leftArmPivot.rotation.z = -0.06
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = 0.06 - sinP * 0.16
          rig.rightArmPivot.rotation.z = 0.06
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.34 + cosP * 0.08
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.34 - cosP * 0.08
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = 0.18
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = 0.18
      }
      return
    }

    if (this.type === ENEMY_TYPES.HUNTER) {
      const sinP = Math.sin(phase)
      const cosP = Math.cos(phase)
      const isChase = this.state === ENEMY_STATES.CHASE
      const isAlert =
        this.state === ENEMY_STATES.INVESTIGATE || this.state === ENEMY_STATES.SEARCH
      const hipY = rig.restPose?.hipHeight ?? 0.925

      // Broken asymmetrical undead limp: stiff dragging left leg vs deeper right stride
      if (rig.leftLegPivot) {
        rig.leftLegPivot.rotation.x = sinP * (amplitude * 0.68) + 0.08
        rig.leftLegPivot.rotation.z = -0.045
      }
      if (rig.rightLegPivot) {
        rig.rightLegPivot.rotation.x = -sinP * (amplitude * 1.1) - 0.04
        rig.rightLegPivot.rotation.z = 0.03
      }
      if (rig.leftKneePivot) {
        rig.leftKneePivot.rotation.x = Math.max(0.08, cosP * 0.24 + 0.22)
      }
      if (rig.rightKneePivot) {
        rig.rightKneePivot.rotation.x = Math.max(0.04, -cosP * (isChase ? 0.62 : 0.45) + 0.16)
      }

      // Twisted scoliotic posture & uneven shoulder roll
      if (rig.upperBodyPivot) {
        rig.upperBodyPivot.position.y =
          hipY - Math.max(0, Math.sin(phase + 0.6)) * (isChase ? 0.032 : 0.022)
        rig.upperBodyPivot.rotation.x = isChase ? 0.36 : isAlert ? 0.25 : 0.16
        rig.upperBodyPivot.rotation.y = 0.05 + cosP * (isChase ? 0.09 : 0.06)
        rig.upperBodyPivot.rotation.z = -0.06 + sinP * (isChase ? 0.06 : 0.045)
      }

      // Crooked neck & eerie head tilt (preserve headPivot.rotation.y for search/patrol sweeps)
      if (rig.neckPivot) {
        rig.neckPivot.rotation.x = isChase ? 0.14 : isAlert ? 0.2 : 0.12
        rig.neckPivot.rotation.z = 0.085 + Math.sin(this.hoverPhase * 0.85) * 0.04
      }
      if (rig.headPivot) {
        rig.headPivot.rotation.x = isChase ? -0.22 : isAlert ? -0.14 : -0.08
        rig.headPivot.rotation.z = -0.11 + Math.sin(this.hoverPhase * 1.15) * 0.07
      }

      // Damaged arms: slumped dragging left arm, crooked raised/reaching right arm
      if (isChase) {
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = -0.78 + sinP * 0.28
          rig.leftArmPivot.rotation.z = -0.06
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = -0.92 - sinP * 0.28
          rig.rightArmPivot.rotation.z = 0.08
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.52 + cosP * 0.14
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.38 - cosP * 0.14
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = -0.28
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = -0.24
      } else if (isAlert) {
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = -0.24 + sinP * 0.18
          rig.leftArmPivot.rotation.z = -0.07
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = -0.44 - sinP * 0.18
          rig.rightArmPivot.rotation.z = 0.06
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.48
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.74
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = -0.14
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = -0.22
      } else {
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = 0.04 + sinP * (amplitude * 0.55)
          rig.leftArmPivot.rotation.z = -0.07
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = -0.12 - sinP * (amplitude * 0.72)
          rig.rightArmPivot.rotation.z = 0.06
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.26 + cosP * 0.1
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.62 - cosP * 0.12
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = 0.16
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = -0.14
      }
      return
    }

    if (this.type === ENEMY_TYPES.BRUTE) {
      const sinP = Math.sin(phase)
      const cosP = Math.cos(phase)
      const isChase = this.state === ENEMY_STATES.CHASE
      const isAlert =
        this.state === ENEMY_STATES.INVESTIGATE || this.state === ENEMY_STATES.SEARCH
      const hipY = rig.restPose?.hipHeight ?? 1.05

      // Tall looming apparition glide with unnaturally warped torso & hovering sway
      if (rig.upperBodyPivot) {
        rig.upperBodyPivot.position.y =
          hipY + Math.sin(this.hoverPhase * (isChase ? 2.2 : 1.35)) * (isChase ? 0.052 : 0.036)
        rig.upperBodyPivot.rotation.x = isChase ? 0.28 : isAlert ? 0.19 : 0.11
        rig.upperBodyPivot.rotation.y = cosP * (isChase ? 0.075 : 0.045)
        rig.upperBodyPivot.rotation.z = 0.035 + sinP * (isChase ? 0.06 : 0.038)
      }

      // Forward-craned crooked neck & unnervingly tilted dark face (preserve headPivot.rotation.y)
      if (rig.neckPivot) {
        rig.neckPivot.rotation.x = isChase ? 0.24 : isAlert ? 0.22 : 0.16
        rig.neckPivot.rotation.z = -0.095 + Math.sin(this.hoverPhase * 0.9) * 0.045
      }
      if (rig.headPivot) {
        rig.headPivot.rotation.x = isChase ? -0.2 : isAlert ? -0.14 : -0.08
        rig.headPivot.rotation.z = 0.135 + Math.sin(this.hoverPhase * 1.3 + 0.4) * 0.085
      }

      // Hyper-elongated trailing shadow legs hovering/drifting behind glide
      const legTrail = isChase ? 0.34 : isAlert ? 0.22 : 0.16
      if (rig.leftLegPivot) {
        rig.leftLegPivot.rotation.x = legTrail + sinP * (amplitude * 0.55)
        rig.leftLegPivot.rotation.z = -0.04 + cosP * 0.035
      }
      if (rig.rightLegPivot) {
        rig.rightLegPivot.rotation.x = legTrail - sinP * (amplitude * 0.55)
        rig.rightLegPivot.rotation.z = 0.035 - cosP * 0.035
      }

      // Elongated arms & sharp long-fingered silhouettes
      if (isChase) {
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = -0.78 + sinP * 0.22
          rig.leftArmPivot.rotation.z = -0.1
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = -0.78 - sinP * 0.22
          rig.rightArmPivot.rotation.z = 0.1
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.38 + cosP * 0.1
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.38 - cosP * 0.1
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = -0.24
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = -0.24
      } else if (isAlert) {
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = -0.34 - sinP * 0.15
          rig.leftArmPivot.rotation.z = -0.08
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = -0.38 + sinP * 0.15
          rig.rightArmPivot.rotation.z = 0.09
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.48
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.52
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = -0.14
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = -0.16
      } else {
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = 0.05 + sinP * (amplitude * 0.42)
          rig.leftArmPivot.rotation.z = -0.08
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = 0.05 - sinP * (amplitude * 0.42)
          rig.rightArmPivot.rotation.z = 0.09
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.32 + cosP * 0.08
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.32 - cosP * 0.08
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = 0.14
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = 0.14
      }

      this._updatePhantomSpectralEffects(isChase, isAlert)
      return
    }

    const sinP = Math.sin(phase)
    if (rig.leftLegPivot) rig.leftLegPivot.rotation.x = sinP * amplitude
    if (rig.rightLegPivot) rig.rightLegPivot.rotation.x = -sinP * amplitude
    if (rig.leftArmPivot) rig.leftArmPivot.rotation.x = -sinP * (amplitude * 0.8) + 0.15
    if (rig.rightArmPivot) rig.rightArmPivot.rotation.x = sinP * (amplitude * 0.8) + 0.15
  }

  _dampLimbs(delta) {
    const rig = this.mesh?.userData?.rig
    if (!rig) return
    const decay = Math.exp(-12 * delta)

    if (this.type === ENEMY_TYPES.STALKER) {
      const blend = 1 - Math.exp(-8 * delta)
      const hipY = rig.restPose?.hipHeight ?? 1.02
      const idleWave = Math.sin(this.hoverPhase * 1.1)

      if (rig.upperBodyPivot) {
        rig.upperBodyPivot.position.y = hipY + idleWave * 0.03
        rig.upperBodyPivot.rotation.x += (0.07 - rig.upperBodyPivot.rotation.x) * blend
        rig.upperBodyPivot.rotation.z +=
          (Math.sin(this.hoverPhase * 0.5) * 0.025 - rig.upperBodyPivot.rotation.z) * blend
      }
      if (rig.lowerRobePivot) {
        rig.lowerRobePivot.rotation.x += (0.05 - rig.lowerRobePivot.rotation.x) * blend
        rig.lowerRobePivot.rotation.z *= decay
      }
      if (rig.neckPivot) {
        rig.neckPivot.rotation.x += (0.1 - rig.neckPivot.rotation.x) * blend
        rig.neckPivot.rotation.z +=
          (Math.sin(this.hoverPhase * 0.6) * 0.08 - rig.neckPivot.rotation.z) * blend
      }
      if (rig.headPivot) {
        rig.headPivot.rotation.x +=
          (Math.sin(this.hoverPhase * 0.8) * 0.04 - rig.headPivot.rotation.x) * blend
        rig.headPivot.rotation.z +=
          (Math.sin(this.hoverPhase * 1.05 + 0.6) * 0.12 - rig.headPivot.rotation.z) * blend
        if (this.state === ENEMY_STATES.IDLE) {
          rig.headPivot.rotation.y +=
            (Math.sin(this.hoverPhase * 0.45) * 0.14 - rig.headPivot.rotation.y) * blend
        }
      }
      if (rig.leftLegPivot) {
        rig.leftLegPivot.rotation.x += (idleWave * 0.06 - rig.leftLegPivot.rotation.x) * blend
        rig.leftLegPivot.rotation.z *= decay
      }
      if (rig.rightLegPivot) {
        rig.rightLegPivot.rotation.x += (-idleWave * 0.06 - rig.rightLegPivot.rotation.x) * blend
        rig.rightLegPivot.rotation.z *= decay
      }
      const targetArmX = -0.1 + Math.sin(this.hoverPhase * 0.8) * 0.04
      if (rig.leftArmPivot) {
        rig.leftArmPivot.rotation.x += (targetArmX - rig.leftArmPivot.rotation.x) * blend
        rig.leftArmPivot.rotation.z += (-0.06 - rig.leftArmPivot.rotation.z) * blend
      }
      if (rig.rightArmPivot) {
        rig.rightArmPivot.rotation.x += (targetArmX - rig.rightArmPivot.rotation.x) * blend
        rig.rightArmPivot.rotation.z += (0.06 - rig.rightArmPivot.rotation.z) * blend
      }
      if (rig.leftElbowPivot) {
        rig.leftElbowPivot.rotation.x += (-0.36 - rig.leftElbowPivot.rotation.x) * blend
      }
      if (rig.rightElbowPivot) {
        rig.rightElbowPivot.rotation.x += (-0.36 - rig.rightElbowPivot.rotation.x) * blend
      }
      if (rig.leftWristPivot) {
        rig.leftWristPivot.rotation.x += (0.22 - rig.leftWristPivot.rotation.x) * blend
      }
      if (rig.rightWristPivot) {
        rig.rightWristPivot.rotation.x += (0.22 - rig.rightWristPivot.rotation.x) * blend
      }
      return
    }

    if (this.type === ENEMY_TYPES.HUNTER) {
      const blend = 1 - Math.exp(-8 * delta)
      const hipY = rig.restPose?.hipHeight ?? 0.925
      const twitch = Math.sin(this.hoverPhase * 1.15)

      if (rig.upperBodyPivot) {
        rig.upperBodyPivot.position.y = hipY + Math.sin(this.hoverPhase * 0.7) * 0.008
        rig.upperBodyPivot.rotation.x += (0.14 - rig.upperBodyPivot.rotation.x) * blend
        rig.upperBodyPivot.rotation.y += (0.05 - rig.upperBodyPivot.rotation.y) * blend
        rig.upperBodyPivot.rotation.z +=
          (-0.055 + Math.sin(this.hoverPhase * 0.65) * 0.015 - rig.upperBodyPivot.rotation.z) *
          blend
      }
      if (rig.neckPivot) {
        rig.neckPivot.rotation.x += (0.12 - rig.neckPivot.rotation.x) * blend
        rig.neckPivot.rotation.z += (0.085 - rig.neckPivot.rotation.z) * blend
      }
      if (rig.headPivot) {
        rig.headPivot.rotation.x += (-0.06 + twitch * 0.03 - rig.headPivot.rotation.x) * blend
        rig.headPivot.rotation.z +=
          (-0.11 + Math.sin(this.hoverPhase * 0.75 + 0.5) * 0.055 - rig.headPivot.rotation.z) *
          blend
        if (this.state === ENEMY_STATES.IDLE) {
          rig.headPivot.rotation.y +=
            (Math.sin(this.hoverPhase * 0.52) * 0.18 - rig.headPivot.rotation.y) * blend
        }
      }
      if (rig.leftLegPivot) {
        rig.leftLegPivot.rotation.x += (0.06 - rig.leftLegPivot.rotation.x) * blend
        rig.leftLegPivot.rotation.z += (-0.04 - rig.leftLegPivot.rotation.z) * blend
      }
      if (rig.rightLegPivot) {
        rig.rightLegPivot.rotation.x += (-0.04 - rig.rightLegPivot.rotation.x) * blend
        rig.rightLegPivot.rotation.z += (0.025 - rig.rightLegPivot.rotation.z) * blend
      }
      if (rig.leftKneePivot) {
        rig.leftKneePivot.rotation.x += (0.14 - rig.leftKneePivot.rotation.x) * blend
      }
      if (rig.rightKneePivot) {
        rig.rightKneePivot.rotation.x += (0.06 - rig.rightKneePivot.rotation.x) * blend
      }
      if (rig.leftArmPivot) {
        rig.leftArmPivot.rotation.x += (0.08 + twitch * 0.03 - rig.leftArmPivot.rotation.x) * blend
        rig.leftArmPivot.rotation.z += (-0.06 - rig.leftArmPivot.rotation.z) * blend
      }
      if (rig.rightArmPivot) {
        rig.rightArmPivot.rotation.x +=
          (-0.14 - twitch * 0.03 - rig.rightArmPivot.rotation.x) * blend
        rig.rightArmPivot.rotation.z += (0.06 - rig.rightArmPivot.rotation.z) * blend
      }
      if (rig.leftElbowPivot) {
        rig.leftElbowPivot.rotation.x += (-0.24 - rig.leftElbowPivot.rotation.x) * blend
      }
      if (rig.rightElbowPivot) {
        rig.rightElbowPivot.rotation.x += (-0.58 - rig.rightElbowPivot.rotation.x) * blend
      }
      if (rig.leftWristPivot) {
        rig.leftWristPivot.rotation.x += (0.14 - rig.leftWristPivot.rotation.x) * blend
      }
      if (rig.rightWristPivot) {
        rig.rightWristPivot.rotation.x += (-0.1 - rig.rightWristPivot.rotation.x) * blend
      }
      return
    }

    if (this.type === ENEMY_TYPES.BRUTE) {
      const blend = 1 - Math.exp(-8 * delta)
      const hipY = rig.restPose?.hipHeight ?? 1.05
      const hoverWave = Math.sin(this.hoverPhase * 1.15)
      const isAlert =
        this.state === ENEMY_STATES.INVESTIGATE || this.state === ENEMY_STATES.SEARCH

      if (rig.upperBodyPivot) {
        rig.upperBodyPivot.position.y = hipY + hoverWave * 0.036
        rig.upperBodyPivot.rotation.x += (0.11 - rig.upperBodyPivot.rotation.x) * blend
        rig.upperBodyPivot.rotation.y += (0 - rig.upperBodyPivot.rotation.y) * blend
        rig.upperBodyPivot.rotation.z +=
          (0.035 + Math.sin(this.hoverPhase * 0.65) * 0.025 - rig.upperBodyPivot.rotation.z) *
          blend
      }
      if (rig.neckPivot) {
        rig.neckPivot.rotation.x += (0.16 - rig.neckPivot.rotation.x) * blend
        rig.neckPivot.rotation.z +=
          (-0.095 + Math.sin(this.hoverPhase * 0.75) * 0.035 - rig.neckPivot.rotation.z) * blend
      }
      if (rig.headPivot) {
        rig.headPivot.rotation.x +=
          (-0.08 + Math.sin(this.hoverPhase * 0.85) * 0.04 - rig.headPivot.rotation.x) * blend
        rig.headPivot.rotation.z +=
          (0.135 + Math.sin(this.hoverPhase * 1.1 + 0.5) * 0.075 - rig.headPivot.rotation.z) *
          blend
        if (this.state === ENEMY_STATES.IDLE) {
          rig.headPivot.rotation.y +=
            (Math.sin(this.hoverPhase * 0.42) * 0.15 - rig.headPivot.rotation.y) * blend
        }
      }
      if (rig.leftLegPivot) {
        rig.leftLegPivot.rotation.x += (hoverWave * 0.06 - rig.leftLegPivot.rotation.x) * blend
        rig.leftLegPivot.rotation.z += (-0.04 - rig.leftLegPivot.rotation.z) * blend
      }
      if (rig.rightLegPivot) {
        rig.rightLegPivot.rotation.x += (-hoverWave * 0.06 - rig.rightLegPivot.rotation.x) * blend
        rig.rightLegPivot.rotation.z += (0.035 - rig.rightLegPivot.rotation.z) * blend
      }
      const idleArmX = -0.08 + Math.sin(this.hoverPhase * 0.75) * 0.04
      if (rig.leftArmPivot) {
        rig.leftArmPivot.rotation.x += (idleArmX - rig.leftArmPivot.rotation.x) * blend
        rig.leftArmPivot.rotation.z += (-0.08 - rig.leftArmPivot.rotation.z) * blend
      }
      if (rig.rightArmPivot) {
        rig.rightArmPivot.rotation.x += (idleArmX - rig.rightArmPivot.rotation.x) * blend
        rig.rightArmPivot.rotation.z += (0.09 - rig.rightArmPivot.rotation.z) * blend
      }
      if (rig.leftElbowPivot) {
        rig.leftElbowPivot.rotation.x += (-0.3 - rig.leftElbowPivot.rotation.x) * blend
      }
      if (rig.rightElbowPivot) {
        rig.rightElbowPivot.rotation.x += (-0.3 - rig.rightElbowPivot.rotation.x) * blend
      }
      if (rig.leftWristPivot) {
        rig.leftWristPivot.rotation.x += (0.14 - rig.leftWristPivot.rotation.x) * blend
      }
      if (rig.rightWristPivot) {
        rig.rightWristPivot.rotation.x += (0.14 - rig.rightWristPivot.rotation.x) * blend
      }

      this._updatePhantomSpectralEffects(false, isAlert)
      return
    }

    if (rig.leftLegPivot) rig.leftLegPivot.rotation.x *= decay
    if (rig.rightLegPivot) rig.rightLegPivot.rotation.x *= decay
    if (rig.leftArmPivot) rig.leftArmPivot.rotation.x *= decay
    if (rig.rightArmPivot) rig.rightArmPivot.rotation.x *= decay
  }

  /**
   * Queues nearby hiding-spot coordinates when a Hunter inspects a sound or search zone.
   * Respects stealth rules: enemy checks the outside of hiding spots without seeing inside.
   */
  _populateHidingSweep(centerCell, playerContext) {
    if (!this.config.prioritizeHidingAreas || !centerCell) {
      return
    }
    const candidates =
      playerContext?.hidingSpotCells || playerContext?.hidingSpots || null
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return
    }

    const maxCellRadius = Math.max(1, Number(this.config.hidingSearchRadiusCells) || 5)
    const nearby = []

    for (let i = 0; i < candidates.length; i += 1) {
      const spot = candidates[i]
      if (!Number.isInteger(spot?.row) || !Number.isInteger(spot?.col)) continue
      const key = `${spot.row},${spot.col}`
      if (this._checkedHidingKeys.has(key)) continue
      const cellDist =
        Math.abs(spot.row - centerCell.row) + Math.abs(spot.col - centerCell.col)
      if (cellDist <= maxCellRadius) {
        nearby.push({ row: spot.row, col: spot.col, key, dist: cellDist })
      }
    }

    nearby.sort((a, b) => a.dist - b.dist || a.row - b.row || a.col - b.col)
    this._hidingSearchQueue = nearby.slice(0, 3)
  }

  /**
   * Articulates arms, torso, and claws during attack sequence per archetype.
   * progress: 0.0 to 1.0 based on elapsed attackTimer / attackDuration.
   */
  _animateAttack(progress) {
    const rig = this.mesh?.userData?.rig
    if (!rig) return

    if (this.type === ENEMY_TYPES.BRUTE) {
      // The Phantom spectral hovering double-arm overhead cleave & claw lunge
      if (progress < 0.42) {
        const p = progress / 0.42
        if (rig.upperBodyPivot) {
          rig.upperBodyPivot.rotation.x = -0.24 * p
          rig.upperBodyPivot.rotation.z = 0.035 + 0.04 * p
        }
        if (rig.neckPivot) rig.neckPivot.rotation.x = -0.14 * p
        if (rig.headPivot) rig.headPivot.rotation.z = 0.13 + 0.12 * p
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = -1.75 * p
          rig.leftArmPivot.rotation.z = -0.08 - 0.14 * p
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = -1.75 * p
          rig.rightArmPivot.rotation.z = 0.09 + 0.14 * p
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.28 - 0.35 * p
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.28 - 0.35 * p
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = 0.32 * p
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = 0.32 * p
      } else if (progress < 0.7) {
        const p = (progress - 0.42) / 0.28
        if (rig.upperBodyPivot) {
          rig.upperBodyPivot.rotation.x = -0.24 + 0.66 * p
          rig.upperBodyPivot.rotation.z = 0.075 - 0.08 * p
        }
        if (rig.neckPivot) rig.neckPivot.rotation.x = -0.14 + 0.42 * p
        if (rig.headPivot) rig.headPivot.rotation.z = 0.25 - 0.28 * p
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = -1.75 + 2.95 * p
          rig.leftArmPivot.rotation.z = -0.22 + 0.26 * p
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = -1.75 + 2.95 * p
          rig.rightArmPivot.rotation.z = 0.23 - 0.26 * p
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.63 + 0.45 * p
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.63 + 0.45 * p
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = 0.32 - 0.72 * p
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = 0.32 - 0.72 * p
      } else {
        const p = (progress - 0.7) / 0.3
        const decay = 1 - p
        if (rig.upperBodyPivot) {
          rig.upperBodyPivot.rotation.x = 0.42 * decay
          rig.upperBodyPivot.rotation.z = 0.035
        }
        if (rig.neckPivot) rig.neckPivot.rotation.x = 0.28 * decay
        if (rig.headPivot) rig.headPivot.rotation.z = -0.03 * decay + 0.13 * p
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = 1.2 * decay
          rig.leftArmPivot.rotation.z = -0.08
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = 1.2 * decay
          rig.rightArmPivot.rotation.z = 0.09
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.18 * decay - 0.3 * p
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.18 * decay - 0.3 * p
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = -0.4 * decay
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = -0.4 * decay
      }

      this._updatePhantomSpectralEffects(true, false)
      return
    }

    if (this.type === ENEMY_TYPES.HUNTER) {
      // The Revenant desperate opposing cross-slash & neck snap
      if (progress < 0.28) {
        const p = progress / 0.28
        if (rig.upperBodyPivot) {
          rig.upperBodyPivot.rotation.x = 0.24 * p
          rig.upperBodyPivot.rotation.y = 0.16 * p
          rig.upperBodyPivot.rotation.z = -0.08 * p
        }
        if (rig.neckPivot) rig.neckPivot.rotation.x = 0.14 * p
        if (rig.headPivot) rig.headPivot.rotation.z = -0.16 * p
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = -1.12 * p
          rig.leftArmPivot.rotation.z = -0.12 * p
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = 0.52 * p
          rig.rightArmPivot.rotation.z = 0.12 * p
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.78 * p
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.62 * p
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = 0.24 * p
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = 0.18 * p
      } else if (progress < 0.65) {
        const p = (progress - 0.28) / 0.37
        if (rig.upperBodyPivot) {
          rig.upperBodyPivot.rotation.x = 0.24 + 0.18 * p
          rig.upperBodyPivot.rotation.y = 0.16 - 0.34 * p
          rig.upperBodyPivot.rotation.z = -0.08 + 0.14 * p
        }
        if (rig.neckPivot) rig.neckPivot.rotation.x = 0.14 + 0.16 * p
        if (rig.headPivot) rig.headPivot.rotation.z = -0.16 + 0.22 * p
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = -1.12 + 2.22 * p
          rig.leftArmPivot.rotation.z = -0.12 + 0.24 * p
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = 0.52 - 1.72 * p
          rig.rightArmPivot.rotation.z = 0.12 - 0.24 * p
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.78 + 0.56 * p
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.62 + 0.42 * p
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = 0.24 - 0.62 * p
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = 0.18 - 0.54 * p
      } else {
        const p = (progress - 0.65) / 0.35
        const decay = 1 - p
        if (rig.upperBodyPivot) {
          rig.upperBodyPivot.rotation.x = 0.42 * decay
          rig.upperBodyPivot.rotation.y = -0.18 * decay
          rig.upperBodyPivot.rotation.z = 0.06 * decay
        }
        if (rig.neckPivot) rig.neckPivot.rotation.x = 0.3 * decay
        if (rig.headPivot) rig.headPivot.rotation.z = 0.06 * decay
        if (rig.leftArmPivot) {
          rig.leftArmPivot.rotation.x = 1.1 * decay
          rig.leftArmPivot.rotation.z = 0.12 * decay
        }
        if (rig.rightArmPivot) {
          rig.rightArmPivot.rotation.x = -1.2 * decay
          rig.rightArmPivot.rotation.z = -0.12 * decay
        }
        if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.22 * decay
        if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.2 * decay
        if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = -0.38 * decay
        if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = -0.36 * decay
      }
      return
    }

    // The Wraith supernatural lunge & asymmetric twin-claw rake
    if (progress < 0.32) {
      const p = progress / 0.32
      if (rig.upperBodyPivot) rig.upperBodyPivot.rotation.x = -0.2 * p
      if (rig.neckPivot) rig.neckPivot.rotation.x = -0.15 * p
      if (rig.headPivot) rig.headPivot.rotation.z = 0.22 * p
      if (rig.leftArmPivot) {
        rig.leftArmPivot.rotation.x = -1.35 * p
        rig.leftArmPivot.rotation.z = -0.22 * p
      }
      if (rig.rightArmPivot) {
        rig.rightArmPivot.rotation.x = -1.55 * p
        rig.rightArmPivot.rotation.z = 0.22 * p
      }
      if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.82 * p
      if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.92 * p
      if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = 0.35 * p
      if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = 0.35 * p
    } else if (progress < 0.64) {
      const p = (progress - 0.32) / 0.32
      if (rig.upperBodyPivot) rig.upperBodyPivot.rotation.x = -0.2 + 0.62 * p
      if (rig.lowerRobePivot) rig.lowerRobePivot.rotation.x = 0.25 * p
      if (rig.neckPivot) rig.neckPivot.rotation.x = -0.15 + 0.45 * p
      if (rig.headPivot) rig.headPivot.rotation.z = 0.22 - 0.36 * p
      if (rig.leftArmPivot) {
        rig.leftArmPivot.rotation.x = -1.35 + 2.45 * p
        rig.leftArmPivot.rotation.z = -0.22 + 0.34 * p
      }
      if (rig.rightArmPivot) {
        rig.rightArmPivot.rotation.x = -1.55 + 2.65 * p
        rig.rightArmPivot.rotation.z = 0.22 - 0.34 * p
      }
      if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.82 + 0.62 * p
      if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.92 + 0.72 * p
      if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = 0.35 - 0.78 * p
      if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = 0.35 - 0.78 * p
    } else {
      const p = (progress - 0.64) / 0.36
      const decay = 1 - p
      if (rig.upperBodyPivot) rig.upperBodyPivot.rotation.x = 0.42 * decay
      if (rig.lowerRobePivot) rig.lowerRobePivot.rotation.x = 0.25 * decay
      if (rig.neckPivot) rig.neckPivot.rotation.x = 0.3 * decay
      if (rig.headPivot) rig.headPivot.rotation.z = -0.14 * decay
      if (rig.leftArmPivot) {
        rig.leftArmPivot.rotation.x = 1.1 * decay
        rig.leftArmPivot.rotation.z = 0.12 * decay
      }
      if (rig.rightArmPivot) {
        rig.rightArmPivot.rotation.x = 1.1 * decay
        rig.rightArmPivot.rotation.z = -0.12 * decay
      }
      if (rig.leftElbowPivot) rig.leftElbowPivot.rotation.x = -0.2 * decay
      if (rig.rightElbowPivot) rig.rightElbowPivot.rotation.x = -0.2 * decay
      if (rig.leftWristPivot) rig.leftWristPivot.rotation.x = -0.43 * decay
      if (rig.rightWristPivot) rig.rightWristPivot.rotation.x = -0.43 * decay
    }
  }

  /**
   * Main per-frame AI update loop. Handles states, transitions, perception, navigation, and attacks.
   */
  update(delta = 0, playerContext = null, runtimeOptions = null) {
    if (this.isDisposed || !this.maze || !Number.isFinite(delta) || delta <= 0) {
      return null
    }

    this.hoverPhase = (this.hoverPhase + delta * 2.1) % (Math.PI * 2)
    this.repathCooldown -= delta
    this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - delta)

    let distToPlayer = Infinity
    if (playerContext?.playerWorldPos) {
      const dx = playerContext.playerWorldPos.x - this.worldPos.x
      const dz = playerContext.playerWorldPos.z - this.worldPos.z
      distToPlayer = Math.hypot(dx, dz)
    }

    const perception = this._checkPerception(playerContext)
    const isHidden = perception.isHidden
    let attackHit = null

    // --- State Machine Transitions & Updates ---
    switch (this.state) {
      case ENEMY_STATES.ATTACK: {
        // Face player smoothly during attack
        if (playerContext?.playerWorldPos) {
          const dx = playerContext.playerWorldPos.x - this.worldPos.x
          const dz = playerContext.playerWorldPos.z - this.worldPos.z
          const targetYaw = Math.atan2(-dx, -dz)
          let diff = targetYaw - this.yaw
          while (diff > Math.PI) diff -= Math.PI * 2
          while (diff < -Math.PI) diff += Math.PI * 2
          this.yaw += diff * (1 - Math.exp(-14 * delta))
          if (this.mesh) {
            this.mesh.rotation.y = this.yaw
          }
        }

        this.attackTimer += delta
        const attackProgress = Math.min(1, this.attackTimer / this.config.attackDuration)
        this._animateAttack(attackProgress)

        // Damage strike window: check if strike connects at attackHitDelay
        // Ensures exactly one damage event per attack
        if (this.attackTimer >= this.config.attackHitDelay && !this.hasDealtDamageInAttack) {
          this.hasDealtDamageInAttack = true
          // Synchronized check against actual distance between enemy and visible player
          if (!isHidden && distToPlayer <= this.config.attackRange * 1.25) {
            attackHit = {
              enemyId: this.id,
              enemyType: this.type,
              damage: this.config.attackDamage,
              position: { ...this.worldPos },
              playerPos: playerContext.playerWorldPos ? { ...playerContext.playerWorldPos } : null,
            }
          }
        }

        // When attack duration finishes, enter cooldown and transition
        if (this.attackTimer >= this.config.attackDuration) {
          this.attackCooldownTimer = this.config.attackCooldown
          this.attackTimer = 0
          this.hasDealtDamageInAttack = false

          if (!isHidden && (perception.canSee || distToPlayer <= this.config.closeProximityRange)) {
            this.state = ENEMY_STATES.CHASE
            this.repathCooldown = 0
            this._needsImmediateRepath = true
          } else {
            this.state = ENEMY_STATES.INVESTIGATE
            this.investigateTarget = playerContext?.playerGridCell || this.lastKnownPlayerCell
            if (this.investigateTarget) {
              this._tryNavigateToCell(this.investigateTarget, {
                runtimeOptions,
                urgent: true,
              })
            }
          }
        }
        break
      }

      case ENEMY_STATES.CHASE: {
        // Close-range attack check
        if (!isHidden && distToPlayer <= this.config.attackRange && this.attackCooldownTimer <= 0) {
          this.state = ENEMY_STATES.ATTACK
          this.attackTimer = 0
          this.hasDealtDamageInAttack = false
          break
        }

        if (perception.canSee) {
          this.awareness = 1.0
          this.loseSightTimer = this.config.loseSightDuration
          this.lastKnownPlayerPos = { ...playerContext.playerWorldPos }
          this.lastKnownPlayerCell = playerContext.playerGridCell
            ? { ...playerContext.playerGridCell }
            : worldToGrid(playerContext.playerWorldPos.x, playerContext.playerWorldPos.z, this.maze)

          // Re-path immediately on transition/danger/stuck, or staggered when target cell changes
          if (this.lastKnownPlayerCell && (this._needsImmediateRepath || this.repathCooldown <= 0)) {
            const hasRemainingPath =
              this.currentPathWaypoints.length > 0 &&
              this.currentPathIndex < this.currentPathWaypoints.length
            const targetChanged =
              !this.targetGridCell ||
              this.lastKnownPlayerCell.row !== this.targetGridCell.row ||
              this.lastKnownPlayerCell.col !== this.targetGridCell.col
            const urgentCloseRange =
              distToPlayer <= Math.max(4.5, (this.config.closeProximityRange || 2.0) * 2.0)

            if (
              this._needsImmediateRepath ||
              targetChanged ||
              !hasRemainingPath ||
              urgentCloseRange ||
              this._chaseStuckCount >= 3
            ) {
              const urgent = Boolean(
                this._needsImmediateRepath ||
                  urgentCloseRange ||
                  !this.targetGridCell ||
                  !hasRemainingPath ||
                  this._chaseStuckCount >= 3
              )
              const planned = this._tryNavigateToCell(this.lastKnownPlayerCell, {
                runtimeOptions,
                urgent,
              })
              if (planned) {
                this._needsImmediateRepath = false
                this._chaseStuckCount = 0
                this.repathCooldown = this._getChaseRepathInterval()
              }
            } else {
              this.repathCooldown = this._getChaseRepathInterval()
            }
          }
        } else {
          // Lost direct line of sight
          this.loseSightTimer -= delta
          if (this.loseSightTimer <= 0) {
            // Give up chase and investigate last known position
            this.state = ENEMY_STATES.INVESTIGATE
            this.investigateTarget = this.lastKnownPlayerCell
            this._chaseStuckCount = 0
            this._tryNavigateToCell(this.investigateTarget, {
              runtimeOptions,
              urgent: true,
            })
            break
          }
        }

        const chaseMove = this._moveAlongPath(this.config.chaseSpeed, delta)
        this._chaseStuckCount =
          chaseMove.moved || chaseMove.arrived ? 0 : this._chaseStuckCount + 1
        break
      }

      case ENEMY_STATES.INVESTIGATE: {
        // If enemy sees player within attack range, strike immediately
        if (perception.canSee && distToPlayer <= this.config.attackRange && this.attackCooldownTimer <= 0) {
          this.state = ENEMY_STATES.ATTACK
          this.attackTimer = 0
          this.hasDealtDamageInAttack = false
          break
        }

        if (perception.canSee) {
          this.state = ENEMY_STATES.CHASE
          this.repathCooldown = 0
          this._needsImmediateRepath = true
          break
        }

        // Hunters actively re-focus on fresh heard sounds while already investigating
        if (this.config.prioritizeHidingAreas && perception.canHear && perception.heardCell) {
          const hCell = perception.heardCell
          if (
            !this.investigateTarget ||
            hCell.row !== this.investigateTarget.row ||
            hCell.col !== this.investigateTarget.col
          ) {
            this.investigateTarget = hCell
            this._tryNavigateToCell(hCell, { runtimeOptions, urgent: true })
            this._populateHidingSweep(hCell, playerContext)
          }
        }

        const moveRes = this._moveAlongPath(this.config.investigateSpeed, delta)
        if (moveRes.arrived) {
          if (this.config.prioritizeHidingAreas) {
            this._populateHidingSweep(this.investigateTarget || this.getGridCell(), playerContext)
          }
          // Arrived at investigation spot -> search area (and nearby hiding spots for Hunter)
          this.state = ENEMY_STATES.SEARCH
          this.searchTimer = this.config.searchDuration
        }
        break
      }

      case ENEMY_STATES.SEARCH: {
        if (perception.canSee && distToPlayer <= this.config.attackRange && this.attackCooldownTimer <= 0) {
          this.state = ENEMY_STATES.ATTACK
          this.attackTimer = 0
          this.hasDealtDamageInAttack = false
          break
        }

        if (perception.canSee) {
          this.state = ENEMY_STATES.CHASE
          this.repathCooldown = 0
          this._needsImmediateRepath = true
          break
        }

        // Hunters sweep adjacent hiding spots sequentially without seeing inside
        if (this.config.prioritizeHidingAreas) {
          if (this.currentPathIndex < this.currentPathWaypoints.length) {
            const sweepRes = this._moveAlongPath(this.config.patrolSpeed * 1.1, delta)
            if (sweepRes.arrived) {
              this.currentPathWaypoints = []
              this.currentPathIndex = 0
            }
          } else if (this._hidingSearchQueue.length > 0) {
            const nextSpot = this._hidingSearchQueue.shift()
            if (nextSpot) {
              this._checkedHidingKeys.add(nextSpot.key)
              this._tryNavigateToCell(
                { row: nextSpot.row, col: nextSpot.col },
                { runtimeOptions, urgent: true }
              )
            }
          } else {
            this._dampLimbs(delta)
          }
        } else {
          this._dampLimbs(delta)
        }

        this.searchTimer -= delta

        // Sweep head sensor back and forth while searching
        const rig = this.mesh?.userData?.rig
        if (rig?.headPivot) {
          const sweepSpeed = this.type === ENEMY_TYPES.HUNTER ? 5.6 : 3.8
          const sweepAmp = this.type === ENEMY_TYPES.HUNTER ? 0.92 : 0.65
          rig.headPivot.rotation.y = Math.sin(this.searchTimer * sweepSpeed) * sweepAmp
        }

        if (this.searchTimer <= 0) {
          if (rig?.headPivot) rig.headPivot.rotation.y = 0
          this._hidingSearchQueue = []
          this._checkedHidingKeys.clear()
          this.state = ENEMY_STATES.PATROL
          this.currentPathWaypoints = []
          this.currentPathIndex = 0
        }
        break
      }

      case ENEMY_STATES.IDLE: {
        if (perception.canSee && distToPlayer <= this.config.attackRange && this.attackCooldownTimer <= 0) {
          this.state = ENEMY_STATES.ATTACK
          this.attackTimer = 0
          this.hasDealtDamageInAttack = false
          break
        }

        if (perception.canSee) {
          this.awareness += delta / this.config.detectionDelay
          if (this.awareness >= 1.0) {
            this.state = ENEMY_STATES.CHASE
            this.repathCooldown = 0
            this._needsImmediateRepath = true
            break
          }
        } else if (perception.canHear) {
          const soundCell =
            perception.heardCell ||
            playerContext.playerGridCell ||
            worldToGrid(playerContext.playerWorldPos.x, playerContext.playerWorldPos.z, this.maze)
          if (soundCell) {
            this.state = ENEMY_STATES.INVESTIGATE
            this.investigateTarget = soundCell
            this._tryNavigateToCell(soundCell, { runtimeOptions, urgent: true })
            if (this.config.prioritizeHidingAreas) {
              this._populateHidingSweep(soundCell, playerContext)
            }
            break
          }
        } else {
          this.awareness = Math.max(0, this.awareness - delta * 1.5)
        }

        this._dampLimbs(delta)
        this.idleTimer -= delta

        if (this.idleTimer <= 0) {
          this.state = ENEMY_STATES.PATROL
          if (this.patrolRoute.length > 0) {
            this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolRoute.length
            this._tryNavigateToCell(this.patrolRoute[this.currentPatrolIndex], {
              runtimeOptions,
              urgent: false,
            })
          }
        }
        break
      }

      case ENEMY_STATES.PATROL:
      default: {
        if (perception.canSee && distToPlayer <= this.config.attackRange && this.attackCooldownTimer <= 0) {
          this.state = ENEMY_STATES.ATTACK
          this.attackTimer = 0
          this.hasDealtDamageInAttack = false
          break
        }

        if (perception.canSee) {
          this.awareness += delta / this.config.detectionDelay
          if (this.awareness >= 1.0) {
            this.state = ENEMY_STATES.CHASE
            this.repathCooldown = 0
            this._needsImmediateRepath = true
            break
          }
        } else if (perception.canHear) {
          const soundCell =
            perception.heardCell ||
            playerContext.playerGridCell ||
            worldToGrid(playerContext.playerWorldPos.x, playerContext.playerWorldPos.z, this.maze)
          if (soundCell) {
            this.state = ENEMY_STATES.INVESTIGATE
            this.investigateTarget = soundCell
            this._tryNavigateToCell(soundCell, { runtimeOptions, urgent: true })
            if (this.config.prioritizeHidingAreas) {
              this._populateHidingSweep(soundCell, playerContext)
            }
            break
          }
        } else {
          this.awareness = Math.max(0, this.awareness - delta * 1.5)
        }

        // Hunters scan slightly side-to-side while stalking corridors
        const rig = this.mesh?.userData?.rig
        if (rig?.headPivot) {
          rig.headPivot.rotation.y =
            this.type === ENEMY_TYPES.HUNTER
              ? Math.sin(this.stridePhase * 0.5) * 0.35
              : 0
        }

        let awaitingDeferredPatrolPath = false
        if (this.currentPathWaypoints.length === 0 && this.patrolRoute.length > 0) {
          const targetPatrol = this.patrolRoute[this.currentPatrolIndex]
          const curCell = this.getGridCell()
          const alreadyAtTarget =
            curCell &&
            targetPatrol &&
            curCell.row === targetPatrol.row &&
            curCell.col === targetPatrol.col
          if (!alreadyAtTarget) {
            const planned = this._tryNavigateToCell(targetPatrol, {
              runtimeOptions,
              urgent: false,
            })
            if (!planned && this.currentPathWaypoints.length === 0) {
              awaitingDeferredPatrolPath = true
            }
          }
        }

        if (awaitingDeferredPatrolPath) {
          this._dampLimbs(delta)
        } else {
          const moveRes = this._moveAlongPath(this.config.patrolSpeed, delta)
          if (moveRes.arrived) {
            this.state = ENEMY_STATES.IDLE
            this.idleTimer = this.config.idleDuration
            this.currentPathWaypoints = []
            this.currentPathIndex = 0
          }
        }
        break
      }
    }

    // Keep eye sensor light and color synced with AI state
    updateEnemyVisualState(this.mesh, this.state)

    return {
      attackHit,
      state: this.state,
      enemyType: this.type,
      worldPos: { ...this.worldPos },
    }
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true

    this.resetAttackState()

    if (this.mesh) {
      disposeEnemy(this.mesh)
      this.mesh = null
    }

    this.maze = null
    this.patrolRoute = []
    this.currentPathWaypoints = []
    this._hidingSearchQueue = []
    this._checkedHidingKeys.clear()
    this.lastKnownPlayerPos = null
    this.lastKnownPlayerCell = null
    this.investigateTarget = null

    return true
  }
}

