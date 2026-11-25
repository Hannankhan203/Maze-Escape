import assert from 'node:assert'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'
import { getDefaultSettingsState, SETTINGS_SCHEMA } from '../../components/settings/settingsConfig.js'

console.log('--- RUNNING DIFFICULTY REMOVAL REGRESSION TESTS ---')

// 1. Verify game state initializes cleanly without difficulty
const state = createInitialGameState(12345)
assert.equal('difficulty' in state, false, 'Game state has no difficulty property')
assert.ok(state.maze, 'Maze is generated')
assert.ok(state.seed === 12345, 'Seed matches')

// 2. Verify settings defaults and schema have no difficulty setting
const defaults = getDefaultSettingsState()
assert.equal('difficulty' in defaults, false, 'Default settings have no difficulty')

const allItems = Object.values(SETTINGS_SCHEMA).flatMap((categoryGroups) =>
  categoryGroups.flatMap((grp) => grp.items || [])
)
assert.equal(
  allItems.some((item) => item.id === 'difficulty' || item.label === 'Difficulty'),
  false,
  'Difficulty setting is completely absent from settings schema'
)

// 3. Verify core gameplay actions work without difficulty
let nextState = gameReducer(state, { type: 'RESET_RUN' })
assert.ok(nextState.maze, 'RESET_RUN preserves valid maze without difficulty')
assert.equal('difficulty' in nextState, false, 'Reset state has no difficulty')

nextState = gameReducer(state, { type: 'RESET_RUN' })
assert.ok(nextState.maze, 'RESET_RUN resets without difficulty')
assert.equal('difficulty' in nextState, false, 'Reset state has no difficulty')

console.log('✓ All difficulty removal regression tests passed successfully!')
