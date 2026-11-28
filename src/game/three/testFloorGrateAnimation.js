/**
 * Automated Verification Suite for MAZE-HAZARD-GRATE-ANIM-001:
 * Physical Collapsing Floor Grate Neutralization Animation
 *
 * Covers all 22 requirements:
 *  1. Existing COLLAPSING_FLOOR_GRATE trigger, 30 damage, permanent collapse & aftermath collider unchanged.
 *  2. Target prompt appears only when collapsed & safe outside pit; prompt-to-click parity invariant.
 *  3. Left-click initiates physical securing animation.
 *  4. Collision-safe approach respects walls, props, and open pit collider; clean rejection when blocked.
 *  5. Physically grounded asymmetric crouch/kneel stance & flat-sole boot grounding in PlayerAnimator.
 *  6. Hand/arm kinematics correspond to actual existing `securedCoverGroup` + 6 perimeter anchor bolts.
 *  7. Atomic commit occurs strictly at progress >= 0.80 with single `secure_floor_opening` audio cue.
 *  8. Pit remains open & aftermath collider enabled during incomplete interaction (< 0.80).
 *  9. Interrupted interaction leaves pit open, resets cover mesh & bolts cleanly, emits 0 audio, allows retry.
 * 10. WASD & sprint movement interruption + full recovery to neutral standing.
 * 11. Damage interruption (zero invulnerability) & fatal damage / death cleanup.
 * 12. Pause, resetCombat, setMaze, and hazard reset cleanup.
 * 13. First-Person arms-only animation (arms visible, 3P head/torso/legs hidden).
 * 14. Third-Person Character Follow full-body animation.
 * 15. Third-Person Free Look full-body animation without snapping free-look orbit yaw.
 * 16. Mid-interaction camera switching (1P <-> 3P Follow <-> 3P Free Look) preserves active animation.
 * 17. Pointer-lock & unlocked mouse clicks (including >6 px jitter quick-start & drag-look preservation).
 * 18. Duplicate left-clicks rejected cleanly while active.
 * 19. Right-click does not trigger floor grate securing.
 * 20. No F-key interaction reintroduced.
 * 21. Sequential securing across multiple collapsing floor grates.
 * 22. Cross-controller mutual exclusion (rubble, furniture, pipes, steam, electrical wiring).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  FLOOR_GRATE_CONSTANTS,
  HAZARD_TYPES,
} from '../generation/hazardPlacement.js'
import { PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import { CAMERA_MODES, THIRD_PERSON_CAMERA_MODES } from './CameraRig.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  FLOOR_GRATE_ANIM_CONFIG,
  FLOOR_GRATE_STATES,
} from './FloorGrateController.js'
import { FLOOR_GRATE_ANIM_MODES } from './PlayerAnimator.js'
import { createViewportPointerController } from './viewportPointerCapture.js'

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

function createWideCorridorMaze() {
  // 9x9 open corridor room around (4,4) with clear safe approach edges on all 4 sides
  const grid = [
    [W, W, W, W, W, W, W, W, W],
    [W, S, P, P, P, P, P, P, W],
    [W, P, P, P, P, P, P, P, W],
    [W, P, P, P, P, P, P, P, W],
    [W, P, P, P, P, P, P, P, W],
    [W, P, P, P, P, P, P, P, W],
    [W, P, P, P, P, P, P, P, W],
    [W, P, P, P, P, P, P, E, W],
    [W, W, W, W, W, W, W, W, W],
  ]
  return {
    rows: grid.length,
    cols: grid[0].length,
    grid,
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 7 },
    seed: 9101,
    level: 1,
    difficulty: 'normal',
  }
}

function createHeadlessEngine(maze, extraConfig = {}) {
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
    skipExtractionSequence: true,
    initialHealth: 100,
    maxHealth: 100,
    enemies: { autoSpawn: false },
    collectibles: { count: 0 },
    hazards: { count: 0 },
    hidingSpots: { count: 0 },
    props: { enabled: false },
    ...extraConfig,
  })
  engine.setMaze(maze)
  engine.cancelSpawnSequence?.({ syncYaw: false })
  engine.hazardManager.clear()
  engine._syncHazardColliders({ allowPushOut: false })
  return engine
}

function spawnFloorGrate(engine, row = 4, col = 4, overrides = {}) {
  const maze = engine._currentMaze
  const cellPos = gridToWorld(row, col, maze)
  const spec = {
    id: overrides.id || `grate-${row}-${col}`,
    type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
    row,
    col,
    corridorAxis: overrides.corridorAxis || 'ns',
    grateYaw: Number.isFinite(overrides.grateYaw) ? overrides.grateYaw : 0,
    floorY: 0,
    localPitOffset: overrides.localPitOffset || { x: 0, z: 0 },
    pitInnerHalfW: FLOOR_GRATE_CONSTANTS.pitInnerHalfW,
    pitInnerHalfD: FLOOR_GRATE_CONSTANTS.pitInnerHalfD,
    pitDepth: FLOOR_GRATE_CONSTANTS.pitDepth,
    aftermathHalfW: FLOOR_GRATE_CONSTANTS.colliderHalfW,
    aftermathHalfD: FLOOR_GRATE_CONSTANTS.colliderHalfD,
    worldPos: { x: cellPos.x, y: 0, z: cellPos.z },
    ...overrides,
  }
  const agent = engine.hazardManager.addHazard(spec, maze)
  engine._syncHazardColliders({ allowPushOut: false })
  return agent
}

function positionPlayer(engine, x, z, yaw = 0, pitch = -0.35) {
  engine._playerWorldPos.x = x
  engine._playerWorldPos.y = 0
  engine._playerWorldPos.z = z
  if (engine._playerGroup) {
    engine._playerGroup.position.set(x, 0, z)
    engine._playerGroup.rotation.y = yaw
  }
  if (engine.cameraRig) {
    engine.cameraRig.setPlayerPosition(x, 0, z)
    engine.cameraRig.setLookDirection(yaw, pitch)
    engine.cameraRig.setCharacterYaw?.(yaw)
    engine.cameraRig.update(0, { immediate: true })
  }
  if (engine.camera) {
    engine.camera.updateMatrixWorld(true)
  }
  engine._notifyStealthChange(true)
}

function collapseGrateNaturally(engine, grate) {
  const c = grate.dangerWorldPos
  // Stand on grate to trigger warning -> collapse -> 30 damage -> permanently collapsed
  const startHp = engine.health
  positionPlayer(engine, c.x, c.z, 0, 0)
  // Step through warning (1.05s) + active (0.95s)
  for (let i = 0; i < 48; i += 1) {
    engine.stepFrame(0.05)
  }
  engine._syncHazardColliders({ allowPushOut: false })
  return { damageTaken: startHp - engine.health }
}

function stepFrames(engine, totalSec, dt = 0.025) {
  const count = Math.max(1, Math.round(totalSec / dt))
  for (let i = 0; i < count; i += 1) {
    engine.stepFrame(dt)
  }
}

function spyAudioInteraction(engine) {
  const calls = []
  const orig = engine.audioEngine?.onHazardInteraction?.bind(engine.audioEngine)
  if (engine.audioEngine) {
    engine.audioEngine.onHazardInteraction = (action, type, anchor) => {
      calls.push({ action, type, anchor: anchor ? { ...anchor } : null })
      if (orig) return orig(action, type, anchor)
      return undefined
    }
  }
  return calls
}

function getSafeSouthEdgePos(grate, extra = 0.25) {
  const c = grate.dangerWorldPos
  const halfD = grate.aftermathHalfD ?? FLOOR_GRATE_CONSTANTS.colliderHalfD
  return {
    x: c.x,
    z: c.z + halfD + PLAYER_RADIUS + extra,
  }
}

function runAllTests() {
  let passed = 0
  function test(name, fn) {
    fn()
    passed += 1
    console.log(`  [PASS] ${name}`)
  }

  console.log('Running MAZE-HAZARD-GRATE-ANIM-001 verification suite...')

  // 1. Existing grate hazard functionality remains completely unchanged
  test('1. Existing COLLAPSING_FLOOR_GRATE trigger, 30 damage, permanent collapse & aftermath collider unchanged', () => {
    const engine = createHeadlessEngine(createWideCorridorMaze())
    const grate = spawnFloorGrate(engine, 4, 4)

    assert.equal(grate.state, HAZARD_STATES.DORMANT)
    assert.equal(grate.isAftermathCleared, false)
    assert.equal(grate.config.damage, 30)
    assert.equal(grate.config.warningDuration, 1.05)
    assert.equal(grate.config.activeDuration, 0.95)

    // Dormant grate must NOT be interactable
    const safePos = getSafeSouthEdgePos(grate)
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.3)
    assert.equal(engine.getNearbyInteractable(), null)

    const { damageTaken } = collapseGrateNaturally(engine, grate)
    assert.equal(damageTaken, 30, 'Existing collapsing floor grate must still deal 30 damage')
    assert.equal(grate.state, HAZARD_STATES.DISABLED)
    assert.equal(grate.isPermanentlyCollapsed, true)
    assert.equal(grate.isAftermathCleared, false)

    const pitCol = grate._colliderEntries.find((c) => c.id.endsWith(':aftermath-pit'))
    assert.ok(pitCol && pitCol.enabled, 'Aftermath pit collider must remain enabled after collapse')

    // Backwards-compatible instant fallback when ctx.instant or engine omitted
    const instantRes = grate.interact({
      playerWorldPos: safePos,
      playerGridCell: { row: 4, col: 4 },
      instant: true,
    })
    assert.equal(instantRes.handled, true)
    assert.equal(instantRes.clearAftermath, true)
    assert.equal(grate.isAftermathCleared, true)

    engine.dispose()
  })

  // 2. Target prompt appears when valid & maintains strict prompt-to-click parity
  test('2. Target prompt appears only when collapsed & safe outside pit with prompt-to-click parity', () => {
    const engine = createHeadlessEngine(createWideCorridorMaze())
    const grate = spawnFloorGrate(engine, 4, 4)
    collapseGrateNaturally(engine, grate)

    // Inside pit center -> prompt must NOT appear, click must NOT start
    positionPlayer(engine, grate.dangerWorldPos.x, grate.dangerWorldPos.z, 0, -0.3)
    assert.equal(engine.getNearbyInteractable(), null)
    assert.equal(engine.floorGrateController.canStartSecure(grate), false)
    assert.equal(engine.handlePrimaryAction().handled, false)

    // Out of range (> 2.2m) -> prompt must NOT appear, click must NOT start
    positionPlayer(engine, grate.dangerWorldPos.x, grate.dangerWorldPos.z + 3.0, 0, -0.3)
    assert.equal(engine.getNearbyInteractable(), null)
    assert.equal(engine.handlePrimaryAction().handled, false)

    // Safe working edge inside 2.2m -> prompt appears & click succeeds
    const safePos = getSafeSouthEdgePos(grate, 0.25)
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.3)
    const prompt = engine.getNearbyInteractable()
    assert.ok(prompt, 'Prompt must appear at safe working edge')
    assert.equal(prompt.kind, 'hazard')
    assert.equal(prompt.id, grate.id)
    assert.equal(prompt.label, 'Secure Floor Opening')
    assert.equal(prompt.shortLabel, 'Secure')
    assert.equal(engine.floorGrateController.canStartSecure(grate), true)

    const clickRes = engine.handlePrimaryAction()
    assert.equal(clickRes.handled, true)
    assert.equal(clickRes.action, 'secure_floor_opening')
    assert.equal(clickRes.isSecuring, true)

    engine.dispose()
  })

  // 3, 6, 7, 8. Full lifecycle, hardware cover animation, atomic commit >= 0.80, single audio cue
  test('3/6/7/8. Left-click animates existing securedCoverGroup + 6 bolts & commits atomically at >= 0.80', () => {
    const engine = createHeadlessEngine(createWideCorridorMaze())
    const grate = spawnFloorGrate(engine, 4, 4)
    collapseGrateNaturally(engine, grate)
    const audioCalls = spyAudioInteraction(engine)

    const safePos = getSafeSouthEdgePos(grate, 0.28)
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.35)

    const startRes = engine.handlePrimaryAction()
    assert.equal(startRes.handled, true)
    assert.equal(startRes.isSecuring, true)
    assert.equal(engine.isSecuringFloorGrate(), true)
    assert.equal(audioCalls.length, 0, 'No completion sound on interaction start')

    const coverGroup = grate.mesh.userData.securedCoverGroup
    assert.ok(coverGroup, 'Existing securedCoverGroup must be present')
    assert.equal(coverGroup.children.length, 7, 'Existing cover plate + 6 perimeter anchor bolts')
    assert.equal(coverGroup.visible, false, 'Cover hidden during initial approach')

    // Advance to ~50% (Phase C1: sliding/lowering steel trench recovery cover)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.5, 0.025)
    assert.equal(engine.isSecuringFloorGrate(), true)
    assert.equal(grate.isAftermathCleared, false, 'Pit must remain open before 0.80')
    assert.equal(
      grate._colliderEntries.find((c) => c.id.endsWith(':aftermath-pit')).enabled,
      true,
      'Aftermath pit collider must remain enabled before 0.80'
    )
    assert.equal(coverGroup.visible, true, 'Existing securedCoverGroup visible during cover placement')
    assert.ok(
      coverGroup.position.y > 0.005,
      `Cover should still be lowering into curb at 50% (y=${coverGroup.position.y})`
    )
    assert.equal(audioCalls.length, 0, 'No audio cue before commit')

    // Advance to ~72% (Phase C2: seating 6 perimeter anchor bolts)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.22, 0.025)
    assert.equal(grate.isAftermathCleared, false, 'Pit must still remain open at 72%')
    const boltYs = coverGroup.children.slice(1).map((b) => b.position.y)
    assert.ok(
      boltYs.some((y) => y > 0.026) && boltYs.some((y) => y < 0.045),
      `Bolts should be mid-seating at 72% (ys=${boltYs.map((v) => v.toFixed(4)).join(',')})`
    )
    assert.equal(audioCalls.length, 0, 'No audio cue before 0.80 commit')

    // Advance past 0.80 commit point to ~85% (Phase D: release)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.14, 0.025)
    assert.equal(grate.isAftermathCleared, true, 'Pit must be secured atomically at >= 0.80')
    assert.equal(
      grate._colliderEntries.find((c) => c.id.endsWith(':aftermath-pit')).enabled,
      false,
      'Aftermath pit collider disabled once secured'
    )
    assert.equal(coverGroup.visible, true)
    assert.equal(coverGroup.position.y, 0)
    assert.equal(coverGroup.position.x, 0)
    assert.equal(coverGroup.position.z, 0)
    for (let i = 1; i < coverGroup.children.length; i += 1) {
      assert.ok(
        Math.abs(coverGroup.children[i].position.y - 0.025) < 1e-4,
        'All 6 perimeter bolts flush at y=0.025 on commit'
      )
    }
    assert.equal(audioCalls.length, 1, 'Exactly one audio cue on atomic commit')
    assert.equal(audioCalls[0].action, 'secure_floor_opening')
    assert.equal(audioCalls[0].type, HAZARD_TYPES.COLLAPSING_FLOOR_GRATE)

    // Finish withdrawal to 100%
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.25, 0.025)
    assert.equal(engine.isSecuringFloorGrate(), false)
    assert.equal(engine.floorGrateController.getStateName(), FLOOR_GRATE_STATES.SECURED)
    assert.equal(audioCalls.length, 1, 'Still only one audio cue after withdrawal finishes')

    // Allow animator blend-out to settle back to standing
    stepFrames(engine, 0.6, 0.025)
    const animState = engine._playerAnimator.getFloorGrateState()
    assert.equal(animState.floorGrateMode, FLOOR_GRATE_ANIM_MODES.NONE)
    assert.ok(animState.floorGrateCrouch < 0.05, 'Character rises back to standing after completion')

    engine.dispose()
  })

  // 4. Collision-safe approach respects walls, props, and open pit collider; rejects when blocked
  test('4. Approach stays collision-safe outside open pit on every frame & rejects cleanly when all edges blocked', () => {
    const engine = createHeadlessEngine(createWideCorridorMaze())
    const grate = spawnFloorGrate(engine, 4, 4)
    collapseGrateNaturally(engine, grate)

    // Start slightly diagonally off-edge inside reach
    const c = grate.dangerWorldPos
    positionPlayer(engine, c.x + 1.15, c.z + 1.38, Math.PI, -0.25)

    const res = engine.handlePrimaryAction()
    assert.equal(res.handled, true)

    // Verify player circular footprint NEVER overlaps the open pit opening on any frame
    for (let i = 0; i < 95; i += 1) {
      engine.stepFrame(0.025)
      if (!grate.isAftermathCleared) {
        const safe = engine.floorGrateController._isPositionSafeFromGrate(
          grate,
          engine._playerWorldPos.x,
          engine._playerWorldPos.z,
          PLAYER_RADIUS,
          0
        )
        assert.equal(safe, true, `Player must remain strictly outside open pit on frame ${i}`)
      }
    }

    // Now test clean rejection when all surrounding edges are blocked by solid walls
    const tightGrid = [
      [W, W, W, W, W],
      [W, S, W, W, W],
      [W, W, P, W, W],
      [W, W, W, E, W],
      [W, W, W, W, W],
    ]
    const tightMaze = {
      rows: tightGrid.length,
      cols: tightGrid[0].length,
      grid: tightGrid,
      start: { row: 1, col: 1 },
      exit: { row: 3, col: 3 },
      seed: 9102,
      level: 1,
      difficulty: 'normal',
    }
    const tightEngine = createHeadlessEngine(tightMaze)
    const tightGrate = spawnFloorGrate(tightEngine, 2, 2)
    collapseGrateNaturally(tightEngine, tightGrate)

    const posBefore = { ...tightEngine._playerWorldPos }
    // Put player right next to the wall in cell (1,1) — blocked by walls with no LOS/safe edge
    const startWorld = gridToWorld(1, 1, tightMaze)
    positionPlayer(tightEngine, startWorld.x, startWorld.z, 0, 0)
    const blockedStart = tightEngine.handlePrimaryAction()
    assert.equal(blockedStart.handled, false, 'Blocked grate must reject cleanly without teleporting')
    assert.equal(tightEngine.isSecuringFloorGrate(), false)
    assert.ok(
      Math.hypot(
        tightEngine._playerWorldPos.x - startWorld.x,
        tightEngine._playerWorldPos.z - startWorld.z
      ) < 1e-5,
      'Rejected interaction must not teleport player'
    )
    assert.ok(Number.isFinite(posBefore.x))

    engine.dispose()
    tightEngine.dispose()
  })

  // 5. Working stance is physically valid (grounded boots, crouch, torso lean, head gaze, both arms)
  test('5. Working stance produces grounded crouch/kneel, torso lean, downward gaze & coordinated two-arm motion', () => {
    const engine = createHeadlessEngine(createWideCorridorMaze())
    engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
    const grate = spawnFloorGrate(engine, 4, 4)
    collapseGrateNaturally(engine, grate)

    const safePos = getSafeSouthEdgePos(grate, 0.12)
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.3)

    const rig = engine._playerGroup.userData.rig
    engine.stepFrame(0.025)
    const restPelvisY = rig.pelvisPivot.position.y

    assert.equal(engine.handlePrimaryAction().handled, true)

    // Advance into Phase C1 (seat_cover, ~52%)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.52, 0.025)
    const crouchPelvisY = rig.pelvisPivot.position.y
    assert.ok(
      crouchPelvisY < restPelvisY - 0.14,
      `Pelvis should lower significantly in working crouch (rest=${restPelvisY.toFixed(3)}, crouch=${crouchPelvisY.toFixed(3)})`
    )
    assert.ok(rig.leftKneePivot.rotation.x < -0.9, 'Left knee deeply flexed in working crouch')
    assert.ok(rig.rightKneePivot.rotation.x < -0.8, 'Right knee deeply flexed in working crouch')
    assert.ok(rig.spinePivot.rotation.x < -0.25, 'Spine leans forward toward floor opening')
    assert.ok(
      rig.leftShoulderPivot.rotation.x > 0.75 && rig.rightShoulderPivot.rotation.x > 0.75,
      'Both arms reach forward/downward toward steel cover'
    )

    // Verify grounded boots (left & right boot bottom stays flush near floor y ≈ 0, no sinking/floating)
    engine._playerGroup.updateMatrixWorld(true)
    const leftAnkleWorld = new THREE.Vector3()
    const rightAnkleWorld = new THREE.Vector3()
    rig.leftAnklePivot.getWorldPosition(leftAnkleWorld)
    rig.rightAnklePivot.getWorldPosition(rightAnkleWorld)
    assert.ok(
      leftAnkleWorld.y >= 0.02 && leftAnkleWorld.y <= 0.22,
      `Left ankle grounded naturally (y=${leftAnkleWorld.y.toFixed(3)})`
    )
    assert.ok(
      rightAnkleWorld.y >= 0.02 && rightAnkleWorld.y <= 0.22,
      `Right ankle grounded naturally (y=${rightAnkleWorld.y.toFixed(3)})`
    )

    // Advance into Phase C2 (bolt_cover, ~70%) and verify alternating left/right bolting motion
    const armSamples = []
    for (let i = 0; i < 16; i += 1) {
      engine.stepFrame(0.025)
      armSamples.push({
        lx: rig.leftShoulderPivot.rotation.x,
        rx: rig.rightShoulderPivot.rotation.x,
        twist: rig.spinePivot.rotation.y,
      })
    }
    const maxAsym = Math.max(...armSamples.map((s) => Math.abs(s.lx - s.rx)))
    assert.ok(
      maxAsym > 0.03,
      `Alternating left/right bolting presses should create visible arm asymmetry (maxAsym=${maxAsym.toFixed(4)})`
    )

    engine.dispose()
  })

  // 9 & 10. Interrupted interaction & WASD/sprint movement interruption
  test('9/10. WASD and sprint interruptions cancel securing, reset cover, emit 0 audio, and allow retry', () => {
    const engine = createHeadlessEngine(createWideCorridorMaze())
    const grate = spawnFloorGrate(engine, 4, 4)
    collapseGrateNaturally(engine, grate)
    const audioCalls = spyAudioInteraction(engine)

    const safePos = getSafeSouthEdgePos(grate, 0.22)
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.3)

    // Start & advance to 55% (cover partially lowered)
    assert.equal(engine.handlePrimaryAction().handled, true)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.55, 0.025)
    assert.equal(grate.mesh.userData.securedCoverGroup.visible, true)

    // Interrupt with WASD backward movement
    engine.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprint: false }, 0.05)
    assert.equal(engine.isSecuringFloorGrate(), false, 'WASD interrupts securing')
    assert.equal(grate.isAftermathCleared, false, 'Interrupted securing does NOT clear pit')
    assert.equal(
      grate.mesh.userData.securedCoverGroup.visible,
      false,
      'Cover resets cleanly to hidden on interruption'
    )
    assert.equal(audioCalls.length, 0, 'No completion audio on WASD interruption')

    // Re-position & test Sprint + WASD interruption
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.3)
    assert.equal(engine.handlePrimaryAction().handled, true, 'Player can retry cleanly after interrupt')
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.45, 0.025)
    engine.stepMovement({ forwardAxis: -1, strafeAxis: 0, sprint: true }, 0.05)
    assert.equal(engine.isSecuringFloorGrate(), false, 'Sprint movement interrupts securing')
    assert.equal(grate.isAftermathCleared, false)
    assert.equal(audioCalls.length, 0)

    // Re-position & test standalone Sprint input interruption
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.3)
    assert.equal(engine.handlePrimaryAction().handled, true)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.35, 0.025)
    engine.stepMovement({ forwardAxis: 0, strafeAxis: 0, sprint: true }, 0.05)
    assert.equal(engine.isSecuringFloorGrate(), false, 'Standalone sprint input interrupts securing')
    assert.equal(grate.isAftermathCleared, false)
    assert.equal(audioCalls.length, 0)

    // Settle standing pose
    stepFrames(engine, 0.6, 0.025)
    assert.ok(
      engine._playerAnimator.getFloorGrateState().floorGrateCrouch < 0.05,
      'Character is never left stuck crouched after movement interrupt'
    )

    engine.dispose()
  })

  // 11. Damage interruption (zero invulnerability) & fatal damage / death cleanup
  test('11. Incoming damage applies full damage (no invulnerability) & interrupts; death cleans up', () => {
    const engine = createHeadlessEngine(createWideCorridorMaze())
    const grate = spawnFloorGrate(engine, 4, 4)
    collapseGrateNaturally(engine, grate)
    engine.damageImmunityTimer = 0
    const audioCalls = spyAudioInteraction(engine)

    const safePos = getSafeSouthEdgePos(grate, 0.22)
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.3)

    assert.equal(engine.handlePrimaryAction().handled, true)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.55, 0.025)

    const hpBefore = engine.health
    engine.applyDamage(15, { source: 'test_enemy' })
    assert.equal(engine.health, hpBefore - 15, 'No temporary invulnerability during securing')
    assert.equal(engine.isSecuringFloorGrate(), false, 'Non-fatal damage interrupts securing')
    assert.equal(grate.isAftermathCleared, false)
    assert.equal(grate.mesh.userData.securedCoverGroup.visible, false)
    assert.equal(audioCalls.length, 0)

    // Fatal damage while securing
    engine.damageImmunityTimer = 0
    assert.equal(engine.handlePrimaryAction().handled, true)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.45, 0.025)
    engine.applyDamage(200, { source: 'fatal_test' })
    assert.equal(engine.isGameOver, true)
    assert.equal(engine.isSecuringFloorGrate(), false)
    assert.equal(grate.isAftermathCleared, false)
    assert.equal(
      engine._playerAnimator.getFloorGrateState().floorGrateMode,
      FLOOR_GRATE_ANIM_MODES.NONE
    )

    engine.dispose()
  })

  // 12. Pause, resetCombat, setMaze, and hazard reset cleanup
  test('12. Pause, resetCombat, setMaze, and hazard.resetState() all clean up cleanly', () => {
    const maze = createWideCorridorMaze()
    const engine = createHeadlessEngine(maze)
    const grate = spawnFloorGrate(engine, 4, 4)
    collapseGrateNaturally(engine, grate)
    const safePos = getSafeSouthEdgePos(grate, 0.22)

    // Pause interruption
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.3)
    assert.equal(engine.handlePrimaryAction().handled, true)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.5, 0.025)
    engine.setPaused(true)
    assert.equal(engine.isSecuringFloorGrate(), false, 'Pause cancels active securing')
    assert.equal(grate.isAftermathCleared, false)
    assert.equal(grate.mesh.userData.securedCoverGroup.visible, false)
    engine.setPaused(false)

    // Hazard reset while securing
    assert.equal(engine.handlePrimaryAction().handled, true)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.5, 0.025)
    grate.resetState()
    engine.stepFrame(0.025)
    assert.equal(engine.isSecuringFloorGrate(), false, 'Hazard reset interrupts securing')
    assert.equal(grate.grateSecureProgress, 0)

    // Re-collapse, start securing, then resetCombat
    collapseGrateNaturally(engine, grate)
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.3)
    assert.equal(engine.handlePrimaryAction().handled, true)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.4, 0.025)
    engine.resetCombat()
    assert.equal(engine.isSecuringFloorGrate(), false, 'resetCombat resets controller')
    assert.equal(engine.floorGrateController.getStateName(), FLOOR_GRATE_STATES.IDLE)

    // Re-collapse, start securing, then setMaze
    collapseGrateNaturally(engine, grate)
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.3)
    assert.equal(engine.handlePrimaryAction().handled, true)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.4, 0.025)
    engine.setMaze(createWideCorridorMaze())
    assert.equal(engine.isSecuringFloorGrate(), false, 'setMaze resets controller cleanly')

    engine.dispose()
  })

  // 13, 14, 15, 16. Camera compatibility: 1P, 3P Follow, 3P Free Look, and mid-interaction switching
  test('13/14/15/16. First-Person arms-only, 3P Follow, 3P Free Look & mid-interaction camera switching', () => {
    const engine = createHeadlessEngine(createWideCorridorMaze())
    const grate = spawnFloorGrate(engine, 4, 4)
    collapseGrateNaturally(engine, grate)
    const safePos = getSafeSouthEdgePos(grate, 0.22)

    // Start in First-Person mode
    engine.setCameraMode(CAMERA_MODES.FIRST_PERSON)
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.35)
    assert.equal(engine.handlePrimaryAction().handled, true)
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.45, 0.025)

    const countVisibleMeshes = (root) => {
      let count = 0
      root.traverse((obj) => {
        if (obj?.isMesh && obj.visible) count += 1
      })
      return count
    }

    // Verify 1P arms-only visibility (arm meshes visible, full 3P head/leg meshes hidden)
    const rig = engine._playerGroup.userData.rig
    assert.equal(engine._playerGroup.visible, true, 'Player group visible for 1P animated arms')
    assert.ok(countVisibleMeshes(rig.leftShoulderPivot) > 0, '1P left arm meshes visible')
    assert.ok(countVisibleMeshes(rig.rightShoulderPivot) > 0, '1P right arm meshes visible')
    assert.equal(countVisibleMeshes(rig.headPivot), 0, '3P head meshes hidden in First-Person mode')
    assert.equal(countVisibleMeshes(rig.leftHipPivot), 0, '3P leg meshes hidden in First-Person mode')

    const progressBeforeSwitch = engine.floorGrateController.getProgress()

    // Switch mid-interaction to Third-Person Character Follow
    engine.setCameraMode(CAMERA_MODES.THIRD_PERSON)
    engine.cameraRig.setThirdPersonCameraMode(THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW)
    engine.syncPlayerVisibility()
    stepFrames(engine, 0.1, 0.025)
    assert.equal(engine.isSecuringFloorGrate(), true, 'Switching to 3P Follow must not reset animation')
    assert.ok(engine.floorGrateController.getProgress() > progressBeforeSwitch)
    assert.ok(countVisibleMeshes(rig.headPivot) > 0, 'Full 3P head meshes visible in 3P Follow')
    assert.ok(countVisibleMeshes(rig.leftHipPivot) > 0, '3P leg meshes visible in 3P Follow')

    // Switch mid-interaction to Third-Person Free Look
    engine.cameraRig.setThirdPersonCameraMode(THIRD_PERSON_CAMERA_MODES.FREE_LOOK)
    const orbitYawBefore = 1.25
    engine.cameraRig.setLookDirection(orbitYawBefore, -0.2)
    stepFrames(engine, 0.1, 0.025)
    assert.equal(engine.isSecuringFloorGrate(), true, 'Switching to 3P Free Look preserves animation')
    assert.ok(
      Math.abs(engine.cameraRig.getCameraLookDirection().yaw - orbitYawBefore) < 0.05,
      'Free Look camera orbit yaw must not snap during grate securing'
    )

    // Switch back to First-Person mid-interaction
    engine.setCameraMode(CAMERA_MODES.FIRST_PERSON)
    engine.syncPlayerVisibility()
    stepFrames(engine, 0.1, 0.025)
    assert.equal(engine.isSecuringFloorGrate(), true)
    assert.equal(countVisibleMeshes(rig.headPivot), 0, 'Returning to 1P hides 3P head meshes again')
    assert.ok(countVisibleMeshes(rig.leftShoulderPivot) > 0, '1P arm meshes remain visible')

    // Complete cleanly
    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec * 0.8, 0.025)
    assert.equal(grate.isAftermathCleared, true)
    assert.equal(engine._playerGroup.visible, false, '1P player group hides cleanly after completion')

    engine.dispose()
  })

  // 17, 18, 19. Pointer-lock & unlocked clicks (with jitter & drag-look), no duplicates, right-click no-op
  test('17/18/19. Pointer-lock & unlocked clicks work, duplicates ignored, right-click does nothing', () => {
    const engine = createHeadlessEngine(createWideCorridorMaze())
    const grate = spawnFloorGrate(engine, 4, 4)
    collapseGrateNaturally(engine, grate)

    const safePos = getSafeSouthEdgePos(grate, 0.22)
    positionPlayer(engine, safePos.x, safePos.z, 0, -0.45)

    // Right-click must NOT start floor grate securing
    const secRes = engine.handleSecondaryAction()
    assert.equal(secRes.handled, false)
    assert.equal(engine.isSecuringFloorGrate(), false)

    // Create mock viewport host + document to test pointer controller
    const fakeDoc = { pointerLockElement: null }
    const fakeCanvasHost = {
      ownerDocument: fakeDoc,
      isConnected: true,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }

    const ptrCtrl = createViewportPointerController({
      canvasHost: fakeCanvasHost,
      doc: fakeDoc,
      getEngine: () => engine,
      getLatestProps: () => ({
        controlsEnabled: true,
        showDiagnosticsModal: false,
        hasWon: false,
        isGameOver: false,
        isArrivalLocked: false,
      }),
    })

    // 17a: Unlocked mouse left-click with >6 px jitter on grate must quick-start securing
    ptrCtrl.handlePointerDown({
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 500,
      clientY: 300,
      target: fakeCanvasHost,
    })
    ptrCtrl.handlePointerMove({
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 525,
      clientY: 318,
    })
    ptrCtrl.handlePointerUp({
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 525,
      clientY: 318,
    })
    assert.equal(
      engine.isSecuringFloorGrate(),
      true,
      'Unlocked mouse click on collapsed grate starts securing even with >6px jitter'
    )

    // 18: Duplicate left-click while active must be rejected cleanly
    const dupRes = engine.handlePrimaryAction()
    assert.equal(dupRes.handled, false)
    assert.equal(dupRes.reason, 'already_handling')

    // Interrupt and test Pointer-Lock left-click
    engine.floorGrateController.interruptSecure({ immediate: true, reason: 'test_reset' })
    fakeDoc.pointerLockElement = fakeCanvasHost
    ptrCtrl.handlePointerDown({
      button: 0,
      buttons: 1,
      pointerId: 2,
      pointerType: 'mouse',
      clientX: 500,
      clientY: 300,
      target: fakeCanvasHost,
    })
    assert.equal(
      engine.isSecuringFloorGrate(),
      true,
      'Pointer-lock left-click starts floor grate securing'
    )

    // Unlocked drag-look still works when not targeting a grate
    engine.floorGrateController.interruptSecure({ immediate: true, reason: 'test_reset' })
    fakeDoc.pointerLockElement = null
    positionPlayer(engine, safePos.x, safePos.z + 3.2, 0, 0)
    const yawBeforeDrag = engine.cameraRig.getLookDirection().yaw
    ptrCtrl.handlePointerDown({
      button: 0,
      buttons: 1,
      pointerId: 3,
      pointerType: 'mouse',
      clientX: 500,
      clientY: 300,
      target: fakeCanvasHost,
    })
    ptrCtrl.handlePointerMove({
      pointerId: 3,
      pointerType: 'mouse',
      clientX: 580,
      clientY: 300,
    })
    ptrCtrl.handlePointerUp({
      button: 0,
      pointerId: 3,
      pointerType: 'mouse',
      clientX: 580,
      clientY: 300,
    })
    assert.ok(
      Math.abs(engine.cameraRig.getLookDirection().yaw - yawBeforeDrag) > 0.05,
      'Unlocked drag-look still rotates camera when clicking outside grate'
    )

    ptrCtrl.dispose?.()
    engine.dispose()
  })

  // 20. No F-key interaction reintroduced
  test('20. No F-key interaction is reintroduced in MazeViewport3D.jsx', () => {
    const thisDir = path.dirname(fileURLToPath(import.meta.url))
    const viewportPath = path.resolve(
      thisDir,
      '../../components/game/MazeViewport3D.jsx'
    )
    const content = fs.readFileSync(viewportPath, 'utf8')
    assert.equal(
      /code\s*===\s*['"]KeyF['"]/.test(content),
      false,
      'KeyF must remain removed from MazeViewport3D.jsx'
    )
  })

  // 21 & 22. Sequential multi-grate securing & cross-controller mutual exclusion
  test('21/22. Sequential multi-grate securing & cross-controller mutual exclusion', () => {
    const engine = createHeadlessEngine(createWideCorridorMaze())
    const grate1 = spawnFloorGrate(engine, 3, 3, { id: 'grate-seq-1' })
    const grate2 = spawnFloorGrate(engine, 5, 5, { id: 'grate-seq-2' })

    collapseGrateNaturally(engine, grate1)
    engine.damageImmunityTimer = 0
    collapseGrateNaturally(engine, grate2)
    engine.health = 100
    engine.damageImmunityTimer = 0

    // Secure grate 1 while checking mutual exclusion against all peer controllers
    const pos1 = getSafeSouthEdgePos(grate1, 0.22)
    positionPlayer(engine, pos1.x, pos1.z, 0, -0.3)
    assert.equal(engine.handlePrimaryAction().handled, true)

    assert.equal(engine.steamRepairController.tryStartRepair().handled, false)
    assert.equal(engine.electricalWiringController.tryStartNeutralize().handled, false)
    assert.equal(engine.furnitureController.tryStartHandling().handled, false)
    assert.equal(engine.pipesController.tryGripTarget().handled, false)
    assert.equal(engine.rubbleController.tryPickup().handled, false)

    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec + 0.15, 0.025)
    assert.equal(grate1.isAftermathCleared, true)
    assert.equal(grate2.isAftermathCleared, false)

    // Now move to grate 2 and secure it sequentially
    const pos2 = getSafeSouthEdgePos(grate2, 0.22)
    positionPlayer(engine, pos2.x, pos2.z, 0, -0.3)
    const start2 = engine.handlePrimaryAction()
    assert.equal(start2.handled, true)
    assert.equal(start2.hazard.id, grate2.id)

    stepFrames(engine, FLOOR_GRATE_ANIM_CONFIG.secureDurationSec + 0.15, 0.025)
    assert.equal(grate2.isAftermathCleared, true)

    engine.dispose()
  })

  console.log(`\nAll ${passed} MAZE-HAZARD-GRATE-ANIM-001 test groups passed!`)
}

runAllTests()
