import * as THREE from 'three'
import { createRng } from '../../utils/rng.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { gridToWorld } from '../world/worldCoords.js'
import { checkLineOfSight } from './EnemyAgent.js'

import {
  HORROR_INTENSITY_LEVELS,
  HORROR_INTENSITY_PRESETS,
  detectPrefersReducedMotion,
  normalizeHorrorIntensity,
} from './threeConfig.js'

export {
  HORROR_INTENSITY_LEVELS,
  HORROR_INTENSITY_PRESETS,
  detectPrefersReducedMotion,
  normalizeHorrorIntensity,
}

export const HORROR_EVENT_TYPES = {
  LIGHT_FLICKER: 'light_flicker',
  BLACKOUT: 'blackout',
  DISTANT_SILHOUETTE: 'distant_silhouette',
  ENVIRONMENTAL_SOUND: 'environmental_sound',
  PRESENCE_WARNING: 'presence_warning',
  SCRIPTED_SCARE: 'scripted_scare',
}

const DEFAULT_TYPE_COOLDOWNS = {
  [HORROR_EVENT_TYPES.LIGHT_FLICKER]: 14,
  [HORROR_EVENT_TYPES.BLACKOUT]: 28,
  [HORROR_EVENT_TYPES.DISTANT_SILHOUETTE]: 20,
  [HORROR_EVENT_TYPES.ENVIRONMENTAL_SOUND]: 10,
  [HORROR_EVENT_TYPES.PRESENCE_WARNING]: 15,
  [HORROR_EVENT_TYPES.SCRIPTED_SCARE]: 55,
}

function createSilhouetteMesh() {
  const group = new THREE.Group()
  group.name = 'maze-horror-silhouette'
  group.visible = false

  const cloakMat = new THREE.MeshBasicMaterial({
    color: 0x04070d,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: true,
  })
  const eyeMat = new THREE.MeshBasicMaterial({
    color: 0x93c5fd,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  })

  // Tall gaunt cloak body
  const bodyGeo = new THREE.CylinderGeometry(0.18, 0.34, 1.65, 10)
  const bodyMesh = new THREE.Mesh(bodyGeo, cloakMat)
  bodyMesh.name = 'maze-horror-silhouette-body'
  bodyMesh.position.set(0, 0.85, 0)
  group.add(bodyMesh)

  // Elongated dark head
  const headGeo = new THREE.SphereGeometry(0.17, 10, 8)
  const headMesh = new THREE.Mesh(headGeo, cloakMat)
  headMesh.name = 'maze-horror-silhouette-head'
  headMesh.scale.set(0.88, 1.25, 0.9)
  headMesh.position.set(0, 1.84, 0)
  group.add(headMesh)

  // Twin dim eyes facing -Z (lookAt rotates +Z or we orient via atan2)
  const eyeGeo = new THREE.BoxGeometry(0.045, 0.022, 0.03)
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat)
    eye.name = `maze-horror-silhouette-eye-${sign < 0 ? 'left' : 'right'}`
    eye.position.set(sign * 0.052, 1.85, -0.14)
    group.add(eye)
  }

  group.userData = {
    isHorrorSilhouette: true,
    cloakMat,
    eyeMat,
  }

  return group
}

function disposeThreeGroup(group) {
  if (!group) return
  const disposedGeos = new Set()
  const disposedMats = new Set()
  group.traverse((node) => {
    if (node.geometry && !disposedGeos.has(node.geometry)) {
      disposedGeos.add(node.geometry)
      node.geometry.dispose?.()
    }
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      for (let i = 0; i < mats.length; i += 1) {
        if (mats[i] && !disposedMats.has(mats[i])) {
          disposedMats.add(mats[i])
          mats[i].dispose?.()
        }
      }
    }
  })
  if (group.parent) {
    group.parent.remove(group)
  }
  group.clear()
}

/**
 * Centralized Horror & Scare Director for Maze Escape's 3D mode.
 * Coordinates light flickers/blackouts, distant silhouettes, environmental sound
 * disturbances, non-directional enemy presence warnings, and rare multi-beat
 * scripted sequences without damaging the player or breaking stealth/combat rules.
 */
