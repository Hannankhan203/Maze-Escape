import { isCellWalkable } from '../world/gridCollision.js'
import { worldToGrid } from '../world/worldCoords.js'
import {
  createNoiseBuffer,
  startAdaptiveMusicLayer,
  startAmbientBed,
  triggerAbilityActivateCue,
  triggerCoinPickupCue,
  triggerEnemyAlertCue,
  triggerEnemyAttackCue,
  triggerEnemyFootstep,
  triggerEnvironmentalDisturbanceCue,
  triggerExitVictoryCue,
  triggerGameOverCue,
  triggerHazardCue,
  triggerHidingSpotCue,
  triggerLightFailureCue,
  triggerPlayerDamageCue,
  triggerPlayerFootstep,
  triggerPowerUpPickupCue,
  triggerPresenceWarningCue,
  triggerScriptedScareCue,
  triggerSilhouetteStingCue,
  triggerSubtleHorrorAccent,
  triggerFlashlightCue,
  triggerStaminaWarningCue,
  triggerKeycardPickupCue,
  triggerGateUnlockCue,
  triggerLockedExitCue,
} from './audioSynthesis.js'
import { DEFAULT_AUDIO_VOLUMES } from './threeConfig.js'

export { DEFAULT_AUDIO_VOLUMES }

export const MUSIC_MOODS = {
  SILENT: 'silent',
  AMBIENT: 'ambient',
  TENSION: 'tension',
  CHASE: 'chase',
}

function clamp01(val, fallback = 0.5) {
  const num = Number(val)
  if (!Number.isFinite(num)) return fallback
  return Math.max(0, Math.min(1, num))
}

function setGainSmooth(gainNode, value, now, tau = 0.03) {
  if (!gainNode?.gain) return
  if (typeof gainNode.gain.setTargetAtTime === 'function') {
    gainNode.gain.setTargetAtTime(value, now, tau)
  } else {
    gainNode.gain.value = value
  }
}

/**
 * Computes distance-based volume attenuation from listener to world sound source.
 */
export function computeDistanceAttenuation(sourcePos, listenerPos, options = {}) {
  if (!sourcePos || !listenerPos) return 0
  const refDistance = Math.max(0.25, Number(options.refDistance) || 1.8)
  const maxDistance = Math.max(refDistance + 0.5, Number(options.maxDistance) || 22.0)
  const rolloff = Math.max(0.2, Number(options.rolloff) || 1.45)

  const dx = (Number(sourcePos.x) || 0) - (Number(listenerPos.x) || 0)
  const dy = (Number(sourcePos.y) || 0) - (Number(listenerPos.y) || 0)
  const dz = (Number(sourcePos.z) || 0) - (Number(listenerPos.z) || 0)
  const dist = Math.hypot(dx, dy, dz)

  if (dist <= refDistance) return 1.0
  if (dist >= maxDistance) return 0.0

  const inv = refDistance / (refDistance + rolloff * (dist - refDistance))
  // Smooth taper to exact 0 at maxDistance
  const normalizedTail = 1 - Math.pow((dist - refDistance) / (maxDistance - refDistance), 2)
  return Math.max(0, Math.min(1, inv * normalizedTail))
}

/**
 * Counts distinct non-walkable wall cells crossed along the 2D maze ray
 * between listener and sound source for wall-occlusion attenuation.
 */
