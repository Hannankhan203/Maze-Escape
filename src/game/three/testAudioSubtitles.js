import * as THREE from 'three'
import {
  HorrorAudioEngine,
  SPATIAL_AUDIBILITY_GAIN_THRESHOLD,
  SUBTITLE_DEDUP_WINDOW_MS,
  computeSpatialAudioAttenuation,
} from './HorrorAudioEngine.js'
import { HorrorDirector, HORROR_EVENT_TYPES, HORROR_INTENSITY_LEVELS } from './HorrorDirector.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { HazardManager } from './HazardManager.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import { sanitizeAllSettings, getDefaultAllSettings } from '../../utils/persistence.js'
import {
  SUBTITLE_LIFETIME_MS,
  SUBTITLE_MAX_ENTRIES,
  enqueueSubtitleEntry,
  createSubtitleQueueController,
} from '../../components/game/subtitleQueue.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function createMockAudioContext() {
  const stats = {
    oscillatorsStarted: 0,
    bufferSourcesStarted: 0,
  }

  function makeParam(initial = 0) {
    return {
      value: initial,
      setValueAtTime(v) {
        this.value = v
      },
      setTargetAtTime(v) {
        this.value = v
      },
      linearRampToValueAtTime(v) {
        this.value = v
      },
      exponentialRampToValueAtTime(v) {
        this.value = v
      },
      cancelScheduledValues() {},
    }
  }

  function makeNode(extra = {}) {
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
    destination: makeNode(),
    listener: {
      positionX: makeParam(0),
      positionY: makeParam(1.65),
      positionZ: makeParam(0),
      forwardX: makeParam(0),
      forwardY: makeParam(0),
      forwardZ: makeParam(-1),
      upX: makeParam(0),
      upY: makeParam(1),
      upZ: makeParam(0),
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
    createGain() {
      return makeNode({ gain: makeParam(1) })
    },
    createDelay(maxDelayTime = 1) {
      return makeNode({ maxDelayTime, delayTime: makeParam(0) })
    },
    createDynamicsCompressor() {
      return makeNode({
        threshold: makeParam(-24),
        knee: makeParam(30),
        ratio: makeParam(12),
        attack: makeParam(0.003),
        release: makeParam(0.25),
      })
    },
    createBiquadFilter() {
      return makeNode({
        type: 'lowpass',
        frequency: makeParam(1000),
        Q: makeParam(1),
        gain: makeParam(0),
      })
    },
    createPanner() {
      return makeNode({
        panningModel: 'HRTF',
        distanceModel: 'linear',
        refDistance: 1.8,
        maxDistance: 22,
        rolloffFactor: 0,
        positionX: makeParam(0),
        positionY: makeParam(0),
        positionZ: makeParam(0),
        setPosition() {},
      })
    },
    createOscillator() {
      return makeNode({
        type: 'sine',
        frequency: makeParam(220),
        detune: makeParam(0),
        start() {
          stats.oscillatorsStarted += 1
        },
        stop() {},
      })
    },
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length)
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData() {
          return data
        },
      }
    },
    createBufferSource() {
      return makeNode({
        buffer: null,
        loop: false,
        playbackRate: makeParam(1),
        start() {
          stats.bufferSourcesStarted += 1
        },
        stop() {},
      })
    },
  }

  return { ctx, stats }
}

function createTestCorridorMaze({ wallCols = [], cols = 9 } = {}) {
  const row0 = new Array(cols).fill(1)
  const row1 = new Array(cols).fill(0)
  row1[0] = 1
  row1[cols - 1] = 1
  for (const wc of wallCols) {
    if (wc > 0 && wc < cols - 1) row1[wc] = 1
  }
  const row2 = new Array(cols).fill(1)
  return {
    seed: 'subtitle-test-corridor',
    rows: 3,
    cols,
    grid: [row0, row1, row2],
    start: { row: 1, col: 1 },
    exit: { row: 1, col: cols - 2 },
  }
}

function createUnlockedSubtitleEngine(options = {}) {
  const mock = createMockAudioContext()
  const engine = new HorrorAudioEngine({
    subtitles: true,
    createAudioContext: () => mock.ctx,
    recordCueHistory: true,
    rainEnabled: false,
    playerBreathingEnabled: false,
    ...options,
  })
  if (options.unlock !== false) {
    engine.unlock()
  }
  const received = []
  const unsubscribe = engine.subscribeSubtitles((entry) => {
    received.push(entry)
  })
  return { engine, mock, received, unsubscribe }
}

function stepHazardTransition(engine, hazard, nextState, listenerPos, extraCtx = {}) {
  hazard.state = nextState
  engine.update(0.016, {
    playerWorldPos: listenerPos,
    hazards: [hazard],
    ...extraCtx,
  })
}

