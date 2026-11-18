import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { resolveWallPassStep } from '../mechanics/powerups.js'
import { isCellWalkable, moveWithSubsteps } from '../world/gridCollision.js'
import { PLAYER_RADIUS, gridToWorld, worldToGrid } from '../world/worldCoords.js'
import {
  applyEnvironmentToScene,
  buildEnvironment,
  DEFAULT_ENVIRONMENT_CONFIG,
  disposeEnvironment,
  syncEnvironmentToMaze,
  updateEnvironmentConfig,
} from './buildEnvironment.js'
import {
  buildMazeMeshes,
  disposeMazeGroup,
  setExitGateState,
  updateExitGate,
} from './buildMazeMeshes.js'
import {
  buildPlayer,
  disposePlayer,
  positionPlayerAtWorld,
} from './buildPlayer.js'
import { CAMERA_MODES, CameraRig } from './CameraRig.js'
import { CollectibleManager } from './CollectibleManager.js'
import { EnemyManager } from './EnemyManager.js'
import { HazardManager } from './HazardManager.js'
import { HidingSpotManager } from './HidingSpotManager.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
import { HorrorDirector } from './HorrorDirector.js'
import { PlayerAnimator } from './PlayerAnimator.js'

export const LUMEN_VAULT_SCENE_COLORS = {
  voidBackground: DEFAULT_ENVIRONMENT_CONFIG.backgroundColor,
  chamberSurface: 0x101722,
}

export const DEFAULT_MOVEMENT_CONFIG = {
  walkSpeed: 5.5,
  sprintSpeed: 9.0,
  radius: PLAYER_RADIUS,
}

function deriveCardinalDirection(dRow, dCol, dirX, dirZ) {
  if (dRow !== 0 || dCol !== 0) {
    if (Math.abs(dCol) >= Math.abs(dRow)) {
      return dCol >= 0 ? 'right' : 'left'
    }
    return dRow >= 0 ? 'down' : 'up'
  }
  if (Math.abs(dirX) >= Math.abs(dirZ)) {
    return dirX >= 0 ? 'right' : 'left'
  }
  return dirZ >= 0 ? 'down' : 'up'
}

const DEFAULT_CONFIG = {
  fov: 65,
  near: 0.1,
  far: 400,
  backgroundColor: LUMEN_VAULT_SCENE_COLORS.voidBackground,
  pixelRatioCap: 2,
  antialias: undefined,
  powerPreference: 'high-performance',
  toneMappingExposure: 1.05,
}

/**
 * Detects software WebGL rasterizers (SwiftShader, llvmpipe, WARP) so render
 * cost and frame pacing can adapt safely without altering scene content.
 */
export function detectSoftwareWebGL() {
  if (typeof document === 'undefined') {
    return false
  }

  try {
    const probeCanvas = document.createElement('canvas')
    const gl =
      probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl')
    if (!gl) return true

    const debugExt = gl.getExtension('WEBGL_debug_renderer_info')
    const rendererParam = debugExt
      ? debugExt.UNMASKED_RENDERER_WEBGL
      : gl.RENDERER
    const gpuName = String(gl.getParameter(rendererParam) || '')

    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpuName)
  } catch {
    return false
  }
}

function disposeMaterial(material) {
  if (!material) return
  if (Array.isArray(material)) {
    for (let i = 0; i < material.length; i += 1) {
      disposeMaterial(material[i])
    }
    return
  }

  const textureKeys = [
    'map',
    'alphaMap',
    'aoMap',
    'bumpMap',
    'emissiveMap',
    'envMap',
    'lightMap',
    'metalnessMap',
    'normalMap',
    'roughnessMap',
  ]
  for (let i = 0; i < textureKeys.length; i += 1) {
    const tex = material[textureKeys[i]]
    if (tex && typeof tex.dispose === 'function') {
      tex.dispose()
    }
  }

  if (typeof material.dispose === 'function') {
    material.dispose()
  }
}

/**
 * Core imperative Three.js scene engine for Maze Escape.
 * Owns Scene, PerspectiveCamera, WebGLRenderer, animation loop, responsive
 * resize handling, maze geometry replacement, and idempotent resource disposal.
 */
