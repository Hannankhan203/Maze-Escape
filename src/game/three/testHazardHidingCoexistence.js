/**
 * MAZE-PLACEMENT-001 — Hazard & Hiding Spot Coexistence Verification Suite
 *
 * Verifies cross-system placement coordination between progressive hazards and
 * progressive hiding spots across all milestone levels, maze sizes, dense
 * layouts, placement orders, failure/shortfall reporting, RNG isolation,
 * multi-seed variation, and runtime 3D manager coexistence.
 */

import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  placeHazardsWithReport,
  validateHazardPlacement,
} from '../generation/hazardPlacement.js'
import { placeHidingSpotsWithReport } from '../generation/hidingSpotPlacement.js'
import {
  areCellsDirectlyOpen,
  auditHazardHidingCoexistence,
  checkHazardHidingConflict,
  findHazardConflictForHidingSpot,
  findHidingSpotConflictForHazard,
  getHazardFootprint,
  getHidingSpotFootprint,
} from '../generation/placementCoexistence.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { validateMaze } from '../generation/pathfinder.js'
import { HAZARD_TYPES } from '../generation/hazardTypes.js'
import {
  ALL_HIDING_SPOT_TYPES,
  HIDING_SPOT_SELECTION_COUNT,
  MIN_HIDING_SPOT_INSTANCES_PER_TYPE,
} from '../mechanics/hidingConfig.js'
import {
  coordinateHazardAndHidingCapacity,
  getHazardBudgetForLevel,
  getLevelConfig,
} from '../mechanics/levelProgression.js'
import { gridToWorld } from '../world/worldCoords.js'
import { buildPropCollisionIndex } from '../world/propCollision.js'
import { HazardManager } from './HazardManager.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { HidingSpotManager } from './HidingSpotManager.js'
import {
  LEVEL_TRANSITION_ACTIONS,
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'

const ALL_HAZARD_TYPES = Object.values(HAZARD_TYPES)

const MILESTONE_LEVELS = [1, 2, 5, 6, 10, 11, 15, 20, 25, 26, 50, 100, 5000]
const MULTI_SEEDS = [1001, 2026, 4242, 7777, 9999, 13371, 24680, 31415, 55555, 88888]

const EXPECTED_HAZARD_DISTINCT_TYPES = {
  1: 5,
  2: 5,
  5: 5,
  6: 6,
  10: 6,
  11: 7,
  15: 7,
  20: 8,
  25: 9,
  26: 10,
  50: 10,
  100: 10,
  5000: 10,
}

function makeSimpleCorridorMaze(grid, start = { row: 1, col: 1 }, exit = { row: 1, col: 5 }) {
  return {
    id: 'coexistence-unit-maze',
    seed: 'coexistence-unit-seed',
    level: 1,
    rows: grid.length,
    cols: grid[0].length,
    grid,
    start,
    exit,
  }
}

console.log('--- RUNNING MAZE-PLACEMENT-001 HAZARD & HIDING COEXISTENCE TESTS ---')

// ============================================================================
// TEST 1: Geometry, Collider & Floor-Cutout Overlap Rejection (Bidirectional)
// ============================================================================
console.log('Test 1: Hazard and hiding geometry, collider & cutout overlaps never pass validation')
{
  // Open 1x5 corridor with north & south solid walls: row=1, cols 1..5 are PATH
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  const corridorGrid = [
    [W, W, W, W, W, W, W],
    [W, P, P, P, P, P, W],
    [W, W, W, W, W, W, W],
  ]
  const maze = makeSimpleCorridorMaze(corridorGrid, { row: 1, col: 1 }, { row: 1, col: 5 })

  // 1a. Same-cell overlap must always be rejected
  const cupboardCenter = gridToWorld(1, 3, maze)
  const hidingSpot = {
    id: 'spot-cupboard-1-3',
    type: 'metal_cupboard',
    row: 1,
    col: 3,
    wallSide: 'north',
    wallYaw: 0,
    x: cupboardCenter.x,
    z: cupboardCenter.z - 1.54,
    entryAnchor: { x: cupboardCenter.x, z: cupboardCenter.z - 0.1 },
    interiorAnchor: { x: cupboardCenter.x, z: cupboardCenter.z - 1.44 },
  }
  const sameCellHazard = {
    id: 'haz-same-cell',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    row: 1,
    col: 3,
  }
  const sameCellRes = checkHazardHidingConflict(sameCellHazard, hidingSpot, maze)
  assert.equal(sameCellRes.conflict, true, 'Same-cell hazard & hiding spot must conflict')
  assert.equal(sameCellRes.category, 'same_cell')

  const sameCellVal = validateHazardPlacement(maze, sameCellHazard, {
    hidingSpots: [hidingSpot],
  })
  assert.equal(sameCellVal.valid, false, 'validateHazardPlacement rejects same-cell hiding overlap')

  // 1b. Explicit floor cutout overlap (collapsing_floor_grate next to floor_hatch with overlapping cutout)
  const hatchCenter = gridToWorld(1, 3, maze)
  const floorHatch = {
    id: 'spot-hatch-1-3',
    type: 'floor_hatch',
    row: 1,
    col: 3,
    wallSide: 'north',
    wallYaw: 0,
    x: hatchCenter.x - 1.55,
    z: hatchCenter.z,
    entryAnchor: { x: hatchCenter.x - 0.8, z: hatchCenter.z },
    interiorAnchor: { x: hatchCenter.x - 1.55, z: hatchCenter.z },
  }
  const floorGrate = {
    id: 'haz-grate-1-2',
    type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
    row: 1,
    col: 2,
    localPitOffset: { x: 1.55, z: 0 },
    frameOuterHalfW: 0.72,
    frameOuterHalfD: 0.72,
  }
  const cutoutConflict = checkHazardHidingConflict(floorGrate, floorHatch, maze)
  assert.equal(cutoutConflict.conflict, true, 'Overlapping floor cutouts must conflict')
  assert.equal(cutoutConflict.reason, 'floor_cutout_overlap')

  // 1c. Footprint helpers produce valid structured geometry for all 10 hazard types & all 8 hiding types
  for (const hType of ALL_HAZARD_TYPES) {
    const fp = getHazardFootprint(
      { id: `fp-${hType}`, type: hType, row: 1, col: 2 },
      maze
    )
    assert.ok(fp && fp.cellCenter && Array.isArray(fp.colliders), `Hazard footprint valid for ${hType}`)
  }
  for (const sType of ALL_HIDING_SPOT_TYPES) {
    const fp = getHidingSpotFootprint(
      { id: `fp-${sType}`, type: sType, row: 1, col: 3, wallSide: 'north', wallYaw: 0 },
      maze
    )
    assert.ok(fp && fp.bodyBox && fp.entryAnchor && fp.interiorAnchor, `Hiding footprint valid for ${sType}`)
  }

  // 1d. Bidirectional explicit rejection via placeHazardsWithReport
  const explicitBlocked = placeHazardsWithReport(maze, {
    placements: [{ type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE, row: 1, col: 3 }],
    hidingSpots: [hidingSpot],
  })
  assert.equal(explicitBlocked.hazards.length, 0, 'Explicit hazard on hiding spot cell is rejected')
  assert.equal(explicitBlocked.report.fullySatisfied, false)
  assert.ok(explicitBlocked.report.coexistenceRejections >= 1)
  console.log('✓ Geometry, collider, and floor-cutout overlap rejection verified')
}

// ============================================================================
// TEST 2: Entrance, Danger/Surge, Trigger, Interaction Clearances & Wall Separation
// ============================================================================
console.log('Test 2: Entrance, surge/plume, trigger & interaction clearances + wall-separation non-rejection')
{
  const W = CELL_TYPES.WALL
  const P = CELL_TYPES.PATH
  // Corridor: row 1 (cols 1..5), separated by wall row 2 from parallel corridor row 3 (cols 1..5)
  const parallelGrid = [
    [W, W, W, W, W, W, W],
    [W, P, P, P, P, P, W],
    [W, W, W, W, W, W, W],
    [W, P, P, P, P, P, W],
    [W, W, W, W, W, W, W],
  ]
  const maze = makeSimpleCorridorMaze(parallelGrid, { row: 1, col: 1 }, { row: 1, col: 5 })

  // 2a. Water tank directional surge pointing east (+X, yaw = Math.PI/2) from (1,2) toward hiding spot entrance at (1,3)
  const c13 = gridToWorld(1, 3, maze)
  const tankSurgeEast = {
    id: 'haz-tank-east',
    type: HAZARD_TYPES.FALLING_WATER_TANK,
    row: 1,
    col: 2,
    tankYaw: Math.PI / 2,
    flowDir: { x: 1, z: 0 },
    surgeLength: 2.55,
  }
  const westFacingSpot = {
    id: 'spot-west-entry',
    type: 'wall_alcove',
    row: 1,
    col: 3,
    wallSide: 'east',
    wallYaw: -Math.PI / 2,
    x: c13.x + 1.5,
    z: c13.z,
    entryAnchor: { x: c13.x - 1.35, z: c13.z },
    interiorAnchor: { x: c13.x + 1.35, z: c13.z },
  }
  const surgeCheck = checkHazardHidingConflict(tankSurgeEast, westFacingSpot, maze)
  assert.equal(surgeCheck.conflict, true, 'Water tank surge into adjacent hiding entrance must conflict')
  assert.ok(
    ['danger_zone', 'entrance', 'clearance'].includes(surgeCheck.category),
    `Expected danger/entrance/clearance conflict, got ${surgeCheck.category}`
  )

  // 2b. Hazard interaction anchor (steam valve) right on top of adjacent hiding entrance triggers prompt conflict
  const steamHazard = {
    id: 'haz-steam-1-2',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    row: 1,
    col: 2,
    steamYaw: -Math.PI / 2, // plume points west (-X), away from (1,3)
    localImpactOffset: { x: -1.6, z: 0 }, // trigger centered far west so interaction conflict is isolated
    localValveOffset: { x: 1.8, z: 0 }, // valve placed on east edge toward (1,3)
  }
  const closeEntrySpot = {
    id: 'spot-close-entry',
    type: 'heavy_industrial_curtains',
    row: 1,
    col: 3,
    wallSide: 'north',
    wallYaw: 0,
    x: c13.x,
    z: c13.z - 1.5,
    entryAnchor: { x: c13.x - 1.2, z: c13.z },
    interiorAnchor: { x: c13.x, z: c13.z - 1.4 },
  }
  const interCheck = checkHazardHidingConflict(steamHazard, closeEntrySpot, maze)
  assert.equal(interCheck.conflict, true, 'Hazard valve anchor overlapping hiding entrance range must conflict')
  assert.equal(interCheck.category, 'interaction')

  // 2c. Wall-separated parallel corridors (1,2) and (3,2) have solid wall at (2,2) -> NOT falsely rejected!
  assert.equal(areCellsDirectlyOpen(parallelGrid, 1, 2, 3, 2), false, 'Wall at (2,2) blocks direct openness')
  const c32 = gridToWorld(3, 2, maze)
  const wallSeparatedSpot = {
    id: 'spot-separated-3-2',
    type: 'metal_cupboard',
    row: 3,
    col: 2,
    wallSide: 'north',
    wallYaw: 0,
    x: c32.x,
    z: c32.z - 1.54,
    entryAnchor: { x: c32.x, z: c32.z - 0.1 },
    interiorAnchor: { x: c32.x, z: c32.z - 1.44 },
  }
  const separatedCheck = checkHazardHidingConflict(tankSurgeEast, wallSeparatedSpot, maze)
  assert.equal(
    separatedCheck.conflict,
    false,
    'Solid maze wall between (1,2) and (3,2) must prevent false-positive rejection'
  )

  // 2d. Diagonal open L-corner IS directly open, while diagonal separated by two walls is NOT
  const lGrid = [
    [W, W, W, W, W],
    [W, P, P, W, W],
    [W, W, P, P, W],
    [W, W, W, W, W],
  ]
  assert.equal(areCellsDirectlyOpen(lGrid, 1, 1, 2, 2), true, 'Open L-corner (1,1)->(1,2)->(2,2) is directly open')
  assert.equal(areCellsDirectlyOpen(lGrid, 1, 2, 2, 3), true, 'Open L-corner (1,2)->(2,2)->(2,3) is directly open')
  const diagBlockedGrid = [
    [W, W, W, W],
    [W, P, W, W],
    [W, W, P, W],
    [W, W, W, W],
  ]
  assert.equal(areCellsDirectlyOpen(diagBlockedGrid, 1, 1, 2, 2), false, 'Wall-pinched diagonal is NOT directly open')
  console.log('✓ Entrance, danger/surge, trigger, interaction clearances & wall separation verified')
}

// ============================================================================
// TEST 3: Bidirectional Placement Order Coordination (Hazards->Hiding & Hiding->Hazards)
// ============================================================================
console.log('Test 3: Bidirectional placement order respect (hazards->hiding AND hiding->hazards)')
{
  const testLevels = [1, 6, 15, 26]
  for (const level of testLevels) {
    // Generate a maze normally (order A: hazards -> hiding)
    const mazeOrderA = generateMaze({ level, baseSeed: 4242 })
    const auditA = auditHazardHidingCoexistence(mazeOrderA)
    assert.equal(auditA.valid, true, `Order A (L${level}) coexistence valid`)
    assert.equal(auditA.conflictCount, 0, `Order A (L${level}) has 0 conflicts`)
    assert.equal(auditA.fullySatisfied, true, `Order A (L${level}) fully satisfied`)

    // Strip hazards & hidingSpots and place in REVERSE order (order B: hiding -> hazards)
    const bareMaze = {
      id: mazeOrderA.id,
      seed: mazeOrderA.seed,
      baseSeed: mazeOrderA.baseSeed,
      level: mazeOrderA.level,
      currentLevel: mazeOrderA.currentLevel,
      rows: mazeOrderA.rows,
      cols: mazeOrderA.cols,
      grid: mazeOrderA.grid,
      start: mazeOrderA.start,
      exit: mazeOrderA.exit,
      keycards: mazeOrderA.keycards,
      collectibles: mazeOrderA.collectibles,
    }

    const hidingFirst = placeHidingSpotsWithReport(bareMaze, {
      keycards: bareMaze.keycards,
      collectibles: bareMaze.collectibles,
    })
    assert.ok(hidingFirst.hidingSpots.length >= 8, `Reverse order L${level} placed hiding spots`)

    const mazeWithHidingOnly = { ...bareMaze, hidingSpots: hidingFirst.hidingSpots }
    const hazardsSecond = placeHazardsWithReport(mazeWithHidingOnly)
    assert.ok(hazardsSecond.hazards.length >= 10, `Reverse order L${level} placed hazards`)

    const auditB = auditHazardHidingCoexistence(bareMaze, {
      hazards: hazardsSecond.hazards,
      hidingSpots: hidingFirst.hidingSpots,
      hazardPlacementReport: hazardsSecond.report,
      hidingSpotPlacementReport: hidingFirst.report,
    })
    assert.equal(auditB.conflictCount, 0, `Reverse order L${level} has 0 conflicts`)
    assert.equal(auditB.solvable, true, `Reverse order L${level} remains solvable`)

    // Also test HazardManager.setMaze on mazeWithHidingOnly (no pre-placed hazards)
    const hazardMgr = new HazardManager(null)
    hazardMgr.setMaze(mazeWithHidingOnly)
    const mgrHazards = hazardMgr.getHazards()
    assert.ok(mgrHazards.length > 0, `HazardManager fallback placed hazards on L${level}`)
    assert.ok(hazardMgr.getPlacementReport(), `HazardManager exposes placementReport on L${level}`)
    for (const hAgent of mgrHazards) {
      const c = findHidingSpotConflictForHazard(hAgent, hidingFirst.hidingSpots, bareMaze)
      assert.equal(c.conflict, false, `HazardManager fallback hazard ${hAgent.id} respects pre-existing hiding spots`)
    }
    hazardMgr.dispose()

    // Also test HidingSpotManager.setMaze on mazeWithHazardsOnly (no pre-placed hiding spots)
    const mazeWithHazardsOnly = { ...bareMaze, hazards: mazeOrderA.hazards }
    const hidingMgr = new HidingSpotManager(null)
    hidingMgr.setMaze(mazeWithHazardsOnly)
    const mgrSpots = hidingMgr.getHidingSpots().map((a) => ({
      id: a.id,
      type: a.type,
      row: a.row,
      col: a.col,
      wallSide: a.wallSide,
      wallYaw: a.wallYaw,
      x: a.worldPos.x,
      z: a.worldPos.z,
      entryAnchor: a.entryAnchor,
      interiorAnchor: a.interiorAnchor,
    }))
    assert.ok(mgrSpots.length >= 8, `HidingSpotManager fallback placed hiding spots on L${level}`)
    for (const sSpec of mgrSpots) {
      const c = findHazardConflictForHidingSpot(sSpec, mazeOrderA.hazards, bareMaze)
      assert.equal(c.conflict, false, `HidingSpotManager fallback spot ${sSpec.id} respects pre-existing hazards`)
    }
    hidingMgr.dispose()
  }
  console.log('✓ Bidirectional placement order & manager fallbacks verified')
}

// ============================================================================
// TEST 4: All 13 Milestone Levels, Solvability, Exclusions & Selected Categories
// ============================================================================
console.log('Test 4: Combined placement across all 13 milestone levels (1..5000)')
{
  for (const level of MILESTONE_LEVELS) {
    const maze = generateMaze({ level, baseSeed: 2026 })
    const report = maze.placementCoexistenceReport
    const levelCfg = getLevelConfig(level, 2026)
    const expectedHazTypes = EXPECTED_HAZARD_DISTINCT_TYPES[level]

    assert.ok(report, `Level ${level} exposes placementCoexistenceReport`)
    assert.ok(maze.hazardHidingCapacityPlan, `Level ${level} exposes hazardHidingCapacityPlan`)
    assert.ok(levelCfg.hazardHidingCapacityPlan, `getLevelConfig(${level}) exposes hazardHidingCapacityPlan`)
    assert.equal(report.valid, true, `Level ${level} coexistence valid`)
    assert.equal(report.solvable, true, `Level ${level} maze solvable`)
    assert.equal(report.conflictCount, 0, `Level ${level} zero conflicts`)
    assert.equal(report.fullySatisfied, true, `Level ${level} fully satisfied`)
    assert.equal(report.hadShortfall, false, `Level ${level} zero shortfalls`)

    // Verify validateMaze directly
    const pathVal = validateMaze({ grid: maze.grid, start: maze.start, exit: maze.exit })
    assert.equal(pathVal.valid, true, `Level ${level} direct validateMaze passes`)

    // Verify hazard schedule & >= 2 per selected type & zero unselected types
    const hazSel = maze.hazardSelection
    assert.equal(
      hazSel.selectedTypes.length,
      expectedHazTypes,
      `Level ${level} selects ${expectedHazTypes} hazard types`
    )
    const hazSelectedSet = new Set(hazSel.selectedTypes)
    const hazCounts = {}
    for (const h of maze.hazards) {
      assert.equal(hazSelectedSet.has(h.type), true, `Level ${level} hazard ${h.type} is selected`)
      hazCounts[h.type] = (hazCounts[h.type] || 0) + 1
    }
    for (const t of hazSel.selectedTypes) {
      assert.ok((hazCounts[t] || 0) >= 2, `Level ${level} hazard type ${t} has >= 2 instances (${hazCounts[t]})`)
    }

    // Verify hiding selection (exact 4 distinct) & >= 2 per selected type & zero unselected types
    const hidSel = maze.hidingSpotSelection
    assert.equal(
      hidSel.selectedTypes.length,
      HIDING_SPOT_SELECTION_COUNT,
      `Level ${level} selects exactly 4 distinct hiding types`
    )
    const hidSelectedSet = new Set(hidSel.selectedTypes)
    assert.equal(hidSelectedSet.size, HIDING_SPOT_SELECTION_COUNT)
    const hidCounts = {}
    for (const s of maze.hidingSpots) {
      assert.equal(hidSelectedSet.has(s.type), true, `Level ${level} hiding spot ${s.type} is selected`)
      hidCounts[s.type] = (hidCounts[s.type] || 0) + 1
    }
    for (const t of hidSel.selectedTypes) {
      assert.ok(
        (hidCounts[t] || 0) >= MIN_HIDING_SPOT_INSTANCES_PER_TYPE,
        `Level ${level} hiding type ${t} has >= 2 instances (${hidCounts[t]})`
      )
    }

    // Verify zero overlap with start, exit, keycards, collectibles, enemies, or each other
    const startKey = `${maze.start.row},${maze.start.col}`
    const exitKey = `${maze.exit.row},${maze.exit.col}`
    const otherReserved = new Set([startKey, exitKey])
    for (const k of maze.keycards || []) otherReserved.add(`${k.row},${k.col}`)
    for (const it of maze.collectibles?.items || []) otherReserved.add(`${it.row},${it.col}`)
    for (const en of maze.enemies || []) otherReserved.add(`${en.row},${en.col}`)

    const hazKeys = new Set()
    for (const h of maze.hazards) {
      const k = `${h.row},${h.col}`
      assert.equal(otherReserved.has(k), false, `Level ${level} hazard at ${k} avoids reserved entities`)
      assert.equal(hazKeys.has(k), false, `Level ${level} hazard cell ${k} unique`)
      hazKeys.add(k)
    }
    const hidKeys = new Set()
    for (const s of maze.hidingSpots) {
      const k = `${s.row},${s.col}`
      assert.equal(otherReserved.has(k), false, `Level ${level} hiding spot at ${k} avoids reserved entities`)
      assert.equal(hazKeys.has(k), false, `Level ${level} hiding spot at ${k} avoids hazard cells`)
      assert.equal(hidKeys.has(k), false, `Level ${level} hiding spot cell ${k} unique`)
      hidKeys.add(k)
    }
  }
  console.log('✓ All 13 milestone levels verified with zero conflicts and full satisfaction')
}

// ============================================================================
// TEST 5: Small, Medium, Maximum-Size & Dense Custom Maze Configurations
// ============================================================================
console.log('Test 5: Small (11x11), medium (17x17, 23x23), max (51x51) & dense layouts')
{
  const sizeMatrix = [
    { label: 'small-L1-11x11', level: 1, rows: 11, cols: 11, expectFull: true },
    { label: 'small-L6-11x11', level: 6, rows: 11, cols: 11, expectFull: true },
    { label: 'dense-L15-11x11', level: 15, rows: 11, cols: 11, expectFull: true },
    { label: 'dense-L15-13x13', level: 15, rows: 13, cols: 13, expectFull: true },
    { label: 'medium-L1-17x17', level: 1, rows: 17, cols: 17, expectFull: true },
    { label: 'medium-L26-17x17', level: 26, rows: 17, cols: 17, expectFull: true },
    { label: 'medium-L50-23x23', level: 50, rows: 23, cols: 23, expectFull: true },
    { label: 'max-L1-51x51', level: 1, rows: 51, cols: 51, expectFull: true },
    { label: 'max-L5000-51x51', level: 5000, rows: 51, cols: 51, expectFull: true },
  ]

  for (const entry of sizeMatrix) {
    for (const baseSeed of [1001, 2026, 7777, 9999]) {
      const m = generateMaze({
        level: entry.level,
        rows: entry.rows,
        cols: entry.cols,
        baseSeed,
      })
      const r = m.placementCoexistenceReport
      assert.equal(r.conflictCount, 0, `${entry.label} seed=${baseSeed} has 0 conflicts`)
      assert.equal(r.valid, true, `${entry.label} seed=${baseSeed} is valid`)
      assert.equal(r.solvable, true, `${entry.label} seed=${baseSeed} is solvable`)
      if (entry.expectFull) {
        assert.equal(
          r.fullySatisfied,
          true,
          `${entry.label} seed=${baseSeed} fully satisfied (hazSF=${r.hazardShortfallTotal}, hidSF=${r.hidingShortfallTotal})`
        )
      }
    }
  }
  console.log('✓ Small, medium, maximum-size, and dense configurations verified')
}

// ============================================================================
// TEST 6: Shortfall Reporting, Capacity Coordination & Zero Silent Substitution
// ============================================================================
console.log('Test 6: Shortfall reporting, capacity coordination & zero silent substitution')
{
  // 6a. Physically over-subscribed dense maze: Level 26 (10 hazard types, min 20) on 11x11 (~50 walkable cells)
  const overDense = generateMaze({ level: 26, rows: 11, cols: 11, baseSeed: 1001 })
  const denseReport = overDense.placementCoexistenceReport
  assert.equal(denseReport.conflictCount, 0, 'Over-subscribed dense maze never forces overlapping placement')
  assert.equal(denseReport.solvable, true, 'Over-subscribed dense maze stays solvable')
  assert.equal(denseReport.hadShortfall, true, 'Over-subscribed dense maze honestly reports shortfall')
  assert.equal(denseReport.fullySatisfied, false, 'Over-subscribed dense maze never claims fullySatisfied')
  assert.ok(denseReport.combinedShortfallTotal > 0, 'combinedShortfallTotal > 0')
  assert.ok(
    denseReport.shortfallReasons.length > 0,
    'shortfallReasons explains why capacity was insufficient'
  )

  // Verify exact per-type shortfall math and zero unselected type substitution
  const selectedHazSet = new Set(overDense.hazardSelection.selectedTypes)
  for (const h of overDense.hazards) {
    assert.equal(selectedHazSet.has(h.type), true, 'No unselected hazard type substituted under shortfall')
  }
  const selectedHidSet = new Set(overDense.hidingSpotSelection.selectedTypes)
  for (const s of overDense.hidingSpots) {
    assert.equal(selectedHidSet.has(s.type), true, 'No unselected hiding type substituted under shortfall')
  }
  const sumHidShortfalls = Object.values(denseReport.hidingShortfallsByType).reduce(
    (acc, v) => acc + v,
    0
  )
  assert.equal(
    sumHidShortfalls,
    denseReport.hidingShortfallTotal,
    'Per-type hiding shortfalls sum to hidingShortfallTotal'
  )

  // 6b. Explicitly constrained capacity test for hazards (excluding almost all walkable cells)
  const smallMaze = generateMaze({ level: 1, rows: 11, cols: 11, baseSeed: 31415 })
  const excludeAllButAFew = []
  let kept = 0
  for (let r = 1; r < smallMaze.rows - 1; r += 1) {
    for (let c = 1; c < smallMaze.cols - 1; c += 1) {
      if (smallMaze.grid[r][c] !== CELL_TYPES.PATH) continue
      if (
        (r === smallMaze.start.row && c === smallMaze.start.col) ||
        (r === smallMaze.exit.row && c === smallMaze.exit.col)
      ) {
        continue
      }
      if (kept < 4) {
        kept += 1
        continue
      }
      excludeAllButAFew.push({ row: r, col: c })
    }
  }
  const constrainedHaz = placeHazardsWithReport(
    { ...smallMaze, hazards: undefined, hidingSpots: undefined },
    { excludedCells: excludeAllButAFew, level: 1, seed: smallMaze.seed }
  )
  assert.equal(constrainedHaz.report.fullySatisfied, false, 'Constrained hazards never claim full satisfaction')
  assert.equal(constrainedHaz.report.hadShortfall, true)
  assert.ok(constrainedHaz.report.shortfallTotal > 0)
  assert.ok(constrainedHaz.report.failures.length > 0, 'Constrained hazards report explicit failure reasons')
  const constrainedHazSelected = new Set(constrainedHaz.selection.selectedTypes)
  for (const h of constrainedHaz.hazards) {
    assert.equal(constrainedHazSelected.has(h.type), true, 'Constrained hazards never substitute unselected types')
  }

  // 6c. Direct coordinateHazardAndHidingCapacity unit check: trims bonus instances first, preserves minimums
  const plan = coordinateHazardAndHidingCapacity({
    rows: 11,
    cols: 11,
    walkableCount: 50,
    reservedOtherCount: 16,
    startExitBuffer: 6, // availableSharedCells = 28
    hazardSelection: {
      selectedTypes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      minInstancesPerType: 2,
      typeQuantities: { a: 3, b: 3, c: 3, d: 3, e: 2, f: 2, g: 2 }, // total 18, min 14
    },
    hidingSpotAllocation: {
      selectedTypes: ['h1', 'h2', 'h3', 'h4'],
      minInstancesPerType: 2,
      typeQuantities: { h1: 3, h2: 3, h3: 3, h4: 3 }, // total 12, min 8
    },
  })
  assert.equal(plan.availableSharedCells, 28)
  assert.equal(plan.hazardCoordinatedTotal + plan.hidingCoordinatedTotal, 28)
  assert.equal(plan.insufficientForCombinedMinimums, false)
  assert.equal(plan.capacityConstrained, true)
  assert.equal(plan.reason, 'bonus_instances_trimmed_for_shared_capacity')
  for (const qty of Object.values(plan.hazardQuantities)) {
    assert.ok(qty >= 2, 'Coordinated hazard quantity preserves >= 2 minimum')
  }
  for (const qty of Object.values(plan.hidingQuantities)) {
    assert.ok(qty >= 2, 'Coordinated hiding quantity preserves >= 2 minimum')
  }
  console.log('✓ Shortfall reporting, capacity coordination & zero silent substitution verified')
}

// ============================================================================
// TEST 7: Determinism & Strict Isolated RNG Streams
// ============================================================================
console.log('Test 7: Determinism and isolated RNG streams across subsystems')
{
  for (const level of [1, 11, 26, 5000]) {
    const a = generateMaze({ level, baseSeed: 77777 })
    const b = generateMaze({ level, baseSeed: 77777 })
    assert.deepEqual(a.hazards, b.hazards, `Level ${level} hazards strictly deterministic`)
    assert.deepEqual(a.hidingSpots, b.hidingSpots, `Level ${level} hidingSpots strictly deterministic`)
    assert.deepEqual(
      a.placementCoexistenceReport,
      b.placementCoexistenceReport,
      `Level ${level} coexistence report strictly deterministic`
    )
  }

  // Varying hidingConfig must NEVER perturb grid, start, exit, hazards, keycards, or collectibles
  const base = generateMaze({ level: 15, baseSeed: 55555 })
  const customHiding = generateMaze({
    level: 15,
    baseSeed: 55555,
    hidingConfig: {
      minInstancesPerType: 3,
      maxInstancesPerType: 5,
      maxTotalHidingSpots: 20,
    },
  })
  assert.deepEqual(customHiding.grid, base.grid, 'hidingConfig never perturbs grid')
  assert.deepEqual(customHiding.hazards, base.hazards, 'hidingConfig never perturbs hazards')
  assert.deepEqual(customHiding.keycards, base.keycards, 'hidingConfig never perturbs keycards')
  assert.deepEqual(customHiding.collectibles, base.collectibles, 'hidingConfig never perturbs collectibles')
  assert.equal(customHiding.placementCoexistenceReport.conflictCount, 0)

  // Varying collectibleConfig must NEVER perturb grid or hazards
  const customCollectibles = generateMaze({
    level: 15,
    baseSeed: 55555,
    collectibleConfig: {
      forcedOptionalCategories: ['phase_battery', 'phantom_veil'],
    },
  })
  assert.deepEqual(customCollectibles.grid, base.grid, 'collectibleConfig never perturbs grid')
  assert.deepEqual(customCollectibles.hazards, base.hazards, 'collectibleConfig never perturbs hazards')
  assert.equal(customCollectibles.placementCoexistenceReport.conflictCount, 0)
  console.log('✓ Determinism and RNG stream isolation verified')
}

// ============================================================================
// TEST 8: Multi-Seed Variation Across All 13 Milestone Levels (130 Runs)
// ============================================================================
console.log('Test 8: Multi-seed variation across 10 seeds x 13 milestone levels')
{
  const level1Signatures = new Set()
  const level26Signatures = new Set()

  for (const level of MILESTONE_LEVELS) {
    const budget = getHazardBudgetForLevel(level)
    for (const baseSeed of MULTI_SEEDS) {
      const m = generateMaze({ level, baseSeed })
      const r = m.placementCoexistenceReport
      assert.equal(r.conflictCount, 0, `L${level} seed=${baseSeed} has 0 coexistence conflicts`)
      assert.equal(r.valid, true, `L${level} seed=${baseSeed} valid`)
      assert.equal(r.solvable, true, `L${level} seed=${baseSeed} solvable`)
      assert.equal(r.fullySatisfied, true, `L${level} seed=${baseSeed} fully satisfied`)
      assert.equal(m.hazardSelection.selectedTypes.length, budget.distinctTypeCount)
      assert.equal(m.hidingSpotSelection.selectedTypes.length, HIDING_SPOT_SELECTION_COUNT)

      if (level === 1) {
        level1Signatures.add(
          JSON.stringify({
            haz: m.hazards.map((h) => `${h.type}@${h.row},${h.col}`),
            hid: m.hidingSpots.map((s) => `${s.type}@${s.row},${s.col}`),
          })
        )
      }
      if (level === 26) {
        level26Signatures.add(
          JSON.stringify({
            haz: m.hazards.map((h) => `${h.type}@${h.row},${h.col}`),
            hid: m.hidingSpots.map((s) => `${s.type}@${s.row},${s.col}`),
          })
        )
      }
    }
  }

  assert.equal(level1Signatures.size, MULTI_SEEDS.length, '10 seeds produce 10 distinct valid L1 layouts')
  assert.equal(level26Signatures.size, MULTI_SEEDS.length, '10 seeds produce 10 distinct valid L26 layouts')
  console.log('✓ All 130 multi-seed milestone runs verified with zero conflicts and full variation')
}

// ============================================================================
// TEST 9: Side-by-Side Runtime 3D Manager Coexistence & Game Transitions
// ============================================================================
console.log('Test 9: Shared 3D scene runtime coexistence (HazardManager + HidingSpotManager) & transitions')
{
  const scene = new THREE.Scene()
  const hazardManager = new HazardManager(scene)
  const hidingManager = new HidingSpotManager(scene)

  // Verify all 8 hiding spot types and hazards operate cleanly in a shared scene & collision index
  const seenHidingTypes = new Set()
  const seenHazardTypes = new Set()

  for (const baseSeed of [1001, 2026, 4242, 7777, 9999]) {
    const maze = generateMaze({ level: 26, baseSeed })
    const collisionIndex = buildPropCollisionIndex(maze, [])

    hazardManager.setMaze(maze)
    hidingManager.setMaze(maze)

    assert.equal(hazardManager.getHazards().length, maze.hazards.length)
    assert.equal(hidingManager.getHidingSpots().length, maze.hidingSpots.length)

    // Sync both managers' dynamic colliders into the SAME collision index
    hazardManager.syncCollidersToIndex(collisionIndex, maze)
    hidingManager.syncCollidersToIndex(collisionIndex, maze)

    // Test entering & exiting every hiding spot in this maze while hazards are active in the scene
    for (const spot of hidingManager.getHidingSpots()) {
      seenHidingTypes.add(spot.type)
      const entryPos = spot.entryAnchor
      const enterRes = hidingManager.enterSpot(spot.id, {
        spottedEntering: false,
      })
      assert.equal(enterRes.handled, true, `Entered ${spot.type} (${spot.id}) cleanly`)
      assert.equal(hidingManager.isPlayerHiding(), true)
      hidingManager.syncCollidersToIndex(collisionIndex, maze)

      // Confirm standing at the hiding spot's entrance does NOT immediately trigger an open-corridor hazard
      const tickRes = hazardManager.update(0.05, {
        playerWorldPos: entryPos,
        playerGridCell: { row: spot.row, col: spot.col },
        isHiding: false,
      })
      assert.equal(
        tickRes.hazardHits.length,
        0,
        `Standing at ${spot.type} entrance (${spot.row},${spot.col}) causes 0 immediate hazard hits`
      )

      const exitRes = hidingManager.exitActiveSpot({ forced: false })
      assert.equal(exitRes.handled, true, `Exited ${spot.type} (${spot.id}) cleanly`)
      assert.equal(hidingManager.isPlayerHiding(), false)
      hidingManager.syncCollidersToIndex(collisionIndex, maze)
    }

    // Exercise one hazard lifecycle transition (proximity trigger -> WARNING -> reset to DORMANT)
    for (const haz of hazardManager.getHazards()) {
      seenHazardTypes.add(haz.type)
    }
    const sampleHaz = hazardManager.getHazards()[0]
    assert.ok(sampleHaz, 'Sample hazard present')
    assert.equal(sampleHaz.getState(), HAZARD_STATES.DORMANT)
    const hazCellCenter = gridToWorld(sampleHaz.row, sampleHaz.col, maze)
    sampleHaz.update(0.1, {
      playerWorldPos: { x: hazCellCenter.x, y: 0, z: hazCellCenter.z },
      playerGridCell: { row: sampleHaz.row, col: sampleHaz.col },
    })
    assert.notEqual(sampleHaz.getState(), HAZARD_STATES.DORMANT, 'Sample hazard transitions out of DORMANT on proximity')
    hazardManager.syncCollidersToIndex(collisionIndex, maze)
    hazardManager.resetHazardStates()
    assert.equal(sampleHaz.getState(), HAZARD_STATES.DORMANT, 'Hazard resets cleanly to DORMANT')

    hazardManager.detachFromCollisionIndex(collisionIndex)
    hidingManager.detachFromCollisionIndex(collisionIndex)
  }

  assert.equal(seenHidingTypes.size, ALL_HIDING_SPOT_TYPES.length, 'All 8 hiding spot types exercised in shared 3D scene')
  assert.equal(seenHazardTypes.size, ALL_HAZARD_TYPES.length, 'All 10 hazard types exercised in shared 3D scene')

  // Verify gameReducer transitions (NEW_GAME, REPLAY_LEVEL, ADVANCE_LEVEL, SET_LEVEL) preserve valid coexistence
  let state = createInitialGameState({ level: 1, baseSeed: 2026 })
  assert.equal(state.maze.placementCoexistenceReport.conflictCount, 0, 'Initial state coexistence clean')

  const originalMazeId = state.maze.id
  const originalHazards = state.maze.hazards
  const originalSpots = state.maze.hidingSpots

  // REPLAY_LEVEL reproduces identical valid maze & coexistence
  state = gameReducer(state, { type: LEVEL_TRANSITION_ACTIONS.REPLAY_LEVEL })
  assert.equal(state.maze.id, originalMazeId)
  assert.deepEqual(state.maze.hazards, originalHazards)
  assert.deepEqual(state.maze.hidingSpots, originalSpots)
  assert.equal(state.maze.placementCoexistenceReport.conflictCount, 0)

  // ADVANCE_LEVEL builds next level cleanly
  state = gameReducer(state, { type: LEVEL_TRANSITION_ACTIONS.ADVANCE_LEVEL })
  assert.equal(state.currentLevel, 2)
  assert.equal(state.maze.placementCoexistenceReport.conflictCount, 0)
  assert.equal(state.maze.placementCoexistenceReport.fullySatisfied, true)

  // SET_LEVEL to Level 26 builds cleanly
  state = gameReducer(state, { type: LEVEL_TRANSITION_ACTIONS.SET_LEVEL, level: 26 })
  assert.equal(state.currentLevel, 26)
  assert.equal(state.maze.placementCoexistenceReport.conflictCount, 0)
  assert.equal(state.maze.placementCoexistenceReport.fullySatisfied, true)

  // NEW_GAME rebuilds fresh valid game
  state = gameReducer(state, { type: LEVEL_TRANSITION_ACTIONS.NEW_GAME, level: 1, baseSeed: 8888 })
  assert.equal(state.currentLevel, 1)
  assert.equal(state.maze.placementCoexistenceReport.conflictCount, 0)
  assert.equal(state.maze.placementCoexistenceReport.fullySatisfied, true)

  // Clean disposal leaves 0 lingering children in scene
  hazardManager.dispose()
  hidingManager.dispose()
  assert.equal(scene.children.length, 0, 'Both managers dispose all 3D meshes cleanly')
  console.log('✓ Shared 3D scene coexistence, all 8 hiding + 10 hazard types, and game transitions verified')
}

console.log('✓ ALL MAZE-PLACEMENT-001 HAZARD & HIDING COEXISTENCE TESTS PASSED!')