export class HorrorDirector {
  constructor(options = {}) {
    this.isDisposed = false
    this.isPaused = false
    this.isGameOver = false

    this.scene = options.scene || null
    this.audioEngine = options.audioEngine || null
    this.environment = options.environment || null
    this.maze = options.maze || null

    this.intensity = normalizeHorrorIntensity(options.intensity)
    this.visualScaresEnabled =
      typeof options.visualScaresEnabled === 'boolean'
        ? options.visualScaresEnabled
        : true
    this.reducedMotion =
      typeof options.reducedMotion === 'boolean'
        ? options.reducedMotion
        : detectPrefersReducedMotion()

    this._baseSeed = options.seed ?? null
    this._rng = createRng(`${this._baseSeed ?? 'default'}-horror-director`)
    this._onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
    this._onEventEnd =
      typeof options.onEventEnd === 'function' ? options.onEventEnd : null
    this._onEventCancel =
      typeof options.onEventCancel === 'function' ? options.onEventCancel : null

    this._debugHistoryEnabled = Boolean(options.recordHistory)
    this._eventHistory = []
    this._walkableCells = []

    this._elapsedSec = 0
    this._eventSequence = 0
    this._lastEventType = null
    this._tensionLevel = 0

    const preset = HORROR_INTENSITY_PRESETS[this.intensity]
    this._cooldownTimer =
      Number.isFinite(options.initialDelay) && options.initialDelay >= 0
        ? options.initialDelay
        : preset.initialDelay
    this._customCooldownOverride =
      Number.isFinite(options.minCooldown) || Number.isFinite(options.maxCooldown)
        ? {
            minCooldown: Number.isFinite(options.minCooldown)
              ? Math.max(0.2, options.minCooldown)
              : null,
            maxCooldown: Number.isFinite(options.maxCooldown)
              ? Math.max(0.2, options.maxCooldown)
              : null,
          }
        : null

    this._typeCooldowns = new Map()
    this._activeEvent = null
    this._silhouetteGroup = null
    this._silhouetteWorldPos = null
    this._lightsModified = false
    this._variantCounter = 0

    if (this.maze) {
      this.setMaze(this.maze)
    }
  }

  setScene(scene) {
    if (this.isDisposed) return
    if (this._silhouetteGroup && this._silhouetteGroup.parent && this.scene !== scene) {
      this._silhouetteGroup.parent.remove(this._silhouetteGroup)
    }
    this.scene = scene || null
    if (this._silhouetteGroup && this.scene && this._silhouetteGroup.parent !== this.scene) {
      this.scene.add(this._silhouetteGroup)
    }
  }

  setEnvironment(environment) {
    if (this.isDisposed) return
    this._restoreBaselineLights()
    this.environment = environment || null
  }

  setAudioEngine(audioEngine) {
    if (this.isDisposed) return
    this.audioEngine = audioEngine || null
  }

  _reseedRng() {
    const seedKey =
      this._baseSeed ??
      (this.maze
        ? `${this.maze.seed ?? 'maze'}-${this.maze.difficulty || 'medium'}`
        : 'default')
    this._rng = createRng(`${seedKey}-horror-director`)
  }