export class MazeSceneEngine {
  constructor(canvasHost, config = {}) {
    if (!canvasHost || typeof canvasHost.appendChild !== 'function') {
      throw new Error('MazeSceneEngine requires a valid DOM canvasHost element.')
    }

    this.canvasHost = canvasHost
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) }
    this.isSoftwareGl =
      typeof this.config.isSoftwareGl === 'boolean'
        ? this.config.isSoftwareGl
        : detectSoftwareWebGL()

    this.isRunning = false
    this.isDisposed = false
    this._frameId = null
    this._timeoutId = null
    this._lastTimestamp = 0
    this._elapsedSec = 0
    this._currentMaze = null
    this._mazeGroup = null
    this._exitGateGroup = null
    this.isExitLocked = false
    this._playerGroup = null
    this._environment = null
    this._playerWorldPos = { x: 0, y: 0, z: 0 }
    this._lastGridCell = null
    this._tmpForward = { x: 0, z: -1 }
    this._tmpRight = { x: 1, z: 0 }
    this._inputSource = null
    this._movementOptions = {}
    this.movementConfig = {
      ...DEFAULT_MOVEMENT_CONFIG,
      ...(this.config.movement || {}),
    }
    this._motionSample = {
      moved: false,
      isSprinting: false,
      actualSpeed: 0,
      walkSpeed: this.movementConfig.walkSpeed,
      sprintSpeed: this.movementConfig.sprintSpeed,
    }
    this._playerAnimator = new PlayerAnimator(null, this.config.animation)
    this._onFrame =
      typeof this.config.onFrame === 'function' ? this.config.onFrame : null

    // Player Health, Damage Immunity & Combat State
    this.maxHealth = Math.max(1, Number(this.config.maxHealth) || 100)
    this.health = Math.max(
      0,
      Math.min(
        this.maxHealth,
        Number.isFinite(this.config.initialHealth)
          ? this.config.initialHealth
          : this.maxHealth
      )
    )
    this.damageImmunityDuration = Number.isFinite(this.config.damageImmunityDuration)
      ? this.config.damageImmunityDuration
      : 1.2
    this.damageImmunityTimer = 0
    this.isGameOver = false
    this.hasWon = false
    this.damageFeedbackTimer = 0
    this.cameraShakeIntensity = 0
    this._onPlayerDamage =
      typeof this.config.onPlayerDamage === 'function'
        ? this.config.onPlayerDamage
        : null
    this._onGameOver =
      typeof this.config.onGameOver === 'function' ? this.config.onGameOver : null

    // Stealth & Hiding Spots State (real-time loop updates kept outside React state)
    this.isHidden = false
    this._soundEvent = null
    this._soundTimer = 0
    this._stealthSnapshot = {
      isHidden: false,
      canInteract: false,
      nearbySpotId: null,
      nearbySpotType: null,
    }
    this._onStealthChange =
      typeof this.config.onStealthChange === 'function'
        ? this.config.onStealthChange
        : null
    this._onFlashlightChange =
      typeof this.config.onFlashlightChange === 'function'
        ? this.config.onFlashlightChange
        : null

    const initialWidth = Math.max(1, Math.floor(canvasHost.clientWidth || 1))
    const initialHeight = Math.max(1, Math.floor(canvasHost.clientHeight || 1))

    this._cachedHidingSpotCells = []
    this.scene = new THREE.Scene()
    this.collectibleManager = new CollectibleManager(this.scene)
    this.enemyManager = new EnemyManager(this.scene, {
      autoSpawn: true,
      ...(this.config.enemies || {}),
    })
    this.hazardManager = new HazardManager(this.scene)
    this.hidingSpotManager = new HidingSpotManager(this.scene)
    this.audioEngine = new HorrorAudioEngine(this.config.audio)

    this.camera = new THREE.PerspectiveCamera(
      this.config.fov,
      initialWidth / initialHeight,
      this.config.near,
      this.config.far
    )

    const initialCameraConfig = {
      ...(this.config.camera || {}),
      ...(typeof this.config.cameraMode === 'string'
        ? { mode: this.config.cameraMode }
        : {}),
    }
    this.cameraRig = new CameraRig(this.camera, initialCameraConfig)
    this.cameraRig.snap()

    // Sprint Stamina System
    this.maxStamina = 100
    this.stamina = 100
    this.staminaDrainRate = 32
    this.staminaRegenRate = 42
    this.recoveryDelay = 0.7
    this.recoveryDelayTimer = 0
    this.isExhausted = false
    this.staminaBreathingTimer = 0

    // Player Flashlight System
    this.flashlightActive = false
    this.maxBattery = 100
    this.battery = 100
    this.batteryDrainRate = 4.0
    this.batteryRechargeRate = 12.0
    this.spotlight = new THREE.SpotLight(0xfff9e6, 0, 32, Math.PI * 0.22, 0.45, 2)
    this.spotlight.position.set(0, -0.05, 0)
    this.spotlightTarget = new THREE.Object3D()
    this.spotlightTarget.position.set(0, -0.05, -12)
    this.spotlight.target = this.spotlightTarget
    this.scene.add(this.spotlightTarget)
    this.camera.add(this.spotlight)
    this.camera.add(this.spotlightTarget)
    if (!this.camera.parent) {
      this.scene.add(this.camera)
    }

    const initialEnvConfig = {
      ...(this.config.environment || {}),
      ...(typeof config?.backgroundColor === 'number'
        ? { backgroundColor: config.backgroundColor }
        : {}),
    }
    this.setEnvironment(initialEnvConfig)

    this._onHorrorEvent =
      typeof this.config.onHorrorEvent === 'function'
        ? this.config.onHorrorEvent
        : null
    this.horrorDirector = new HorrorDirector({
      scene: this.scene,
      audioEngine: this.audioEngine,
      environment: this._environment,
      ...(this.config.horrorDirector || {}),
      onEvent: (evt) => {
        this._onHorrorEvent?.(evt)
        this.config.horrorDirector?.onEvent?.(evt)
      },
      onEventEnd: (evt) => {
        this.config.horrorDirector?.onEventEnd?.(evt)
      },
    })

    const antialias =
      typeof this.config.antialias === 'boolean'
        ? this.config.antialias
        : !this.isSoftwareGl

    const rendererOptions = {
      antialias,
      powerPreference: this.config.powerPreference,
    }

    this.renderer =
      typeof this.config.createRenderer === 'function'
        ? this.config.createRenderer(rendererOptions)
        : new THREE.WebGLRenderer(rendererOptions)

    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = this.config.toneMappingExposure

    this.resize(initialWidth, initialHeight)

    if (
      this.renderer.domElement &&
      this.renderer.domElement.parentNode !== this.canvasHost
    ) {
      this.canvasHost.appendChild(this.renderer.domElement)
    }
  }

  getEnvironment() {
    return this._environment
  }

  clearEnvironment() {
    if (this._environment) {
      this.horrorDirector?.setEnvironment(null)
      disposeEnvironment(this._environment, this.scene)
      this._environment = null
    }
  }

  /**
   * Builds and applies a fresh environment bundle to the scene without touching
   * maze geometry, renderer, or the active animation loop.
   */
  setEnvironment(envConfig = {}) {
    if (this.isDisposed || !this.scene) {
      return null
    }

    this.clearEnvironment()
    const env = buildEnvironment({
      maze: this._currentMaze,
      config: envConfig,
    })
    this._environment = env
    applyEnvironmentToScene(this.scene, env)
    this.horrorDirector?.setEnvironment(env)
    return env
  }

  /**
   * Updates environment settings (fog, ambient/directional/localized lighting,
   * background, details) in place without rebuilding maze geometry or renderer.
   */
  updateEnvironment(partialConfig = {}) {
    if (this.isDisposed || !this.scene) {
      return null
    }

    if (!this._environment) {
      return this.setEnvironment(partialConfig)
    }

    return updateEnvironmentConfig(
      this._environment,
      this.scene,
      partialConfig,
      this._currentMaze
    )
  }

  getCameraRig() {
    return this.cameraRig
  }

  getEnemyManager() {
    return this.enemyManager
  }

  spawnEnemy(options = {}) {
    return this.enemyManager ? this.enemyManager.spawnEnemy(options) : null
  }

  clearEnemies() {
    this.enemyManager?.clear()
  }

  clearHazards() {
    this.hazardManager?.clear()
  }

  getHazardManager() {
    return this.hazardManager
  }

  getCollectibleManager() {
    return this.collectibleManager
  }

  clearCollectibles() {
    this.collectibleManager?.clear({ disposeBursts: true })
  }

  syncCollectibles({
    coins,
    powerUps,
    keycards,
    echoPath,
    spawnBursts = true,
    isReset = false,
  } = {}) {
    if (this.isDisposed || !this.collectibleManager) return
    if (coins !== undefined) {
      this.collectibleManager.syncCoins(coins, this._currentMaze, {
        spawnBursts,
        isReset,
      })
    }
    if (powerUps !== undefined) {
      this.collectibleManager.syncPowerUps(powerUps, this._currentMaze, {
        spawnBursts,
        isReset,
      })
    }
    if (keycards !== undefined) {
      this.collectibleManager.syncKeycards(keycards, this._currentMaze, {
        spawnBursts,
        isReset,
      })
    }
    if (echoPath !== undefined) {
      this.collectibleManager.syncEchoPath(echoPath, this._currentMaze)
    }
  }

  syncEchoPath(echoPath = []) {
    if (this.isDisposed || !this.collectibleManager) return
    this.collectibleManager.syncEchoPath(echoPath, this._currentMaze)
  }

  setExitLocked(locked, options = {}) {
    if (this.isDisposed) return false
    const nextLocked = Boolean(locked)
    const wasLocked = this.isExitLocked
    this.isExitLocked = nextLocked

    if (this._exitGateGroup) {
      setExitGateState(this._exitGateGroup, nextLocked, options)
    }

    if (
      wasLocked &&
      !nextLocked &&
      options.animate !== false &&
      this._currentMaze?.exit &&
      this.collectibleManager
    ) {
      this.collectibleManager.spawnBurstAtCell(
        'gate_unlock',
        this._currentMaze.exit.row,
        this._currentMaze.exit.col,
        this._currentMaze
      )
    }

    return this.isExitLocked
  }

  getIsExitLocked() {
    return this.isExitLocked
  }

  getExitGateGroup() {
    return this._exitGateGroup
  }

  setHasWon(won) {
    if (this.isDisposed) return
    this.hasWon = Boolean(won)
    if (this.hasWon) {
      this._motionSample.moved = false
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = 0
      this.horrorDirector?.setPaused(true)
    }
  }

  handleGameEvent(event) {
    if (this.isDisposed) return false
    return Boolean(this.audioEngine?.handleGameEvent(event))
  }

  clearHidingSpots() {
    this.isHidden = false
    this._soundEvent = null
    this._soundTimer = 0
    this.hidingSpotManager?.clear()
    this._notifyStealthChange(true, {
      isHidden: false,
      canInteract: false,
      nearbySpotId: null,
      nearbySpotType: null,
    })
  }

  getHidingSpotManager() {
    return this.hidingSpotManager
  }

  getHidingSpots() {
    return this.hidingSpotManager ? this.hidingSpotManager.getHidingSpots() : []
  }

  getAudioEngine() {
    return this.audioEngine
  }

  unlockAudio() {
    if (this.isDisposed || !this.audioEngine) return false
    return this.audioEngine.unlock()
  }

  getAudioState() {
    return this.audioEngine ? this.audioEngine.getAudioState() : null
  }

  getAudioVolumes() {
    return this.audioEngine ? this.audioEngine.getVolumeConfig() : null
  }

  setAudioVolumes(partial = {}) {
    if (this.isDisposed || !this.audioEngine) return null
    return this.audioEngine.setVolumes(partial)
  }

  setAudioMuted(muted) {
    if (this.isDisposed || !this.audioEngine) return null
    return this.audioEngine.setMuted(muted)
  }

  setAudioPaused(paused) {
    if (this.isDisposed || !this.audioEngine) return
    this.audioEngine.setPaused(paused)
  }

  getHorrorDirector() {
    return this.horrorDirector
  }

  getHorrorState() {
    return this.horrorDirector ? this.horrorDirector.getState() : null
  }

  getHorrorConfig() {
    return this.horrorDirector ? this.horrorDirector.getConfig() : null
  }

  updateHorrorConfig(partial = {}) {
    if (this.isDisposed || !this.horrorDirector) return null
    return this.horrorDirector.updateConfig(partial)
  }

  setHorrorPaused(paused) {
    if (this.isDisposed || !this.horrorDirector) return
    this.horrorDirector.setPaused(paused)
  }

  setPaused(paused) {
    if (this.isDisposed) return
    this.audioEngine?.setPaused(paused)
    this.horrorDirector?.setPaused(paused)
  }

  isPlayerHidden() {
    return Boolean(this.isHidden)
  }

  getStealthState() {
    return { ...this._stealthSnapshot }
  }

  _notifyStealthChange(force = false, nextState = null) {
    const activeSpot = this.hidingSpotManager?.getActiveHidingSpot?.()
    const candidate = nextState || {
      isHidden: Boolean(this.isHidden),
      canInteract:
        !this.isGameOver &&
        (Boolean(this.isHidden) ||
          Boolean(
            this.hidingSpotManager?.findNearestInteractable?.(
              this._playerWorldPos,
              this.getPlayerGridCell()
            )
          )),
      nearbySpotId: this.isHidden
        ? activeSpot?.id || null
        : this.hidingSpotManager?.nearbySpotId || null,
      nearbySpotType: this.isHidden
        ? activeSpot?.type || null
        : this.hidingSpotManager?.getHidingSpot?.(this.hidingSpotManager?.nearbySpotId)?.type || null,
    }

    const changed =
      force ||
      candidate.isHidden !== this._stealthSnapshot.isHidden ||
      candidate.canInteract !== this._stealthSnapshot.canInteract ||
      candidate.nearbySpotId !== this._stealthSnapshot.nearbySpotId ||
      candidate.nearbySpotType !== this._stealthSnapshot.nearbySpotType

    if (!changed) return

    this._stealthSnapshot.isHidden = candidate.isHidden
    this._stealthSnapshot.canInteract = candidate.canInteract
    this._stealthSnapshot.nearbySpotId = candidate.nearbySpotId
    this._stealthSnapshot.nearbySpotType = candidate.nearbySpotType

    this._onStealthChange?.({ ...this._stealthSnapshot })
  }

  emitSound(position = null, range = 5.5, duration = 0.6) {
    if (this.isDisposed || !this._currentMaze || !position) return
    const sx = Number(position.x)
    const sz = Number(position.z)
    if (!Number.isFinite(sx) || !Number.isFinite(sz)) return

    this._soundEvent = {
      position: { x: sx, y: 0, z: sz },
      cell: worldToGrid(sx, sz, this._currentMaze),
      range: Math.max(0, Number(range) || 5.5),
    }
    this._soundTimer = Math.max(0.05, Number(duration) || 0.6)
  }

  enterHidingSpot(spotOrId = null) {
    if (
      this.isDisposed ||
      this.isGameOver ||
      !this._currentMaze ||
      !this.hidingSpotManager ||
      this.isHidden
    ) {
      return { entered: false, spot: null }
    }

    const spot = spotOrId
      ? typeof spotOrId === 'string'
        ? this.hidingSpotManager.getHidingSpot(spotOrId)
        : spotOrId
      : this.hidingSpotManager.findNearestInteractable(
          this._playerWorldPos,
          this.getPlayerGridCell()
        )

    if (!spot || !spot.isPlayerInRange(this._playerWorldPos, this.getPlayerGridCell())) {
      return { entered: false, spot: null }
    }

    const currentYaw = this.cameraRig?.getLookDirection?.()?.yaw ?? 0
    const entry = this.hidingSpotManager.enterHidingSpot(
      spot,
      this._playerWorldPos,
      currentYaw
    )
    if (!entry) {
      return { entered: false, spot: null }
    }

    this.isHidden = true
    this._motionSample.moved = false
    this._motionSample.isSprinting = false
    this._motionSample.actualSpeed = 0
    this._playerAnimator?.reset()

    this._playerWorldPos.x = entry.interiorPos.x
    this._playerWorldPos.y = entry.interiorPos.y
    this._playerWorldPos.z = entry.interiorPos.z

    if (this._playerGroup) {
      positionPlayerAtWorld(
        this._playerGroup,
        entry.interiorPos.x,
        0,
        entry.interiorPos.z,
        entry.facingYaw
      )
    }

    if (this.cameraRig) {
      this.cameraRig.setPlayerPosition(
        entry.interiorPos.x,
        entry.interiorPos.y,
        entry.interiorPos.z
      )
      this.cameraRig.setLookDirection(entry.facingYaw, 0)
    }

    this.syncPlayerVisibility()
    this.emitSound(spot.getPosition(), 4.8, 0.45)
    this.audioEngine?.onHidingSpotTransition('enter', spot.getPosition())
    this._notifyStealthChange(true, {
      isHidden: true,
      canInteract: true,
      nearbySpotId: spot.id,
      nearbySpotType: spot.type,
    })

    return { entered: true, spot }
  }

  exitHidingSpot(options = {}) {
    if (!this.isHidden) {
      return { exited: false, spot: null }
    }

    const result = this.hidingSpotManager?.exitHidingSpot()
    this.isHidden = false

    if (options?.restorePosition !== false && result?.exitPos) {
      this.setPlayerWorldPosition(
        result.exitPos.x,
        0,
        result.exitPos.z,
        {
          immediate: Boolean(options?.immediate),
        }
      )
    } else {
      this._playerWorldPos.y = 0
      this.cameraRig?.setPlayerPosition(
        this._playerWorldPos.x,
        0,
        this._playerWorldPos.z
      )
    }

    this.syncPlayerVisibility()
    if (!options?.silent) {
      this.audioEngine?.onHidingSpotTransition(
        'exit',
        result?.spot?.getPosition() || this._playerWorldPos
      )
    }
    this._notifyStealthChange(true)

    return { exited: true, spot: result?.spot || null }
  }

  interact() {
    if (this.isDisposed || this.isGameOver || !this._currentMaze) {
      return { handled: false, action: null }
    }

    if (this.isHidden) {
      const res = this.exitHidingSpot()
      return { handled: res.exited, action: res.exited ? 'exit' : null, spot: res.spot }
    }

    const res = this.enterHidingSpot()
    return { handled: res.entered, action: res.entered ? 'enter' : null, spot: res.spot }
  }

  getEnemies() {
    return this.enemyManager ? this.enemyManager.getEnemies() : []
  }

  getPlayer() {
    return this._playerGroup
  }

  getPlayerAnimator() {
    return this._playerAnimator
  }

  getPlayerAnimationState() {
    return this._playerAnimator ? this._playerAnimator.getState() : null
  }

  syncPlayerVisibility() {
    if (this.isDisposed || !this._playerGroup) {
      return false
    }
    const isThirdPerson =
      this.cameraRig?.getMode?.() === CAMERA_MODES.THIRD_PERSON
    this._playerGroup.visible = isThirdPerson && !this.isHidden
    return this._playerGroup.visible
  }

  clearPlayer() {
    if (this._playerAnimator) {
      this._playerAnimator.setPlayerGroup(null)
    }
    if (this._playerGroup) {
      disposePlayer(this._playerGroup)
      this._playerGroup = null
    }
    this._playerWorldPos.x = 0
    this._playerWorldPos.y = 0
    this._playerWorldPos.z = 0
    this._lastGridCell = null
    this._motionSample.moved = false
    this._motionSample.isSprinting = false
    this._motionSample.actualSpeed = 0
  }

  getHealth() {
    return {
      health: this.health,
      maxHealth: this.maxHealth,
      isGameOver: this.isGameOver,
      isImmune: this.damageImmunityTimer > 0,
      immunityRemaining: this.damageImmunityTimer,
    }
  }

  setHealth(nextHealth) {
    if (this.isDisposed) return this.health
    const clamped = Math.max(0, Math.min(this.maxHealth, Number(nextHealth) || 0))
    this.health = clamped
    if (this.health <= 0 && !this.isGameOver) {
      this.isGameOver = true
      if (this.isHidden) {
        this.exitHidingSpot({ restorePosition: false, immediate: true, silent: true })
      }
      this.audioEngine?.onGameOver()
      this.horrorDirector?.onGameOver()
      this._notifyStealthChange(true)
      this._onGameOver?.({})
    } else if (this.health > 0) {
      this.isGameOver = false
    }
    return this.health
  }

  resetCombat() {
    this.isHidden = false
    this._soundEvent = null
    this._soundTimer = 0
    this.health = this.maxHealth
    this.isGameOver = false
    this.hasWon = false
    this.damageImmunityTimer = 0
    this.damageFeedbackTimer = 0
    this.cameraShakeIntensity = 0
    this.stamina = this.maxStamina
    this.recoveryDelayTimer = 0
    this.isExhausted = false
    this.staminaBreathingTimer = 0
    this.flashlightActive = false
    this.battery = this.maxBattery
    if (this.spotlight) {
      this.spotlight.visible = false
      this.spotlight.intensity = 0
    }
    this._onFlashlightChange?.(false)
    if (this.camera && this.camera.rotation.z !== 0) {
      this.camera.rotation.z = 0
    }
    this.enemyManager?.resetEnemyStates()
    this.hazardManager?.resetHazardStates()
    this.hidingSpotManager?.resetStates()
    this.audioEngine?.reset()
    this.horrorDirector?.reset()
    this._playerWorldPos.y = 0
    this.syncPlayerVisibility()
    this._notifyStealthChange(true)
  }

  toggleFlashlight() {
    if (this.isDisposed || this.isGameOver || this.hasWon) return false
    this.flashlightActive = !this.flashlightActive
    if (this.spotlight) {
      this.spotlight.visible = this.flashlightActive && this.battery > 0
      this.spotlight.intensity = this.flashlightActive && this.battery > 0 ? 2.8 : 0
    }
    this.audioEngine?.onFlashlightToggle(this.flashlightActive)
    this._onFlashlightChange?.(this.flashlightActive)
    return this.flashlightActive
  }

  getFlashlightState() {
    return {
      active: this.flashlightActive,
      battery: this.battery,
      maxBattery: this.maxBattery,
    }
  }

  getStaminaState() {
    return {
      stamina: this.stamina,
      maxStamina: this.maxStamina,
      isExhausted: this.isExhausted,
    }
  }

  applyDamage(amount, meta = {}) {
    if (
      this.isDisposed ||
      this.isGameOver ||
      this.health <= 0 ||
      this.damageImmunityTimer > 0
    ) {
      return false
    }

    const dmg = Math.max(0, Number(amount) || 0)
    if (dmg <= 0) return false

    this.health = Math.max(0, this.health - dmg)
    this.damageImmunityTimer = this.damageImmunityDuration
    this.damageFeedbackTimer = 0.55
    this.cameraShakeIntensity = 0.28

    const isGameOver = this.health <= 0
    if (isGameOver) {
      this.isGameOver = true
      this._motionSample.moved = false
      this._motionSample.actualSpeed = 0
      if (this.isHidden) {
        this.exitHidingSpot({ restorePosition: false, immediate: true, silent: true })
      }
      this._notifyStealthChange(true)
    }

    this.audioEngine?.onPlayerDamage()

    this._onPlayerDamage?.({
      damage: dmg,
      health: this.health,
      maxHealth: this.maxHealth,
      enemyId: meta?.enemyId || null,
      hazardId: meta?.hazardId || null,
      hazardType: meta?.hazardType || null,
      isGameOver,
    })

    if (isGameOver) {
      this.audioEngine?.onGameOver()
      this.horrorDirector?.onGameOver()
      this._onGameOver?.({
        enemyId: meta?.enemyId || null,
        hazardId: meta?.hazardId || null,
        hazardType: meta?.hazardType || null,
      })
    }

    return true
  }

  getMovementConfig() {
    return { ...this.movementConfig }
  }

  updateMovementConfig(partialConfig = {}) {
    if (this.isDisposed || !partialConfig || typeof partialConfig !== 'object') {
      return this.getMovementConfig()
    }
    this.movementConfig = {
      ...this.movementConfig,
      ...partialConfig,
    }
    return this.getMovementConfig()
  }

  getPlayerWorldPosition() {
    return { ...this._playerWorldPos }
  }

  getPlayerGridCell() {
    if (this._currentMaze) {
      const gridCell = worldToGrid(
        this._playerWorldPos.x,
        this._playerWorldPos.z,
        this._currentMaze
      )
      if (gridCell) return gridCell
    }
    return this._lastGridCell ? { ...this._lastGridCell } : null
  }

  setInputSource(source) {
    if (typeof source === 'function') {
      this._inputSource = source
    } else if (source && typeof source === 'object') {
      this._inputSource = () => source
    } else {
      this._inputSource = null
    }
  }

  setMovementOptions(options = {}) {
    this._movementOptions = options && typeof options === 'object' ? options : {}
  }

  setCameraMode(mode, options = {}) {
    if (this.isDisposed || !this.cameraRig) return null
    const nextMode = this.cameraRig.setMode(mode, options)
    this.syncPlayerVisibility()
    return nextMode
  }

  updateCameraConfig(partialConfig = {}) {
    if (this.isDisposed || !this.cameraRig) return null
    const nextConfig = this.cameraRig.updateConfig(partialConfig)
    this.syncPlayerVisibility()
    return nextConfig
  }

  /**
   * Repositions the 3D player character and camera rig anchor in world space
   * without rebuilding maze geometry or restarting the WebGLRenderer.
   */
  setPlayerWorldPosition(xOrVec, y = 0, z = 0, options = {}) {
    if (this.isDisposed) return null

    let nextX = this._playerWorldPos.x
    let nextY = this._playerWorldPos.y
    let nextZ = this._playerWorldPos.z

    if (xOrVec && typeof xOrVec === 'object') {
      if (Number.isFinite(xOrVec.x)) nextX = xOrVec.x
      if (Number.isFinite(xOrVec.y)) nextY = xOrVec.y
      if (Number.isFinite(xOrVec.z)) nextZ = xOrVec.z
    } else if (
      Number.isFinite(xOrVec) &&
      Number.isFinite(y) &&
      Number.isFinite(z)
    ) {
      nextX = xOrVec
      nextY = y
      nextZ = z
    }

    this._playerWorldPos.x = nextX
    this._playerWorldPos.y = nextY
    this._playerWorldPos.z = nextZ

    if (this._currentMaze) {
      const cell = worldToGrid(nextX, nextZ, this._currentMaze)
      if (cell) {
        this._lastGridCell = cell
      }
    }

    if (this.cameraRig) {
      this.cameraRig.setPlayerPosition(nextX, nextY, nextZ)
      if (Number.isFinite(options?.yaw)) {
        this.cameraRig.setLookDirection(options.yaw)
      }
      if (options?.immediate) {
        this.cameraRig.snap()
      }
    }

    if (this._playerGroup) {
      return positionPlayerAtWorld(
        this._playerGroup,
        nextX,
        nextY,
        nextZ,
        options?.yaw
      )
    }

    return { ...this._playerWorldPos }
  }

  /**
   * Repositions the 3D player character and camera rig anchor to discrete
   * `(row, col)` using canonical `gridToWorld()` without rebuilding the maze.
   */
  setPlayerGridPosition(row, col, options = {}) {
    if (this.isDisposed || !this._currentMaze) {
      return null
    }

    const worldPos = gridToWorld(row, col, this._currentMaze)
    if (!worldPos) {
      return null
    }

    const y = Number.isFinite(options?.y) ? options.y : 0
    const updated = this.setPlayerWorldPosition(worldPos.x, y, worldPos.z, options)
    this._lastGridCell = { row, col }
    if (options?.immediate) {
      this._motionSample.moved = false
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = 0
      this._playerAnimator?.reset()
    }
    return updated
  }

  setLookDirection(yaw, pitch) {
    if (this.isDisposed) return
    if (this.cameraRig) {
      this.cameraRig.setLookDirection(yaw, pitch)
    }
    if (this._playerGroup && Number.isFinite(yaw)) {
      this._playerGroup.rotation.y = yaw
    }
  }

  applyLookDelta(deltaX = 0, deltaY = 0, options = {}) {
    if (this.isDisposed || !this.cameraRig) return
    this.cameraRig.applyLookDelta(deltaX, deltaY, options)
    if (this._playerGroup) {
      this._playerGroup.rotation.y = this.cameraRig.getLookDirection().yaw
    }
  }

  /**
   * Advances continuous player movement using delta-time kinematics,
   * normalized diagonal vectors, maze.grid anti-tunneling collision,
   * optional Wall Pass consumption, and single-fire cell-entry notifications.
   */
  stepMovement(inputState, delta = 0, options = {}) {
    if (
      this.isDisposed ||
      this.isGameOver ||
      this.isHidden ||
      !this._currentMaze?.grid ||
      !inputState ||
      !Number.isFinite(delta) ||
      delta <= 0
    ) {
      this._motionSample.moved = false
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = 0
      if (options?.updateAnimation !== false && Number.isFinite(delta) && delta > 0) {
        this._playerAnimator?.update(delta, this._motionSample)
      }
      return {
        moved: false,
        collided: false,
        hitBoundary: false,
        position: { ...this._playerWorldPos },
        cell: this.getPlayerGridCell(),
        cellChanged: false,
        usedWallPass: false,
        passedWall: null,
      }
    }

    const forwardAxis = Number(inputState.forwardAxis) || 0
    const strafeAxis = Number(inputState.strafeAxis) || 0
    if (forwardAxis === 0 && strafeAxis === 0) {
      this._motionSample.moved = false
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = 0
      if (options?.updateAnimation !== false) {
        this._playerAnimator?.update(delta, this._motionSample)
      }
      return {
        moved: false,
        collided: false,
        hitBoundary: false,
        position: { ...this._playerWorldPos },
        cell: this.getPlayerGridCell(),
        cellChanged: false,
        usedWallPass: false,
        passedWall: null,
      }
    }

    if (this.cameraRig) {
      this.cameraRig.getForwardVector(this._tmpForward)
      this.cameraRig.getRightVector(this._tmpRight)
    } else {
      this._tmpForward.x = 0
      this._tmpForward.z = -1
      this._tmpRight.x = 1
      this._tmpRight.z = 0
    }

    const rawX =
      this._tmpForward.x * forwardAxis + this._tmpRight.x * strafeAxis
    const rawZ =
      this._tmpForward.z * forwardAxis + this._tmpRight.z * strafeAxis
    const mag = Math.hypot(rawX, rawZ)
    if (mag <= 1e-6) {
      return {
        moved: false,
        collided: false,
        hitBoundary: false,
        position: { ...this._playerWorldPos },
        cell: this.getPlayerGridCell(),
        cellChanged: false,
        usedWallPass: false,
        passedWall: null,
      }
    }

    const dirX = rawX / mag
    const dirZ = rawZ / mag

    let requestingSprint = Boolean(inputState?.sprint)
    if (this.isExhausted) {
      if (this.stamina >= 35) {
        this.isExhausted = false
      } else {
        requestingSprint = false
      }
    }

    const isMovingForStamina = mag > 0.1
    const effectiveSprint = requestingSprint && !this.isExhausted && isMovingForStamina
    if (this.isHidden) {
      this.recoveryDelayTimer = 0
      this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * 1.5 * delta)
      if (this.stamina >= 35) this.isExhausted = false
    } else if (effectiveSprint) {
      if (this.stamina > 0) {
        this.stamina = Math.max(0, this.stamina - this.staminaDrainRate * delta)
        this.recoveryDelayTimer = this.recoveryDelay
        if (this.stamina <= 0) {
          this.isExhausted = true
          this.audioEngine?.onStaminaWarning('heartbeat')
        }
      } else {
        this.isExhausted = true
      }
    } else {
      if (this.recoveryDelayTimer > 0) {
        this.recoveryDelayTimer = Math.max(0, this.recoveryDelayTimer - delta)
      } else {
        this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * delta)
        if (this.stamina >= 35 && this.isExhausted) {
          this.isExhausted = false
        }
      }
    }

    const speed = effectiveSprint
      ? this.movementConfig.sprintSpeed
      : this.movementConfig.walkSpeed
    const stepDist = Math.max(0, speed) * delta
    const deltaX = dirX * stepDist
    const deltaZ = dirZ * stepDist

    const startX = this._playerWorldPos.x
    const startZ = this._playerWorldPos.z
    const prevCell =
      this._lastGridCell ||
      worldToGrid(startX, startZ, this._currentMaze) ||
      this._currentMaze.start ||
      null

    const moveResult = moveWithSubsteps(
      startX,
      startZ,
      deltaX,
      deltaZ,
      this._currentMaze,
      { radius: this.movementConfig.radius }
    )

    let nextX = moveResult.x
    let nextZ = moveResult.z
    let usedWallPass = false
    let passedWall = null

    const wallPassArmed =
      typeof options?.wallPassArmed === 'boolean'
        ? options.wallPassArmed
        : Boolean(this._movementOptions?.getWallPassArmed?.())

    // Preserve exact Wall Pass rules: only trigger on intentional push into a
    // single interior wall with a walkable tile directly beyond it.
    if (
      wallPassArmed &&
      moveResult.collided &&
      prevCell &&
      moveResult.blockingCells.length > 0
    ) {
      let bestWallPass = null
      let bestDot = 0.72

      for (let i = 0; i < moveResult.blockingCells.length; i += 1) {
        const block = moveResult.blockingCells[i]
        const dRow = block.row - prevCell.row
        const dCol = block.col - prevCell.col
        if (Math.abs(dRow) + Math.abs(dCol) !== 1) continue

        const dot = dCol * dirX + dRow * dirZ
        if (dot <= bestDot) continue

        const wp = resolveWallPassStep(
          this._currentMaze.grid,
          block.row,
          block.col,
          { row: dRow, col: dCol }
        )
        if (wp.allowed && wp.landing) {
          bestDot = dot
          bestWallPass = {
            landing: wp.landing,
            wallTile: wp.wallTile,
          }
        }
      }

      if (bestWallPass) {
        const landingWorld = gridToWorld(
          bestWallPass.landing.row,
          bestWallPass.landing.col,
          this._currentMaze
        )
        if (landingWorld) {
          nextX = landingWorld.x
          nextZ = landingWorld.z
          usedWallPass = true
          passedWall = bestWallPass.wallTile
          this.collectibleManager?.spawnBurstAtCell(
            'wall_pass',
            bestWallPass.wallTile.row,
            bestWallPass.wallTile.col,
            this._currentMaze
          )
        }
      }
    }

    const actualDistance = Math.hypot(nextX - startX, nextZ - startZ)
    const moved = actualDistance > 1e-6
    const actualSpeed = moved && delta > 1e-5 ? actualDistance / delta : 0

    if (moved) {
      this._playerWorldPos.x = nextX
      this._playerWorldPos.z = nextZ

      if (this._playerGroup) {
        this._playerGroup.position.set(nextX, this._playerWorldPos.y, nextZ)
        if (this.cameraRig) {
          this._playerGroup.rotation.y = this.cameraRig.getLookDirection().yaw
        }
      }

      if (this.cameraRig) {
        this.cameraRig.setPlayerPosition(nextX, this._playerWorldPos.y, nextZ)
        if (usedWallPass) {
          this.cameraRig.snap()
        }
      }
    }

    if (usedWallPass) {
      this._motionSample.moved = false
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = 0
      this._playerAnimator?.reset()
    } else {
      this._motionSample.moved = moved && actualSpeed > 0.05
      this._motionSample.actualSpeed = actualSpeed
      this._motionSample.walkSpeed = this.movementConfig.walkSpeed
      this._motionSample.sprintSpeed = this.movementConfig.sprintSpeed
      this._motionSample.isSprinting =
        effectiveSprint &&
        this._motionSample.moved &&
        actualSpeed > this.movementConfig.walkSpeed * 1.1
    }

    if (options?.updateAnimation !== false) {
      this._playerAnimator?.update(delta, this._motionSample)
    }

    const nextCell = worldToGrid(nextX, nextZ, this._currentMaze)
    const cellChanged = Boolean(
      nextCell &&
        isCellWalkable(nextCell.row, nextCell.col, this._currentMaze) &&
        (!prevCell ||
          nextCell.row !== prevCell.row ||
          nextCell.col !== prevCell.col)
    )

    if (cellChanged) {
      const dRow = prevCell ? nextCell.row - prevCell.row : 0
      const dCol = prevCell ? nextCell.col - prevCell.col : 0
      const direction = deriveCardinalDirection(dRow, dCol, dirX, dirZ)
      this._lastGridCell = { row: nextCell.row, col: nextCell.col }

      const onCellChange =
        options?.onCellChange || this._movementOptions?.onPlayerCellChange
      onCellChange?.(
        { row: nextCell.row, col: nextCell.col },
        {
          direction,
          countMove: true,
          usedWallPass,
          passedWall,
        }
      )
    }

    return {
      moved,
      collided: moveResult.collided && !usedWallPass,
      hitBoundary: moveResult.hitBoundary,
      position: { ...this._playerWorldPos },
      cell: this._lastGridCell ? { ...this._lastGridCell } : nextCell,
      cellChanged,
      usedWallPass,
      passedWall,
    }
  }

  getMazeGroup() {
    return this._mazeGroup
  }

  clearMaze() {
    this.resetCombat()
    if (this._mazeGroup) {
      disposeMazeGroup(this._mazeGroup)
      this._mazeGroup = null
    }
    this._exitGateGroup = null
    this.isExitLocked = false
    this.clearCollectibles()
    this.clearPlayer()
    this.clearEnemies()
    this.clearHazards()
    this.clearHidingSpots()
    this._cachedHidingSpotCells = []
    this._currentMaze = null
    this.collectibleManager?.setMaze(null)
    this.horrorDirector?.setMaze(null)
    this.audioEngine?.setMaze(null)
    this.cameraRig?.setMaze(null)
    if (this._environment && !this.isDisposed) {
      syncEnvironmentToMaze(this._environment, this.scene, null)
    }
  }

  /**
   * Builds and mounts 3D geometry for `maze`, safely disposing any previously
   * mounted maze meshes without recreating the WebGLRenderer or animation loop.
   */
  setMaze(maze) {
    if (this.isDisposed || !this.scene) {
      return null
    }

    if (maze && maze === this._currentMaze && this._mazeGroup) {
      return this._mazeGroup
    }

    this.clearMaze()

    if (!maze) {
      return null
    }

    const nextGroup = buildMazeMeshes(maze)
    if (!nextGroup) {
      return null
    }

    this._currentMaze = maze
    this._mazeGroup = nextGroup
    this._exitGateGroup = nextGroup.userData?.exitGate || null
    const defaultLocked = Array.isArray(maze.keycards) && maze.keycards.length > 0
    this.setExitLocked(defaultLocked, { animate: false })

    this.audioEngine?.setMaze(maze)
    this.cameraRig?.setMaze(maze)
    this.scene.add(nextGroup)

    if (this._environment) {
      syncEnvironmentToMaze(this._environment, this.scene, maze)
    }
    this.horrorDirector?.setMaze(maze)

    if (this.collectibleManager) {
      this.collectibleManager.setMaze(maze)
      if (maze.collectibles || maze.keycards) {
        this.collectibleManager.syncState({
          maze,
          coins: maze.collectibles?.coins || [],
          powerUps: maze.collectibles?.powerUps || [],
          keycards: maze.keycards || [],
          echoPath: [],
          spawnBursts: false,
        })
      }
    }

    if (this.hazardManager) {
      this.hazardManager.setMaze(maze)
    }

    if (this.hidingSpotManager) {
      this.hidingSpotManager.setMaze(maze, {
        hazards: this.hazardManager?.getHazards(),
      })
      const spots = this.hidingSpotManager.getHidingSpots()
      this._cachedHidingSpotCells = spots.map((s) => ({
        id: s.id,
        row: s.row ?? s.cell?.row,
        col: s.col ?? s.cell?.col,
      }))
    } else {
      this._cachedHidingSpotCells = []
    }

    if (this.enemyManager) {
      this.enemyManager.setMaze(maze, {
        autoSpawn: true,
        ...(this.config.enemies || {}),
        hidingSpots: this._cachedHidingSpotCells,
      })
    }

    // Resolve starting corridor direction and spawn world coordinates
    const startWorld = maze.start
      ? gridToWorld(maze.start.row, maze.start.col, maze)
      : null

    let initialYaw = 0
    if (maze.start) {
      const g = maze.grid
      const { row, col } = maze.start
      if (g?.[row]?.[col + 1] === CELL_TYPES.PATH) {
        initialYaw = -Math.PI / 2 // East (+X)
      } else if (g?.[row + 1]?.[col] === CELL_TYPES.PATH) {
        initialYaw = Math.PI // South (+Z)
      } else if (g?.[row - 1]?.[col] === CELL_TYPES.PATH) {
        initialYaw = 0 // North (-Z)
      } else if (g?.[row]?.[col - 1] === CELL_TYPES.PATH) {
        initialYaw = Math.PI / 2 // West (-X)
      }
    }

    // Create and mount 3D player character positioned at maze.start via gridToWorld()
    const isThirdPerson =
      this.cameraRig?.getMode?.() === CAMERA_MODES.THIRD_PERSON
    this._playerGroup = buildPlayer({
      maze,
      spawnCell: startWorld ? maze.start : null,
      position: startWorld ? null : { x: 0, y: 0, z: 0 },
      yaw: initialYaw,
      visible: isThirdPerson,
    })
    if (this._playerGroup) {
      this.scene.add(this._playerGroup)
    }
    if (this._playerAnimator) {
      this._playerAnimator.setPlayerGroup(this._playerGroup)
    }

    const resolvedSpawn = startWorld || { x: 0, z: 0 }
    this._playerWorldPos.x = resolvedSpawn.x
    this._playerWorldPos.y = 0
    this._playerWorldPos.z = resolvedSpawn.z
    this._lastGridCell = maze.start
      ? { row: maze.start.row, col: maze.start.col }
      : worldToGrid(resolvedSpawn.x, resolvedSpawn.z, maze)

    // Anchor camera rig at the maze starting cell facing the opening corridor
    if (this.cameraRig && startWorld) {
      this.cameraRig.setPlayerPosition(startWorld.x, 0, startWorld.z)
      this.cameraRig.setLookDirection(initialYaw, 0)
      this.cameraRig.snap()
    }

    return nextGroup
  }

  getPixelRatio() {
    const deviceRatio =
      typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
        ? window.devicePixelRatio
        : 1
    const maxCap = Math.max(1, Number(this.config.pixelRatioCap) || 2)
    return this.isSoftwareGl ? 1 : Math.min(deviceRatio, maxCap)
  }

  setFrameCallback(callback) {
    this._onFrame = typeof callback === 'function' ? callback : null
  }

  resize(width, height) {
    if (this.isDisposed || !this.camera || !this.renderer) {
      return
    }

    const rawWidth =
      typeof width === 'number' ? width : this.canvasHost?.clientWidth || 0
    const rawHeight =
      typeof height === 'number' ? height : this.canvasHost?.clientHeight || 0

    const safeWidth = Math.max(1, Math.floor(rawWidth))
    const safeHeight = Math.max(1, Math.floor(rawHeight))

    this.camera.aspect = safeWidth / safeHeight
    this.camera.updateProjectionMatrix()

    this.renderer.setPixelRatio(this.getPixelRatio())
    this.renderer.setSize(safeWidth, safeHeight, false)
  }

  renderFrame() {
    if (this.isDisposed || !this.renderer || !this.scene || !this.camera) {
      return
    }
    this.renderer.render(this.scene, this.camera)
  }

  _scheduleNextTick(tickFn) {
    if (!this.isRunning || this.isDisposed) return

    if (this.isSoftwareGl) {
      const gl = this.renderer?.getContext?.()
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
        gl.flush()
        const poll = () => {
          if (!this.isRunning || this.isDisposed) {
            if (sync) gl.deleteSync(sync)
            return
          }
          const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS)
          if (status === gl.UNSIGNALED) {
            this._timeoutId = window.setTimeout(poll, 5)
          } else {
            if (sync) gl.deleteSync(sync)
            this._timeoutId = window.setTimeout(tickFn, 80)
          }
        }
        this._timeoutId = window.setTimeout(poll, 5)
        return
      }

      this._timeoutId = window.setTimeout(tickFn, 80)
      return
    }

    if (typeof requestAnimationFrame === 'function') {
      this._frameId = requestAnimationFrame(tickFn)
    }
  }

  start() {
    if (this.isDisposed || this.isRunning) {
      return false
    }

    this.isRunning = true
    this._lastTimestamp =
      typeof performance !== 'undefined' ? performance.now() : Date.now()

    const tick = (timestamp) => {
      if (!this.isRunning || this.isDisposed) {
        return
      }

      const now =
        typeof timestamp === 'number'
          ? timestamp
          : typeof performance !== 'undefined'
            ? performance.now()
            : Date.now()
      const delta = Math.min(0.05, Math.max(0, (now - this._lastTimestamp) / 1000))
      this._lastTimestamp = now
      this._elapsedSec += delta

      this._motionSample.moved = false
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = 0

      // Countdown combat timers outside React state updates
      this.damageImmunityTimer = Math.max(0, this.damageImmunityTimer - delta)
      this.damageFeedbackTimer = Math.max(0, this.damageFeedbackTimer - delta)

      // Dynamic trauma / camera shake decay (respects reducedMotion)
      if (this.cameraShakeIntensity > 0) {
        this.cameraShakeIntensity = Math.max(
          0,
          this.cameraShakeIntensity - delta * 0.95
        )
        const shakeZ = this.horrorDirector?.reducedMotion
          ? 0
          : this.cameraShakeIntensity * (Math.random() - 0.5) * 0.14
        if (this.camera) {
          this.camera.rotation.z = shakeZ
        }
      } else if (this.camera && this.camera.rotation.z !== 0) {
        this.camera.rotation.z = 0
      }

      if (this._inputSource && !this.isGameOver && !this.hasWon) {
        const inputState = this._inputSource()
        if (inputState) {
          this.stepMovement(inputState, delta, { updateAnimation: false })
        }
      }

      if (this._playerAnimator) {
        this._playerAnimator.update(delta, this._motionSample)
      }

      if (this.collectibleManager) {
        this.collectibleManager.update(delta)
      }

      if (this._exitGateGroup) {
        updateExitGate(this._exitGateGroup, delta, this._elapsedSec)
      }

      if (!this.isGameOver && !this.hasWon) {
        if (this.isHidden) {
          this.recoveryDelayTimer = 0
          this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * 1.5 * delta)
          if (this.stamina >= 35) this.isExhausted = false
        } else {
          if (this.recoveryDelayTimer > 0) {
            this.recoveryDelayTimer = Math.max(0, this.recoveryDelayTimer - delta)
          } else if (!this._motionSample.isSprinting) {
            this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * delta)
            if (this.stamina >= 35 && this.isExhausted) {
              this.isExhausted = false
            }
          }
        }

        if (this.stamina < 30 && !this.isHidden) {
          this.staminaBreathingTimer = (this.staminaBreathingTimer || 0) + delta
          if (this.staminaBreathingTimer >= 2.2) {
            this.staminaBreathingTimer = 0
            this.audioEngine?.onStaminaWarning(this.isExhausted ? 'heartbeat' : 'breathing')
          }
        } else {
          this.staminaBreathingTimer = 0
        }
      }

      if (this.flashlightActive && !this.isGameOver && !this.hasWon && !this.isPaused) {
        this.battery = Math.max(0, this.battery - this.batteryDrainRate * delta)
        if (this.battery <= 0) {
          this.flashlightActive = false
          this.audioEngine?.onFlashlightToggle(false)
          this._onFlashlightChange?.(false)
        }
      } else {
        this.battery = Math.min(this.maxBattery, this.battery + this.batteryRechargeRate * delta)
      }

      if (this._onFrame) {
        this._onFrame({
          delta,
          elapsed: this._elapsedSec,
          scene: this.scene,
          camera: this.camera,
          cameraRig: this.cameraRig,
          renderer: this.renderer,
          health: this.health,
          maxHealth: this.maxHealth,
          stamina: this.stamina,
          maxStamina: this.maxStamina,
          isExhausted: this.isExhausted,
          flashlightActive: this.flashlightActive,
          battery: this.battery,
          maxBattery: this.maxBattery,
          isImmune: this.damageImmunityTimer > 0,
          damageFeedbackAlpha:
            this.damageFeedbackTimer > 0
              ? this.damageFeedbackTimer / 0.55
              : 0,
          isGameOver: this.isGameOver,
          playerGridCell: this.getPlayerGridCell(),
          playerWorldPos: this._playerWorldPos,
          yaw: this.cameraRig ? this.cameraRig.getLookDirection().yaw : 0,
        })
      }

      if (this._soundTimer > 0) {
        this._soundTimer = Math.max(0, this._soundTimer - delta)
        if (this._soundTimer === 0) {
          this._soundEvent = null
        }
      }

      if (this.spotlight) {
        if (this.flashlightActive && this.battery > 0 && !this.isGameOver && !this.hasWon) {
          this.spotlight.visible = true
          let intensity = 2.8
          if (this.battery < 25) {
            const flicker = Math.sin(this._elapsedSec * 24) > 0.2 ? 1 : 0.35
            intensity *= (0.6 + 0.4 * flicker)
          }
          this.spotlight.intensity = intensity
        } else {
          this.spotlight.visible = false
          this.spotlight.intensity = 0
        }
      }

      if (this.hidingSpotManager && !this.isGameOver && !this.hasWon) {
        const stealthInfo = this.hidingSpotManager.update(delta, {
          playerWorldPos: this._playerWorldPos,
          playerGridCell: this.getPlayerGridCell(),
        })
        this._notifyStealthChange(false, stealthInfo)
      }

      let enemyResult = null
      if (this.enemyManager && !this.isGameOver && !this.hasWon) {
        enemyResult = this.enemyManager.update(delta, {
          playerWorldPos: this._playerWorldPos,
          playerGridCell: this.getPlayerGridCell(),
          playerMotion: this._motionSample,
          playerHidden: this.isHidden,
          soundEvent: this._soundEvent,
          hidingSpotCells: this._cachedHidingSpotCells,
        })
        if (enemyResult?.attackHits?.length > 0) {
          for (let i = 0; i < enemyResult.attackHits.length; i += 1) {
            const hit = enemyResult.attackHits[i]
            this.applyDamage(hit.damage, {
              enemyId: hit.enemyId,
              enemyType: hit.enemyType,
            })
          }
        }
      }

      if (this.hazardManager && !this.isGameOver && !this.hasWon && !this.isHidden) {
        const hazardResult = this.hazardManager.update(delta, {
          playerWorldPos: this._playerWorldPos,
          playerGridCell: this.getPlayerGridCell(),
        })
        if (hazardResult?.hazardHits?.length > 0) {
          for (let i = 0; i < hazardResult.hazardHits.length; i += 1) {
            const hit = hazardResult.hazardHits[i]
            this.applyDamage(hit.damage, { hazardId: hit.hazardId, hazardType: hit.type })
          }
        }
      } else if (this.hazardManager && !this.isGameOver && !this.hasWon && this.isHidden) {
        // Still advance environmental hazard visual timers while player hides safely
        this.hazardManager.update(delta, null)
      }

      if (this.cameraRig) {
        this.cameraRig.update(delta)
      }

      if (this.horrorDirector) {
        this.horrorDirector.update(delta, {
          playerWorldPos: this._playerWorldPos,
          playerGridCell: this.getPlayerGridCell(),
          isHidden: this.isHidden,
          health: this.health,
          maxHealth: this.maxHealth,
          elapsedTime: this._elapsedSec,
          enemies: this.enemyManager?.enemies?.values(),
        })
      }

      if (this.audioEngine) {
        this.audioEngine.update(delta, {
          camera: this.camera,
          playerWorldPos: this._playerWorldPos,
          playerMotion: this._motionSample,
          isHidden: this.isHidden,
          isGameOver: this.isGameOver,
          enemies: this.enemyManager?.enemies?.values(),
          hazards: this.hazardManager?.hazards?.values(),
          attackHits: enemyResult?.attackHits || null,
        })
      }

      this.renderFrame()
      this._scheduleNextTick(tick)
    }

    if (typeof requestAnimationFrame === 'function') {
      this._frameId = requestAnimationFrame(tick)
    } else {
      tick()
    }

    return true
  }

  stop() {
    if (!this.isRunning && this._frameId === null && this._timeoutId === null) {
      return false
    }

    this.isRunning = false

    if (this._frameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._frameId)
    }
    this._frameId = null

    if (this._timeoutId !== null && typeof clearTimeout === 'function') {
      clearTimeout(this._timeoutId)
    }
    this._timeoutId = null

    return true
  }

  dispose() {
    if (this.isDisposed) {
      return false
    }

    this.isDisposed = true
    this.stop()
    this._onFrame = null
    this._onStealthChange = null
    this._onHorrorEvent = null
    this._inputSource = null
    this._movementOptions = {}
    this.clearMaze()
    this.clearPlayer()
    this.clearEnvironment()

    if (this.horrorDirector) {
      this.horrorDirector.dispose()
      this.horrorDirector = null
    }

    if (this.collectibleManager) {
      this.collectibleManager.dispose()
      this.collectibleManager = null
    }

    if (this.enemyManager) {
      this.enemyManager.dispose()
      this.enemyManager = null
    }

    if (this.hazardManager) {
      this.hazardManager.dispose()
      this.hazardManager = null
    }

    if (this.hidingSpotManager) {
      this.hidingSpotManager.dispose()
      this.hidingSpotManager = null
    }

    if (this.audioEngine) {
      this.audioEngine.dispose()
      this.audioEngine = null
    }

    if (this._playerAnimator) {
      this._playerAnimator.dispose()
      this._playerAnimator = null
    }

    if (this.cameraRig) {
      this.cameraRig.dispose()
      this.cameraRig = null
    }

    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry && typeof obj.geometry.dispose === 'function') {
          obj.geometry.dispose()
        }
        if (obj.material) {
          disposeMaterial(obj.material)
        }
        if (typeof obj.dispose === 'function' && obj !== this.scene) {
          obj.dispose()
        }
      })
      if (this.scene.environment && typeof this.scene.environment.dispose === 'function') {
        this.scene.environment.dispose()
      }
      this.scene.clear()
    }

    if (this.renderer) {
      const domEl = this.renderer.domElement
      if (domEl && domEl.parentNode === this.canvasHost) {
        this.canvasHost.removeChild(domEl)
      }
      if (typeof this.renderer.dispose === 'function') {
        this.renderer.dispose()
      }
    }

    this.scene = null
    this.camera = null
    this.renderer = null
    this.canvasHost = null

    return true
  }
}
