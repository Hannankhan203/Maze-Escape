import assert from 'node:assert/strict'
import {
  ALL_HIDING_SPOT_TYPES,
  isValidHidingSpotType,
} from '../mechanics/hidingConfig.js'
import {
  selectHidingSpotTypesForLevel,
  allocateHidingSpotQuantitiesForLevel,
  getLevelConfig,
} from '../mechanics/levelProgression.js'
import { generateMaze } from '../generation/mazeGenerator.js'

console.log('--- RUNNING LEVEL-BASED HIDING PROGRESSION TESTS ---')

const milestoneLevels = [1, 2, 5, 6, 10, 11, 15, 20, 25, 26, 50, 100, 5000]
const baseSeed = 409217

for (const level of milestoneLevels) {
  console.log(`Testing Level ${level} hiding progression...`)

  // 1. Level config integration
  const config = getLevelConfig(level, baseSeed)
  assert.ok(config.hidingSpotSelection, `Level ${level} has hidingSpotSelection`)
  assert.ok(config.hidingSpotAllocation, `Level ${level} has hidingSpotAllocation`)

  // 2. Exact 4 distinct types selection
  const selection = config.hidingSpotSelection
  assert.equal(selection.selectedTypes.length, 4, `Level ${level} selects exactly 4 distinct hiding spot types`)
  
  const selectedSet = new Set(selection.selectedTypes)
  assert.equal(selectedSet.size, 4, `Level ${level} selected types have no duplicates`)

  for (const type of selection.selectedTypes) {
    assert.equal(isValidHidingSpotType(type), true, `Selected type ${type} is valid`)
    assert.equal(selection.unselectedTypes.includes(type), false, `Selected type ${type} is not in unselected pool`)
  }

  assert.equal(
    selection.selectedTypes.length + selection.unselectedTypes.length,
    ALL_HIDING_SPOT_TYPES.length,
    `Selected + unselected types equal total 8 types`
  )

  // 3. Allocation and multi-instance rules
  const allocation = config.hidingSpotAllocation
  assert.deepEqual(allocation.selectedTypes, selection.selectedTypes)

  for (const type of selection.selectedTypes) {
    const qty = allocation.typeQuantities[type]
    assert.ok(Number.isInteger(qty) && qty >= 2, `Selected type ${type} has at least 2 instances (got ${qty})`)
  }

  // 4. Generated maze placement and zero unselected instances
  const maze = generateMaze({ level, baseSeed })
  assert.ok(maze.hidingSpots.length >= 8, `Maze for level ${level} places at least 8 hiding spots`)
  assert.deepEqual(maze.hidingSpotSelection.selectedTypes, selection.selectedTypes)
  assert.deepEqual(maze.hidingSpotAllocation.typeQuantities, allocation.typeQuantities)

  const placedTypes = new Set(maze.hidingSpots.map((s) => s.type))
  for (const type of placedTypes) {
    assert.equal(
      selectedSet.has(type),
      true,
      `Maze at level ${level} strictly excludes unselected hiding spot type: ${type}`
    )
  }

  // Verify placement report
  const report = maze.hidingSpotPlacementReport
  assert.ok(report, `Maze at level ${level} includes hidingSpotPlacementReport`)
  assert.equal(report.selectedTypes.length, 4)

  // 5. Determinism check
  const mazeCopy = generateMaze({ level, baseSeed })
  assert.deepEqual(
    maze.hidingSpots.map((s) => s.id),
    mazeCopy.hidingSpots.map((s) => s.id),
    `Level ${level} hiding spot placement is strictly deterministic`
  )
}

// Independent selection check between consecutive levels
const selL1 = selectHidingSpotTypesForLevel({ level: 1, baseSeed })
const selL2 = selectHidingSpotTypesForLevel({ level: 2, baseSeed })
assert.notDeepEqual(selL1.selectedTypes, selL2.selectedTypes, 'Different levels produce independent selections')

console.log('✓ All Level-Based Hiding Progression tests passed successfully!')
