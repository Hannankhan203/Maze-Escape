import { performance } from 'node:perf_hooks'
import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { COLLECTIBLE_TYPES } from '../mechanics/collectiblesConfig.js'
import {
  isCellWalkable,
  moveWithSubsteps,
  resolveGridCollision,
} from '../world/gridCollision.js'
import { gridToWorld, worldToGrid } from '../world/worldCoords.js'
import { CollectibleManager } from './CollectibleManager.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
import {
  HORROR_EVENT_TYPES,
  HORROR_INTENSITY_LEVELS,
  HorrorDirector,
} from './HorrorDirector.js'
import { buildCeilingLights } from './buildCeilingLights.js'
import { COLLECTIBLE_PALETTE } from './buildCollectibles.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps
}

function referenceCountOccludingWalls(fromPos, toPos, maze) {
  if (!maze?.grid || !fromPos || !toPos) return 0
  const dx = (Number(toPos.x) || 0) - (Number(fromPos.x) || 0)
  const dz = (Number(toPos.z) || 0) - (Number(fromPos.z) || 0)
  const dist = Math.hypot(dx, dz)
  if (dist < 0.6) return 0

  const startCell = worldToGrid(fromPos.x, fromPos.z, maze)
  const endCell = worldToGrid(toPos.x, toPos.z, maze)
  const step = 0.45
  const steps = Math.floor(dist / step)
  const ux = dx / dist
  const uz = dz / dist

  let wallCount = 0
  let lastWallKey = ''

  for (let i = 1; i < steps; i += 1) {
    const sx = fromPos.x + ux * (i * step)
    const sz = fromPos.z + uz * (i * step)
    const cell = worldToGrid(sx, sz, maze)
    if (!cell) continue
    if (
      (startCell && cell.row === startCell.row && cell.col === startCell.col) ||
      (endCell && cell.row === endCell.row && cell.col === endCell.col)
    ) {
      continue
    }
    if (!isCellWalkable(cell.row, cell.col, maze)) {
      const key = `${cell.row},${cell.col}`
      if (key !== lastWallKey) {
        wallCount += 1
        lastWallKey = key
      }
    }
  }

  return wallCount
}

function createSpyAudioContext() {
  const stats = {
    setValueCalls: 0,
    setTargetCalls: 0,
    pannerSetPosCalls: 0,
    oscillatorsStarted: 0,
    oscillatorsStopped: 0,
    paramCallsByLabel: Object.create(null),
  }

  function makeParam(initial = 0, label = 'param') {
    return {
      value: initial,
      setValueAtTime(v) {
        this.value = v
        stats.setValueCalls += 1
      },
      setTargetAtTime(v) {
        this.value = v
        stats.setTargetCalls += 1
        stats.paramCallsByLabel[label] = (stats.paramCallsByLabel[label] || 0) + 1
      },
      linearRampToValueAtTime(v) {
        this.value = v
      },
      exponentialRampToValueAtTime(v) {
        this.value = v
      },
    }
  }

  function makeBase(extra = {}) {
    return {
      connect() {},
      disconnect() {},
      ...extra,
    }
  }

  const ctx = {
    state: 'running',
    currentTime: 1.0,
    sampleRate: 44100,
    destination: makeBase(),
    listener: {
      positionX: makeParam(0, 'listenerX'),
      positionY: makeParam(0, 'listenerY'),
      positionZ: makeParam(0, 'listenerZ'),
      forwardX: makeParam(0, 'forwardX'),
      forwardY: makeParam(0, 'forwardY'),
      forwardZ: makeParam(-1, 'forwardZ'),
      upX: makeParam(0, 'upX'),
      upY: makeParam(1, 'upY'),
      upZ: makeParam(0, 'upZ'),
    },
    createGain() {
      return makeBase({ gain: makeParam(1, 'gain') })
    },
    createDelay() {
      return makeBase({ delayTime: makeParam(0, 'delay') })
    },
    createDynamicsCompressor() {
      return makeBase({
        threshold: makeParam(-14, 'compThreshold'),
        knee: makeParam(18, 'compKnee'),
        ratio: makeParam(6, 'compRatio'),
      })
    },
    createBiquadFilter() {
      return makeBase({
        type: 'lowpass',
        frequency: makeParam(1000, 'filterFreq'),
        Q: makeParam(1, 'filterQ'),
      })
    },
    createPanner() {
      return makeBase({
        panningModel: 'HRTF',
        distanceModel: 'linear',
        refDistance: 1.9,
        maxDistance: 13.5,
        rolloffFactor: 0,
        positionX: makeParam(0, 'pannerX'),
        positionY: makeParam(0, 'pannerY'),
        positionZ: makeParam(0, 'pannerZ'),
        setPosition() {
          stats.pannerSetPosCalls += 1
        },
      })
    },
    createOscillator() {
      let started = false
      let stopped = false
      return makeBase({
        type: 'sine',
        frequency: makeParam(220, 'oscFreq'),
        start() {
          if (!started) {
            started = true
            stats.oscillatorsStarted += 1
          }
        },
        stop() {
          if (started && !stopped) {
            stopped = true
            stats.oscillatorsStopped += 1
          }
        },
      })
    },
    createBuffer(channels, length, sampleRate) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: () => new Float32Array(length),
      }
    },
    createBufferSource() {
      return makeBase({ buffer: null, loop: false, start() {}, stop() {} })
    },
    async resume() {
      ctx.state = 'running'
    },
    async suspend() {
      ctx.state = 'suspended'
    },
    async close() {
      ctx.state = 'closed'
    },
  }

  return {
    ctx,
    stats,
    resetCounters() {
      stats.setValueCalls = 0
      stats.setTargetCalls = 0
      stats.pannerSetPosCalls = 0
      for (const k of Object.keys(stats.paramCallsByLabel)) {
        stats.paramCallsByLabel[k] = 0
      }
    },
  }
}

