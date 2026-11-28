/**
 * End-to-End Automated Verification Suite for MAZE-HAZARD-STEAM-ANIM-002
 * Safe-Side Steam Pipe Repair Positioning & Damage Integrity
 */

import assert from 'node:assert/strict'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { CAMERA_MODES } from './CameraRig.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

const W = CELL_TYPES.WALL
const P = CELL_TYPES.PATH
const S = CELL_TYPES.START
const E = CELL_TYPES.EXIT

function createMockCanvasHost() {
  return {
    clientWidth: 960,
    clientHeight: 540,
    appendChild() {},
    removeChild() {},
  }
}

console.log('=== RUNNING MAZE-HAZARD-STEAM-ANIM-002 SAFE-SIDE STEAM REPAIR SUITE ===')

{
  const grid = [
    [W, W, W, W, W, W, W, W, W],
    [W, W, W, W, W, W, W, W, W],
    [W, S, P, P, P, P, P, E, W],
    [W, W, W, W, W, W, W, W, W],
    [W, W, W, W, W, W, W, W, W],
  ]
  const maze = {
    grid,
    rows: grid.length,
    cols: grid[0].length,
    start: { row: 2, col: 1 },
    exit: { row: 2, col: 7 },
    level: 3,
    seed: 9200,
  }
  const mockRenderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    setPixelRatio: () => {},
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    getContext: () => null,
  }
  const engine = new MazeSceneEngine(createMockCanvasHost(), {
    createRenderer: () => mockRenderer,
    skipSpawnSequence: true,
    cameraMode: CAMERA_MODES.THIRD_PERSON,
    initialHealth: 100,
    maxHealth: 100,
    enemies: { autoSpawn: false },
  })
  engine.setMaze(maze)
  engine.cancelSpawnSequence?.({ syncYaw: false })
  engine.hazardManager.clear()
  engine.syncHazardColliders({ allowPushOut: false })

  const steamHaz = engine.hazardManager.addHazard({
    id: 'safe-steam-1',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    row: 2,
    col: 4,
    wallSide: 'north',
  })
  steamHaz.state = HAZARD_STATES.ACTIVE
  steamHaz.update(1.5, { playerWorldPos: { x: 0, y: 0, z: 0 }, playerGridCell: { row: 0, col: 0 } })

  const anchor = steamHaz.getInteractionAnchor()
  assert.ok(anchor, 'Steam hazard has valid interaction anchor')

  // Requirement 1 & 2: Selected repair position is outside the actual steam damage envelope and collision bounds remain outside
  const approachPos = { x: anchor.x - 0.7, z: anchor.z + 1.2 }
  engine.setPlayerWorldPosition(approachPos.x, 0, approachPos.z, { immediate: true })
  engine._notifyStealthChange?.(true)

  const startRes = engine.steamRepairController.tryStartRepair(steamHaz)
  if (!startRes.handled) {
    console.log('tryStartRepair failed with reason:', startRes.reason, 'dist:', Math.hypot(approachPos.x - anchor.x, approachPos.z - anchor.z))
  }
  assert.equal(startRes.handled, true, 'Left-click initiates safe-side repair')
  
  const targetPos = engine.steamRepairController._repairTargetPos
  const inPlume = steamHaz._isPointInSteamPlumeArea?.(targetPos.x, targetPos.z, 0.45)
  assert.equal(inPlume, false, 'Requirement 1 & 2: Selected repair standoff position is strictly outside active steam damage envelope')

  // Requirement 3: Player does not receive steam damage while repairing from safe position
  const initialHP = engine.health
  engine.damageImmunityTimer = 0
  engine.stepFrame(0.5, { render: false })
  assert.equal(engine.health, initialHP, 'Requirement 3: No steam damage received while repairing from safe position')

  // Requirement 4: Voluntarily entering the plume still causes normal steam damage
  engine.steamRepairController.interruptRepair()
  const plumeCenter = steamHaz.dangerWorldPos || anchor
  engine.setPlayerWorldPosition(plumeCenter.x, 0, plumeCenter.z, { immediate: true })
  const hpBeforePlumeDamage = engine.health
  engine.damageImmunityTimer = 0
  steamHaz.update(0.4, { playerWorldPos: engine.getPlayerWorldPosition(), playerGridCell: steamHaz.cell })
  engine.stepFrame(0.4, { render: false })
  assert.ok(engine.health < hpBeforePlumeDamage, 'Requirement 4: Voluntarily stepping into active plume causes normal steam damage')

  // Requirement 6: If no safe position exists, repair does not begin
  engine.steamRepairController.reset()
  const origCheck = steamHaz._isPointInSteamPlumeArea
  steamHaz._isPointInSteamPlumeArea = () => true
  const blockedRes = engine.steamRepairController.tryStartRepair(steamHaz)
  assert.equal(blockedRes.handled, false, 'Requirement 6: Repair does not begin if no safe position outside plume exists')
  assert.equal(blockedRes.reason, 'unsafe_position')
  steamHaz._isPointInSteamPlumeArea = origCheck

  // Requirement 7 & 9: First-person and third-person camera modes remain compatible & hand reach
  engine.setPlayerWorldPosition(approachPos.x, 0, approachPos.z, { immediate: true })
  for (const camMode of [CAMERA_MODES.FIRST_PERSON, CAMERA_MODES.THIRD_PERSON]) {
    engine.cameraRig?.setMode?.(camMode, { immediate: true })
    engine.steamRepairController.reset()
    const res = engine.steamRepairController.tryStartRepair(steamHaz)
    assert.equal(res.handled, true, `Compatible with camera mode ${camMode}`)
  }

  // Requirement 10: Left-click repair and valve shutoff work independently
  engine.steamRepairController.reset()
  steamHaz.state = HAZARD_STATES.ACTIVE
  const valvePos = steamHaz.valveWorldPos || { x: anchor.x - 1.0, z: anchor.z }
  engine.setPlayerWorldPosition(valvePos.x, 0, valvePos.z, { immediate: true })
  engine._notifyStealthChange?.(true)
  const valveRes = engine.handlePrimaryAction()
  assert.equal(valveRes.handled, true, 'Valve shutoff left-click works independently')

  engine.dispose()
  console.log('✓ All MAZE-HAZARD-STEAM-ANIM-002 Safe-Side Steam Repair tests passed successfully!')
}
