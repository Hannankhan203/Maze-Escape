import { strict as assert } from 'node:assert'
import { generateMaze } from '../generation/mazeGenerator.js'
import { placeCollectibles, STANDARD_COLLECTIBLE_SPAWN_COUNTS } from '../generation/collectiblePlacement.js'
import { exploreReachableCells } from '../generation/pathfinder.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import { gameReducer, createInitialGameState } from '../engine/gameReducer.js'
import { COLLECTIBLE_TYPES, COLLECTIBLE_CONFIG } from '../mechanics/collectiblesConfig.js'
import {
  createExplorationState,
  isCellDiscovered,
  revealPathsInRadius,
  renderMinimapCanvas,
} from '../mechanics/minimap.js'
import { EnemyAgent, ENEMY_STATES } from './EnemyAgent.js'
import { CollectibleManager } from './CollectibleManager.js'
import { buildCollectibleItemMesh, disposeObject3D } from './buildCollectibles.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { triggerCollectiblePickupCue } from './audioSynthesis.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
import { HAPTIC_PATTERNS, triggerHapticForGameEvent } from '../../utils/haptics.js'
import { disposeAllSharedPools } from './sharedResources.js'

function createMockRenderer() {
  const renderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: {
      enabled: false,
      type: null,
      needsUpdate: false,
    },
    pixelRatio: 1,
    setPixelRatio: (r) => {
      renderer.pixelRatio = r
    },
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    getContext: () => null,
  }
  return renderer
}

function createHeadlessEngine(config = {}) {
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 1280,
    clientHeight: 720,
  }
  const mockRenderer = createMockRenderer()
  return new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    isSoftwareGl: false,
    lowPerformance: false,
    skipSpawnSequence: true,
    ...config,
  })
}

function createOpenCorridorMaze(rows = 15, cols = 29) {
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      r === 0 || r === rows - 1 || c === 0 || c === cols - 1
        ? CELL_TYPES.WALL
        : CELL_TYPES.PATH
    )
  )
  return {
    id: `open-corridor-${rows}x${cols}`,
    rows,
    cols,
    grid,
    start: { row: Math.floor(rows / 2), col: 2 },
    exit: { row: Math.floor(rows / 2), col: cols - 3 },
  }
}

function createMockAudioCtx() {
  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
    setTargetAtTime: () => {},
  })
  const makeNode = () => ({
    connect: () => {},
    disconnect: () => {},
    gain: makeParam(1),
    frequency: makeParam(440),
    Q: makeParam(1),
    type: 'sine',
    start: () => {},
    stop: () => {},
  })
  return {
    currentTime: 0,
    state: 'running',
    createOscillator: makeNode,
    createGain: makeNode,
    createBiquadFilter: makeNode,
    createBufferSource: () => ({
      ...makeNode(),
      buffer: null,
    }),
  }
}