console.log('--- RUNNING PHASE 5 GC CHURN & RESOURCE REUSE TESTS ---')

// ============================================================================
// TEST 1: HorrorAudioEngine updateCeilingLights & occlusion raymarch
// ============================================================================
console.log('Test 1: HorrorAudioEngine Occlusion Parity, Steady-State Param Skip & Silence Reuse')
const mazeMedium = generateMaze({ difficulty: 'medium', seed: 54321 })
const startWp = gridToWorld(mazeMedium.start.row, mazeMedium.start.col, mazeMedium)

// 1a. Verify countOccludingWalls exact parity against reference implementation
for (let r = 1; r < mazeMedium.rows - 1; r += 2) {
  for (let c = 1; c < mazeMedium.cols - 1; c += 2) {
    const wp = gridToWorld(r, c, mazeMedium)
    const { countOccludingWalls } = await import('./HorrorAudioEngine.js')
    const actual = countOccludingWalls(startWp, wp, mazeMedium)
    const expected = referenceCountOccludingWalls(startWp, wp, mazeMedium)
    assert(
      actual === expected,
      `countOccludingWalls parity failed at (${r},${c}): actual=${actual} vs expected=${expected}`
    )
  }
}
{
  const { countOccludingWalls } = await import('./HorrorAudioEngine.js')
  assert(
    countOccludingWalls({ x: NaN, z: 0 }, startWp, mazeMedium) === 0,
    'Non-finite start coordinates return 0 safely'
  )
  assert(
    countOccludingWalls(startWp, { x: startWp.x, z: startWp.z }, { grid: [[0], [0, 1]] }) === 0,
    'Non-rectangular maze grid returns 0 safely'
  )
}

// 1b. Steady-state frames skip redundant setTargetAtTime & silence calls
const audioSpy = createSpyAudioContext()
const audioEngine = new HorrorAudioEngine({
  createAudioContext: () => audioSpy.ctx,
  autoUnlock: true,
})
audioEngine.setMaze(mazeMedium)
audioEngine.updateListener({ x: startWp.x, y: 1.65, z: startWp.z })

const steadyGroup = {
  userData: {
    currentLightScale: 1,
    reducedMotion: false,
    highContrast: false,
    fixtures: [
      {
        index: 7,
        designType: 'fluorescent_batten',
        condition: 'working',
        x: startWp.x + 1.5,
        z: startWp.z,
        lightY: 3.4,
        phase: 0.2,
        baseIntensity: 1.0,
        _liveIntensity: 1.0,
        _warmShift: 0,
      },
    ],
  },
}

