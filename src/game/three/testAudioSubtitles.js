import * as THREE from 'three'
import {
  HorrorAudioEngine,
  SPATIAL_AUDIBILITY_GAIN_THRESHOLD,
  computeSpatialAudioAttenuation,
} from './HorrorAudioEngine.js'
import { HorrorDirector, HORROR_EVENT_TYPES, HORROR_INTENSITY_LEVELS } from './HorrorDirector.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { HazardManager } from './HazardManager.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { gridToWorld } from '../world/worldCoords.js'
import { sanitizeAllSettings, getDefaultAllSettings } from '../../utils/persistence.js'

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

  // Test 1: Remote floor spikes produce no subtitle
  {
    const { engine, mock, received, unsubscribe } = createUnlockedSubtitleEngine()
    const listenerPos = { x: 0, y: 1.65, z: 0 }
    const remoteSpikes = {
      id: 'remote-spikes',
      type: HAZARD_TYPES.FLOOR_SPIKES,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: 26, y: 0, z: 0 },
      isDisposed: false,
    }

    engine.update(0.016, { playerWorldPos: listenerPos, hazards: [remoteSpikes] })
    const startOsc = mock.stats.oscillatorsStarted
    const startBuf = mock.stats.bufferSourcesStarted

    stepHazardTransition(engine, remoteSpikes, HAZARD_STATES.WARNING, listenerPos)
    stepHazardTransition(engine, remoteSpikes, HAZARD_STATES.ACTIVE, listenerPos)

    assert(received.length === 0, `Remote floor spikes should emit 0 subtitles (got ${received.length})`)
    assert(
      mock.stats.oscillatorsStarted === startOsc && mock.stats.bufferSourcesStarted === startBuf,
      'Remote floor spikes should not synthesize audio'
    )
    unsubscribe()
    engine.dispose()
  }

  // Test 2: Remote electric grids produce no subtitle
  {
    const { engine, mock, received, unsubscribe } = createUnlockedSubtitleEngine()
    const listenerPos = { x: 0, y: 1.65, z: 0 }
    const remoteGrid = {
      id: 'remote-grid',
      type: HAZARD_TYPES.ELECTRIC_GRID,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: -24, y: 0, z: 12 },
      isDisposed: false,
    }

    engine.update(0.016, { playerWorldPos: listenerPos, hazards: [remoteGrid] })
    const startOsc = mock.stats.oscillatorsStarted
    const startBuf = mock.stats.bufferSourcesStarted

    stepHazardTransition(engine, remoteGrid, HAZARD_STATES.WARNING, listenerPos)
    stepHazardTransition(engine, remoteGrid, HAZARD_STATES.ACTIVE, listenerPos)

    assert(received.length === 0, `Remote electric grid should emit 0 subtitles (got ${received.length})`)
    assert(
      mock.stats.oscillatorsStarted === startOsc && mock.stats.bufferSourcesStarted === startBuf,
      'Remote electric grid should not synthesize audio'
    )
    unsubscribe()
    engine.dispose()
  }

  // Test 3: Nearby audible hazards produce the correct subtitle (all 13 hazard types)
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
      [HAZARD_TYPES.FLOOR_SPIKES, 'Floor spikes arming', 'Floor spikes active'],
      [HAZARD_TYPES.ELECTRIC_GRID, 'Electrical grid buzzing', 'Electrical grid discharging'],
      [HAZARD_TYPES.PRESSURE_PLATE, 'Pressure plate click', 'Pressure plate triggered'],
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
      id: 'occluded-grid',
      type: HAZARD_TYPES.ELECTRIC_GRID,
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
      id: 'open-grid',
      type: HAZARD_TYPES.ELECTRIC_GRID,
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

  // Test 5: Hazard transitions during elevator exit do not produce false subtitles
  {
    const maze = generateMaze({ rows: 17, cols: 17, seed: 'elevator-exit-subtitles' })
    const hazardManager = new HazardManager(null)
    hazardManager.setMaze(maze)

    const { engine, received, unsubscribe } = createUnlockedSubtitleEngine()
    engine.setMaze(maze)

    const spawnPos = gridToWorld(maze.start.row, maze.start.col, maze)
    const allHazards = hazardManager.getHazards()

    // Ensure remote autonomous hazards actually cycle through warning & active during spawn sequence
    let sawAutonomousTransitionDuringSpawn = false
    const seenStates = new Map(allHazards.map((h) => [h.id, h.state]))

    // Simulate 5.5 seconds of starting elevator descent + exit (isSpawnSequenceActive = true)
    for (let step = 0; step < 110; step += 1) {
      hazardManager.update(0.05, null)
      for (const h of allHazards) {
        if (
          (h.type === HAZARD_TYPES.FLOOR_SPIKES || h.type === HAZARD_TYPES.ELECTRIC_GRID) &&
          h.state !== seenStates.get(h.id) &&
          (h.state === HAZARD_STATES.WARNING || h.state === HAZARD_STATES.ACTIVE)
        ) {
          sawAutonomousTransitionDuringSpawn = true
        }
        seenStates.set(h.id, h.state)
      }
      engine.update(0.05, {
        playerWorldPos: spawnPos,
        hazards: allHazards,
        isSpawnSequenceActive: true,
      })
    }

    assert(
      sawAutonomousTransitionDuringSpawn,
      'Autonomous floor_spikes / electric_grid hazards must cycle during spawn sequence for test validity'
    )
    assert(
      received.length === 0,
      `Zero hazard subtitles should appear during elevator sequence (got: ${received.map((r) => r.text).join(', ')})`
    )

    // Step out of the elevator (isSpawnSequenceActive becomes false) and advance 6 more seconds at spawn
    for (let step = 0; step < 120; step += 1) {
      hazardManager.update(0.05, null)
      engine.update(0.05, {
        playerWorldPos: spawnPos,
        hazards: allHazards,
        isSpawnSequenceActive: false,
      })
    }

    // Verify any subtitle emitted at spawn was genuinely spatially audible (never remote/occluded)
    for (const sub of received) {
      assert(sub.source === 'hazard', 'Unexpected subtitle source during spawn idle check')
      assert(
        sub.distance < 18,
        `No remote (>=18m) hazard subtitle may appear at elevator exit (got ${sub.text} at ${sub.distance}m)`
      )
    }

    // Explicitly verify remote floor_spikes & electric_grid at >20m produce zero subtitles right after exit
    const remotePostExitSpikes = {
      id: 'post-exit-remote-spikes',
      type: HAZARD_TYPES.FLOOR_SPIKES,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: spawnPos.x + 28, y: 0, z: spawnPos.z },
      isDisposed: false,
    }
    const remotePostExitGrid = {
      id: 'post-exit-remote-grid',
      type: HAZARD_TYPES.ELECTRIC_GRID,
      state: HAZARD_STATES.DORMANT,
      worldPos: { x: spawnPos.x - 28, y: 0, z: spawnPos.z },
      isDisposed: false,
    }
    received.length = 0
    engine.update(0.016, {
      playerWorldPos: spawnPos,
      hazards: [remotePostExitSpikes, remotePostExitGrid],
      isSpawnSequenceActive: true,
    })
    remotePostExitSpikes.state = HAZARD_STATES.WARNING
    remotePostExitGrid.state = HAZARD_STATES.ACTIVE
    engine.update(0.016, {
      playerWorldPos: spawnPos,
      hazards: [remotePostExitSpikes, remotePostExitGrid],
      isSpawnSequenceActive: false,
    })
    assert(
      received.length === 0,
      `Remote floor_spikes / electric_grid transitioning on elevator exit must emit 0 subtitles (got ${received.length})`
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
      id: 'muted-far-spikes',
      type: HAZARD_TYPES.FLOOR_SPIKES,
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
      id: 'zero-vol-far-grid',
      type: HAZARD_TYPES.ELECTRIC_GRID,
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
      type: HAZARD_TYPES.FLOOR_SPIKES,
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

  console.log('All Audio Subtitles Unit & Integration Tests Passed Successfully!')
  return true
}

runAudioSubtitlesTests()