function createMockCanvas() {
  const calls = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    setTransform: () => {},
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    strokeRect: (...args) => calls.push(['strokeRect', ...args]),
    beginPath: () => calls.push(['beginPath']),
    closePath: () => calls.push(['closePath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    arc: (...args) => calls.push(['arc', ...args]),
    ellipse: (...args) => calls.push(['ellipse', ...args]),
    fill: () => calls.push(['fill']),
    stroke: () => calls.push(['stroke']),
  }
  return {
    width: 156,
    height: 156,
    calls,
    getContext: (kind) => (kind === '2d' ? ctx : null),
  }
}

export function runPhase4AdvancedCollectiblesTests() {
  console.log('Running Phase 4 Advanced Horror Collectibles Tests...')
  disposeAllSharedPools()

  // =========================================================================
  // 1. Spawn Distribution, Placement, Overlap Prevention & BFS Reachability
  // =========================================================================
  {
    const phase4Types = [
      COLLECTIBLE_TYPES.TIME_FRAGMENT,
      COLLECTIBLE_TYPES.WATCHERS_EYE,
      COLLECTIBLE_TYPES.ECHO_PULSE,
      COLLECTIBLE_TYPES.SPIRIT_LANTERN,
    ]
    const counts = STANDARD_COLLECTIBLE_SPAWN_COUNTS

    for (const seed of [8484, 9595]) {
      const maze = generateMaze({ seed })
      const placement = placeCollectibles(maze, {
        hazards: maze.hazards || [],
        hidingSpots: maze.hidingSpots || [],
        keycards: maze.keycards || [],
      })

      assert.ok(Array.isArray(placement.items), `Placement items exist for seed ${seed}`)
      assert.equal(placement.coins.length, 0, 'Legacy coins array stays empty')
      assert.equal(placement.powerUps.length, 0, 'Legacy powerUps array stays empty')
      const reachable = exploreReachableCells(maze.grid, maze.start)
      const occupied = new Set()

      for (const item of placement.items) {
        const key = `${item.row},${item.col}`
        assert.equal(occupied.has(key), false, `No duplicate collectible at ${key} (seed ${seed})`)
        occupied.add(key)
        assert.notEqual(
          `${maze.start.row},${maze.start.col}`,
          key,
          `Collectible does not overlap start (seed ${seed})`
        )
        assert.notEqual(
          `${maze.exit.row},${maze.exit.col}`,
          key,
          `Collectible does not overlap exit (seed ${seed})`
        )
        assert.equal(
          maze.grid[item.row][item.col],
          CELL_TYPES.PATH,
          `Collectible ${item.type} placed on walkable path (seed ${seed})`
        )
        if (phase4Types.includes(item.type)) {
          assert.equal(
            reachable.distances.has(key),
            true,
            `Phase 4 collectible ${item.type} is BFS reachable (seed ${seed})`
          )
        }
      }

      for (const type of phase4Types) {
        const spawned = placement.items.filter((i) => i.type === type)
        assert.equal(
          spawned.length,
          counts[type],
          `Correct ${type} spawn count (${counts[type]}) for seed ${seed}`
        )
      }
    }
  }

  // =========================================================================
  // 2. Procedural 3D Meshes & Burst Colors for All 4 Phase 4 Collectibles
  // =========================================================================
  {
    const cm = new CollectibleManager()
    const testMaze = createOpenCorridorMaze(11, 15)
    cm.setMaze(testMaze)

    const mockItems = [
      { id: 'tf-1', type: COLLECTIBLE_TYPES.TIME_FRAGMENT, row: 2, col: 3 },
      { id: 'we-1', type: COLLECTIBLE_TYPES.WATCHERS_EYE, row: 2, col: 5 },
      { id: 'ep-1', type: COLLECTIBLE_TYPES.ECHO_PULSE, row: 2, col: 7 },
      { id: 'sl-1', type: COLLECTIBLE_TYPES.SPIRIT_LANTERN, row: 2, col: 9 },
    ]
    cm.syncItems(mockItems, testMaze, { spawnBursts: false })
    assert.equal(cm.getCounts().items, 4, 'All 4 Phase 4 collectibles mount cleanly in CollectibleManager')

    for (const item of mockItems) {
      const built = buildCollectibleItemMesh(item)
      assert.equal(built.userData.type, item.type, `Mesh metadata type matches ${item.type}`)
      assert.ok(built.children.length >= 2, `Distinct procedural parts generated for ${item.type}`)
      disposeObject3D(built)
    }

    cm.update(0.05)
    cm.syncItems([], testMaze, { spawnBursts: true })
    assert.equal(cm.getCounts().items, 0, 'Collected items removed cleanly')
    assert.equal(cm.getCounts().bursts, 4, 'Distinct collection bursts spawned for all 4 items')
    cm.dispose()
  }

  // =========================================================================
  // 3. Time Fragment: Duration (5s), 50% Speed Reduction, 8-Tile Dynamic Radius & Cleanup
  // =========================================================================
  {
    let state = createInitialGameState(101)
    const tfItem = state.items.find((i) => i.type === COLLECTIBLE_TYPES.TIME_FRAGMENT)
    assert.ok(tfItem, 'Time Fragment spawned in medium game state')

    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: tfItem.row, col: tfItem.col })
    assert.equal(
      state.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT],
      1,
      'Time Fragment is stored in inventory on pickup'
    )
    assert.equal(
      state.activeEffects.timeFragmentRemainingMs,
      0,
      'Time Fragment does NOT activate automatically on pickup'
    )
    const itemsAfterPickup = state.items.length
    // Revisiting same cell cannot duplicate collection
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: tfItem.row, col: tfItem.col })
    assert.equal(state.items.length, itemsAfterPickup, 'No duplicate pickup on same cell')
    assert.equal(state.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT], 1)

    state = gameReducer(state, { type: 'ACTIVATE_TIME_FRAGMENT' })
    assert.equal(
      state.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT],
      0,
      'Time Fragment consumes 1 stored charge on manual activation'
    )
    assert.equal(
      state.activeEffects.timeFragmentRemainingMs,
      5000,
      'Time Fragment activates manually with exact 5000ms (5s) duration'
    )
    assert.equal(
      COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.TIME_FRAGMENT].durationMs,
      5000,
      'Time Fragment config duration is 5000ms'
    )

    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 2500 })
    assert.equal(state.activeEffects.timeFragmentRemainingMs, 2500)
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 2500 })
    assert.equal(state.activeEffects.timeFragmentRemainingMs, 0, 'Time Fragment expires after 5s')

    // Radius, 50% speed reduction, dynamic entry/exit, and non-mutation of base stats
    const openMaze = createOpenCorridorMaze(15, 31)
    const baseEnemy = new EnemyAgent('tf-normal', {
      maze: openMaze,
      spawnCell: { row: 7, col: 6 },
      patrolRoute: [{ row: 7, col: 25 }, { row: 7, col: 6 }],
    })
    const slowEnemy = new EnemyAgent('tf-slowed', {
      maze: openMaze,
      spawnCell: { row: 7, col: 6 },
      patrolRoute: [{ row: 7, col: 25 }, { row: 7, col: 6 }],
    })
    const originalPatrolSpeed = slowEnemy.config.patrolSpeed
    const originalChaseSpeed = slowEnemy.config.chaseSpeed

    const playerOrigin = gridToWorld(7, 2, openMaze) // 4 tiles away (< 8 tiles)
    const stepDt = 0.08
    const baseStartZ = baseEnemy.worldPos.z
    const baseStartX = baseEnemy.worldPos.x
    for (let i = 0; i < 4; i += 1) {
      baseEnemy.update(stepDt, {
        playerWorldPos: playerOrigin,
        playerHidden: true,
        activeEffects: null,
      })
      slowEnemy.update(stepDt, {
        playerWorldPos: playerOrigin,
        playerHidden: true,
        activeEffects: { timeFragmentRemainingMs: 4000 },
      })
    }

    const baseDisp = Math.hypot(baseEnemy.worldPos.x - baseStartX, baseEnemy.worldPos.z - baseStartZ)
    const slowDisp = Math.hypot(slowEnemy.worldPos.x - baseStartX, slowEnemy.worldPos.z - baseStartZ)
    assert.ok(baseDisp > 0.5, 'Normal enemy moves cleanly along patrol route')
    assert.ok(
      Math.abs(slowDisp / baseDisp - 0.5) < 0.08,
      `Time Fragment slows enemy movement by 50% (ratio=${(slowDisp / baseDisp).toFixed(3)})`
    )
    assert.equal(slowEnemy.isTimeSlowed, true)
    assert.equal(slowEnemy.speedMultiplier, 0.5)
    assert.equal(slowEnemy.config.patrolSpeed, originalPatrolSpeed, 'Base patrolSpeed is never mutated')
    assert.equal(slowEnemy.config.chaseSpeed, originalChaseSpeed, 'Base chaseSpeed is never mutated')
    assert.ok(
      Number.isFinite(slowEnemy.stridePhase),
      'Enemy animation stridePhase remains valid under Time Fragment'
    )

    // Enemy outside 8 tiles (e.g. col 14 => 12 tiles away) is unaffected
    const farWorld = gridToWorld(7, 14, openMaze)
    slowEnemy.setPosition(farWorld.x, 0, farWorld.z)
    slowEnemy.update(0.05, {
      playerWorldPos: playerOrigin,
      playerHidden: true,
      activeEffects: { timeFragmentRemainingMs: 4000 },
    })
    assert.equal(slowEnemy.isTimeSlowed, false, 'Enemy outside 8-tile radius is not slowed')
    assert.equal(slowEnemy.speedMultiplier, 1, 'Speed multiplier is 1 outside radius')

    // Moving inside 8 tiles activates slow dynamically
    const insideWorld = gridToWorld(7, 8, openMaze) // 6 tiles away
    slowEnemy.setPosition(insideWorld.x, 0, insideWorld.z)
    slowEnemy.update(0.05, {
      playerWorldPos: playerOrigin,
      playerHidden: true,
      activeEffects: { timeFragmentRemainingMs: 3000 },
    })
    assert.equal(slowEnemy.isTimeSlowed, true, 'Enemy entering 8-tile radius becomes slowed')
    assert.equal(slowEnemy.speedMultiplier, 0.5)

    // Leaving 8 tiles restores speed immediately
    const outsideWorld = gridToWorld(7, 13, openMaze) // 11 tiles away
    slowEnemy.setPosition(outsideWorld.x, 0, outsideWorld.z)
    slowEnemy.update(0.05, {
      playerWorldPos: playerOrigin,
      playerHidden: true,
      activeEffects: { timeFragmentRemainingMs: 2500 },
    })
    assert.equal(slowEnemy.isTimeSlowed, false, 'Enemy leaving 8-tile radius returns to normal speed')
    assert.equal(slowEnemy.speedMultiplier, 1)

    // Expiration & reset cleanup
    slowEnemy.setPosition(insideWorld.x, 0, insideWorld.z)
    slowEnemy.update(0.05, {
      playerWorldPos: playerOrigin,
      playerHidden: true,
      activeEffects: { timeFragmentRemainingMs: 1000 },
    })
    assert.equal(slowEnemy.isTimeSlowed, true)
    slowEnemy.update(0.05, {
      playerWorldPos: playerOrigin,
      playerHidden: true,
      activeEffects: { timeFragmentRemainingMs: 0 },
    })
    assert.equal(slowEnemy.isTimeSlowed, false, 'Time Fragment expiration restores normal speed')
    assert.equal(slowEnemy.speedMultiplier, 1)

    baseEnemy.dispose()
    slowEnemy.dispose()
  }

  // =========================================================================
  // 4. Watcher's Eye: 6s Duration, 10-Tile Through-Wall Reveal & Cleanup
  // =========================================================================
  {
    let state = createInitialGameState(202)
    const eyeItem = state.items.find((i) => i.type === COLLECTIBLE_TYPES.WATCHERS_EYE)
    assert.ok(eyeItem, "Watcher's Eye spawned in medium game state")
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: eyeItem.row, col: eyeItem.col })
    assert.equal(
      state.inventory[COLLECTIBLE_TYPES.WATCHERS_EYE],
      1,
      "Watcher's Eye is stored in inventory on pickup"
    )
    assert.equal(
      state.activeEffects.watchersEyeRemainingMs,
      0,
      "Watcher's Eye does NOT activate automatically on pickup"
    )
    state = gameReducer(state, { type: 'ACTIVATE_WATCHERS_EYE' })
    assert.equal(
      state.inventory[COLLECTIBLE_TYPES.WATCHERS_EYE],
      0,
      "Watcher's Eye consumes 1 stored charge on manual activation"
    )
    assert.equal(
      state.activeEffects.watchersEyeRemainingMs,
      6000,
      "Watcher's Eye activates manually with exact 6000ms (6s) duration"
    )
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 6000 })
    assert.equal(state.activeEffects.watchersEyeRemainingMs, 0, "Watcher's Eye expires after 6s")

    const walledMaze = generateMaze({ difficulty: 'medium', seed: 999 })
    const startWorld = gridToWorld(walledMaze.start.row, walledMaze.start.col, walledMaze)
    const enemy = new EnemyAgent('eye-stalker', {
      maze: walledMaze,
      spawnCell: walledMaze.start,
    })

    // Position enemy 6 tiles away (within 10 tiles, even across maze walls)
    enemy.setPosition(startWorld.x + 6 * CELL_SIZE, 0, startWorld.z)
    const initialState = enemy.state
    enemy.update(0.05, {
      playerWorldPos: startWorld,
      playerHidden: true,
      activeEffects: { watchersEyeRemainingMs: 5000 },
    })
    assert.equal(enemy.isWatchersEyeRevealed, true, 'Enemy within 10 tiles is revealed')
    const revealGroup = enemy.getMesh().userData.watchersEyeReveal
    assert.ok(revealGroup, 'Through-wall reveal group created on enemy mesh')
    assert.equal(revealGroup.visible, true, 'Reveal overlay is visible when revealed')
    const hullMesh = revealGroup.userData?.hullMesh || revealGroup.children[0]
    assert.ok(hullMesh, 'Through-wall silhouette mesh exists')
    assert.equal(
      hullMesh.material.depthTest,
      false,
      'Through-wall silhouette disables depthTest to render through walls'
    )
    assert.equal(
      hullMesh.material.depthWrite,
      false,
      'Through-wall silhouette disables depthWrite'
    )
    assert.equal(
      hullMesh.renderOrder >= 60,
      true,
      'Through-wall silhouette uses elevated renderOrder'
    )
    assert.notEqual(
      enemy.getMesh().userData.highContrastOutline,
      revealGroup,
      "Watcher's Eye effect is distinct from High Contrast outline"
    )
    assert.equal(enemy.state, initialState, "Watcher's Eye does not alter enemy AI state")

    // Move enemy outside 10 tiles (11.5 tiles away)
    enemy.setPosition(startWorld.x + 11.5 * CELL_SIZE, 0, startWorld.z)
    enemy.update(0.05, {
      playerWorldPos: startWorld,
      playerHidden: true,
      activeEffects: { watchersEyeRemainingMs: 4000 },
    })
    assert.equal(enemy.isWatchersEyeRevealed, false, 'Enemy outside 10 tiles is not revealed')
    assert.equal(revealGroup.visible, false, 'Reveal overlay hides outside 10 tiles')

    // Move enemy back inside 10 tiles dynamically
    enemy.setPosition(startWorld.x + 9 * CELL_SIZE, 0, startWorld.z)
    enemy.update(0.05, {
      playerWorldPos: startWorld,
      playerHidden: true,
      activeEffects: { watchersEyeRemainingMs: 3000 },
    })
    assert.equal(enemy.isWatchersEyeRevealed, true, 'Dynamic movement re-reveals enemy within 10 tiles')
    assert.equal(revealGroup.visible, true)

    // Expiration cleanup
    enemy.update(0.05, {
      playerWorldPos: startWorld,
      playerHidden: true,
      activeEffects: { watchersEyeRemainingMs: 0 },
    })
    assert.equal(enemy.isWatchersEyeRevealed, false, 'Reveal removed upon expiration')
    assert.equal(revealGroup.visible, false)

    // Reset cleanup
    enemy.setWatchersEyeReveal(true, 1.0)
    assert.equal(enemy.isWatchersEyeRevealed, true)
    enemy.resetAttackState()
    assert.equal(enemy.isWatchersEyeRevealed, false, 'Reveal cleaned up on resetAttackState()')
    assert.equal(revealGroup.visible, false)

    enemy.dispose()
  }

  // =========================================================================
  // 5. Echo Pulse: 6-Tile Radius, 2s Stun, Interrupts All AI States, Dedup & Recovery
  // =========================================================================
  {
    let state = createInitialGameState(303)
    const pulseItem = state.items.find((i) => i.type === COLLECTIBLE_TYPES.ECHO_PULSE)
    assert.ok(pulseItem, 'Echo Pulse spawned in medium game state')
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: pulseItem.row, col: pulseItem.col })
    assert.equal(state.lastEvent?.type, 'item_collected')
    assert.equal(state.lastEvent?.item?.type, COLLECTIBLE_TYPES.ECHO_PULSE)
    assert.equal(state.lastEvent?.echoPulse, null, 'Pickup does NOT emit echoPulse shockwave automatically')
    assert.equal(state.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 1, 'Echo Pulse is stored in inventory on pickup')

    state = gameReducer(state, { type: 'ACTIVATE_ECHO_PULSE' })
    assert.equal(state.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 0, 'Echo Pulse consumes 1 stored charge on manual activation')
    assert.equal(state.lastEvent?.type, 'ability_activated')
    assert.equal(state.lastEvent?.abilityType, COLLECTIBLE_TYPES.ECHO_PULSE)
    assert.ok(state.lastEvent?.echoPulse, 'Manual activation emits echoPulse event payload')
    assert.equal(state.lastEvent.echoPulse.radius, 6)
    assert.equal(state.lastEvent.echoPulse.duration, 2000)

    const openMaze = createOpenCorridorMaze(15, 31)
    const engine = createHeadlessEngine()
    engine.setMaze(openMaze)
    const playerOrigin = gridToWorld(7, 5, openMaze)
    engine.setPlayerWorldPosition(playerOrigin.x, 0, playerOrigin.z, { immediate: true })

    // Spawn 3 enemies: chasing/attacking inside 6 tiles, investigating inside 6 tiles, patrolling outside 6 tiles
    const chaser = engine.enemyManager.spawnEnemy({
      id: 'ep-chaser',
      spawnCell: { row: 7, col: 7 },
    })
    chaser.state = ENEMY_STATES.ATTACK
    chaser._attackWindupElapsed = 0.2

    const investigator = engine.enemyManager.spawnEnemy({
      id: 'ep-investigator',
      spawnCell: { row: 7, col: 10 }, // 5 tiles away (< 6)
    })
    investigator.state = ENEMY_STATES.INVESTIGATE
    investigator.investigateTarget = { x: playerOrigin.x, z: playerOrigin.z }

    const farEnemy = engine.enemyManager.spawnEnemy({
      id: 'ep-far',
      spawnCell: { row: 7, col: 14 }, // 9 tiles away (> 6)
    })

    // Pickup event alone must NOT trigger Echo Pulse stun or wave ring
    engine.handleGameEvent({
      id: 776,
      type: 'item_collected',
      item: { ...pulseItem, row: 7, col: 5 },
      echoPulse: null,
    })
    assert.equal(chaser.isStunned, false, 'Pickup item_collected event does not stun enemies')
    assert.equal(engine.collectibleManager.getCounts().echoPulses, 0, 'Pickup does not spawn wave ring')

    // Dispatch manual Echo Pulse game event
    engine.handleGameEvent({
      id: 777,
      type: 'ability_activated',
      abilityType: COLLECTIBLE_TYPES.ECHO_PULSE,
      echoPulse: {
        radius: 6,
        duration: 2000,
        position: { row: 7, col: 5 },
      },
    })

    assert.equal(chaser.isStunned, true, 'Attacking/chasing enemy within 6 tiles is stunned')
    assert.equal(chaser.state, ENEMY_STATES.CHASE, 'Cancelled ATTACK restores logical base state (CHASE)')
    assert.equal(investigator.isStunned, true, 'Investigating enemy within 6 tiles is stunned')
    assert.equal(farEnemy.isStunned, false, 'Enemy outside 6 tiles is unaffected by Echo Pulse')
    assert.equal(
      engine.collectibleManager.getCounts().echoPulses,
      1,
      'Visible 3D Echo Pulse wave ring spawned in scene'
    )

    // Duplicate application from same event ID must be blocked
    const dupRes = engine.triggerEchoPulse(playerOrigin, { eventId: 777 })
    assert.equal(dupRes.duplicate, true, 'Single Echo Pulse activation cannot re-apply stun')
    const dupMgrRes = engine.enemyManager.applyEchoPulse(playerOrigin, { eventId: 777 })
    assert.equal(dupMgrRes.duplicate, true)

    // Step 1.0s while stunned: enemies cannot move or land attacks
    const chaserXBefore = chaser.worldPos.x
    const chaserZBefore = chaser.worldPos.z
    const invXBefore = investigator.worldPos.x
    const invZBefore = investigator.worldPos.z
    let anyDamageHit = false
    for (let i = 0; i < 20; i += 1) {
      const prevHp = engine.health
      engine.stepFrame(0.05, { render: false })
      if (engine.health < prevHp) anyDamageHit = true
    }
    assert.equal(anyDamageHit, false, 'Stunned enemies cannot attack or damage player')
    assert.equal(chaser.worldPos.x, chaserXBefore, 'Stunned chaser X remains frozen')
    assert.equal(chaser.worldPos.z, chaserZBefore, 'Stunned chaser Z remains frozen')
    assert.equal(investigator.worldPos.x, invXBefore, 'Stunned investigator X remains frozen')
    assert.equal(investigator.worldPos.z, invZBefore, 'Stunned investigator Z remains frozen')
    assert.equal(chaser.isStunned, true, 'Stun still active at ~1.0s of 2.0s duration')

    // Step remaining > 1.05s to finish 2.0s stun & confirm natural recovery
    for (let i = 0; i < 25; i += 1) {
      engine.stepFrame(0.05, { render: false })
    }
    assert.equal(chaser.isStunned, false, 'Stun expires cleanly after 2 seconds')
    assert.equal(investigator.isStunned, false, 'Investigator recovers cleanly after 2 seconds')
    assert.ok(
      Object.values(ENEMY_STATES).includes(chaser.state),
      'Recovered enemy remains in valid AI state'
    )
    // Wave ring completes and recycles cleanly
    assert.equal(
      engine.collectibleManager.getCounts().echoPulses,
      0,
      'Echo Pulse 3D wave ring completes animation and cleans up'
    )

    engine.dispose()
  }

  // =========================================================================
  // 6. Spirit Lantern: 8s Duration, Lighting Boost, Dark Area & Flashlight Compat, Minimap 8-Tile Reveal & Cleanup
  // =========================================================================
  {
    let state = createInitialGameState(404)
    const lanternItem = state.items.find((i) => i.type === COLLECTIBLE_TYPES.SPIRIT_LANTERN)
    assert.ok(lanternItem, 'Spirit Lantern spawned in medium game state')
    state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', row: lanternItem.row, col: lanternItem.col })
    assert.equal(
      state.activeEffects.spiritLanternRemainingMs,
      8000,
      'Spirit Lantern activates with exact 8000ms (8s) duration'
    )
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 8000 })
    assert.equal(state.activeEffects.spiritLanternRemainingMs, 0, 'Spirit Lantern expires after 8s')

    // Lighting, flashlight compatibility & battery non-consumption
    const maze = generateMaze({ difficulty: 'medium', seed: 505 })
    const engine = createHeadlessEngine()
    engine.setMaze(maze)
    const env = engine.getEnvironment()
    const baseAmbient = env.lights.ambientLight.intensity
    const baseHemi = env.lights.hemiLight.intensity
    const baseFill = env.lights.fillLight.intensity
    const baseFog = env.fog.density

    // Ensure flashlight is OFF and battery is depleted (0) — Spirit Lantern still works
    engine.setBattery(0)
    assert.equal(engine.flashlightActive, false)
    engine.setActiveEffects({ spiritLanternRemainingMs: 8000 })
    engine.stepFrame(0.05, { render: false })

    const lanternState = engine.getSpiritLanternState()
    assert.equal(lanternState.active, true, 'Spirit Lantern player light activates')
    assert.ok(lanternState.lightIntensity >= 6.0, 'Spirit Lantern provides bright warm illumination')
    assert.ok(env.lights.ambientLight.intensity > baseAmbient, 'Ambient visibility increased')
    assert.ok(env.lights.hemiLight.intensity > baseHemi, 'Hemisphere visibility increased')
    assert.ok(env.lights.fillLight.intensity > baseFill, 'Fill visibility increased')
    assert.ok(env.fog.density < baseFog, 'Fog density reduced for clearer distant sightlines')
    assert.equal(engine.flashlightActive, false, 'Flashlight stays OFF when Spirit Lantern activates')

    // Even with flashlight ON, Spirit Lantern does NOT consume extra battery
    engine.setBattery(80)
    engine.toggleFlashlight()
    assert.equal(engine.flashlightActive, true)
    const expectedDrainOnly = 80 - engine.batteryDrainRate * 0.25
    engine.setActiveEffects({ spiritLanternRemainingMs: 7000 })
    engine.stepFrame(0.25, { render: false })
    assert.ok(
      Math.abs(engine.battery - expectedDrainOnly) < 0.05,
      'Spirit Lantern does not consume extra flashlight battery'
    )

    // Expiration restores baseline environment lighting & fog without mutating config
    engine.setActiveEffects({ spiritLanternRemainingMs: 0 })
    engine.stepFrame(0.05, { render: false })
    assert.equal(engine.getSpiritLanternState().active, false)
    assert.ok(Math.abs(env.lights.ambientLight.intensity - env.config.ambientIntensity) < 1e-6)
    assert.ok(Math.abs(env.lights.hemiLight.intensity - env.config.hemiIntensity) < 1e-6)
    assert.ok(Math.abs(env.lights.fillLight.intensity - env.config.fillIntensity) < 1e-6)
    assert.ok(Math.abs(env.fog.density - env.config.fogDensity) < 1e-6)

    // Victory / Game Over / Reset cleanup restores lighting immediately
    engine.setActiveEffects({ spiritLanternRemainingMs: 5000 })
    assert.equal(engine.getSpiritLanternState().active, true)
    engine.setHasWon(true)
    assert.equal(engine.getSpiritLanternState().active, false, 'Victory cleans up Spirit Lantern')
    assert.ok(Math.abs(env.lights.ambientLight.intensity - env.config.ambientIntensity) < 1e-6)

    engine.resetCombat()
    engine.setActiveEffects({ spiritLanternRemainingMs: 5000 })
    assert.equal(engine.getSpiritLanternState().active, true)
    engine.setHealth(0)
    assert.equal(engine.getSpiritLanternState().active, false, 'Game Over cleans up Spirit Lantern')
    assert.ok(Math.abs(env.lights.ambientLight.intensity - env.config.ambientIntensity) < 1e-6)

    engine.dispose()

    // Minimap 8-tile path reveal
    const openMaze = createOpenCorridorMaze(25, 25)
    const center = { row: 12, col: 12 }
    const exp = createExplorationState(openMaze, { revealStart: false })
    const res = revealPathsInRadius(exp, openMaze, center, 8)
    assert.equal(res.changed, true, 'Spirit Lantern reveals paths on minimap')
    assert.equal(
      isCellDiscovered(exp, 12, 20),
      true,
      'Path cell exactly 8 tiles away is discovered'
    )
    assert.equal(
      isCellDiscovered(exp, 12, 22),
      false,
      'Path cell 10 tiles away remains undiscovered fog'
    )
  }

  // =========================================================================
  // 7. Simultaneous Effects, Game Over Reducer Cleanup, Minimap Render, Audio & Haptics
  // =========================================================================
  {
    // Simultaneous active effects + fatal DAMAGE_PLAYER clears all activeEffects
    let state = createInitialGameState(606)
    state = {
      ...state,
      activeEffects: {
        ...state.activeEffects,
        timeFragmentRemainingMs: 4000,
        watchersEyeRemainingMs: 5000,
        spiritLanternRemainingMs: 6000,
      },
    }
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 999 })
    assert.equal(state.isGameOver, true)
    assert.equal(state.activeEffects.timeFragmentRemainingMs, 0)
    assert.equal(state.activeEffects.watchersEyeRemainingMs, 0)
    assert.equal(state.activeEffects.spiritLanternRemainingMs, 0)

    // Minimap rendering with all 4 collectible icons + Spirit Lantern aura
    const openMaze = createOpenCorridorMaze(13, 13)
    const exp = createExplorationState(openMaze)
    revealPathsInRadius(exp, openMaze, openMaze.start, 8)
    const canvas = createMockCanvas()
    const rendered = renderMinimapCanvas(canvas, {
      maze: openMaze,
      exploration: exp,
      playerCell: openMaze.start,
      items: [
        { id: 'tf', type: COLLECTIBLE_TYPES.TIME_FRAGMENT, row: 6, col: 3 },
        { id: 'we', type: COLLECTIBLE_TYPES.WATCHERS_EYE, row: 6, col: 4 },
        { id: 'ep', type: COLLECTIBLE_TYPES.ECHO_PULSE, row: 6, col: 5 },
        { id: 'sl', type: COLLECTIBLE_TYPES.SPIRIT_LANTERN, row: 6, col: 6 },
      ],
      spiritLanternActive: true,
    })
    assert.equal(rendered, true, 'Minimap renders cleanly with Phase 4 icons and Spirit Lantern aura')
    assert.ok(canvas.calls.length > 20, 'Minimap canvas issued drawing calls')

    // Procedural audio cues & HorrorAudioEngine event recording/deduplication
    const audioCtx = createMockAudioCtx()
    for (const type of [
      COLLECTIBLE_TYPES.TIME_FRAGMENT,
      COLLECTIBLE_TYPES.WATCHERS_EYE,
      COLLECTIBLE_TYPES.ECHO_PULSE,
      COLLECTIBLE_TYPES.SPIRIT_LANTERN,
    ]) {
      triggerCollectiblePickupCue(audioCtx, audioCtx.createGain(), type)
    }

    const audioEngine = new HorrorAudioEngine()
    const first = audioEngine.handleGameEvent({
      id: 901,
      type: 'item_collected',
      item: { type: COLLECTIBLE_TYPES.ECHO_PULSE },
    })
    const dup = audioEngine.handleGameEvent({
      id: 901,
      type: 'item_collected',
      item: { type: COLLECTIBLE_TYPES.ECHO_PULSE },
    })
    assert.equal(dup, false, 'Audio engine deduplicates repeated event IDs')
    assert.equal(typeof first, 'boolean')
    audioEngine.dispose()

    // Haptics verification for all 4 Phase 4 collectibles
    const vibrated = []
    const mockNav = {
      vibrate: (pattern) => {
        vibrated.push(pattern)
        return true
      },
    }
    triggerHapticForGameEvent(
      { type: 'item_collected', item: { type: COLLECTIBLE_TYPES.TIME_FRAGMENT } },
      { enabled: true, navigator: mockNav }
    )
    triggerHapticForGameEvent(
      { type: 'item_collected', item: { type: COLLECTIBLE_TYPES.WATCHERS_EYE } },
      { enabled: true, navigator: mockNav }
    )
    triggerHapticForGameEvent(
      { type: 'item_collected', item: { type: COLLECTIBLE_TYPES.ECHO_PULSE } },
      { enabled: true, navigator: mockNav }
    )
    triggerHapticForGameEvent(
      { type: 'item_collected', item: { type: COLLECTIBLE_TYPES.SPIRIT_LANTERN } },
      { enabled: true, navigator: mockNav }
    )
    assert.deepEqual(vibrated, [
      HAPTIC_PATTERNS.TIME_FRAGMENT,
      HAPTIC_PATTERNS.WATCHERS_EYE,
      HAPTIC_PATTERNS.ECHO_PULSE,
      HAPTIC_PATTERNS.SPIRIT_LANTERN,
    ])
  }

  disposeAllSharedPools()
  console.log('All Phase 4 Advanced Horror Collectibles Tests Passed Successfully!')
}

if (typeof window === 'undefined') {
  runPhase4AdvancedCollectiblesTests()
}