// Initial update programs audio parameters cleanly
audioEngine.updateCeilingLights(steadyGroup, { playerWorldPos: startWp })
assert(
  audioSpy.stats.setTargetCalls > 0,
  'Initial ceiling light update configures audio parameters'
)
assert(
  audioEngine.getCeilingLightAudioState().activeVoiceCount === 1,
  'Overhead fixture acquires voice slot'
)

// Subsequent identical steady frames should trigger ZERO redundant setTargetAtTime calls
audioSpy.resetCounters()
for (let i = 0; i < 120; i += 1) {
  audioEngine.updateCeilingLights(steadyGroup, { playerWorldPos: startWp })
}
assert(
  audioSpy.stats.setTargetCalls === 0 && audioSpy.stats.pannerSetPosCalls === 0,
  `Steady frames issue 0 redundant Web Audio scheduling calls (got setTarget=${audioSpy.stats.setTargetCalls})`
)

// Moving only player triggers ONLY voiceGain updates without rescheduling unchanged panner or oscillator freqs
audioSpy.resetCounters()
for (let i = 1; i <= 10; i += 1) {
  audioEngine.updateListener({ x: startWp.x + i * 0.25, y: 1.65, z: startWp.z })
  audioEngine.updateCeilingLights(steadyGroup, { playerWorldPos: startWp })
}
assert(
  (audioSpy.stats.paramCallsByLabel.gain || 0) > 0,
  'Player movement updates voice gain as distance changes'
)
assert(
  (audioSpy.stats.paramCallsByLabel.pannerX || 0) === 0 &&
    (audioSpy.stats.paramCallsByLabel.oscFreq || 0) === 0,
  'Player movement does not needlessly reschedule static fixture panner/oscillator frequencies'
)

// Out-of-range silencing: triggers silence once on transition edge, then 0 repeated silence calls
const outOfRangeGroup = {
  userData: {
    currentLightScale: 1,
    fixtures: [
      {
        index: 7,
        designType: 'fluorescent_batten',
        condition: 'working',
        x: startWp.x + 40,
        z: startWp.z + 40,
        lightY: 3.4,
        phase: 0.2,
        baseIntensity: 1.0,
        _liveIntensity: 1.0,
        _warmShift: 0,
      },
    ],
  },
}
audioSpy.resetCounters()
audioEngine.updateCeilingLights(outOfRangeGroup, { playerWorldPos: startWp })
const callsOnSilenceEdge = audioSpy.stats.setTargetCalls
assert(callsOnSilenceEdge === 1, 'Silencing active voice issues exactly 1 fade-to-zero target')
audioSpy.resetCounters()
for (let i = 0; i < 60; i += 1) {
  audioEngine.updateCeilingLights(outOfRangeGroup, { playerWorldPos: startWp })
}
assert(
  audioSpy.stats.setTargetCalls === 0,
  'Already-silenced voices skip repeated silence() calls across frames'
)

// Moving fixture back in range cleanly restores gain and updates audio nodes again
audioSpy.resetCounters()
audioEngine.updateListener({ x: startWp.x, y: 1.65, z: startWp.z })
audioEngine.updateCeilingLights(steadyGroup, { playerWorldPos: startWp })
assert(
  audioSpy.stats.setTargetCalls > 0 &&
    audioEngine.getCeilingLightAudioState().activeVoiceCount === 1,
  'Re-entering fixture range restores audio node updates after silencing'
)

audioEngine.dispose()
assert(
  audioSpy.stats.oscillatorsStopped === audioSpy.stats.oscillatorsStarted,
  'Audio dispose stops all pooled light voice oscillators'
)
console.log('✓ HorrorAudioEngine occlusion parity, steady-state param skip, and silence cache verified')

// ============================================================================
// TEST 2: gridCollision Scratch Reuse, Isolation & Re-Entrancy
// ============================================================================
console.log('Test 2: gridCollision Correctness, Caller Isolation & Re-Entrancy Safety')
const collisionMaze = {
  rows: 5,
  cols: 5,
  start: { row: 1, col: 1 },
  exit: { row: 3, col: 3 },
  grid: [
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.PATH, CELL_TYPES.PATH, CELL_TYPES.WALL],
    [CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL, CELL_TYPES.WALL],
  ],
}