export function runAudioSubtitlesTests() {
  console.log('Running Audio Subtitles Unit & Integration Tests...')

  // 0. Core options, subscription, deduplication, persistence, and spatial distance field
  {
    const engine = new HorrorAudioEngine({ subtitles: false })
    assert(engine._subtitlesEnabled === false, 'Default subtitles should be false')

    engine.setAudioOptions({ subtitles: true })
    assert(engine._subtitlesEnabled === true, 'Subtitles should be enabled via setAudioOptions')

    engine.setAudioOptions({ subtitles: false })
    assert(engine._subtitlesEnabled === false, 'Subtitles should be disabled via setAudioOptions')

    const engine2 = new HorrorAudioEngine({ subtitles: true })
    assert(engine2._subtitlesEnabled === true, 'Subtitles enabled via constructor')
    let receivedSubtitle = null
    const unsubscribe = engine2.subscribeSubtitles((entry) => {
      receivedSubtitle = entry
    })

    engine2._emitSubtitle('Player hurt', 'player', 2.0, 10)
    assert(
      receivedSubtitle !== null && receivedSubtitle.text === 'Player hurt',
      'Subtitle event was received by subscriber'
    )

    receivedSubtitle = null
    engine2._emitSubtitle('Player hurt', 'player', 2.0, 10)
    assert(receivedSubtitle === null, 'Rapid identical subtitle was deduplicated')

    // Caller-provided maxDistance filtering works without a hardcoded 18m restriction
    receivedSubtitle = null
    engine2._emitSubtitle('Too far for 18m system', 'hazard', 20.0, 5, { maxDistance: 18 })
    assert(
      receivedSubtitle === null,
      'Subtitle beyond caller maxDistance (18m) should be filtered out'
    )

    receivedSubtitle = null
    engine2._emitSubtitle('Audible 20m director cue', 'horror', 20.0, 8, {
      maxDistance: 24,
      attenuation: { gain: 0.02, distance: 20.0, wallCount: 0 },
    })
    assert(
      receivedSubtitle !== null &&
        receivedSubtitle.text === 'Audible 20m director cue' &&
        receivedSubtitle.distance === 20.0,
      'Valid 20m cue within 24m maxDistance must not be discarded by an 18m cap'
    )

    // Verify computeSpatialAudioAttenuation returns actual finite Euclidean distance
    const attNear = computeSpatialAudioAttenuation(
      { x: 3, y: 1.65, z: 4 },
      { x: 0, y: 1.65, z: 0 },
      null,
      { maxDistance: 18 }
    )
    assert(
      Number.isFinite(attNear.distance) && Math.abs(attNear.distance - 5.0) < 1e-6,
      `computeSpatialAudioAttenuation should return Euclidean distance 5.0 (got ${attNear.distance})`
    )
    const attFar = computeSpatialAudioAttenuation(
      { x: 30, y: 1.65, z: 0 },
      { x: 0, y: 1.65, z: 0 },
      null,
      { maxDistance: 18 }
    )
    assert(
      Number.isFinite(attFar.distance) && Math.abs(attFar.distance - 30.0) < 1e-6 && attFar.gain === 0,
      `Out-of-range computeSpatialAudioAttenuation should still return finite distance 30.0 and gain 0 (got dist=${attFar.distance}, gain=${attFar.gain})`
    )

    // Persistence sanitization
    const defaults = getDefaultAllSettings()
    assert(defaults.audio.subtitles === false, 'Default all settings subtitles should be false')
    assert(
      sanitizeAllSettings({ audio: { subtitles: true } }).audio.subtitles === true,
      'Sanitization preserves subtitles: true'
    )
    assert(
      sanitizeAllSettings({ audio: { subtitles: false } }).audio.subtitles === false,
      'Sanitization preserves subtitles: false'
    )

    unsubscribe()
    receivedSubtitle = null
    engine2._emitSubtitle('After unsubscribe', 'player', 1.0, 10)
    assert(receivedSubtitle === null, 'Unsubscribed listener receives no further subtitles')

    engine.dispose()
    engine2.dispose()
  }

  // Test 1: Remote ceiling collapse produces no subtitle and no audio
  {
    const { engine, mock, received, unsubscribe } = createUnlockedSubtitleEngine()
    const listenerPos = { x: 0, y: 1.65, z: 0 }
    const remoteCeiling = {
      id: 'remote-ceiling',
      type: HAZARD_TYPES.CEILING_COLLAPSE,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: 26, y: 0, z: 0 },
      isDisposed: false,
    }

    engine.update(0.016, { playerWorldPos: listenerPos, hazards: [remoteCeiling] })
    const startOsc = mock.stats.oscillatorsStarted
    const startBuf = mock.stats.bufferSourcesStarted

    stepHazardTransition(engine, remoteCeiling, HAZARD_STATES.WARNING, listenerPos)
    stepHazardTransition(engine, remoteCeiling, HAZARD_STATES.ACTIVE, listenerPos)

    assert(received.length === 0, `Remote ceiling collapse should emit 0 subtitles (got ${received.length})`)
    assert(
      mock.stats.oscillatorsStarted === startOsc && mock.stats.bufferSourcesStarted === startBuf,
      'Remote ceiling collapse should not synthesize audio'
    )
    unsubscribe()
    engine.dispose()
  }

  // Test 2: Remote exposed wiring produces no subtitle, and removed legacy types emit 0 subtitles/audio even nearby
  {
    const { engine, mock, received, unsubscribe } = createUnlockedSubtitleEngine()
    const listenerPos = { x: 0, y: 1.65, z: 0 }
    const remoteWiring = {
      id: 'remote-wiring',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: -24, y: 0, z: 12 },
      isDisposed: false,
    }

    engine.update(0.016, { playerWorldPos: listenerPos, hazards: [remoteWiring] })
    const startOsc = mock.stats.oscillatorsStarted
    const startBuf = mock.stats.bufferSourcesStarted

    stepHazardTransition(engine, remoteWiring, HAZARD_STATES.WARNING, listenerPos)
    stepHazardTransition(engine, remoteWiring, HAZARD_STATES.ACTIVE, listenerPos)

    assert(received.length === 0, `Remote exposed wiring should emit 0 subtitles (got ${received.length})`)
    assert(
      mock.stats.oscillatorsStarted === startOsc && mock.stats.bufferSourcesStarted === startBuf,
      'Remote exposed wiring should not synthesize audio'
    )

    // Removed legacy types produce zero subtitles and zero audio even at close range
    for (const removedType of ['floor_spikes', 'pressure_plate', 'electric_grid']) {
      const fakeLegacy = {
        id: `removed-${removedType}`,
        type: removedType,
        state: HAZARD_STATES.DORMANT,
        worldPos: { x: 2, y: 0, z: 0 },
        isDisposed: false,
      }
      engine.update(0.016, { playerWorldPos: listenerPos, hazards: [fakeLegacy] })
      stepHazardTransition(engine, fakeLegacy, HAZARD_STATES.WARNING, listenerPos)
      stepHazardTransition(engine, fakeLegacy, HAZARD_STATES.ACTIVE, listenerPos)
    }
    assert(received.length === 0, `Removed legacy hazards must emit 0 subtitles even nearby (got ${received.length})`)
    assert(
      mock.stats.oscillatorsStarted === startOsc && mock.stats.bufferSourcesStarted === startBuf,
      'Removed legacy hazards must synthesize zero audio even nearby'
    )
    unsubscribe()
    engine.dispose()
  }

  // Test 3: Nearby audible hazards produce the correct subtitle (all 10 realistic hazard types)
  {
    const expectedByType = [
      [HAZARD_TYPES.CEILING_COLLAPSE, 'Ceiling cracking and dropping dust', 'Ceiling collapse impact'],
      [
        HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE,
        'Wooden furniture creaking and shaking',
        'Furniture collapse and splintering',
      ],
      [
        HAZARD_TYPES.FALLING_PIPES_FIXTURES,
        'Metallic rattling and overhead pipe creaking',
        'Heavy metal pipe fixture falling and crashing',
      ],
      [
        HAZARD_TYPES.STEAM_PIPE_BURST,
        'Steam pipe hissing and pressurizing',
        'High-pressure steam burst',
      ],
      [
        HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
        'Exposed wiring buzzing and sparking',
        'Electrical discharge crackling',
      ],
      [
        HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
        'Floor grate creaking and bending',
        'Metal grate collapsing',
      ],
      [
        HAZARD_TYPES.WALL_COLLAPSE,
        'Structural wall cracking and groaning',
        'Wall collapsing with falling rubble',
      ],
      [
        HAZARD_TYPES.FALLING_WATER_TANK,
        'Water tank creaking and leaking',
        'Tank rupturing with rushing water',
      ],
      [
        HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY,
        'Suspended machinery creaking and swaying',
        'Heavy machinery crashing down',
      ],
      [
        HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE,
        'Ventilation duct rattling and sagging',
        'Ventilation duct crashing down',
      ],
    ]

    const { engine, received, unsubscribe } = createUnlockedSubtitleEngine()
    const listenerPos = { x: 0, y: 1.65, z: 0 }

    for (let i = 0; i < expectedByType.length; i += 1) {
      const [type, warnText, activeText] = expectedByType[i]
      received.length = 0
      const hazard = {
        id: `near-${type}`,
        type,
        state: HAZARD_STATES.DORMANT,
        worldPos: { x: 4, y: 0, z: 0 },
        isDisposed: false,
      }
      engine.update(0.016, { playerWorldPos: listenerPos, hazards: [hazard] })
      stepHazardTransition(engine, hazard, HAZARD_STATES.WARNING, listenerPos)
      stepHazardTransition(engine, hazard, HAZARD_STATES.ACTIVE, listenerPos)

      assert(
        received.length === 2,
        `Nearby audible ${type} should emit 2 subtitles (warning + active), got ${received.length}`
      )
      assert(
        received[0].text === warnText && received[0].source === 'hazard',
        `${type} warning subtitle mismatch: expected "${warnText}", got "${received[0]?.text}"`
      )
      assert(
        received[1].text === activeText && received[1].source === 'hazard',
        `${type} active subtitle mismatch: expected "${activeText}", got "${received[1]?.text}"`
      )
      assert(
        received[0].distance > 3.5 && received[0].distance < 5.0,
        `${type} subtitle should record real Euclidean distance ~4.33m (got ${received[0].distance})`
      )
    }

    unsubscribe()
    engine.dispose()
  }

  // Test 4: Wall-occluded hazards produce no subtitle (while same-distance open corridor does)
  {
    const openMaze = createTestCorridorMaze({ wallCols: [], cols: 9 })
    const walledMaze = createTestCorridorMaze({ wallCols: [2, 3, 4], cols: 9 })
    const listenerPos = gridToWorld(1, 1, openMaze)
    const hazardPos = gridToWorld(1, 5, openMaze) // 4 cells = 16m (< 18m maxDistance)

    const openAtt = computeSpatialAudioAttenuation(
      hazardPos,
      { x: listenerPos.x, y: 1.65, z: listenerPos.z },
      openMaze,
      { maxDistance: 18 }
    )
    const walledAtt = computeSpatialAudioAttenuation(
      hazardPos,
      { x: listenerPos.x, y: 1.65, z: listenerPos.z },
      walledMaze,
      { maxDistance: 18 }
    )
    assert(
      openAtt.gain > SPATIAL_AUDIBILITY_GAIN_THRESHOLD,
      `Open 16m hazard should be spatially audible (gain=${openAtt.gain})`
    )
    assert(
      walledAtt.wallCount >= 3 && walledAtt.gain <= SPATIAL_AUDIBILITY_GAIN_THRESHOLD,
      `3-wall-occluded 16m hazard should be below audibility threshold (walls=${walledAtt.wallCount}, gain=${walledAtt.gain})`
    )

    // Wall-occluded: no sound, no subtitle
    const walledSetup = createUnlockedSubtitleEngine()
    walledSetup.engine.setMaze(walledMaze)
    const occludedHazard = {
      id: 'occluded-wiring',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      state: HAZARD_STATES.DORMANT,
      worldPos: hazardPos,
      isDisposed: false,
    }
    walledSetup.engine.update(0.016, { playerWorldPos: listenerPos, hazards: [occludedHazard] })
    stepHazardTransition(walledSetup.engine, occludedHazard, HAZARD_STATES.WARNING, listenerPos)
    stepHazardTransition(walledSetup.engine, occludedHazard, HAZARD_STATES.ACTIVE, listenerPos)
    assert(
      walledSetup.received.length === 0,
      `Wall-occluded hazard must emit 0 subtitles (got ${walledSetup.received.length})`
    )
    walledSetup.unsubscribe()
    walledSetup.engine.dispose()

    // Same distance in open corridor: audible + emits subtitles
    const openSetup = createUnlockedSubtitleEngine()
    openSetup.engine.setMaze(openMaze)
    const openHazard = {
      id: 'open-wiring',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      state: HAZARD_STATES.DORMANT,
      worldPos: hazardPos,
      isDisposed: false,
    }
    openSetup.engine.update(0.016, { playerWorldPos: listenerPos, hazards: [openHazard] })
    stepHazardTransition(openSetup.engine, openHazard, HAZARD_STATES.WARNING, listenerPos)
    stepHazardTransition(openSetup.engine, openHazard, HAZARD_STATES.ACTIVE, listenerPos)
    assert(
      openSetup.received.length === 2,
      `Unoccluded 16m hazard should emit 2 subtitles (got ${openSetup.received.length})`
    )
    openSetup.unsubscribe()
    openSetup.engine.dispose()
  }

  // Test 5: Elevator exit sequence & post-exit idle produce zero false hazard subtitles
  {
    const maze = generateMaze({ rows: 17, cols: 17, seed: 'elevator-exit-subtitles' })
    const hazardManager = new HazardManager(null)
    hazardManager.setMaze(maze)

    const { engine, received, unsubscribe } = createUnlockedSubtitleEngine()
    engine.setMaze(maze)

    const spawnPos = gridToWorld(maze.start.row, maze.start.col, maze)
    const allHazards = hazardManager.getHazards()
    assert(allHazards.length === 10, `Maze spawns 10 realistic hazards (got ${allHazards.length})`)

    // Simulate 5.5 seconds of starting elevator descent + exit (isSpawnSequenceActive = true)
    for (let step = 0; step < 110; step += 1) {
      hazardManager.update(0.05, null)
      engine.update(0.05, {
        playerWorldPos: spawnPos,
        hazards: allHazards,
        isSpawnSequenceActive: true,
      })
    }

    assert(
      received.length === 0,
      `Zero hazard subtitles should appear during elevator sequence (got: ${received.map((r) => r.text).join(', ')})`
    )

    // Step out of the elevator (isSpawnSequenceActive becomes false) and advance 6 more seconds at spawn
    for (let step = 0; step < 120; step += 1) {
      hazardManager.update(0.05, {
        playerWorldPos: spawnPos,
        playerGridCell: maze.start,
      })
      engine.update(0.05, {
        playerWorldPos: spawnPos,
        hazards: allHazards,
        isSpawnSequenceActive: false,
      })
    }

    assert(
      received.length === 0,
      `Zero false hazard subtitles should appear while standing at elevator exit (got: ${received.map((r) => r.text).join(', ')})`
    )

    // Explicitly verify remote (>20m) realistic hazards transitioning right after exit emit 0 subtitles
    const remotePostExitCeiling = {
      id: 'post-exit-remote-ceiling',
      type: HAZARD_TYPES.CEILING_COLLAPSE,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: spawnPos.x + 28, y: 0, z: spawnPos.z },
      isDisposed: false,
    }
    const remotePostExitWiring = {
      id: 'post-exit-remote-wiring',
      type: HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: spawnPos.x - 28, y: 0, z: spawnPos.z },
      isDisposed: false,
    }
    received.length = 0
    engine.update(0.016, {
      playerWorldPos: spawnPos,
      hazards: [remotePostExitCeiling, remotePostExitWiring],
      isSpawnSequenceActive: true,
    })
    remotePostExitCeiling.state = HAZARD_STATES.WARNING
    remotePostExitWiring.state = HAZARD_STATES.ACTIVE
    engine.update(0.016, {
      playerWorldPos: spawnPos,
      hazards: [remotePostExitCeiling, remotePostExitWiring],
      isSpawnSequenceActive: false,
    })
    assert(
      received.length === 0,
      `Remote hazards transitioning on elevator exit must emit 0 subtitles (got ${received.length})`
    )

    unsubscribe()
    engine.dispose()
    hazardManager.dispose()
  }

  // Test 6: Muted and zero-volume settings preserve subtitles for spatially audible hazards (and block inaudible ones)
  {
    const listenerPos = { x: 0, y: 1.65, z: 0 }

    // 6a. Unlocked + muted
    const mutedSetup = createUnlockedSubtitleEngine({
      volumes: { master: 0.8, effects: 0.8, muted: true },
    })
    const nearHazardA = {
      id: 'muted-near-steam',
      type: HAZARD_TYPES.STEAM_PIPE_BURST,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: 5, y: 0, z: 0 },
      isDisposed: false,
    }
    const farHazardA = {
      id: 'muted-far-wall',
      type: HAZARD_TYPES.WALL_COLLAPSE,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: 30, y: 0, z: 0 },
      isDisposed: false,
    }
    mutedSetup.engine.update(0.016, {
      playerWorldPos: listenerPos,
      hazards: [nearHazardA, farHazardA],
    })
    nearHazardA.state = HAZARD_STATES.WARNING
    farHazardA.state = HAZARD_STATES.ACTIVE
    mutedSetup.engine.update(0.016, {
      playerWorldPos: listenerPos,
      hazards: [nearHazardA, farHazardA],
    })
    assert(
      mutedSetup.received.length === 1 &&
        mutedSetup.received[0].text === 'Steam pipe hissing and pressurizing',
      `Muted mode must preserve spatially audible hazard subtitle while suppressing remote hazard (got ${mutedSetup.received.map((s) => s.text).join(', ')})`
    )
    mutedSetup.unsubscribe()
    mutedSetup.engine.dispose()

    // 6b. Master volume = 0 AND pre-unlock (dest === null, yet spatially audible)
    const zeroVolSetup = createUnlockedSubtitleEngine({
      unlock: false,
      volumes: { master: 0, effects: 0, muted: false },
    })
    const nearHazardB = {
      id: 'zero-vol-near-ceiling',
      type: HAZARD_TYPES.CEILING_COLLAPSE,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: 4, y: 0, z: 0 },
      isDisposed: false,
    }
    const farHazardB = {
      id: 'zero-vol-far-tank',
      type: HAZARD_TYPES.FALLING_WATER_TANK,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: 25, y: 0, z: 0 },
      isDisposed: false,
    }
    zeroVolSetup.engine.update(0.016, {
      playerWorldPos: listenerPos,
      hazards: [nearHazardB, farHazardB],
    })
    nearHazardB.state = HAZARD_STATES.ACTIVE
    farHazardB.state = HAZARD_STATES.ACTIVE
    zeroVolSetup.engine.update(0.016, {
      playerWorldPos: listenerPos,
      hazards: [nearHazardB, farHazardB],
    })
    assert(
      zeroVolSetup.received.length === 1 &&
        zeroVolSetup.received[0].text === 'Ceiling collapse impact',
      `Zero-volume / locked audio must still emit subtitle for spatially audible hazard and skip remote hazard (got ${zeroVolSetup.received.map((s) => s.text).join(', ')})`
    )
    zeroVolSetup.unsubscribe()
    zeroVolSetup.engine.dispose()
  }

  // Test 7: Paused and disposed (plus gameOver/won) states suppress new subtitles
  {
    const { engine, received, unsubscribe } = createUnlockedSubtitleEngine()
    const listenerPos = { x: 0, y: 1.65, z: 0 }
    const nearHazard = {
      id: 'paused-test-hazard',
      type: HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: 3, y: 0, z: 0 },
      isDisposed: false,
    }
    engine.update(0.016, { playerWorldPos: listenerPos, hazards: [nearHazard] })

    // Paused
    engine.setPaused(true)
    stepHazardTransition(engine, nearHazard, HAZARD_STATES.WARNING, listenerPos)
    engine.playHorrorDirectorCue('distant_silhouette', { x: 6, y: 0, z: 0 })
    engine._emitSubtitle('Should not emit while paused', 'player', 0, 10)
    assert(received.length === 0, `Paused engine must emit 0 subtitles (got ${received.length})`)

    // Unpause, then verify gameOver & won suppress new subtitles
    engine.setPaused(false)
    engine.onGameOver()
    engine.playHorrorDirectorCue('blackout')
    engine._emitSubtitle('Should not emit after game over', 'player', 0, 10)
    assert(received.length === 0, `Game-over engine must emit 0 subtitles (got ${received.length})`)

    engine.reset()
    engine.setHasWon(true)
    engine.playHorrorDirectorCue('light_flicker')
    engine._emitSubtitle('Should not emit after victory', 'player', 0, 10)
    assert(received.length === 0, `Victory engine must emit 0 subtitles (got ${received.length})`)

    // Disposed
    engine.setHasWon(false)
    engine.dispose()
    engine.playHorrorDirectorCue('distant_silhouette', { x: 5, y: 0, z: 0 })
    engine._emitSubtitle('Should not emit after dispose', 'player', 0, 10)
    assert(received.length === 0, `Disposed engine must emit 0 subtitles (got ${received.length})`)

    unsubscribe()
  }

  // Test 8: Audible distant_silhouette cue produces its subtitle (direct, at 20m > 18m, muted, and via HorrorDirector)
  {
    // 8a. Direct playHorrorDirectorCue at 8m and 20m (proving 18m restriction is removed)
    const { engine, mock, received, unsubscribe } = createUnlockedSubtitleEngine()
    engine.update(0.016, { playerWorldPos: { x: 0, y: 1.65, z: 0 } })

    const startOsc = mock.stats.oscillatorsStarted
    const played = engine.playHorrorDirectorCue('distant_silhouette', { x: 8, y: 0, z: 0 })
    assert(played === true, 'Audible distant_silhouette cue should play audio')
    assert(
      mock.stats.oscillatorsStarted > startOsc,
      'distant_silhouette cue should synthesize audible silhouette sting'
    )
    assert(
      received.length === 1 &&
        received[0].text === 'Distant figure whispering' &&
        received[0].source === 'horror',
      `Audible distant_silhouette must emit "Distant figure whispering" (got ${received[0]?.text})`
    )

    // Reset dedup cache via reset() and verify a 20m silhouette (within 24m maxDistance) still emits subtitle
    engine.reset()
    received.length = 0
    engine.update(0.016, { playerWorldPos: { x: 0, y: 1.65, z: 0 } })
    const played20m = engine.playHorrorDirectorCue('distant_silhouette', { x: 20, y: 0, z: 0 })
    assert(played20m === true, '20m distant_silhouette within 24m maxDistance should play audio')
    assert(
      received.length === 1 &&
        received[0].text === 'Distant figure whispering' &&
        received[0].distance >= 19.5,
      `20m distant_silhouette must not be dropped by removed 18m cap (got count=${received.length}, dist=${received[0]?.distance})`
    )

    // Muted distant_silhouette still emits subtitle
    engine.reset()
    received.length = 0
    engine.setMuted(true)
    engine.update(0.016, { playerWorldPos: { x: 0, y: 1.65, z: 0 } })
    engine.playHorrorDirectorCue('distant_silhouette', { x: 10, y: 0, z: 0 })
    assert(
      received.length === 1 && received[0].text === 'Distant figure whispering',
      'Muted distant_silhouette must still emit subtitle'
    )

    unsubscribe()
    engine.dispose()

    // 8b. End-to-end HorrorDirector.triggerEvent(DISTANT_SILHOUETTE) -> HorrorAudioEngine -> subtitle
    const openMaze = createTestCorridorMaze({ wallCols: [], cols: 9 })
    const dirSetup = createUnlockedSubtitleEngine()
    dirSetup.engine.setMaze(openMaze)
    const scene = new THREE.Scene()
    const director = new HorrorDirector({
      scene,
      audioEngine: dirSetup.engine,
      intensity: HORROR_INTENSITY_LEVELS.HIGH,
      visualScaresEnabled: true,
    })
    director.setMaze(openMaze)

    const playerPos = gridToWorld(1, 1, openMaze)
    dirSetup.engine.update(0.016, { playerWorldPos: playerPos })

    const evt = director.triggerEvent(HORROR_EVENT_TYPES.DISTANT_SILHOUETTE, {
      playerWorldPos: playerPos,
      playerForward: new THREE.Vector3(1, 0, 0),
      playerGridCell: { row: 1, col: 1 },
      health: 100,
      maxHealth: 100,
      elapsedTime: 25,
      enemies: [],
    })
    assert(evt !== null && evt.type === HORROR_EVENT_TYPES.DISTANT_SILHOUETTE, 'HorrorDirector triggered DISTANT_SILHOUETTE')
    assert(
      dirSetup.received.some((s) => s.text === 'Distant figure whispering'),
      'End-to-end HorrorDirector DISTANT_SILHOUETTE event must emit "Distant figure whispering"'
    )

    director.dispose()
    dirSetup.unsubscribe()
    dirSetup.engine.dispose()
  }

  // Test 9: All HorrorDirector cue types and scripted_scare beats 1, 2, 3 have distinct accurate subtitles
  {
    const { engine, received, unsubscribe } = createUnlockedSubtitleEngine()
    engine.update(0.016, { playerWorldPos: { x: 0, y: 1.65, z: 0 } })

    const cases = [
      ['distant_silhouette', { x: 7, y: 0, z: 0 }, {}, 'Distant figure whispering'],
      ['environmental_sound', { x: 9, y: 0, z: 0 }, { variant: 1 }, 'Distant metallic disturbance'],
      ['light_flicker', null, {}, 'Overhead lights flickering'],
      ['blackout', null, {}, 'Power failure'],
      ['presence_warning', null, { tension: 0.7 }, 'Ominous presence nearby'],
      ['scripted_scare', null, { beat: 1 }, 'Sudden power drop and metallic shriek'],
      ['scripted_scare', null, { beat: 2 }, 'Sharp metallic scrape echoing nearby'],
      ['scripted_scare', null, { beat: 3 }, 'Power relay humming back online'],
    ]

    const scriptedTexts = new Set()
    for (const [eventType, pos, meta, expectedText] of cases) {
      received.length = 0
      const played = engine.playHorrorDirectorCue(eventType, pos, meta)
      assert(played === true, `HorrorDirector cue ${eventType} (beat=${meta.beat ?? '-'}) should play`)
      assert(
        received.length === 1 && received[0].text === expectedText && received[0].source === 'horror',
        `HorrorDirector ${eventType} (beat=${meta.beat ?? '-'}) expected "${expectedText}", got "${received[0]?.text}"`
      )
      if (eventType === 'scripted_scare') {
        scriptedTexts.add(received[0].text)
      }
    }
    assert(scriptedTexts.size === 3, 'All 3 scripted_scare beats must produce distinct subtitles')

    // Invalid event type & invalid beat emit no subtitle
    received.length = 0
    engine.playHorrorDirectorCue('nonexistent_director_event', { x: 4, y: 0, z: 0 })
    engine.playHorrorDirectorCue('scripted_scare', null, { beat: 99 })
    assert(
      received.length === 0,
      `Invalid HorrorDirector cue or beat must emit 0 subtitles (got ${received.length})`
    )

    unsubscribe()
    engine.dispose()
  }

  // Test 10: Out-of-range and wall-occluded HorrorDirector cues produce no subtitles
  {
    const openMaze = createTestCorridorMaze({ wallCols: [], cols: 9 })
    const walledMaze = createTestCorridorMaze({ wallCols: [2, 3, 4], cols: 9 })
    const listenerPos = gridToWorld(1, 1, openMaze)
    const far20mPos = gridToWorld(1, 6, openMaze) // 5 cells = 20m (< 24m maxDistance)

    const openAtt = computeSpatialAudioAttenuation(
      far20mPos,
      { x: listenerPos.x, y: 1.65, z: listenerPos.z },
      openMaze,
      { maxDistance: 24 }
    )
    const walledAtt = computeSpatialAudioAttenuation(
      far20mPos,
      { x: listenerPos.x, y: 1.65, z: listenerPos.z },
      walledMaze,
      { maxDistance: 24 }
    )
    assert(
      openAtt.gain > SPATIAL_AUDIBILITY_GAIN_THRESHOLD,
      `Open 20m HorrorDirector cue should be spatially audible (gain=${openAtt.gain})`
    )
    assert(
      walledAtt.wallCount >= 3 && walledAtt.gain <= SPATIAL_AUDIBILITY_GAIN_THRESHOLD,
      `Wall-occluded 20m HorrorDirector cue should fall below audibility threshold (walls=${walledAtt.wallCount}, gain=${walledAtt.gain})`
    )

    // Out-of-range (>= 24m)
    const outSetup = createUnlockedSubtitleEngine()
    outSetup.engine.setMaze(openMaze)
    outSetup.engine.update(0.016, { playerWorldPos: listenerPos })
    const outSilPlayed = outSetup.engine.playHorrorDirectorCue('distant_silhouette', {
      x: listenerPos.x + 28,
      y: 0,
      z: listenerPos.z,
    })
    const outEnvPlayed = outSetup.engine.playHorrorDirectorCue('environmental_sound', {
      x: listenerPos.x + 30,
      y: 0,
      z: listenerPos.z,
    })
    assert(!outSilPlayed && !outEnvPlayed, 'Out-of-range HorrorDirector cues should not play')
    assert(
      outSetup.received.length === 0,
      `Out-of-range HorrorDirector cues must emit 0 subtitles (got ${outSetup.received.length})`
    )
    outSetup.unsubscribe()
    outSetup.engine.dispose()

    // Wall-occluded (< 24m, behind 3 walls -> gain <= 0.005)
    const wallSetup = createUnlockedSubtitleEngine()
    wallSetup.engine.setMaze(walledMaze)
    wallSetup.engine.update(0.016, { playerWorldPos: listenerPos })
    const wallSilPlayed = wallSetup.engine.playHorrorDirectorCue('distant_silhouette', far20mPos)
    const wallEnvPlayed = wallSetup.engine.playHorrorDirectorCue('environmental_sound', far20mPos)
    assert(!wallSilPlayed && !wallEnvPlayed, 'Wall-occluded HorrorDirector cues should not play')
    assert(
      wallSetup.received.length === 0,
      `Wall-occluded HorrorDirector cues must emit 0 subtitles (got ${wallSetup.received.length})`
    )
    wallSetup.unsubscribe()
    wallSetup.engine.dispose()

    // Same 20m distance in open corridor: audible + emits subtitles
    const openSetup = createUnlockedSubtitleEngine()
    openSetup.engine.setMaze(openMaze)
    openSetup.engine.update(0.016, { playerWorldPos: listenerPos })
    openSetup.engine.playHorrorDirectorCue('distant_silhouette', far20mPos)
    openSetup.engine.playHorrorDirectorCue('environmental_sound', far20mPos)
    assert(
      openSetup.received.length === 2,
      `Open 20m HorrorDirector cues should emit 2 subtitles (got ${openSetup.received.length})`
    )
    openSetup.unsubscribe()
    openSetup.engine.dispose()
  }

  // Test 11: Audible 20m enemy chase alert (maxDistance 24m) is preserved after removing 18m cap
  {
    const { engine, received, unsubscribe } = createUnlockedSubtitleEngine()
    const listenerPos = { x: 0, y: 1.65, z: 0 }
    engine.update(0.016, { playerWorldPos: listenerPos })
    const enemy = {
      id: 'far-stalker',
      type: 'hunter',
      state: 'patrol',
      worldPos: { x: 20, y: 0, z: 0 },
      isDisposed: false,
    }
    engine.update(0.016, { playerWorldPos: listenerPos, enemies: [enemy] })
    enemy.state = 'chase'
    engine.update(0.016, { playerWorldPos: listenerPos, enemies: [enemy] })
    assert(
      received.some((s) => s.text === 'Phantom: detects you (chase)' && s.distance >= 19.5),
      `Audible 20m enemy chase alert should emit subtitle without 18m cutoff (got: ${received.map((s) => `${s.text}@${s.distance}`).join(', ')})`
    )
    unsubscribe()
    engine.dispose()
  }

  // --- P1 LIFECYCLE, OVERLAY QUEUE, TIMER CLEANUP & DEDUPLICATION TESTS ---

  function createFakeTimerHarness() {
    let now = 0
    let nextId = 1
    const active = new Map()
    let clearedCount = 0

    return {
      get now() {
        return now
      },
      get activeCount() {
        return active.size
      },
      get clearedCount() {
        return clearedCount
      },
      schedule(fn, ms) {
        const id = nextId++
        active.set(id, { fn, runAt: now + ms })
        return id
      },
      cancel(id) {
        if (active.delete(id)) {
          clearedCount += 1
        }
      },
      advanceBy(deltaMs) {
        now += deltaMs
        const due = []
        for (const [id, task] of active.entries()) {
          if (task.runAt <= now) {
            due.push([id, task])
          }
        }
        due.sort((a, b) => a[1].runAt - b[1].runAt || a[0] - b[0])
        for (const [id, task] of due) {
          if (active.delete(id)) {
            task.fn()
          }
        }
      },
      fireAllForcefully() {
        const snapshot = Array.from(active.entries())
        active.clear()
        for (const [, task] of snapshot) {
          task.fn()
        }
      },
    }
  }

  function mountSimulatedOverlay(audioEngine, fakeTimers) {
    let visible = []
    let stateUpdateCount = 0
    let isMounted = true
    const timersMap = new Map()

    let activeCleanup = null

    function syncActive({ enabled = true, paused = false, gameOver = false, won = false } = {}) {
      if (activeCleanup) {
        activeCleanup()
        activeCleanup = null
      }

      const isActive = Boolean(audioEngine && enabled && !paused && !gameOver && !won)
      if (!isActive) {
        for (const timerId of timersMap.values()) {
          fakeTimers.cancel(timerId)
        }
        timersMap.clear()
        return
      }

      const controller = createSubtitleQueueController({
        timersMap,
        lifetimeMs: SUBTITLE_LIFETIME_MS,
        maxEntries: SUBTITLE_MAX_ENTRIES,
        scheduleTimeout: (fn, ms) => fakeTimers.schedule(fn, ms),
        cancelTimeout: (id) => fakeTimers.cancel(id),
        onChange: (nextEntries) => {
          if (isMounted) {
            visible = nextEntries
            stateUpdateCount += 1
          }
        },
      })

      const unsubSub = audioEngine.subscribeSubtitles((entry) => {
        controller.push(entry)
      })
      const unsubClear = audioEngine.subscribeSubtitleClear(() => {
        controller.clear({ notify: true })
      })

      activeCleanup = () => {
        unsubSub?.()
        unsubClear?.()
        controller.clear({ notify: isMounted })
        controller.dispose()
      }
    }

    function unmount() {
      isMounted = false
      if (activeCleanup) {
        activeCleanup()
        activeCleanup = null
      }
    }

    syncActive({ enabled: true })

    return {
      syncActive,
      unmount,
      getVisible: () => visible,
      getStateUpdateCount: () => stateUpdateCount,
      timersMap,
    }
  }

  // Test 12: Disabling subtitles immediately clears visible entries & timers
  {
    const timers = createFakeTimerHarness()
    const { engine, unsubscribe } = createUnlockedSubtitleEngine()
    const overlay = mountSimulatedOverlay(engine, timers)

    engine._emitSubtitle('Ceiling cracking and dropping dust', 'hazard', 3, 10)
    engine._emitSubtitle('Wraith: footsteps', 'enemy', 4, 5)
    assert(overlay.getVisible().length === 2, 'Expected 2 visible subtitles before disable')
    assert(timers.activeCount === 2 && overlay.timersMap.size === 2, 'Expected 2 active timers')

    // Disable via engine option
    engine.setAudioOptions({ subtitles: false })
    assert(
      overlay.getVisible().length === 0,
      'Disabling subtitles via setAudioOptions must immediately clear visible entries'
    )
    assert(
      timers.activeCount === 0 && overlay.timersMap.size === 0,
      'Disabling subtitles must clear all pending timers'
    )

    // Re-enable, emit, then disable via overlay prop transition
    engine.setAudioOptions({ subtitles: true })
    engine._emitSubtitle('Floor grate creaking and bending', 'hazard', 3, 10)
    assert(overlay.getVisible().length === 1, 'Subtitle visible after re-enable')
    overlay.syncActive({ enabled: false })
    assert(
      overlay.getVisible().length === 0 && timers.activeCount === 0,
      'Disabling overlay prop must immediately clear entries and timers'
    )

    // Re-enabling overlay must not restore stale entries
    overlay.syncActive({ enabled: true })
    assert(
      overlay.getVisible().length === 0,
      'Re-enabling overlay must not restore old subtitles'
    )

    overlay.unmount()
    unsubscribe()
    engine.dispose()
  }

  // Test 13: Pause, game over, and victory immediately clear entries and prevent stale reappearance
  {
    const timers = createFakeTimerHarness()
    const { engine, unsubscribe } = createUnlockedSubtitleEngine()
    const overlay = mountSimulatedOverlay(engine, timers)

    // Pause clears entries & resuming does not bring them back
    engine._emitSubtitle('Steam pipe hissing and pressurizing', 'hazard', 4, 9)
    assert(overlay.getVisible().length === 1, 'Expected 1 subtitle before pause')
    engine.setPaused(true)
    assert(
      overlay.getVisible().length === 0 && timers.activeCount === 0,
      'Pausing engine must immediately clear subtitles and timers'
    )
    engine.setPaused(false)
    assert(
      overlay.getVisible().length === 0,
      'Resuming from pause must not resurrect stale subtitles'
    )

    // Game over clears entries (both onGameOver and update() transition)
    engine._emitSubtitle('Revenant: attacking', 'enemy', 3, 14)
    assert(overlay.getVisible().length === 1, 'Expected 1 subtitle before game over')
    engine.onGameOver()
    assert(
      overlay.getVisible().length === 0 && timers.activeCount === 0,
      'onGameOver must immediately clear subtitles and timers'
    )

    engine.reset()
    engine._emitSubtitle('Wraith: investigating', 'enemy', 5, 5)
    assert(overlay.getVisible().length === 1, 'Expected 1 subtitle before update(isGameOver)')
    engine.update(0.016, { isGameOver: true })
    assert(
      overlay.getVisible().length === 0 && timers.activeCount === 0,
      'update({ isGameOver: true }) must clear subtitles and timers'
    )

    // Victory clears entries
    engine.reset()
    engine._emitSubtitle('Extraction elevator departing', 'environment', 0, 10)
    assert(overlay.getVisible().length === 1, 'Expected 1 subtitle before victory')
    engine.setHasWon(true)
    assert(
      overlay.getVisible().length === 0 && timers.activeCount === 0,
      'setHasWon(true) must immediately clear subtitles and timers'
    )

    overlay.unmount()
    unsubscribe()
    engine.dispose()
  }

  // Test 14: Maze replacement (setMaze), reset(), and dispose() clear visible entries & timers
  {
    const timers = createFakeTimerHarness()
    const { engine, unsubscribe } = createUnlockedSubtitleEngine()
    const overlay = mountSimulatedOverlay(engine, timers)
    const maze1 = createTestCorridorMaze({ cols: 9 })
    const maze2 = createTestCorridorMaze({ cols: 11 })

    engine.setMaze(maze1)
    engine._emitSubtitle('Structural wall cracking and groaning', 'hazard', 4, 10)
    assert(overlay.getVisible().length === 1 && timers.activeCount === 1, 'Subtitle active on maze1')

    engine.setMaze(maze2)
    assert(
      overlay.getVisible().length === 0 && timers.activeCount === 0,
      'setMaze must immediately clear active subtitles and timers'
    )

    engine._emitSubtitle('Heavy machinery crashing down', 'hazard', 4, 15)
    assert(overlay.getVisible().length === 1 && timers.activeCount === 1, 'Subtitle active before reset')

    engine.reset()
    assert(
      overlay.getVisible().length === 0 && timers.activeCount === 0,
      'reset() must immediately clear active subtitles and timers'
    )

    engine._emitSubtitle('Distant figure whispering', 'horror', 7, 11)
    assert(overlay.getVisible().length === 1 && timers.activeCount === 1, 'Subtitle active before dispose')

    engine.dispose()
    assert(
      overlay.getVisible().length === 0 && timers.activeCount === 0,
      'dispose() must notify clear subscribers to clear active subtitles and timers'
    )

    overlay.unmount()
    unsubscribe()
  }

  // Test 15: Unmount clears all pending timeouts and prevents any post-unmount state updates
  {
    const timers = createFakeTimerHarness()
    const { engine, unsubscribe } = createUnlockedSubtitleEngine()
    const overlay = mountSimulatedOverlay(engine, timers)

    engine._emitSubtitle('Entry A', 'hazard', 2, 10)
    engine._emitSubtitle('Entry B', 'hazard', 2, 10)
    engine._emitSubtitle('Entry C', 'enemy', 3, 14)
    assert(timers.activeCount === 3 && overlay.timersMap.size === 3, 'Expected 3 pending timeouts before unmount')

    const updatesBeforeUnmount = overlay.getStateUpdateCount()
    overlay.unmount()

    assert(
      timers.activeCount === 0 && overlay.timersMap.size === 0,
      `All pending timeout handles must be cleared on unmount (active=${timers.activeCount}, map=${overlay.timersMap.size})`
    )
    assert(
      overlay.getStateUpdateCount() === updatesBeforeUnmount,
      'Unmounting must NOT trigger any post-unmount state update'
    )

    // Emit further subtitles and advance time past lifetime — zero state updates may occur
    engine._emitSubtitle('After unmount event', 'hazard', 2, 15)
    timers.advanceBy(SUBTITLE_LIFETIME_MS * 2)
    timers.fireAllForcefully()
    assert(
      overlay.getStateUpdateCount() === updatesBeforeUnmount,
      'No state updates may occur after unmount from timers or late engine events'
    )

    unsubscribe()
    engine.dispose()
  }

  // Test 16: Max 6 entries, priority-aware survival, equal-priority oldest-first eviction, newest at bottom
  {
    // 16a. Pure queue: max 6 entries & equal-priority oldest-first eviction
    let list = []
    for (let i = 1; i <= 8; i += 1) {
      const res = enqueueSubtitleEntry(list, { id: i, text: `Msg ${i}`, priority: 5 })
      assert(res.accepted === true, `Equal-priority entry ${i} should be accepted`)
      list = res.next
      assert(list.length <= SUBTITLE_MAX_ENTRIES, 'Queue must never exceed 6 entries')
    }
    assert(
      list.map((e) => e.id).join(',') === '3,4,5,6,7,8',
      `Equal-priority eviction must remove oldest first and keep newest at bottom (got ${list.map((e) => e.id).join(',')})`
    )

    // 16b. High-priority entries survive low-priority flood (mixed queue)
    const timers = createFakeTimerHarness()
    let latest = []
    const controller = createSubtitleQueueController({
      timersMap: new Map(),
      lifetimeMs: SUBTITLE_LIFETIME_MS,
      maxEntries: SUBTITLE_MAX_ENTRIES,
      scheduleTimeout: (fn, ms) => timers.schedule(fn, ms),
      cancelTimeout: (id) => timers.cancel(id),
      onChange: (next) => {
        latest = next
      },
    })

    controller.push({ id: 1, text: 'Ceiling collapse impact', priority: 15 })
    controller.push({ id: 2, text: 'Soft sigh', priority: 2 })
    controller.push({ id: 3, text: 'Revenant: attacking', priority: 14 })
    controller.push({ id: 4, text: 'Wraith: footsteps', priority: 5 })
    controller.push({ id: 5, text: 'Player injured / gasp', priority: 15 })
    controller.push({ id: 6, text: 'Walking breath', priority: 2 })
    assert(latest.length === 6 && timers.activeCount === 6, 'Queue filled to 6 entries with 6 timers')

    // Incoming low-priority breath (2) should evict oldest low-priority entry (id: 2, priority 2)
    controller.push({ id: 7, text: 'Running panting', priority: 2 })
    assert(latest.length === 6, 'Queue stays capped at 6')
    assert(!latest.some((e) => e.id === 2), 'Oldest low-priority entry (id=2) should be evicted first')
    assert(latest[latest.length - 1].id === 7, 'Newest accepted entry must be at the bottom')
    assert(
      timers.activeCount === 6 && !controller.timersMap.has(2),
      'Evicted entry timer handle must be cleared immediately'
    )

    // Incoming high-priority attack (14) should evict remaining lowest-priority entry (id: 6, priority 2)
    controller.push({ id: 8, text: 'Phantom: attacking', priority: 14 })
    assert(!latest.some((e) => e.id === 6), 'Next oldest priority-2 entry (id=6) should be evicted')
    assert(
      latest.some((e) => e.id === 1) &&
        latest.some((e) => e.id === 3) &&
        latest.some((e) => e.id === 5) &&
        latest.some((e) => e.id === 8),
      'All high-priority hazard/attack/damage entries must survive'
    )

    // Fill all 6 slots with high-priority entries (12..15), then flood with low-priority breathing (2)
    controller.clear()
    for (let i = 10; i < 16; i += 1) {
      controller.push({ id: i, text: `Critical ${i}`, priority: 14 })
    }
    assert(latest.length === 6, '6 critical entries present')
    const rejectedLow = controller.push({ id: 99, text: 'Soft sigh', priority: 2 })
    assert(rejectedLow === false, 'Low-priority cue must not evict strictly higher-priority entries')
    assert(
      latest.map((e) => e.id).join(',') === '10,11,12,13,14,15',
      'All 6 high-priority entries preserved intact under low-priority pressure'
    )
    assert(timers.activeCount === 6, 'Rejected low-priority entry must not leak a timer')

    controller.dispose()
  }

  // Test 17: Independent expiration removes only expired entries at their individual 4.5s lifetimes
  {
    const timers = createFakeTimerHarness()
    let latest = []
    const controller = createSubtitleQueueController({
      timersMap: new Map(),
      lifetimeMs: SUBTITLE_LIFETIME_MS,
      maxEntries: SUBTITLE_MAX_ENTRIES,
      scheduleTimeout: (fn, ms) => timers.schedule(fn, ms),
      cancelTimeout: (id) => timers.cancel(id),
      onChange: (next) => {
        latest = next
      },
    })

    controller.push({ id: 1, text: 'First cue', priority: 10 })
    timers.advanceBy(1000)
    controller.push({ id: 2, text: 'Second cue', priority: 10 })
    timers.advanceBy(1500) // t = 2500
    controller.push({ id: 3, text: 'Third cue', priority: 10 })

    assert(latest.map((e) => e.id).join(',') === '1,2,3', 'All 3 entries active at t=2500')

    timers.advanceBy(2000) // t = 4500 -> entry 1 expires, entries 2 & 3 remain
    assert(
      latest.map((e) => e.id).join(',') === '2,3' &&
        !controller.timersMap.has(1) &&
        controller.timersMap.size === 2,
      `Only entry 1 should expire at t=4500 (got ${latest.map((e) => e.id).join(',')})`
    )

    timers.advanceBy(1000) // t = 5500 -> entry 2 expires, entry 3 remains
    assert(
      latest.map((e) => e.id).join(',') === '3' &&
        !controller.timersMap.has(2) &&
        controller.timersMap.size === 1,
      `Only entry 2 should expire at t=5500 (got ${latest.map((e) => e.id).join(',')})`
    )

    timers.advanceBy(1500) // t = 7000 -> entry 3 expires
    assert(
      latest.length === 0 && controller.timersMap.size === 0 && timers.activeCount === 0,
      'All entries and timers should be cleanly expired at t=7000'
    )

    controller.dispose()
  }

  // Test 18: Deduplication clearing on reset/setMaze/dispose, expired pruning, and post-window re-emission
  {
    let clockMs = 1000
    const { engine, received, unsubscribe } = createUnlockedSubtitleEngine({
      nowMs: () => clockMs,
    })

    // Emit and verify dedup within window
    assert(engine._emitSubtitle('Floor grate creaking and bending', 'hazard', 3, 10) === true, 'Initial emit succeeds')
    assert(
      engine._emitSubtitle('Floor grate creaking and bending', 'hazard', 3, 10) === false,
      'Duplicate within 900ms window is suppressed'
    )
    assert(received.length === 1, 'Only 1 subtitle received within dedup window')

    // Advance past dedup window (900ms) -> legitimate repeat succeeds AND expired keys are pruned
    for (let i = 0; i < 40; i += 1) {
      engine._emitSubtitle(`Transient noise ${i}`, 'hazard', 3, 5)
    }
    assert(engine._recentSubtitles.size === 41, '41 recent dedup keys stored within current window')

    clockMs += SUBTITLE_DEDUP_WINDOW_MS + 50
    const reEmitted = engine._emitSubtitle('Floor grate creaking and bending', 'hazard', 3, 10)
    assert(reEmitted === true, 'Legitimate repeated sound after 900ms window must emit again')
    assert(
      engine._recentSubtitles.size === 1,
      `Expired dedup keys must be pruned to prevent unbounded growth (size=${engine._recentSubtitles.size})`
    )

    // reset() clears dedup state so immediate replay emits cleanly
    assert(engine._emitSubtitle('Floor grate creaking and bending', 'hazard', 3, 10) === false, 'Suppressed before reset')
    engine.reset()
    assert(engine._recentSubtitles.size === 0, 'reset() must clear _recentSubtitles')
    assert(
      engine._emitSubtitle('Floor grate creaking and bending', 'hazard', 3, 10) === true,
      'Immediate repeat after reset() must emit cleanly'
    )

    // setMaze() clears dedup state
    engine.setMaze(createTestCorridorMaze({ cols: 9 }))
    assert(engine._recentSubtitles.size === 0, 'setMaze() must clear _recentSubtitles')
    assert(
      engine._emitSubtitle('Floor grate creaking and bending', 'hazard', 3, 10) === true,
      'Immediate repeat after setMaze() must emit cleanly'
    )

    // dispose() clears dedup state & rejects subsequent emissions
    engine.dispose()
    assert(engine._recentSubtitles.size === 0, 'dispose() must clear _recentSubtitles')
    assert(
      engine._emitSubtitle('Floor grate creaking and bending', 'hazard', 3, 10) === false,
      'dispose() must reject all future subtitles'
    )

    unsubscribe()
  }

  console.log('All Audio Subtitles Unit & Integration Tests Passed Successfully!')
  return true
}

runAudioSubtitlesTests()
