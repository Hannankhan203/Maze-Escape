import { strict as assert } from 'node:assert'
import { generateMaze } from '../generation/mazeGenerator.js'
import { placeCollectibles, COLLECTIBLE_SPAWN_COUNTS } from '../generation/collectiblePlacement.js'
import { gameReducer, createInitialGameState } from '../engine/gameReducer.js'
import { COLLECTIBLE_TYPES, COLLECTIBLE_CONFIG } from '../mechanics/collectiblesConfig.js'
import { EnemyAgent } from './EnemyAgent.js'
import { CollectibleManager } from './CollectibleManager.js'

export function runPhase3TacticalCollectiblesTests() {
  console.log('Running Phase 3 Tactical & Defensive Collectibles Tests...')

  // 1. Difficulty Spawn Counts & Placement Verification
  const difficulties = ['easy', 'medium', 'hard', 'hardcore']
  for (const diff of difficulties) {
    const maze = generateMaze({ difficulty: diff, seed: 12345 })
    const counts = COLLECTIBLE_SPAWN_COUNTS[diff]
    assert.ok(counts[COLLECTIBLE_TYPES.SPECTRAL_COMPASS] >= 1, `Spectral compass spawn count valid for ${diff}`)
    assert.ok(counts[COLLECTIBLE_TYPES.PHANTOM_VEIL] >= 1, `Phantom veil spawn count valid for ${diff}`)
    assert.ok(counts[COLLECTIBLE_TYPES.WARDING_CHARM] >= 1, `Warding charm spawn count valid for ${diff}`)

    const placement = placeCollectibles(maze)
    assert.ok(Array.isArray(placement.items), 'Placement items array exists')
    const compassItems = placement.items.filter((i) => i.type === COLLECTIBLE_TYPES.SPECTRAL_COMPASS)
    const veilItems = placement.items.filter((i) => i.type === COLLECTIBLE_TYPES.PHANTOM_VEIL)
    const wardingItems = placement.items.filter((i) => i.type === COLLECTIBLE_TYPES.WARDING_CHARM)

    assert.equal(compassItems.length, counts[COLLECTIBLE_TYPES.SPECTRAL_COMPASS], `Correct spectral compass count for ${diff}`)
    assert.equal(veilItems.length, counts[COLLECTIBLE_TYPES.PHANTOM_VEIL], `Correct phantom veil count for ${diff}`)
    assert.equal(wardingItems.length, counts[COLLECTIBLE_TYPES.WARDING_CHARM], `Correct warding charm count for ${diff}`)
  }

  // 2. Spectral Compass Activation & Duration
  let state = createInitialGameState('medium', 42)
  const compassItem = state.items.find((i) => i.type === COLLECTIBLE_TYPES.SPECTRAL_COMPASS)
  if (compassItem) {
    state = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      row: compassItem.row,
      col: compassItem.col,
    })
    assert.equal(state.activeEffects.spectralCompassRemainingMs, COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.SPECTRAL_COMPASS].durationMs, 'Spectral compass activates immediately with 6000ms duration')
    
    // Tick abilities
    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 6000 })
    assert.equal(state.activeEffects.spectralCompassRemainingMs, 0, 'Spectral compass expires after duration')
  }

  // 3. Phantom Veil Manual Storage, Activation & Concealment
  state = createInitialGameState('medium', 42)
  const veilItem = state.items.find((i) => i.type === COLLECTIBLE_TYPES.PHANTOM_VEIL)
  if (veilItem) {
    state = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      row: veilItem.row,
      col: veilItem.col,
    })
    assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 1, 'Phantom veil is stored in inventory on pickup')
    assert.equal(state.activeEffects.phantomVeilRemainingMs, 0, 'Phantom veil does NOT activate automatically on pickup')

    state = gameReducer(state, { type: 'ACTIVATE_PHANTOM_VEIL' })
    assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 0, 'Manual activation consumes 1 stored Phantom Veil')
    assert.equal(state.activeEffects.phantomVeilRemainingMs, COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.PHANTOM_VEIL].durationMs, 'Phantom veil activates manually with 4000ms duration')

    // Test enemy perception suppression
    const maze = state.maze
    const enemy = new EnemyAgent('test-stalker', { maze, spawnCell: maze.start })
    const perception = enemy._checkPerception({
      playerWorldPos: { x: 0, y: 0, z: 0 },
      activeEffects: state.activeEffects,
    })
    assert.equal(perception.isHidden, true, 'Phantom veil conceals player from enemy perception')

    state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 4000 })
    assert.equal(state.activeEffects.phantomVeilRemainingMs, 0, 'Phantom veil expires after duration')
  }

  // 4. Warding Charm Protection & Attack Absorption
  state = createInitialGameState('medium', 42)
  const wardingItem = state.items.find((i) => i.type === COLLECTIBLE_TYPES.WARDING_CHARM)
  if (wardingItem) {
    const initialHealth = state.health
    state = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      row: wardingItem.row,
      col: wardingItem.col,
    })
    assert.equal(state.activeEffects.wardingCharmsCount, 1, 'Warding charm grants 1 protection shield')

    // Damage player while warding charm is active
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 35 })
    assert.equal(state.health, initialHealth, 'Warding charm absorbs attack, health remains unchanged')
    assert.equal(state.activeEffects.wardingCharmsCount, 0, 'Warding charm is consumed exactly once')

    // Subsequent damage should reduce health normally
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 35 })
    assert.equal(state.health, initialHealth - 35, 'Subsequent attacks damage player normally when no warding charms remain')
  }

  // 5. CollectibleManager Spectral Compass Attraction Test
  const manager = new CollectibleManager()
  manager.setMaze(state.maze)
  const shardItem = { id: 'shard-test', type: COLLECTIBLE_TYPES.SOUL_SHARDS, row: 5, col: 5 }
  manager.syncItems([shardItem], state.maze, { spawnBursts: false })
  
  const shardEntry = manager.items.get('shard-test')
  if (shardEntry) {
    shardEntry.mesh.position.set(3, 0.9, 3)
    let collectedCount = 0
    manager.update(0.016, { x: 3, y: 0, z: 3 }, { spectralCompassRemainingMs: 5000 }, () => {
      collectedCount += 1
    })
    assert.ok(collectedCount > 0, 'Spectral compass attracts and triggers collection when close to player')
  }
  manager.dispose()

  console.log('All Phase 3 Tactical & Defensive Collectibles Tests Passed Successfully!')
}

if (typeof window === 'undefined') {
  runPhase3TacticalCollectiblesTests()
}