const cell11 = gridToWorld(1, 1, collisionMaze)
// Caller isolation check: r1 and m1 stay untouched after hundreds of later calls + user mutations
const r1 = resolveGridCollision(cell11.x + 1.5, cell11.z, collisionMaze, { radius: 0.75 })
assert(r1.collided === true && r1.blockingCells.length >= 1, 'Initial collision detected wall tile')
const snapR1 = {
  x: r1.x,
  z: r1.z,
  collided: r1.collided,
  blockingRow: r1.blockingCells[0].row,
  blockingCol: r1.blockingCells[0].col,
  blockingLen: r1.blockingCells.length,
}

const m1 = moveWithSubsteps(cell11.x, cell11.z, 8.5, -1.2, collisionMaze, { radius: 0.75 })
assert(m1.collided === true && m1.substeps > 1, 'High-speed move runs multiple substeps cleanly')
const snapM1 = {
  x: m1.x,
  z: m1.z,
  blockingRow: m1.blockingCells[0]?.row,
  blockingCol: m1.blockingCells[0]?.col,
  blockingLen: m1.blockingCells.length,
}

// Run 500 more collisions at various positions and also mutate r1/m1
for (let i = 0; i < 500; i += 1) {
  const rx = resolveGridCollision(
    cell11.x + ((i % 7) - 3) * 0.6,
    cell11.z + ((i % 5) - 2) * 0.6,
    collisionMaze,
    { radius: 0.75 }
  )
  assert(rx !== r1 && rx.blockingCells !== r1.blockingCells, 'Returned results never alias')
  const mx = moveWithSubsteps(cell11.x, cell11.z, 0.2, 1.5, collisionMaze, { radius: 0.75 })
  assert(mx !== m1 && mx.blockingCells !== m1.blockingCells, 'Returned substep results never alias')
}
assert(
  r1.x === snapR1.x &&
    r1.z === snapR1.z &&
    r1.blockingCells.length === snapR1.blockingLen &&
    r1.blockingCells[0].row === snapR1.blockingRow &&
    r1.blockingCells[0].col === snapR1.blockingCol,
  'Earlier resolveGridCollision result remains uncorrupted after 500 later calls'
)
assert(
  m1.x === snapM1.x &&
    m1.z === snapM1.z &&
    m1.blockingCells.length === snapM1.blockingLen &&
    m1.blockingCells[0]?.row === snapM1.blockingRow,
  'Earlier moveWithSubsteps result remains uncorrupted after 500 later calls'
)

// Blocking cell uniqueness on repeated sliding along multi-wall seam
const cell22 = gridToWorld(2, 2, collisionMaze)
const slideRes = moveWithSubsteps(cell22.x, cell22.z, 0, -5.0, collisionMaze, { radius: 0.75 })
const seenKeys = new Set()
for (const bc of slideRes.blockingCells) {
  const key = `${bc.row},${bc.col}`
  assert(!seenKeys.has(key), `Duplicate blocking cell reported: ${key}`)
  seenKeys.add(key)
}

// Re-entrancy check: nested resolveGridCollision + moveWithSubsteps invoked inside grid access
let nestedRes = null
let reentrantTriggered = false
const proxiedGrid = new Proxy(collisionMaze.grid, {
  get(target, prop, receiver) {
    if (!reentrantTriggered && prop === '1') {
      reentrantTriggered = true
      // Trigger nested calls inside the active scratch frame
      nestedRes = moveWithSubsteps(cell22.x, cell22.z, 2.2, 0.4, collisionMaze, {
        radius: 0.65,
      })
    }
    return Reflect.get(target, prop, receiver)
  },
})
const reentrantMaze = { ...collisionMaze, grid: proxiedGrid }
const outerRes = resolveGridCollision(cell11.x + 1.5, cell11.z, reentrantMaze, { radius: 0.75 })
assert(reentrantTriggered && nestedRes !== null, 'Re-entrant nested collision was exercised')
assert(
  approxEqual(outerRes.x, snapR1.x) && approxEqual(outerRes.z, snapR1.z),
  'Outer collision result is unaffected by nested re-entrant collision calls'
)