export function countOccludingWalls(fromPos, toPos, maze) {
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

/**
 * Maps crossed wall barriers to gain reduction and low-pass muffling frequency.
 */
export function computeOcclusionFactors(fromPos, toPos, maze) {
  const wallCount = countOccludingWalls(fromPos, toPos, maze)
  if (wallCount <= 0) {
    return {
      wallCount: 0,
      gainMultiplier: 1.0,
      lowpassCutoff: 18000,
    }
  }

  const gainMultiplier = Math.max(0.08, Math.pow(0.45, wallCount))
  const lowpassCutoff = Math.max(420, Math.round(1800 / Math.pow(1.75, wallCount - 1)))
  return {
    wallCount,
    gainMultiplier,
    lowpassCutoff,
  }
}

/**
 * Combined distance + wall occlusion gain helper.
 */
export function computeSpatialAudioAttenuation(sourcePos, listenerPos, maze, options = {}) {
  const distanceGain = computeDistanceAttenuation(sourcePos, listenerPos, options)
  if (distanceGain <= 0.001) {
    return {
      gain: 0,
      distanceGain: 0,
      wallCount: 0,
      occlusionMultiplier: 1,
      lowpassCutoff: 18000,
    }
  }

  const occlusion = computeOcclusionFactors(listenerPos, sourcePos, maze)
  return {
    gain: distanceGain * occlusion.gainMultiplier,
    distanceGain,
    wallCount: occlusion.wallCount,
    occlusionMultiplier: occlusion.gainMultiplier,
    lowpassCutoff: occlusion.lowpassCutoff,
  }
}

/**
 * Centralized procedural 3D horror audio engine for Maze Escape.
 * Respects browser autoplay restrictions (no AudioContext until user gesture unlock),
 * routes master/ambience/effects/music buses, spatializes 3D world sources with
 * wall-occlusion muffling, and triggers state-driven enemy/hazard cues cleanly.
 */
export class HorrorAudioEngine {
  constructor(options = {}) {
    this.isDisposed = false
    this.isPaused = false
    this.isUnlocked = false
    this.maze = null

    this._createAudioContext =
      typeof options.createAudioContext === 'function'
        ? options.createAudioContext
        : null
    this._injectedContext = options.audioContext || null
    this._ownsContext = !options.audioContext

    this.volumes = {
      master: clamp01(options.volumes?.master, DEFAULT_AUDIO_VOLUMES.master),
      ambience: clamp01(options.volumes?.ambience, DEFAULT_AUDIO_VOLUMES.ambience),
      effects: clamp01(options.volumes?.effects, DEFAULT_AUDIO_VOLUMES.effects),
      music: clamp01(options.volumes?.music, DEFAULT_AUDIO_VOLUMES.music),
      muted: Boolean(options.volumes?.muted ?? DEFAULT_AUDIO_VOLUMES.muted),
    }

    this.spatialAudio = options.spatialAudio !== false
    this.footstepEchoes = options.footstepEchoes !== false

    this.ctx = null
    this.masterGain = null
    this.ambienceGain = null
    this.effectsGain = null
    this.musicGain = null
    this.compressor = null
    this.noiseBuffer = null
    this._reverbInput = null
    this._reverbDelay = null
    this._reverbFilter = null
    this._reverbWetGain = null
    this._playerStepBus = null

    this._ambientBed = null
    this._musicLayer = null
    this._musicMood = MUSIC_MOODS.SILENT
    this._desiredAmbientActive = true

    this._listenerPos = { x: 0, y: 1.65, z: 0 }
    this._listenerForward = { x: 0, y: 0, z: -1 }
    this._listenerUp = { x: 0, y: 1, z: 0 }
    this._enemyStateMap = new Map()
    this._hazardStateMap = new Map()
    this._cleanupTimers = new Set()

    this._playerStepTimer = 0
    this._subtleHorrorTimer = 6.5
    this._subtleAccentVariant = 0
    this._elapsedSec = 0
    this._isHidden = false
    this._isGameOver = false
    this._hasWon = false
    this._lastGameEventId = null
    this._lastCueLog = [] // Bounded recent cues only when debugHistoryEnabled is set
    this._debugHistoryEnabled = Boolean(options.recordCueHistory)

    if (options.autoUnlock === true) {
      this.unlock()
    }
  }

  _resolveAudioContextConstructor() {
    if (this._createAudioContext) {
      return null
    }
    if (typeof window !== 'undefined') {
      return window.AudioContext || window.webkitAudioContext || null
    }
    if (typeof globalThis !== 'undefined') {
      return globalThis.AudioContext || globalThis.webkitAudioContext || null
    }
    return null
  }

  _ensureContinuousLayers() {
    if (this.isDisposed || !this.isUnlocked || !this.ctx || this.isPaused) return

    if (!this._ambientBed && this._desiredAmbientActive && !this._isGameOver && !this._hasWon) {
      this._ambientBed = startAmbientBed(this.ctx, this.ambienceGain, this.noiseBuffer)
      this._ambientBed?.setStealthDucking?.(this._isHidden)
    }
    if (!this._musicLayer) {
      this._musicLayer = startAdaptiveMusicLayer(this.ctx, this.musicGain)
    }
    const targetMood =
      this._isGameOver || this._hasWon
        ? MUSIC_MOODS.SILENT
        : this._musicMood === MUSIC_MOODS.SILENT
          ? MUSIC_MOODS.AMBIENT
          : this._musicMood
    this._musicMood = targetMood
    this._musicLayer?.setMood?.(targetMood)
  }

  /**
   * Initializes or resumes the Web Audio graph. Safe to call repeatedly; must be
   * called from a user gesture in browsers to satisfy autoplay policies.
   */
  unlock() {
    if (this.isDisposed || this.isPaused) return false

    if (!this.ctx) {
      let ctx = this._injectedContext || null
      if (!ctx && this._createAudioContext) {
        ctx = this._createAudioContext()
      } else if (!ctx) {
        const AudioCtx = this._resolveAudioContextConstructor()
        if (!AudioCtx) {
          return false
        }
        ctx = new AudioCtx()
      }

      if (!ctx) return false
      this.ctx = ctx
      this._buildAudioGraph()
    }

    if (!this.isPaused && this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
      try {
        this.ctx.resume().catch?.(() => {})
      } catch {
        // Ignore resume errors in restricted contexts
      }
    }

    this.isUnlocked = true
    this._syncBusGains()
    this._ensureContinuousLayers()

    return true
  }

  _buildAudioGraph() {
    if (!this.ctx || typeof this.ctx.createGain !== 'function') return

    this.masterGain = this.ctx.createGain()
    this.ambienceGain = this.ctx.createGain()
    this.effectsGain = this.ctx.createGain()
    this.musicGain = this.ctx.createGain()

    this.ambienceGain.connect(this.masterGain)
    this.effectsGain.connect(this.masterGain)
    this.musicGain.connect(this.masterGain)

    if (typeof this.ctx.createDelay === 'function') {
      this._reverbInput = this.ctx.createGain()
      this._reverbDelay = this.ctx.createDelay(1.0)
      if (this._reverbDelay.delayTime) {
        this._reverbDelay.delayTime.value = 0.095
      }
      this._reverbWetGain = this.ctx.createGain()
      if (this._reverbWetGain.gain) {
        this._reverbWetGain.gain.value = this.footstepEchoes ? 0.16 : 0
      }

      if (typeof this.ctx.createBiquadFilter === 'function') {
        this._reverbFilter = this.ctx.createBiquadFilter()
        this._reverbFilter.type = 'lowpass'
        if (this._reverbFilter.frequency) this._reverbFilter.frequency.value = 950
        if (this._reverbFilter.Q) this._reverbFilter.Q.value = 0.7
        this._reverbInput.connect(this._reverbDelay)
        this._reverbDelay.connect(this._reverbFilter)
        this._reverbFilter.connect(this._reverbWetGain)
      } else {
        this._reverbInput.connect(this._reverbDelay)
        this._reverbDelay.connect(this._reverbWetGain)
      }
      this._reverbWetGain.connect(this.effectsGain)

      this._playerStepBus = this.ctx.createGain()
      this._playerStepBus.connect(this.effectsGain)
      this._playerStepBus.connect(this._reverbInput)
    }

    if (typeof this.ctx.createDynamicsCompressor === 'function') {
      this.compressor = this.ctx.createDynamicsCompressor()
      if (this.compressor.threshold) this.compressor.threshold.value = -14
      if (this.compressor.knee) this.compressor.knee.value = 18
      if (this.compressor.ratio) this.compressor.ratio.value = 6
      this.masterGain.connect(this.compressor)
      this.compressor.connect(this.ctx.destination)
    } else {
      this.masterGain.connect(this.ctx.destination)
    }

    this.noiseBuffer = createNoiseBuffer(this.ctx, 2.0)
    this._syncBusGains()
  }

  _syncBusGains() {
    if (!this.ctx || !this.masterGain) return
    const now = this.ctx.currentTime || 0
    const masterVal = this.volumes.muted || this.isPaused ? 0 : this.volumes.master
    setGainSmooth(this.masterGain, masterVal, now, 0.025)
    setGainSmooth(this.ambienceGain, this.volumes.ambience, now, 0.03)
    setGainSmooth(this.effectsGain, this.volumes.effects, now, 0.03)
    setGainSmooth(this.musicGain, this.volumes.music, now, 0.03)
    if (this._reverbWetGain) {
      setGainSmooth(this._reverbWetGain, this.footstepEchoes ? 0.16 : 0, now, 0.03)
    }
  }

  getVolumeConfig() {
    return { ...this.volumes }
  }

  setVolume(channel, value) {
    if (this.isDisposed) return this.getVolumeConfig()
    if (channel === 'muted') {
      this.volumes.muted = Boolean(value)
    } else if (channel in this.volumes) {
      this.volumes[channel] = clamp01(value, this.volumes[channel])
    }
    this._syncBusGains()
    return this.getVolumeConfig()
  }

  setVolumes(partial = {}) {
    if (this.isDisposed || !partial || typeof partial !== 'object') {
      return this.getVolumeConfig()
    }
    if ('master' in partial) {
      this.volumes.master = clamp01(partial.master, this.volumes.master)
    }
    if ('ambience' in partial) {
      this.volumes.ambience = clamp01(partial.ambience, this.volumes.ambience)
    }
    if ('effects' in partial) {
      this.volumes.effects = clamp01(partial.effects, this.volumes.effects)
    }
    if ('music' in partial) {
      this.volumes.music = clamp01(partial.music, this.volumes.music)
    }
    if ('muted' in partial) {
      this.volumes.muted = Boolean(partial.muted)
    }
    this._syncBusGains()
    return this.getVolumeConfig()
  }

  setMuted(muted) {
    return this.setVolume('muted', Boolean(muted))
  }

  getEffectiveVolumes() {
    const activeMaster = this.volumes.muted || this.isPaused ? 0 : this.volumes.master
    return {
      master: activeMaster,
      ambience: activeMaster * this.volumes.ambience,
      effects: activeMaster * this.volumes.effects,
      music: activeMaster * this.volumes.music,
      muted: this.volumes.muted,
      isPaused: this.isPaused,
    }
  }

  getAudioOptions() {
    return {
      spatialAudio: this.spatialAudio,
      footstepEchoes: this.footstepEchoes,
    }
  }

  setAudioOptions(partial = {}) {
    if (this.isDisposed || !partial || typeof partial !== 'object') {
      return this.getAudioOptions()
    }
    if ('spatialAudio' in partial) {
      this.spatialAudio = Boolean(partial.spatialAudio)
    }
    if ('footstepEchoes' in partial) {
      this.footstepEchoes = Boolean(partial.footstepEchoes)
    }
    this._syncBusGains()
    return this.getAudioOptions()
  }

  getAudioState() {
    return {
      isUnlocked: this.isUnlocked,
      isPaused: this.isPaused,
      isDisposed: this.isDisposed,
      contextState: this.ctx?.state || 'uninitialized',
      musicMood: this._musicMood,
      isHidden: this._isHidden,
      isGameOver: this._isGameOver,
      volumes: this.getVolumeConfig(),
      effectiveVolumes: this.getEffectiveVolumes(),
      spatialAudio: this.spatialAudio,
      footstepEchoes: this.footstepEchoes,
    }
  }

  setPaused(paused) {
    if (this.isDisposed) return
    this.isPaused = Boolean(paused)
    this._syncBusGains()

    if (this.isPaused) {
      this._musicLayer?.setMood?.(MUSIC_MOODS.SILENT)
      if (this.ctx?.state === 'running' && typeof this.ctx.suspend === 'function') {
        try {
          this.ctx.suspend().catch?.(() => {})
        } catch {
          // Ignore suspend errors in restricted contexts
        }
      }
      return
    }

    if (this.isUnlocked && this.ctx) {
      if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        try {
          this.ctx.resume().catch?.(() => {})
        } catch {
          // Ignore resume errors in restricted contexts
        }
      }
      this._ensureContinuousLayers()
      this._syncBusGains()
      if (this._musicLayer) {
        this._musicLayer.setMood?.(
          this._isGameOver || this._hasWon ? MUSIC_MOODS.SILENT : this._musicMood
        )
      }
    }
  }

  setMaze(maze) {
    this.maze = maze || null
    this._enemyStateMap.clear()
    this._hazardStateMap.clear()
    this._playerStepTimer = 0
    this._hasWon = false
    this._clearTransientTimers()

    if (!this._isGameOver && this._musicLayer) {
      this._musicMood = MUSIC_MOODS.AMBIENT
      this._musicLayer.setMood?.(this.isPaused ? MUSIC_MOODS.SILENT : MUSIC_MOODS.AMBIENT)
    }
  }

  reset() {
    this._enemyStateMap.clear()
    this._hazardStateMap.clear()
    this._playerStepTimer = 0
    this._isHidden = false
    this._isGameOver = false
    this._hasWon = false
    this._clearTransientTimers()
    this._ambientBed?.setStealthDucking?.(false)
    this._musicMood = this.isUnlocked ? MUSIC_MOODS.AMBIENT : MUSIC_MOODS.SILENT
    this._musicLayer?.setMood?.(this.isPaused ? MUSIC_MOODS.SILENT : this._musicMood)
  }

  _clearTransientTimers() {
    for (const id of this._cleanupTimers) {
      clearTimeout(id)
    }
    this._cleanupTimers.clear()
  }

  _recordCue(type, meta = {}) {
    if (!this._debugHistoryEnabled) return
    this._lastCueLog.push({ type, time: this._elapsedSec, ...meta })
    if (this._lastCueLog.length > 64) {
      this._lastCueLog.shift()
    }
  }

  getCueHistory() {
    return [...this._lastCueLog]
  }

  clearCueHistory() {
    this._lastCueLog.length = 0
  }

  /**
   * Updates Web Audio listener orientation & position to match the 3D camera.
   */
  updateListener(cameraOrPos, forwardVec = null, upVec = null) {
    if (!cameraOrPos) return

    const pos = cameraOrPos.position || cameraOrPos
    this._listenerPos.x = Number(pos.x) || 0
    this._listenerPos.y = Number.isFinite(pos.y) ? pos.y : 1.65
    this._listenerPos.z = Number(pos.z) || 0

    if (forwardVec) {
      this._listenerForward.x = Number(forwardVec.x) || 0
      this._listenerForward.y = Number(forwardVec.y) || 0
      this._listenerForward.z = Number(forwardVec.z) || -1
    } else if (cameraOrPos.quaternion) {
      const q = cameraOrPos.quaternion
      const x = q.x, y = q.y, z = q.z, w = q.w
      this._listenerForward.x = -(2 * (x * z + w * y))
      this._listenerForward.y = -(2 * (y * z - w * x))
      this._listenerForward.z = -(1 - 2 * (x * x + y * y))
    }

    if (upVec) {
      this._listenerUp.x = Number(upVec.x) || 0
      this._listenerUp.y = Number(upVec.y) || 1
      this._listenerUp.z = Number(upVec.z) || 0
    } else if (cameraOrPos.quaternion) {
      const q = cameraOrPos.quaternion
      const x = q.x, y = q.y, z = q.z, w = q.w
      this._listenerUp.x = 2 * (x * y + w * z)
      this._listenerUp.y = 1 - 2 * (x * x + z * z)
      this._listenerUp.z = 2 * (y * z - w * x)
    }

    const listener = this.ctx?.listener
    if (!listener) return

    const now = this.ctx.currentTime || 0
    if (listener.positionX) {
      setGainSmooth({ gain: listener.positionX }, this._listenerPos.x, now, 0.015)
      setGainSmooth({ gain: listener.positionY }, this._listenerPos.y, now, 0.015)
      setGainSmooth({ gain: listener.positionZ }, this._listenerPos.z, now, 0.015)
      setGainSmooth({ gain: listener.forwardX }, this._listenerForward.x, now, 0.015)
      setGainSmooth({ gain: listener.forwardY }, this._listenerForward.y, now, 0.015)
      setGainSmooth({ gain: listener.forwardZ }, this._listenerForward.z, now, 0.015)
      setGainSmooth({ gain: listener.upX }, this._listenerUp.x, now, 0.015)
      setGainSmooth({ gain: listener.upY }, this._listenerUp.y, now, 0.015)
      setGainSmooth({ gain: listener.upZ }, this._listenerUp.z, now, 0.015)
    } else if (typeof listener.setPosition === 'function') {
      listener.setPosition(this._listenerPos.x, this._listenerPos.y, this._listenerPos.z)
      listener.setOrientation?.(
        this._listenerForward.x,
        this._listenerForward.y,
        this._listenerForward.z,
        this._listenerUp.x,
        this._listenerUp.y,
        this._listenerUp.z
      )
    }
  }

  /**
   * Creates a spatialized (Panner + Occlusion Filter + Attenuation Gain) node chain
   * attached to `effectsGain` and schedules leak-free cleanup. Returns `null` if out
   * of audible range or audio context is not yet unlocked.
   */
  _createPositionalDestination(worldPos, options = {}) {
    const attenuation = computeSpatialAudioAttenuation(
      worldPos,
      this._listenerPos,
      this.maze,
      options
    )
    if (attenuation.gain <= 0.005) {
      return { dest: null, attenuation, cleanup: () => {} }
    }

    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return { dest: null, attenuation, cleanup: () => {} }
    }

    const now = this.ctx.currentTime || 0
    const attGain = this.ctx.createGain()
    if (attGain.gain) {
      attGain.gain.setValueAtTime?.(attenuation.gain, now)
    }

    let tail = attGain
    let filter = null
    if (typeof this.ctx.createBiquadFilter === 'function' && attenuation.wallCount > 0) {
      filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency?.setValueAtTime?.(attenuation.lowpassCutoff, now)
      tail.connect(filter)
      tail = filter
    }

    let panner = null
    if (this.spatialAudio && typeof this.ctx.createPanner === 'function') {
      panner = this.ctx.createPanner()
      panner.panningModel = 'HRTF'
      panner.distanceModel = 'linear'
      panner.refDistance = options.refDistance || 1.8
      panner.maxDistance = options.maxDistance || 22.0
      panner.rolloffFactor = 0 // Distance gain already accounts for wall occlusion + taper
      if (panner.positionX) {
        panner.positionX.setValueAtTime?.(Number(worldPos.x) || 0, now)
        panner.positionY.setValueAtTime?.(Number(worldPos.y) || 0, now)
        panner.positionZ.setValueAtTime?.(Number(worldPos.z) || 0, now)
      } else {
        panner.setPosition?.(
          Number(worldPos.x) || 0,
          Number(worldPos.y) || 0,
          Number(worldPos.z) || 0
        )
      }
      tail.connect(panner)
      panner.connect(this.effectsGain)
    } else {
      tail.connect(this.effectsGain)
    }

    if (this._reverbInput) {
      tail.connect(this._reverbInput)
    }

    const ttlMs = Math.max(250, Number(options.ttlMs) || 1200)
    const cleanup = () => {
      try {
        attGain.disconnect()
        filter?.disconnect()
        panner?.disconnect()
      } catch {
        // Ignore already-disconnected errors
      }
    }
    const timerId = setTimeout(() => {
      this._cleanupTimers.delete(timerId)
      cleanup()
    }, ttlMs)
    this._cleanupTimers.add(timerId)

    return { dest: attGain, attenuation, cleanup }
  }

  onHidingSpotTransition(action, worldPos) {
    if (this.isDisposed) return
    this._isHidden = action === 'enter'
    this._ambientBed?.setStealthDucking?.(this._isHidden)

    const { dest, attenuation } = this._createPositionalDestination(
      worldPos || this._listenerPos,
      { maxDistance: 12, ttlMs: 800 }
    )
    this._recordCue(`hiding_${action}`, { gain: attenuation.gain })
    if (dest) {
      triggerHidingSpotCue(this.ctx, dest, this.noiseBuffer, action)
    }
  }

  onFlashlightToggle(active) {
    if (this.isDisposed) return
    this._recordCue('flashlight_toggle', { active })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) return
    triggerFlashlightCue(this.ctx, this.effectsGain, this.noiseBuffer, active)
  }

  onStaminaWarning(type = 'breathing') {
    if (this.isDisposed || this.isPaused) return
    if (!this.isUnlocked || !this.ctx || !this.effectsGain) return
    triggerStaminaWarningCue(this.ctx, this.effectsGain, this.noiseBuffer, type)
  }

  onPlayerDamage() {
    if (this.isDisposed) return
    this._recordCue('player_damage', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) return
    triggerPlayerDamageCue(this.ctx, this.effectsGain, this.noiseBuffer)
  }

  onGameOver() {
    if (this.isDisposed) return
    this._isGameOver = true
    this._isHidden = false
    this._ambientBed?.setStealthDucking?.(false)
    this._musicMood = MUSIC_MOODS.SILENT
    this._musicLayer?.setMood?.(MUSIC_MOODS.SILENT)

    this._recordCue('game_over', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) return
    triggerGameOverCue(this.ctx, this.effectsGain, this.noiseBuffer)
  }

  onCoinPickup(coinsGained = 1) {
    if (this.isDisposed || this._isGameOver) return false
    const count = Math.max(1, Number(coinsGained) || 1)
    this._recordCue('coin_collected', { coinsGained: count })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerCoinPickupCue(this.ctx, this.effectsGain, count)
    return true
  }

  onPowerUpPickup(powerUpType = 'wall_pass') {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('powerup_collected', { powerUpType })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerPowerUpPickupCue(this.ctx, this.effectsGain, powerUpType)
    return true
  }

  onAbilityActivate(abilityType = 'wall_pass_armed') {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('ability_activate', { abilityType })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerAbilityActivateCue(this.ctx, this.effectsGain, this.noiseBuffer, abilityType)
    return true
  }

  onExitVictory() {
    if (this.isDisposed || this._isGameOver) return false
    this._hasWon = true
    this._isHidden = false
    this._ambientBed?.setStealthDucking?.(false)
    this._musicMood = MUSIC_MOODS.SILENT
    this._musicLayer?.setMood?.(MUSIC_MOODS.SILENT)

    this._recordCue('exit_victory', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerExitVictoryCue(this.ctx, this.effectsGain)
    return true
  }

  onKeycardPickup(keysCollected = 1, totalKeys = 1) {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('keycard_collected', { keysCollected, totalKeys })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerKeycardPickupCue(this.ctx, this.effectsGain, keysCollected, totalKeys)
    return true
  }

  onGateUnlocked() {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('gate_unlocked', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerGateUnlockCue(this.ctx, this.effectsGain, this.noiseBuffer)
    return true
  }

  onLockedExit() {
    if (this.isDisposed || this._isGameOver) return false
    this._recordCue('locked_exit', { gain: 1 })
    if (!this.isUnlocked || !this.ctx || !this.effectsGain || this.isPaused) {
      return false
    }
    triggerLockedExitCue(this.ctx, this.effectsGain)
    return true
  }

  /**
   * Handles discrete reducer `lastEvent` objects with strict ID deduplication so
   * collectibles, power-up abilities, keycards, gate unlocks, and exit chimes never trigger twice per event.
   */
  handleGameEvent(event) {
    if (this.isDisposed || !event || typeof event !== 'object') return false

    if (event.id !== undefined && event.id !== null) {
      if (event.id === this._lastGameEventId) {
        return false
      }
      this._lastGameEventId = event.id
    }

    switch (event.type) {
      case 'coin_collected':
        return this.onCoinPickup(event.coinsGained || 1)

      case 'powerup_collected': {
        const playedPu = this.onPowerUpPickup(event.powerUpType || 'wall_pass')
        if ((event.coinsGained || 0) > 0) {
          this.onCoinPickup(event.coinsGained)
        }
        return playedPu
      }

      case 'keycard_collected':
        return this.onKeycardPickup(event.keysCollected || 1, event.totalKeys || 1)

      case 'gate_unlocked': {
        if (event.keycard) {
          this.onKeycardPickup(event.keysCollected || 1, event.totalKeys || 1)
        }
        return this.onGateUnlocked()
      }

      case 'locked_exit':
        return this.onLockedExit()

      case 'wall_pass_armed':
      case 'wall_pass_used':
      case 'echo_reveal_activated':
        return this.onAbilityActivate(event.type)

      case 'coin_magnet_activated': {
        const playedMag = this.onAbilityActivate('coin_magnet_activated')
        if ((event.coinsGained || 0) > 0) {
          this.onCoinPickup(event.coinsGained)
        }
        return playedMag
      }

      case 'exit':
        return this.onExitVictory()

      default:
        return false
    }
  }

  /**
   * Plays a HorrorDirector scare/tension cue. Positional events (environmental disturbances,
   * distant silhouettes) route through distance + wall occlusion; presence warnings and light
   * events play non-directionally so exact enemy positions are never leaked.
   */
  playHorrorDirectorCue(eventType, worldPos = null, meta = {}) {
    if (this.isDisposed || this._isGameOver || this.isPaused) return false

    const isPositional =
      (eventType === 'environmental_sound' || eventType === 'distant_silhouette') &&
      worldPos &&
      Number.isFinite(worldPos.x) &&
      Number.isFinite(worldPos.z)

    let dest = null
    let attenuation = { gain: 1, wallCount: 0 }

    if (isPositional) {
      const spatial = this._createPositionalDestination(worldPos, {
        maxDistance: 24,
        ttlMs: 1400,
      })
      dest = spatial.dest
      attenuation = spatial.attenuation
    } else if (this.isUnlocked && this.ctx && this.effectsGain) {
      dest = this.effectsGain
    }

    this._recordCue(`director_${eventType}`, {
      gain: attenuation.gain,
      wallCount: attenuation.wallCount,
      variant: meta?.variant ?? 0,
      beat: meta?.beat ?? 1,
      positional: isPositional,
    })

    if (!dest || !this.isUnlocked || !this.ctx) {
      return false
    }

    if (eventType === 'environmental_sound') {
      triggerEnvironmentalDisturbanceCue(this.ctx, dest, this.noiseBuffer, meta?.variant || 0)
      return true
    }
    if (eventType === 'distant_silhouette') {
      triggerSilhouetteStingCue(this.ctx, dest, this.noiseBuffer)
      return true
    }
    if (eventType === 'light_flicker' || eventType === 'blackout') {
      triggerLightFailureCue(this.ctx, dest, this.noiseBuffer, eventType === 'blackout')
      return true
    }
    if (eventType === 'presence_warning') {
      triggerPresenceWarningCue(this.ctx, dest, this.noiseBuffer, meta?.tension ?? 0.6)
      return true
    }
    if (eventType === 'scripted_scare') {
      triggerScriptedScareCue(this.ctx, dest, this.noiseBuffer, meta?.beat ?? 1)
      return true
    }

    return false
  }

  /**
   * Main per-frame update driven inside MazeSceneEngine.tick() (outside React state).
   * Monitors discrete state transitions on enemies and hazards without re-triggering
   * cues across consecutive frames in the same state.
   */
  update(delta = 0.016, context = {}) {
    if (this.isDisposed || !Number.isFinite(delta) || delta <= 0) return

    this._elapsedSec += delta
    this._isHidden = Boolean(context.isHidden)
    this._isGameOver = Boolean(context.isGameOver)

    if (context.camera) {
      this.updateListener(context.camera)
    } else if (context.playerWorldPos) {
      this.updateListener({
        x: context.playerWorldPos.x,
        y: 1.65,
        z: context.playerWorldPos.z,
      })
    }

    if (this._isGameOver || this._hasWon || this.isPaused) {
      if (this._musicMood !== MUSIC_MOODS.SILENT) {
        this._musicMood = MUSIC_MOODS.SILENT
        this._musicLayer?.setMood?.(MUSIC_MOODS.SILENT)
      }
      return
    }

    this._ambientBed?.setStealthDucking?.(this._isHidden)

    // 1. Ambient subtle horror accents (non-intrusive spaced events)
    this._subtleHorrorTimer -= delta
    if (this._subtleHorrorTimer <= 0) {
      this._subtleHorrorTimer = 9 + Math.random() * 8
      if (this.isUnlocked && this.ctx && this.ambienceGain && !this.isPaused) {
        this._subtleAccentVariant += 1
        triggerSubtleHorrorAccent(
          this.ctx,
          this.ambienceGain,
          this.noiseBuffer,
          this._subtleAccentVariant
        )
      }
      this._recordCue('horror_accent', { variant: this._subtleAccentVariant })
    }

    // 2. Player footsteps (paused when hidden)
    const motion = context.playerMotion
    if (motion?.moved && !this._isHidden) {
      const interval = motion.isSprinting ? 0.31 : 0.48
      this._playerStepTimer += delta
      if (this._playerStepTimer >= interval) {
        this._playerStepTimer -= interval
        this._recordCue('player_footstep', { sprinting: Boolean(motion.isSprinting) })
        if (this.isUnlocked && this.ctx && this.effectsGain) {
          triggerPlayerFootstep(
            this.ctx,
            this._playerStepBus || this.effectsGain,
            this.noiseBuffer,
            Boolean(motion.isSprinting)
          )
        }
      }
    } else {
      this._playerStepTimer = 0.25
    }

    // 3. Enemy state cues, footsteps, and adaptive chase music evaluation
    let anyChaseOrAttack = false
    let anyInvestigateOrClose = false
    const enemies = context.enemies

    if (enemies) {
      for (const enemy of enemies) {
        if (!enemy || enemy.isDisposed) continue
        const enemyId = enemy.id
        const enemyType = enemy.type || 'stalker'
        const state = enemy.state
        const worldPos = enemy.worldPos

        let tracker = this._enemyStateMap.get(enemyId)
        if (!tracker) {
          tracker = {
            lastState: state,
            stepTimer: 0,
            lastAlertAt: -10,
            lastAttackAt: -10,
          }
          this._enemyStateMap.set(enemyId, tracker)
        }

        if (state === 'chase' || state === 'attack') {
          anyChaseOrAttack = true
        } else if (state === 'investigate' || state === 'search') {
          anyInvestigateOrClose = true
        } else if (worldPos) {
          const d = Math.hypot(
            worldPos.x - this._listenerPos.x,
            worldPos.z - this._listenerPos.z
          )
          if (d <= 8.5) anyInvestigateOrClose = true
        }

        // Edge-triggered state transition cues (never restarted every frame)
        if (state !== tracker.lastState) {
          if (state === 'chase' && this._elapsedSec - tracker.lastAlertAt >= 2.0) {
            tracker.lastAlertAt = this._elapsedSec
            const { dest, attenuation } = this._createPositionalDestination(worldPos, {
              maxDistance: 24,
              ttlMs: 900,
            })
            this._recordCue('enemy_detect_chase', {
              enemyId,
              enemyType,
              gain: attenuation.gain,
              wallCount: attenuation.wallCount,
            })
            if (dest) triggerEnemyAlertCue(this.ctx, dest, true, enemyType)
          } else if (
            state === 'investigate' &&
            (tracker.lastState === 'patrol' || tracker.lastState === 'idle') &&
            this._elapsedSec - tracker.lastAlertAt >= 2.4
          ) {
            tracker.lastAlertAt = this._elapsedSec
            const { dest, attenuation } = this._createPositionalDestination(worldPos, {
              maxDistance: 20,
              ttlMs: 700,
            })
            this._recordCue('enemy_detect_investigate', {
              enemyId,
              enemyType,
              gain: attenuation.gain,
              wallCount: attenuation.wallCount,
            })
            if (dest) triggerEnemyAlertCue(this.ctx, dest, false, enemyType)
          } else if (
            state === 'attack' &&
            this._elapsedSec - tracker.lastAttackAt >= 0.4
          ) {
            tracker.lastAttackAt = this._elapsedSec
            const { dest, attenuation } = this._createPositionalDestination(worldPos, {
              maxDistance: 16,
              ttlMs: 700,
            })
            this._recordCue('enemy_attack_windup', {
              enemyId,
              enemyType,
              gain: attenuation.gain,
              wallCount: attenuation.wallCount,
            })
            if (dest) triggerEnemyAttackCue(this.ctx, dest, this.noiseBuffer, false, enemyType)
          }

          tracker.lastState = state
        }

        // Positional enemy footsteps while patrolling, investigating, or chasing
        if (state === 'patrol' || state === 'investigate' || state === 'chase') {
          const isChasing = state === 'chase'
          const stepPeriod =
            enemyType === 'brute'
              ? isChasing
                ? 0.42
                : state === 'investigate'
                  ? 0.62
                  : 0.78
              : enemyType === 'hunter'
                ? isChasing
                  ? 0.22
                  : state === 'investigate'
                    ? 0.3
                    : 0.42
                : isChasing
                  ? 0.28
                  : state === 'investigate'
                    ? 0.42
                    : 0.56
          tracker.stepTimer += delta
          if (tracker.stepTimer >= stepPeriod) {
            tracker.stepTimer -= stepPeriod
            const { dest, attenuation } = this._createPositionalDestination(worldPos, {
              maxDistance: isChasing ? 24 : 18,
              ttlMs: 500,
            })
            this._recordCue('enemy_footstep', {
              enemyId,
              enemyType,
              isChasing,
              gain: attenuation.gain,
              wallCount: attenuation.wallCount,
            })
            if (dest) {
              triggerEnemyFootstep(this.ctx, dest, this.noiseBuffer, isChasing, enemyType)
            }
          }
        }
      }
    }

    // Discrete attack hits
    if (context.attackHits?.length > 0) {
      for (let i = 0; i < context.attackHits.length; i += 1) {
        const hit = context.attackHits[i]
        const hitType = hit.enemyType || 'stalker'
        const { dest, attenuation } = this._createPositionalDestination(
          hit.position || this._listenerPos,
          { maxDistance: 16, ttlMs: 600 }
        )
        this._recordCue('enemy_attack_hit', {
          enemyId: hit.enemyId,
          enemyType: hitType,
          gain: attenuation.gain,
        })
        if (dest) {
          triggerEnemyAttackCue(this.ctx, dest, this.noiseBuffer, true, hitType)
        }
      }
    }

    // 4. Environmental hazards positional state-change cues
    const hazards = context.hazards
    if (hazards) {
      for (const hazard of hazards) {
        if (!hazard || hazard.isDisposed) continue
        const prevState = this._hazardStateMap.get(hazard.id)
        const nextState = hazard.state
        if (prevState !== undefined && nextState !== prevState) {
          if (nextState === 'warning' || nextState === 'active') {
            const { dest, attenuation } = this._createPositionalDestination(hazard.worldPos, {
              maxDistance: 18,
              ttlMs: 800,
            })
            this._recordCue(`hazard_${hazard.type}_${nextState}`, {
              hazardId: hazard.id,
              gain: attenuation.gain,
              wallCount: attenuation.wallCount,
            })
            if (dest) {
              triggerHazardCue(this.ctx, dest, this.noiseBuffer, hazard.type, nextState)
            }
          }
        }
        this._hazardStateMap.set(hazard.id, nextState)
      }
    }

    // 5. Adaptive chase / tension / ambient music mood transition (edge-driven)
    const desiredMood = anyChaseOrAttack
      ? MUSIC_MOODS.CHASE
      : anyInvestigateOrClose
        ? MUSIC_MOODS.TENSION
        : MUSIC_MOODS.AMBIENT

    if (desiredMood !== this._musicMood) {
      this._musicMood = desiredMood
      this._musicLayer?.setMood?.(desiredMood)
      this._recordCue('music_mood_change', { mood: desiredMood })
    }
    this._musicLayer?.tick?.(delta)
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this.isUnlocked = false

    this._clearTransientTimers()
    this._enemyStateMap.clear()
    this._hazardStateMap.clear()

    if (this._ambientBed) {
      this._ambientBed.stop()
      this._ambientBed = null
    }
    if (this._musicLayer) {
      this._musicLayer.stop()
      this._musicLayer = null
    }

    try {
      this._playerStepBus?.disconnect()
      this._reverbInput?.disconnect()
      this._reverbDelay?.disconnect()
      this._reverbFilter?.disconnect()
      this._reverbWetGain?.disconnect()
      this.ambienceGain?.disconnect()
      this.effectsGain?.disconnect()
      this.musicGain?.disconnect()
      this.masterGain?.disconnect()
      this.compressor?.disconnect()
    } catch {
      // Ignore disconnect errors on already-disposed nodes
    }

    if (this.ctx && this._ownsContext && typeof this.ctx.close === 'function') {
      try {
        this.ctx.close().catch?.(() => {})
      } catch {
        // Ignore close errors
      }
    }

    this.ctx = null
    this.masterGain = null
    this.ambienceGain = null
    this.effectsGain = null
    this.musicGain = null
    this.compressor = null
    this._reverbInput = null
    this._reverbDelay = null
    this._reverbFilter = null
    this._reverbWetGain = null
    this._playerStepBus = null
    this.noiseBuffer = null
    this.maze = null
    return true
  }
}