  setMaze(maze) {
    if (this.isDisposed) return
    this._stopActiveEvent(true)
    this.maze = maze || null
    this._walkableCells = []
    this._elapsedSec = 0
    this._eventSequence = 0
    this._lastEventType = null
    this._tensionLevel = 0
    this._typeCooldowns.clear()
    this._reseedRng()

    if (maze?.grid) {
      const rows = maze.grid.length
      const cols = maze.grid[0]?.length || 0
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          if (maze.grid[r][c] === CELL_TYPES.PATH) {
            const world = gridToWorld(r, c, maze)
            if (world) {
              this._walkableCells.push({ row: r, col: c, x: world.x, z: world.z })
            }
          }
        }
      }
    }

    const preset = this._getEffectivePreset()
    this._cooldownTimer = preset.enabled ? preset.initialDelay : Infinity
  }

  _getEffectivePreset() {
    const base = HORROR_INTENSITY_PRESETS[this.intensity]
    if (!this._customCooldownOverride || !base.enabled) {
      return base
    }
    const minCd = this._customCooldownOverride.minCooldown ?? base.minCooldown
    const maxCd = Math.max(
      minCd,
      this._customCooldownOverride.maxCooldown ?? base.maxCooldown
    )
    return {
      ...base,
      minCooldown: minCd,
      maxCooldown: maxCd,
    }
  }

  setIntensity(level) {
    if (this.isDisposed) return this.intensity
    const normalized = normalizeHorrorIntensity(level)
    if (normalized === this.intensity) return this.intensity
    this.intensity = normalized
    const preset = this._getEffectivePreset()

    if (!preset.enabled) {
      this._stopActiveEvent(true)
      this._cooldownTimer = Infinity
    } else if (!Number.isFinite(this._cooldownTimer) || this._cooldownTimer > preset.maxCooldown) {
      this._cooldownTimer = preset.initialDelay
    }
    return this.intensity
  }

  setVisualScaresEnabled(enabled) {
    if (this.isDisposed) return this.visualScaresEnabled
    this.visualScaresEnabled = Boolean(enabled)
    if (!this.visualScaresEnabled) {
      this._restoreBaselineLights()
      this._hideSilhouette()
      if (this._activeEvent?.visualOnly) {
        this._stopActiveEvent(true)
      }
    }
    return this.visualScaresEnabled
  }

  setReducedMotion(reduced) {
    if (this.isDisposed) return this.reducedMotion
    this.reducedMotion = Boolean(reduced)
    return this.reducedMotion
  }

  setPaused(paused) {
    if (this.isDisposed) return
    const nextPaused = Boolean(paused)
    if (nextPaused === this.isPaused) return
    this.isPaused = nextPaused
    if (this.isPaused) {
      this._restoreBaselineLights()
      this._hideSilhouette()
    }
  }

  updateConfig(partial = {}) {
    if (this.isDisposed || !partial || typeof partial !== 'object') {
      return this.getConfig()
    }
    if ('intensity' in partial) {
      this.setIntensity(partial.intensity)
    }
    if ('visualScaresEnabled' in partial) {
      this.setVisualScaresEnabled(partial.visualScaresEnabled)
    }
    if ('reducedMotion' in partial) {
      this.setReducedMotion(partial.reducedMotion)
    }
    if ('seed' in partial && partial.seed !== this._baseSeed) {
      this._baseSeed = partial.seed
      this._reseedRng()
    }
    return this.getConfig()
  }

  getConfig() {
    return {
      intensity: this.intensity,
      visualScaresEnabled: this.visualScaresEnabled,
      reducedMotion: this.reducedMotion,
    }
  }

  getState() {
    return {
      isDisposed: this.isDisposed,
      isPaused: this.isPaused,
      isGameOver: this.isGameOver,
      intensity: this.intensity,
      visualScaresEnabled: this.visualScaresEnabled,
      reducedMotion: this.reducedMotion,
      elapsedTime: this._elapsedSec,
      cooldownRemaining: this._cooldownTimer,
      tensionLevel: this._tensionLevel,
      eventCount: this._eventSequence,
      lastEventType: this._lastEventType,
      activeEvent: this._activeEvent
        ? {
            id: this._activeEvent.id,
            type: this._activeEvent.type,
            elapsed: this._activeEvent.elapsed,
            duration: this._activeEvent.duration,
          }
        : null,
    }
  }

  getEventHistory() {
    return [...this._eventHistory]
  }

  clearEventHistory() {
    this._eventHistory.length = 0
  }

  _recordHistory(entry) {
    if (!this._debugHistoryEnabled) return
    this._eventHistory.push(entry)
    if (this._eventHistory.length > 64) {
      this._eventHistory.shift()
    }
  }

  onGameOver() {
    if (this.isDisposed) return
    this.isGameOver = true
    this._stopActiveEvent(true)
  }

  reset() {
    if (this.isDisposed) return
    this._stopActiveEvent(true)
    this.isGameOver = false
    this._elapsedSec = 0
    this._eventSequence = 0
    this._lastEventType = null
    this._tensionLevel = 0
    this._typeCooldowns.clear()
    this._reseedRng()
    const preset = this._getEffectivePreset()
    this._cooldownTimer = preset.enabled ? preset.initialDelay : Infinity
  }

  _ensureSilhouetteGroup() {
    if (this.isDisposed || !this.scene) return null
    if (!this._silhouetteGroup) {
      this._silhouetteGroup = createSilhouetteMesh()
    }
    if (this._silhouetteGroup.parent !== this.scene) {
      this.scene.add(this._silhouetteGroup)
    }
    return this._silhouetteGroup
  }

  _hideSilhouette() {
    if (!this._silhouetteGroup) return
    this._silhouetteGroup.visible = false
    const { cloakMat, eyeMat } = this._silhouetteGroup.userData || {}
    if (cloakMat) cloakMat.opacity = 0
    if (eyeMat) eyeMat.opacity = 0
    this._silhouetteWorldPos = null
  }

  _disposeSilhouette() {
    if (!this._silhouetteGroup) return
    disposeThreeGroup(this._silhouetteGroup)
    this._silhouetteGroup = null
    this._silhouetteWorldPos = null
  }

  _applyLightScale(scale = 1) {
    const lights = this.environment?.lights
    const cfg = this.environment?.config
    if (!lights || !cfg) return

    const s = Math.max(0.03, Math.min(1.25, scale))
    if (lights.ambientLight) lights.ambientLight.intensity = cfg.ambientIntensity * s
    if (lights.hemiLight) lights.hemiLight.intensity = cfg.hemiIntensity * s
    if (lights.directionalLight) lights.directionalLight.intensity = cfg.directionalIntensity * s
    if (lights.fillLight) lights.fillLight.intensity = (cfg.fillIntensity ?? 0) * s
    if (lights.startLight) {
      if (cfg.localizedLightsEnabled) {
        lights.startLight.intensity = cfg.startLightIntensity * Math.max(0.15, s)
      } else {
        lights.startLight.intensity = 0
        lights.startLight.visible = false
      }
    }
    if (lights.exitLight) {
      if (cfg.localizedLightsEnabled) {
        lights.exitLight.intensity = cfg.exitLightIntensity * Math.max(0.15, s)
      } else {
        lights.exitLight.intensity = 0
        lights.exitLight.visible = false
      }
    }
    this._lightsModified = true
    this.environment?.onLightScaleChange?.(s)
  }

  _restoreBaselineLights() {
    if (!this._lightsModified) return
    this._lightsModified = false
    const lights = this.environment?.lights
    const cfg = this.environment?.config
    if (!lights || !cfg) return

    if (lights.ambientLight) lights.ambientLight.intensity = cfg.ambientIntensity
    if (lights.hemiLight) lights.hemiLight.intensity = cfg.hemiIntensity
    if (lights.directionalLight) lights.directionalLight.intensity = cfg.directionalIntensity
    if (lights.fillLight) lights.fillLight.intensity = cfg.fillIntensity ?? 0
    if (lights.startLight) {
      lights.startLight.intensity = cfg.localizedLightsEnabled ? cfg.startLightIntensity : 0
      lights.startLight.visible = Boolean(cfg.localizedLightsEnabled && (!this.maze || this.maze.start))
    }
    if (lights.exitLight) {
      lights.exitLight.intensity = cfg.localizedLightsEnabled ? cfg.exitLightIntensity : 0
      lights.exitLight.visible = Boolean(cfg.localizedLightsEnabled && (!this.maze || this.maze.exit))
    }
    this.environment?.onLightScaleChange?.(1)
  }

  _stopActiveEvent(silent = false) {
    const prev = this._activeEvent
    this._activeEvent = null
    this._restoreBaselineLights()
    this._hideSilhouette()
    if (!prev) return
    const payload = {
      id: prev.id,
      type: prev.type,
      elapsedTime: this._elapsedSec,
    }
    if (silent) {
      this._onEventCancel?.(payload)
    } else {
      this._onEventEnd?.(payload)
    }
  }

  /**
   * Builds a sanitized gameplay context snapshot without storing or exposing
   * enemy coordinates or directional vectors.
   */
  evaluateContext(context = {}) {
    const playerWorldPos = context?.playerWorldPos || { x: 0, y: 0, z: 0 }
    const isHidden = Boolean(context?.isHidden || context?.playerHidden)
    const maxHealth = Math.max(1, Number(context?.maxHealth) || 100)
    const health = Math.max(
      0,
      Math.min(maxHealth, Number.isFinite(context?.health) ? context.health : maxHealth)
    )
    const healthRatio = health / maxHealth
    const elapsedTime = Math.max(
      this._elapsedSec,
      Number.isFinite(context?.elapsedTime) ? context.elapsedTime : 0
    )

    let nearestEnemyDist = Infinity
    let enemyChasing = false
    const enemies = context?.enemies
    if (enemies) {
      for (const enemy of enemies) {
        if (!enemy || enemy.isDisposed) continue
        if (enemy.state === 'chase' || enemy.state === 'attack') {
          enemyChasing = true
        }
        if (enemy.worldPos) {
          const d = Math.hypot(
            enemy.worldPos.x - (playerWorldPos.x || 0),
            enemy.worldPos.z - (playerWorldPos.z || 0)
          )
          if (d < nearestEnemyDist) {
            nearestEnemyDist = d
          }
        }
      }
    }

    const enemyNearby = nearestEnemyDist <= 11.5
    const timeFactor = Math.min(0.28, elapsedTime / 90)
    const lowHealthFactor = (1 - healthRatio) * 0.34
    const proximityFactor = enemyNearby ? (1 - nearestEnemyDist / 11.5) * 0.34 : 0
    const stealthTension = isHidden && enemyNearby ? 0.2 : 0
    const tensionLevel = Math.max(
      0,
      Math.min(1, timeFactor + lowHealthFactor + proximityFactor + stealthTension)
    )

    return {
      playerWorldPos,
      playerGridCell: context?.playerGridCell || null,
      isHidden,
      health,
      maxHealth,
      healthRatio,
      elapsedTime,
      nearestEnemyDist,
      enemyNearby,
      enemyChasing,
      tensionLevel,
    }
  }

  _pickCorridorTarget(playerWorldPos, minDist, maxDist, requireLineOfSight = false) {
    if (!playerWorldPos || this._walkableCells.length === 0) {
      return null
    }

    const sightCandidates = []
    const fallbackCandidates = []

    for (let i = 0; i < this._walkableCells.length; i += 1) {
      const cell = this._walkableCells[i]
      const dist = Math.hypot(cell.x - playerWorldPos.x, cell.z - playerWorldPos.z)
      if (dist < minDist || dist > maxDist) continue

      if (requireLineOfSight && this.maze) {
        if (checkLineOfSight(playerWorldPos, cell, this.maze)) {
          sightCandidates.push(cell)
        } else {
          fallbackCandidates.push(cell)
        }
      } else {
        fallbackCandidates.push(cell)
      }
    }

    const pool = sightCandidates.length > 0 ? sightCandidates : fallbackCandidates
    if (pool.length === 0) return null
    const idx = Math.floor(this._rng() * pool.length)
    return pool[idx] || pool[0]
  }

  /**
   * Weighted deterministic candidate selection grounded in gameplay context,
   * cooldowns, reduced-visual constraints, and anti-repetition rules.
   */
  selectNextEvent(snapshot) {
    const preset = this._getEffectivePreset()
    if (!preset.enabled) return null

    const candidates = []
    const onCooldown = (type) => (this._typeCooldowns.get(type) || 0) > 0

    // 1. Unexpected environmental sound disturbance (always valid if maze/position exists)
    if (!onCooldown(HORROR_EVENT_TYPES.ENVIRONMENTAL_SOUND)) {
      candidates.push({
        type: HORROR_EVENT_TYPES.ENVIRONMENTAL_SOUND,
        weight: snapshot.isHidden ? 1.5 : 1.15,
      })
    }

    // 2. Nearby enemy presence warning (only when enemy is near, never revealing position)
    if (
      snapshot.enemyNearby &&
      !snapshot.enemyChasing &&
      !onCooldown(HORROR_EVENT_TYPES.PRESENCE_WARNING)
    ) {
      const proximityBoost = 1 + (1 - Math.min(1, snapshot.nearestEnemyDist / 11.5)) * 1.4
      candidates.push({
        type: HORROR_EVENT_TYPES.PRESENCE_WARNING,
        weight: 1.1 * proximityBoost,
      })
    }

    // Visual scare candidates (only when visualScaresEnabled is true)
    if (this.visualScaresEnabled) {
      if (!onCooldown(HORROR_EVENT_TYPES.LIGHT_FLICKER)) {
        candidates.push({
          type: HORROR_EVENT_TYPES.LIGHT_FLICKER,
          weight: 1.0 + snapshot.tensionLevel * 0.65,
        })
      }

      if (
        snapshot.elapsedTime >= 12 &&
        !onCooldown(HORROR_EVENT_TYPES.BLACKOUT)
      ) {
        candidates.push({
          type: HORROR_EVENT_TYPES.BLACKOUT,
          weight: 0.45 + snapshot.tensionLevel * 0.5,
        })
      }

      if (
        !snapshot.isHidden &&
        !snapshot.enemyChasing &&
        this._walkableCells.length > 0 &&
        !onCooldown(HORROR_EVENT_TYPES.DISTANT_SILHOUETTE)
      ) {
        candidates.push({
          type: HORROR_EVENT_TYPES.DISTANT_SILHOUETTE,
          weight: 0.72 + (1 - snapshot.healthRatio) * 0.45,
        })
      }
    }

    // 3. Rare context-sensitive scripted scare sequence
    const scriptedContextReady =
      snapshot.elapsedTime >= preset.minScriptedElapsed &&
      ((snapshot.isHidden && snapshot.enemyNearby) ||
        snapshot.healthRatio <= 0.65 ||
        snapshot.tensionLevel >= 0.45)

    if (
      scriptedContextReady &&
      preset.scriptedWeight > 0 &&
      !onCooldown(HORROR_EVENT_TYPES.SCRIPTED_SCARE)
    ) {
      candidates.push({
        type: HORROR_EVENT_TYPES.SCRIPTED_SCARE,
        weight: preset.scriptedWeight,
      })
    }

    if (candidates.length === 0) return null

    // Prevent back-to-back repetition whenever alternatives are available
    const nonRepeating =
      candidates.length > 1 && this._lastEventType
        ? candidates.filter((c) => c.type !== this._lastEventType)
        : candidates

    const pool = nonRepeating.length > 0 ? nonRepeating : candidates
    let totalWeight = 0
    for (let i = 0; i < pool.length; i += 1) {
      totalWeight += pool[i].weight
    }
    if (totalWeight <= 0) return pool[0].type

    let roll = this._rng() * totalWeight
    for (let i = 0; i < pool.length; i += 1) {
      roll -= pool[i].weight
      if (roll <= 0) {
        return pool[i].type
      }
    }
    return pool[pool.length - 1].type
  }

  /**
   * Starts a specific horror event cleanly. Respects disabled intensity, game-over,
   * and visualScaresEnabled settings (suppressing pure visual scares when disabled).
   */
  triggerEvent(type, context = {}, options = {}) {
    if (this.isDisposed || this.isGameOver || this.isPaused) return null
    const preset = this._getEffectivePreset()
    if (!preset.enabled && !options?.force) return null

    const isPureVisual =
      type === HORROR_EVENT_TYPES.DISTANT_SILHOUETTE ||
      type === HORROR_EVENT_TYPES.LIGHT_FLICKER ||
      type === HORROR_EVENT_TYPES.BLACKOUT

    if (isPureVisual && !this.visualScaresEnabled) {
      return null
    }

    const snapshot = context?.playerWorldPos
      ? this.evaluateContext(context)
      : {
          playerWorldPos: { x: 0, y: 0, z: 0 },
          isHidden: false,
          healthRatio: 1,
          elapsedTime: this._elapsedSec,
          nearestEnemyDist: Infinity,
          enemyNearby: false,
          enemyChasing: false,
          tensionLevel: this._tensionLevel,
        }

    this._stopActiveEvent(true)
    this._eventSequence += 1
    this._lastEventType = type
    this._variantCounter += 1

    const eventId = `horror-${type}-${this._eventSequence}`
    let duration = 1.6
    let visualOnly = false

    if (type === HORROR_EVENT_TYPES.LIGHT_FLICKER) {
      duration = 1.5 + this._rng() * 0.9
      visualOnly = true
      this.audioEngine?.playHorrorDirectorCue('light_flicker', null, {
        tension: snapshot.tensionLevel,
      })
    } else if (type === HORROR_EVENT_TYPES.BLACKOUT) {
      duration = 2.4 + this._rng() * 1.1
      visualOnly = true
      this.audioEngine?.playHorrorDirectorCue('blackout', null, {
        tension: snapshot.tensionLevel,
      })
    } else if (type === HORROR_EVENT_TYPES.DISTANT_SILHOUETTE) {
      duration = 2.1
      visualOnly = true
      const target =
        options?.targetPos ||
        this._pickCorridorTarget(snapshot.playerWorldPos, 5.5, 14.5, true)
      const silWorldPos = target
        ? { x: target.x, y: 0, z: target.z }
        : {
            x: snapshot.playerWorldPos.x,
            y: 0,
            z: snapshot.playerWorldPos.z - 8.5,
          }
      const sil = this._ensureSilhouetteGroup()
      if (sil) {
        sil.position.set(silWorldPos.x, 0, silWorldPos.z)
        const dx = snapshot.playerWorldPos.x - silWorldPos.x
        const dz = snapshot.playerWorldPos.z - silWorldPos.z
        sil.rotation.y = Math.atan2(-dx, -dz)
        sil.visible = true
      }
      this._silhouetteWorldPos = silWorldPos
      this.audioEngine?.playHorrorDirectorCue('distant_silhouette', silWorldPos, {
        tension: snapshot.tensionLevel,
      })
    } else if (type === HORROR_EVENT_TYPES.ENVIRONMENTAL_SOUND) {
      duration = 1.1
      const target =
        options?.targetPos ||
        this._pickCorridorTarget(snapshot.playerWorldPos, 4.5, 15.0, false)
      const soundWorldPos = target
        ? { x: target.x, y: 0, z: target.z }
        : {
            x: snapshot.playerWorldPos.x + 6.5,
            y: 0,
            z: snapshot.playerWorldPos.z,
          }
      this.audioEngine?.playHorrorDirectorCue('environmental_sound', soundWorldPos, {
        variant: this._variantCounter,
      })
    } else if (type === HORROR_EVENT_TYPES.PRESENCE_WARNING) {
      duration = 1.8
      // Deliberately non-positional (null worldPos) to never expose enemy coordinates
      this.audioEngine?.playHorrorDirectorCue('presence_warning', null, {
        tension: snapshot.tensionLevel,
      })
    } else if (type === HORROR_EVENT_TYPES.SCRIPTED_SCARE) {
      duration = 3.4
      if (this.visualScaresEnabled) {
        const target =
          options?.targetPos ||
          this._pickCorridorTarget(snapshot.playerWorldPos, 5.5, 13.5, true)
        if (target) {
          this._silhouetteWorldPos = { x: target.x, y: 0, z: target.z }
        }
      }
      this.audioEngine?.playHorrorDirectorCue('scripted_scare', null, { beat: 1 })
    }

    const typeCd =
      type === HORROR_EVENT_TYPES.SCRIPTED_SCARE
        ? preset.scriptedCooldown
        : DEFAULT_TYPE_COOLDOWNS[type] || 15
    this._typeCooldowns.set(type, typeCd)

    this._activeEvent = {
      id: eventId,
      type,
      elapsed: 0,
      duration,
      visualOnly,
      beatStage: 1,
      seedPhase: this._rng() * Math.PI * 2,
      tensionLevel: snapshot.tensionLevel,
    }

    const summary = {
      id: eventId,
      type,
      duration,
      tensionLevel: snapshot.tensionLevel,
      visualScaresEnabled: this.visualScaresEnabled,
      reducedMotion: this.reducedMotion,
    }

    this._recordHistory({ ...summary, time: this._elapsedSec })
    this._onEvent?.(summary)

    return summary
  }

  _updateActiveEvent(delta, snapshot) {
    const active = this._activeEvent
    if (!active) return

    active.elapsed += delta
    const progress = Math.min(1, active.elapsed / Math.max(0.05, active.duration))
    const preset = HORROR_INTENSITY_PRESETS[this.intensity]
    const dipDepth = preset.enabled ? preset.lightDipDepth : 0.65

    if (active.type === HORROR_EVENT_TYPES.LIGHT_FLICKER && this.visualScaresEnabled) {
      if (this.reducedMotion) {
        // Gentle non-strobing slow dip for reduced motion accessibility
        const smoothDip = Math.sin(progress * Math.PI)
        this._applyLightScale(1 - smoothDip * Math.min(0.45, dipDepth))
      } else {
        const wave =
          0.5 +
          0.3 * Math.sin(active.elapsed * 28 + active.seedPhase) +
          0.2 * Math.cos(active.elapsed * 43)
        const scale = Math.max(1 - dipDepth, Math.min(1.05, 1 - dipDepth * wave))
        this._applyLightScale(scale)
      }
    } else if (active.type === HORROR_EVENT_TYPES.BLACKOUT && this.visualScaresEnabled) {
      const minScale = this.reducedMotion ? 0.32 : Math.max(0.06, 1 - dipDepth * 1.05)
      let scale
      if (progress < 0.16) {
        scale = 1 - (1 - minScale) * (progress / 0.16)
      } else if (progress < 0.8) {
        scale = minScale
      } else {
        scale = minScale + (1 - minScale) * ((progress - 0.8) / 0.2)
      }
      this._applyLightScale(scale)
    } else if (
      active.type === HORROR_EVENT_TYPES.DISTANT_SILHOUETTE &&
      this.visualScaresEnabled &&
      this._silhouetteGroup
    ) {
      const fade = Math.sin(progress * Math.PI)
      const maxOp = preset.silhouetteMaxOpacity || 0.62
      const { cloakMat, eyeMat } = this._silhouetteGroup.userData || {}
      if (cloakMat) cloakMat.opacity = maxOp * fade
      if (eyeMat) eyeMat.opacity = Math.min(0.85, maxOp * 1.15) * fade
      if (!this.reducedMotion && this._silhouetteWorldPos) {
        this._silhouetteGroup.position.y = Math.sin(active.elapsed * 2.4) * 0.04
      } else {
        this._silhouetteGroup.position.y = 0
      }
    } else if (active.type === HORROR_EVENT_TYPES.PRESENCE_WARNING && this.visualScaresEnabled) {
      // Subtle atmospheric dim pulse synced to tension
      const pulse = Math.sin(progress * Math.PI) * (this.reducedMotion ? 0.16 : 0.26)
      this._applyLightScale(1 - pulse)
    } else if (active.type === HORROR_EVENT_TYPES.SCRIPTED_SCARE) {
      // Multi-beat scripted tension sequence
      if (active.beatStage < 2 && active.elapsed >= 1.15) {
        active.beatStage = 2
        this.audioEngine?.playHorrorDirectorCue('scripted_scare', null, { beat: 2 })
        if (this.visualScaresEnabled && this._silhouetteWorldPos) {
          const sil = this._ensureSilhouetteGroup()
          if (sil) {
            sil.position.set(this._silhouetteWorldPos.x, 0, this._silhouetteWorldPos.z)
            const dx = snapshot.playerWorldPos.x - this._silhouetteWorldPos.x
            const dz = snapshot.playerWorldPos.z - this._silhouetteWorldPos.z
            sil.rotation.y = Math.atan2(-dx, -dz)
            sil.visible = true
          }
        }
      } else if (active.beatStage < 3 && active.elapsed >= 2.45) {
        active.beatStage = 3
        this._hideSilhouette()
        this.audioEngine?.playHorrorDirectorCue('scripted_scare', null, { beat: 3 })
      }

      if (this.visualScaresEnabled) {
        const minScale = this.reducedMotion ? 0.36 : 0.14
        if (active.elapsed < 1.15) {
          const p = active.elapsed / 1.15
          this._applyLightScale(1 - (1 - minScale) * p)
        } else if (active.elapsed < 2.45) {
          this._applyLightScale(minScale)
          if (this._silhouetteGroup?.visible) {
            const silP = Math.min(1, (active.elapsed - 1.15) / 1.25)
            const fade = Math.sin(silP * Math.PI)
            const { cloakMat, eyeMat } = this._silhouetteGroup.userData || {}
            if (cloakMat) cloakMat.opacity = 0.7 * fade
            if (eyeMat) eyeMat.opacity = 0.85 * fade
          }
        } else {
          const p = Math.min(1, (active.elapsed - 2.45) / (active.duration - 2.45))
          this._applyLightScale(minScale + (1 - minScale) * p)
        }
      }
    }

    if (active.elapsed >= active.duration) {
      this._stopActiveEvent(false)
    }
  }

  /**
   * Per-frame director update driven inside MazeSceneEngine.tick() (outside React state).
   */
  update(delta = 0.016, context = {}) {
    if (this.isDisposed || this.isPaused || this.isGameOver || !Number.isFinite(delta) || delta <= 0) {
      return
    }

    this._elapsedSec += delta

    // Decrement per-type cooldowns
    if (this._typeCooldowns.size > 0) {
      this._typeCooldowns.forEach((remaining, key) => {
        const nextVal = remaining - delta
        if (nextVal <= 0) {
          this._typeCooldowns.delete(key)
        } else {
          this._typeCooldowns.set(key, nextVal)
        }
      })
    }

    const snapshot = this.evaluateContext(context)
    this._tensionLevel = snapshot.tensionLevel

    if (this._activeEvent) {
      this._updateActiveEvent(delta, snapshot)
      return
    }

    const preset = this._getEffectivePreset()
    if (!preset.enabled) {
      return
    }

    // Pace cooldown slightly faster under elevated tension while preserving minCooldown floor
    const tensionAccel = 1 + snapshot.tensionLevel * 0.25
    this._cooldownTimer = Math.max(0, this._cooldownTimer - delta * tensionAccel)

    if (this._cooldownTimer <= 0) {
      const nextType = this.selectNextEvent(snapshot)
      const span = Math.max(0, preset.maxCooldown - preset.minCooldown)
      this._cooldownTimer = preset.minCooldown + this._rng() * span

      if (nextType) {
        this.triggerEvent(nextType, context)
      }
    }
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this._stopActiveEvent(true)
    this._disposeSilhouette()
    this._typeCooldowns.clear()
    this._walkableCells = []
    this._onEvent = null
    this._onEventEnd = null
    this._onEventCancel = null
    this.audioEngine = null
    this.environment = null
    this.scene = null
    this.maze = null
    return true
  }
}