// Exception cleanup check: malformed proxy throwing mid-step must still release scratch depth cleanly
const throwingGrid = new Proxy(collisionMaze.grid, {
  get(target, prop, receiver) {
    if (prop === '2') {
      throw new Error('simulated mid-step read fault')
    }
    return Reflect.get(target, prop, receiver)
  },
})
let caughtFault = false
try {
  resolveGridCollision(cell22.x, cell22.z, { ...collisionMaze, grid: throwingGrid }, { radius: 0.75 })
} catch {
  caughtFault = true
}
assert(caughtFault, 'Proxy fault propagated cleanly')
const postFaultRes = resolveGridCollision(cell11.x + 1.5, cell11.z, collisionMaze, { radius: 0.75 })
assert(
  approxEqual(postFaultRes.x, snapR1.x) && approxEqual(postFaultRes.z, snapR1.z),
  'Scratch stack cleanly recovered after mid-step exception'
)
console.log('✓ gridCollision parity, caller isolation, re-entrancy, and fault recovery verified')

// ============================================================================
// TEST 3: HorrorDirector Context Reuse, External Snapshot Isolation & Disposal
// ============================================================================
console.log('Test 3: HorrorDirector Internal Snapshot Reuse, External Isolation & Silhouette Reuse')
const mazeHard = generateMaze({ difficulty: 'hardcore', seed: 12345 })
const hardStart = gridToWorld(mazeHard.start.row, mazeHard.start.col, mazeHard)
const mockScene = new THREE.Scene()
const dir = new HorrorDirector({
  maze: mazeHard,
  scene: mockScene,
  intensity: HORROR_INTENSITY_LEVELS.HIGH,
  seed: 42,
})

const testEnemies = [
  { id: 1, isDisposed: false, state: 'patrol', worldPos: { x: hardStart.x + 4, z: hardStart.z } },
  { id: 2, isDisposed: false, state: 'chase', worldPos: { x: hardStart.x + 8, z: hardStart.z + 4 } },
]
const externalCtx = {
  playerWorldPos: { ...hardStart },
  playerForward: { x: 1, z: 0 },
  playerGridCell: { row: mazeHard.start.row, col: mazeHard.start.col },
  health: 85,
  maxHealth: 100,
  enemies: testEnemies,
}

// External evaluateContext calls preserve snapshot caching AND isolation from internal update() reuse
const extSnapA = dir.evaluateContext(externalCtx)
const extSnapB = dir.evaluateContext(externalCtx)
assert(extSnapA === extSnapB, 'Identical external evaluateContext calls return cached external snapshot')
assert(
  extSnapA !== dir._internalSnapshot,
  'External evaluateContext never returns internal mutable _internalSnapshot'
)

const recordedX = extSnapA.playerWorldPos.x
// Mutate caller input & run update() multiple times moving player
externalCtx.playerWorldPos.x = hardStart.x + 2.5
externalCtx.health = 45
dir.update(0.016, externalCtx)
externalCtx.playerWorldPos.x = hardStart.x + 3.5
dir.update(0.016, externalCtx)

assert(
  extSnapA.playerWorldPos.x === recordedX && extSnapA.healthRatio === 0.85,
  'Previous external evaluateContext snapshot stays isolated when update() reuses _internalSnapshot'
)

// Trigger DISTANT_SILHOUETTE twice across maze switch -> silhouette group built lazily ONCE & reused
const silTarget = { x: hardStart.x + 8, z: hardStart.z }
dir.triggerEvent(HORROR_EVENT_TYPES.DISTANT_SILHOUETTE, externalCtx, { targetPos: silTarget })
const firstSilGroup = dir._silhouetteGroup
assert(Boolean(firstSilGroup) && firstSilGroup.visible === true, 'Silhouette created lazily on trigger')

dir.triggerEvent(HORROR_EVENT_TYPES.DISTANT_SILHOUETTE, externalCtx, {
  targetPos: { x: hardStart.x + 12, z: hardStart.z },
})
assert(
  dir._silhouetteGroup === firstSilGroup,
  'Repeated silhouette triggers reuse single silhouette Three.Group without recreation'
)

// Complete disposal cleans silhouette group and caches
dir.dispose()
assert(dir._silhouetteGroup === null, 'Director disposes silhouette group')
assert(mockScene.children.length === 0, 'Director removes silhouette group from scene on dispose')
assert(dir._contextSnapshotCache === null && dir._corridorCandidateCache === null, 'Caches cleared')
console.log('✓ HorrorDirector snapshot isolation, silhouette reuse, and disposal verified')

// ============================================================================
// TEST 4: Pickup Burst Pool Reuse, Kind Reset & Complete Disposal
// ============================================================================
console.log('Test 4: CollectibleManager Pickup Burst Pooling, State Reset & Complete Disposal')
const burstScene = new THREE.Scene()
const cm = new CollectibleManager(burstScene)
cm.setMaze(mazeMedium)

const burstKinds = [
  COLLECTIBLE_TYPES.SOUL_SHARDS,
  COLLECTIBLE_TYPES.HEALTH_CAPSULE,
  COLLECTIBLE_TYPES.ENERGY_CELL,
  COLLECTIBLE_TYPES.ECHO_REVEAL,
  'keycard',
  'gate_unlock',
]

// Sequentially spawn and finish 30 bursts -> only 1 group/material created, 29 reuses!
let firstBurstRef = null
for (let i = 0; i < 30; i += 1) {
  const kind = burstKinds[i % burstKinds.length]
  const pos = { x: startWp.x + i * 0.3, y: 0.9, z: startWp.z }
  const b = cm.spawnBurst(kind, pos)
  if (i === 0) {
    firstBurstRef = b
  } else {
    assert(b === firstBurstRef, `Sequential burst #${i} reused pooled burst group`)
  }
  assert(b.name === `collection-burst-${kind}`, 'Pooled burst name updated on reuse')
  assert(b.visible === true, 'Pooled burst made visible on reuse')
  assert(
    approxEqual(b.position.x, pos.x) &&
      approxEqual(b.position.y, pos.y) &&
      approxEqual(b.position.z, pos.z),
    'Pooled burst world position reset cleanly'
  )

  // Verify clean material & transform reset before animating
  const expectedColor =
    kind === COLLECTIBLE_TYPES.HEALTH_CAPSULE
      ? COLLECTIBLE_PALETTE.healthPrimary
      : kind === COLLECTIBLE_TYPES.ENERGY_CELL
        ? COLLECTIBLE_PALETTE.energyPrimary
        : kind === COLLECTIBLE_TYPES.ECHO_REVEAL
          ? COLLECTIBLE_PALETTE.echoPulsePrimary
          : kind === 'keycard'
            ? COLLECTIBLE_PALETTE.keycardPrimary
            : kind === 'gate_unlock'
              ? COLLECTIBLE_PALETTE.gateUnlock
              : COLLECTIBLE_PALETTE.soulPrimary
  assert(
    b.userData.material.color.getHex() === expectedColor,
    `Pooled burst colors reset cleanly for kind=${kind}`
  )
  assert(
    approxEqual(b.userData.material.opacity, 1),
    'Pooled burst material opacity reset cleanly before play'
  )
  for (const p of b.userData.particles) {
    assert(
      approxEqual(p.position.x, 0) &&
        approxEqual(p.position.y, 0.2) &&
        approxEqual(p.position.z, 0),
      'Pooled burst particle positions reset cleanly'
    )
  }

  // Advance mid-flight then finish
  cm.update(0.24)
  assert(cm.getCounts().bursts === 1, 'Mid-flight burst remains active')
  assert(b.userData.material.opacity < 1, 'Mid-flight burst animates opacity')
  cm.update(0.25)
  assert(cm.getCounts().bursts === 0, 'Finished burst returned cleanly to pool')
}

assert(cm.burstCreatedCount === 1, `Expected 1 burst created, got ${cm.burstCreatedCount}`)
assert(cm.burstReusedCount === 29, `Expected 29 burst reuses, got ${cm.burstReusedCount}`)
assert(cm._burstPool.length === 1, 'Completed burst waits in _burstPool')
assert(cm.disposedMeshCount === 0, 'Pooled bursts were not churn-disposed mid-run')

// Track material disposal on both active and pooled bursts during setMaze / dispose
let matDisposeCalls = 0
for (let i = 0; i < 6; i += 1) {
  const b = cm.spawnBurst(burstKinds[i % burstKinds.length], startWp)
  const mat = b.userData.material
  if (!mat._spied) {
    mat._spied = true
    const origDispose = mat.dispose.bind(mat)
    mat.dispose = () => {
      matDisposeCalls += 1
      origDispose()
    }
  }
}
// Finish 2 bursts (leaving 4 active + 2 pooled) then trigger dispose
cm.bursts[0].userData.elapsed = 0.45
cm.bursts[1].userData.elapsed = 0.45
cm.update(0.05)
assert(cm.bursts.length === 4 && cm._burstPool.length === 2, '4 active and 2 pooled bursts tracked')

const createdTotal = cm.burstCreatedCount
cm.dispose()
assert(cm.isDisposed === true && cm.bursts.length === 0 && cm._burstPool.length === 0, 'All active and pooled bursts cleared on dispose')
assert(
  matDisposeCalls === createdTotal,
  `Every burst instance material disposed (expected ${createdTotal}, got ${matDisposeCalls})`
)
assert(burstScene.children.length === 0, 'CollectibleManager rootGroup removed cleanly on dispose')
console.log('✓ Pickup burst pooling, full state reset, and complete disposal verified')

// ============================================================================
// NODE.JS CPU & CALL-COUNT MICRO-BENCHMARKS (NOT BROWSER GPU FPS)
// ============================================================================
console.log('\n--- PHASE 5 NODE.JS CPU & REUSE BENCHMARKS ---')
const ceilingGroupBench = buildCeilingLights(mazeHard)
const benchAudioSpy = createSpyAudioContext()
const benchAudio = new HorrorAudioEngine({
  createAudioContext: () => benchAudioSpy.ctx,
  autoUnlock: true,
})
benchAudio.setMaze(mazeHard)
benchAudio.updateListener({ x: hardStart.x, y: 1.65, z: hardStart.z })
const benchAudioCtx = { playerWorldPos: hardStart, reducedMotion: false }
for (let i = 0; i < 50; i += 1) benchAudio.updateCeilingLights(ceilingGroupBench, benchAudioCtx)
benchAudioSpy.resetCounters()
const tAudio0 = performance.now()
for (let i = 0; i < 600; i += 1) benchAudio.updateCeilingLights(ceilingGroupBench, benchAudioCtx)
const tAudioMs = performance.now() - tAudio0
console.log(
  `HorrorAudioEngine.updateCeilingLights [Hardcore, 600 static frames]: ${tAudioMs.toFixed(2)}ms | redundant setTargetAtTime calls=${benchAudioSpy.stats.setTargetCalls}`
)
benchAudio.dispose()

const tCol0 = performance.now()
let colX = hardStart.x
let colZ = hardStart.z
for (let i = 0; i < 3000; i += 1) {
  const res = moveWithSubsteps(
    colX,
    colZ,
    ((i % 3) - 1) * 0.9,
    ((i % 5) - 2) * 0.6,
    mazeHard,
    0.75
  )
  if (i % 5 === 0) {
    colX = hardStart.x
    colZ = hardStart.z
  } else {
    colX = res.x
    colZ = res.z
  }
}
const tColMs = performance.now() - tCol0
console.log(`gridCollision.moveWithSubsteps [Hardcore, 3000 calls]: ${tColMs.toFixed(2)}ms`)

const benchScene = new THREE.Scene()
const benchCm = new CollectibleManager(benchScene)
benchCm.setMaze(mazeHard)
const tBurst0 = performance.now()
for (let i = 0; i < 40; i += 1) {
  benchCm.spawnBurst(
    i % 2 === 0 ? COLLECTIBLE_TYPES.SOUL_SHARDS : COLLECTIBLE_TYPES.HEALTH_CAPSULE,
    {
      x: hardStart.x + i * 0.2,
      y: 0.9,
      z: hardStart.z,
    }
  )
  benchCm.update(0.25)
  benchCm.update(0.25)
}
const tBurstMs = performance.now() - tBurst0
console.log(
  `CollectibleManager pickup bursts [40 sequential bursts]: ${tBurstMs.toFixed(2)}ms | created=${benchCm.burstCreatedCount}, reused=${benchCm.burstReusedCount}`
)
benchCm.dispose()

console.log('ALL PHASE 5 OPTIMIZATION TESTS PASSED SUCCESSFULLY!')
