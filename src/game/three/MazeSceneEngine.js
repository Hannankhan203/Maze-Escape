import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { resolveWallPassStep } from '../mechanics/powerups.js'
import { placeEnvironmentalProps } from '../generation/environmentalPropPlacement.js'
import { isCellWalkable, moveWithSubsteps } from '../world/gridCollision.js'
import { buildPropCollisionIndex } from '../world/propCollision.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld, worldToGrid } from '../world/worldCoords.js'
import {
  applyEnvironmentToScene,
  buildEnvironment,
  DEFAULT_ENVIRONMENT_CONFIG,
  disposeEnvironment,
  stepEnvironmentAtmosphere,
  syncEnvironmentToMaze,
  updateEnvironmentConfig,
} from './buildEnvironment.js'
import {
  buildMazeMeshes,
  disposeMazeGroup,
  getExitGateDeckOffsetY,
  setExitGateSequenceState,
  setExitGateState,
  setStartElevatorSequenceState,
  triggerStartElevatorLandingDust,
  updateExitGate,
  updateStartElevator,
} from './buildMazeMeshes.js'
import {
  ELEVATOR_PALETTE,
  getElevatorColliderDescriptors,
  getElevatorFloorHeightAtWorld,
} from './buildElevators.js'
import {
  invalidateOverheadShadowCache,
  resolveOverheadShadowLightBudget,
  stepCeilingLights,
  syncCeilingLightsQuality,
} from './buildCeilingLights.js'
import { syncCeilingVentsQuality } from './buildCeilingVents.js'
import { syncCeilingElectricalQuality } from './buildCeilingElectrical.js'
import {
  syncElevatorShaftsQuality,
  syncExtractionShaftState,
} from './buildElevatorShafts.js'
import { syncEnvironmentalPropsQuality } from './buildEnvironmentalProps.js'
import { syncStructuralDeteriorationQuality } from './buildStructuralDeterioration.js'
import {
  syncMazeGroupSurfaceTextures,
  syncMazeSurfaceTextureAnisotropy,
  syncWorldSpaceConcreteQuality,
} from './mazeSurfaceTextures.js'
import {
  buildPlayer,
  disposePlayer,
  positionPlayerAtWorld,
  syncPlayerQuality,
} from './buildPlayer.js'
import { pruneUnusedPlayerTexturePools } from './playerTextures.js'
import { CAMERA_MODES, CameraRig } from './CameraRig.js'
import { CollectibleManager } from './CollectibleManager.js'
import { EnemyManager } from './EnemyManager.js'
import { HazardManager } from './HazardManager.js'
import { HidingSpotManager } from './HidingSpotManager.js'
import { HorrorAudioEngine } from './HorrorAudioEngine.js'
import { HorrorDirector } from './HorrorDirector.js'
import {
  ElevatorExitSequence,
  SPAWN_SEQUENCE_STAGES,
} from './ElevatorExitSequence.js'
import {
  EXTRACTION_SEQUENCE_STAGES,
  ElevatorExtractionSequence,
} from './ElevatorExtractionSequence.js'
import { PlayerAnimator } from './PlayerAnimator.js'
import {
  acquireSharedPools,
  getActiveSharedPoolOwnerCount,
  isSharedResource,
  releaseSharedPools,
} from './sharedResources.js'
import {
  applyHighContrastToScene,
  syncCollectibleHighContrast,
  syncEnemyHighContrast,
  syncExitGateOutlineColor,
} from './highContrastOutlines.js'
import {
  DEFAULT_GRAPHICS_SETTINGS,
  GRAPHICS_QUALITY_PRESETS,
  normalizeGraphicsSettings,
} from './threeConfig.js'

export const LUMEN_VAULT_SCENE_COLORS = {
  voidBackground: DEFAULT_ENVIRONMENT_CONFIG.backgroundColor,
  chamberSurface: 0x1c283d,
}

export const ACTIVE_FLASHLIGHT_INTENSITY = 11.5

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
  pixelRatioCap: undefined,
  antialias: undefined,
  powerPreference: 'high-performance',
  toneMappingExposure: 1.26,
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

/**
 * Detects low-performance or mobile/constrained hardware heuristics safely
 * without breaking headless/SSR environments.
 */
export function detectLowPerformanceDevice() {
  if (typeof navigator === 'undefined' && typeof window === 'undefined') {
    return false
  }

  try {
    const nav = typeof navigator !== 'undefined' ? navigator : null
    const cores = Number(nav?.hardwareConcurrency)
    const memoryGb = Number(nav?.deviceMemory)
    const ua = String(nav?.userAgent || '')
    const isMobileUa = /Mobi|Android|iPhone|iPad|iPod/i.test(ua)
    const isCoarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      Boolean(window.matchMedia('(pointer: coarse)').matches)

    if (Number.isFinite(memoryGb) && memoryGb > 0 && memoryGb <= 4) {
      return true
    }
    if (Number.isFinite(cores) && cores > 0 && cores <= 4 && (isMobileUa || isCoarsePointer)) {
      return true
    }
    return isMobileUa || isCoarsePointer
  } catch {
    return false
  }
}

export function resolvePerformanceProfile(config = {}, isSoftwareGl = false, isLowPerformance = false) {
  const hasExplicitGraphics = Boolean(config?.graphics && typeof config.graphics === 'object')
  const graphics = hasExplicitGraphics ? normalizeGraphicsSettings(config.graphics) : null
  const qualityPreset = graphics
    ? graphics.qualityPreset
    : isLowPerformance
      ? 'balanced'
      : 'high'
  const presetSpec = GRAPHICS_QUALITY_PRESETS[qualityPreset] || GRAPHICS_QUALITY_PRESETS.high

  const defaultPixelCap = isSoftwareGl
    ? 1
    : graphics
      ? presetSpec.pixelRatioCap
      : isLowPerformance
        ? 1.5
        : 2
  const maxAllowedCap = isSoftwareGl ? 1 : graphics ? 2 : isLowPerformance ? 1.5 : 2
  const pixelRatioCap =
    typeof config?.pixelRatioCap === 'number' && Number.isFinite(config.pixelRatioCap)
      ? Math.max(1, Math.min(maxAllowedCap, config.pixelRatioCap))
      : defaultPixelCap

  const defaultMaxLights = isSoftwareGl
    ? 0
    : graphics
      ? graphics.dynamicLights
        ? presetSpec.maxEnemyLights
        : 0
      : isLowPerformance
        ? 1
        : 2
  const maxEnemyLights =
    typeof config?.enemies?.maxEnemyLights === 'number' &&
    Number.isFinite(config.enemies.maxEnemyLights)
      ? Math.max(0, Math.floor(config.enemies.maxEnemyLights))
      : defaultMaxLights

  const particlesEnabled =
    typeof config?.environment?.particlesEnabled === 'boolean'
      ? config.environment.particlesEnabled
      : graphics
        ? graphics.particlesEnabled
        : !isSoftwareGl

  const particleCount =
    typeof config?.environment?.particleCount === 'number' &&
    Number.isFinite(config.environment.particleCount)
      ? Math.max(0, Math.floor(config.environment.particleCount))
      : !particlesEnabled
        ? 0
        : graphics
          ? presetSpec.particleCount
          : isSoftwareGl
            ? 0
            : isLowPerformance
              ? 45
              : DEFAULT_ENVIRONMENT_CONFIG.particleCount

  const antialias =
    typeof config?.antialias === 'boolean'
      ? config.antialias
      : graphics
        ? isSoftwareGl
          ? false
          : graphics.antialias
        : !isSoftwareGl && !isLowPerformance

  return {
    isSoftwareGl: Boolean(isSoftwareGl),
    isLowPerformance: Boolean(isLowPerformance),
    qualityPreset,
    pixelRatioCap,
    maxEnemyLights,
    particlesEnabled,
    particleCount,
    antialias,
  }
}

/**
 * Computes an adaptive timeout delay (ms) for timed/software WebGL loops based
 * on the measured frame cost rather than synchronous gl.fenceSync busy-polling.
 */
export function computeAdaptiveFrameDelayMs(renderDurationMs = 0, isPaused = false) {
  if (isPaused) {
    return 200
  }
  const safeDuration =
    typeof renderDurationMs === 'number' && Number.isFinite(renderDurationMs) && renderDurationMs > 0
      ? renderDurationMs
      : 0
  return Math.round(Math.min(180, Math.max(32, safeDuration * 1.5 + 16)))
}

function disposeMaterial(material) {
  if (!material || isSharedResource(material)) return
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
    if (tex && !isSharedResource(tex) && typeof tex.dispose === 'function') {
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
    this.isLowPerformance =
      typeof this.config.lowPerformance === 'boolean'
        ? this.config.lowPerformance
        : detectLowPerformanceDevice()
    this.graphicsConfig = normalizeGraphicsSettings(
      this.config.graphics || DEFAULT_GRAPHICS_SETTINGS
    )
    this.performanceProfile = resolvePerformanceProfile(
      this.config,
      this.isSoftwareGl,
      this.isLowPerformance
    )
    if (!this.config.graphics) {
      this.graphicsConfig.qualityPreset = this.performanceProfile.qualityPreset
      this.graphicsConfig.particlesEnabled = Boolean(this.performanceProfile.particlesEnabled)
    }
    this.graphicsConfig.antialias = Boolean(this.performanceProfile.antialias)
    acquireSharedPools(this)

    this.isRunning = false
    this.isPaused = false
    this.isDisposed = false
    this._frameId = null
    this._timeoutId = null
    this._lastTimestamp = 0
    this._elapsedSec = 0
    this._isSprintingThisTick = false
    this._currentMaze = null
    this._mazeGroup = null
    this._startElevatorGroup = null
    this._exitGateGroup = null
    this._ceilingLightsGroup = null
    this._cachedAmbientAnchors = null
    this._activeHorrorEventType = null
    this.isExitLocked = false
    this._playerGroup = null
    this._environment = null
    this._playerWorldPos = { x: 0, y: 0, z: 0 }
    this._dynamicShadowCasters = []
    this._dynamicShadowCasterPool = []
    this._flashlightShadowCache = {
      hasRendered: false,
      dirty: true,
      wasVisible: false,
      castShadow: false,
      mapSize: 0,
      hadShadowMap: false,
      lastLightX: NaN,
      lastLightY: NaN,
      lastLightZ: NaN,
      lastTargetX: NaN,
      lastTargetY: NaN,
      lastTargetZ: NaN,
      lastFov: 0,
      lastFar: 0,
      lastFocus: 0,
      lastCasterCount: -1,
      lastCasterHash: 0,
    }
    this._lastGridCell = null
    this._tmpForward = { x: 0, z: -1 }
    this._tmpRight = { x: 1, z: 0 }
    this._inputSource = null
    this._movementOptions = {}
    this._propCollisionIndex = null
    this.movementConfig = {
      ...DEFAULT_MOVEMENT_CONFIG,
      ...(this.config.movement || {}),
    }
    this._moveCollisionOptions = {
      radius: this.movementConfig.radius,
      propColliders: null,
    }
    this._motionSample = {
      moved: false,
      isSprinting: false,
      actualSpeed: 0,
      walkSpeed: this.movementConfig.walkSpeed,
      sprintSpeed: this.movementConfig.sprintSpeed,
    }
    this._playerAnimator = new PlayerAnimator(null, this.config.animation)
    this._elevatorExitSequence = new ElevatorExitSequence(this.config.spawnSequence)
    this._elevatorExtractionSequence = new ElevatorExtractionSequence(
      this.config.extractionSequence
    )
    this._steppingSpawnSequence = false
    this._steppingInFrame = false
    this._steppingExtractionSequence = false
    this._hasCompletedExtractionThisRun = false
    this._pendingExtractionCellChange = null
    this._lastNotifiedSpawnActive = false
    this._lastNotifiedExtractionActive = false
    this._startDescentCueFired = false
    this._startImpactCueFired = false
    this._extractionDoorsCloseCueFired = false
    this._extractionLockPauseCueFired = false
    this._extractionDepartCueFired = false
    this._onSpawnSequenceChange =
      typeof this.config.onSpawnSequenceChange === 'function'
        ? this.config.onSpawnSequenceChange
        : null
    this._onExtractionSequenceChange =
      typeof this.config.onExtractionSequenceChange === 'function'
        ? this.config.onExtractionSequenceChange
        : null
    this._onExtractionComplete =
      typeof this.config.onExtractionComplete === 'function'
        ? this.config.onExtractionComplete
        : null
    this._onFrame =
      typeof this.config.onFrame === 'function' ? this.config.onFrame : null
    this._framePayload = {
      delta: 0,
      elapsed: 0,
      scene: null,
      camera: null,
      cameraRig: null,
      renderer: null,
      health: 0,
      maxHealth: 0,
      stamina: 0,
      maxStamina: 0,
      isExhausted: false,
      flashlightActive: false,
      battery: 0,
      maxBattery: 0,
      isImmune: false,
      isSpawnSequenceActive: false,
      isExtractionSequenceActive: false,
      damageFeedbackAlpha: 0,
      isGameOver: false,
      playerGridCell: null,
      playerWorldPos: null,
      yaw: 0,
    }

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
    this._onCameraDistanceChange =
      typeof this.config.onCameraDistanceChange === 'function'
        ? this.config.onCameraDistanceChange
        : null

    this.scene = null
    this.camera = null
    this.cameraRig = null
    this.renderer = null
    this.spotlight = null
    this.spotlightTarget = null
    this.flashlightRig = null
    this.collectibleManager = null
    this.enemyManager = null
    this.hazardManager = null
    this.hidingSpotManager = null
    this.audioEngine = null
    this.horrorDirector = null
    this._envMapTarget = null
    this._envMapTexture = null

    try {
      const initialWidth = Math.max(1, Math.floor(canvasHost.clientWidth || 1))
      const initialHeight = Math.max(1, Math.floor(canvasHost.clientHeight || 1))

    this._cachedHidingSpotCells = []
    this.scene = new THREE.Scene()
    this.collectibleManager = new CollectibleManager(this.scene)
    this.enemyManager = new EnemyManager(this.scene, {
      autoSpawn: true,
      maxEnemyLights: this.performanceProfile.maxEnemyLights,
      particlesEnabled: this.performanceProfile.particlesEnabled,
      reducedMotion: Boolean(this.config.horrorDirector?.reducedMotion),
      ...(this.config.enemies || {}),
    })
    this.hazardManager = new HazardManager(this.scene)
    this.hidingSpotManager = new HidingSpotManager(this.scene)
    this.audioEngine = new HorrorAudioEngine(this.config.audio)

    const initialFovRaw = Number(this.config.fov ?? this.config.camera?.fov ?? DEFAULT_CONFIG.fov)
    const initialFov = Number.isFinite(initialFovRaw)
      ? Math.max(55, Math.min(85, initialFovRaw))
      : DEFAULT_CONFIG.fov
    this.config.fov = initialFov
    this.cameraShakeEnabled =
      typeof this.config.cameraShake === 'boolean'
        ? this.config.cameraShake
        : typeof this.config.camera?.cameraShake === 'boolean'
          ? this.config.camera.cameraShake
          : true

    this.camera = new THREE.PerspectiveCamera(
      initialFov,
      initialWidth / initialHeight,
      this.config.near,
      this.config.far
    )
    this.camera.rotation.order = 'YXZ'

    const initialCameraConfig = {
      ...(this.config.camera || {}),
      ...(typeof this.config.cameraMode === 'string'
        ? { mode: this.config.cameraMode }
        : {}),
      ...(typeof this.config.thirdPersonCameraMode === 'string'
        ? { thirdPersonCameraMode: this.config.thirdPersonCameraMode }
        : {}),
      ...(typeof this.config.thirdPersonMode === 'string'
        ? { thirdPersonMode: this.config.thirdPersonMode }
        : {}),
      ...(typeof this.config.cameraDistancePreset === 'string'
        ? { cameraDistancePreset: this.config.cameraDistancePreset }
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
    this.spotlight = new THREE.SpotLight(0xfff9e6, 0, 48, Math.PI * 0.31, 0.62, 1.35)
    this.spotlightTarget = new THREE.Object3D()
    this.spotlight.target = this.spotlightTarget
    this.flashlightRig = new THREE.Group()
    this.flashlightRig.name = 'player-flashlight-rig'
    this.flashlightRig.rotation.order = 'YXZ'
    this.scene.add(this.flashlightRig)
    if (!this.camera.parent) {
      this.scene.add(this.camera)
    }
    this._syncFlashlightRig()

    const initialEnvConfig = {
      fogEnabled: this.graphicsConfig.volumetricFog,
      particlesEnabled: this.performanceProfile.particlesEnabled,
      particleCount: this.performanceProfile.particleCount,
      localizedLightsEnabled: this.graphicsConfig.dynamicLights,
      qualityPreset: this.performanceProfile.qualityPreset,
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
        this._activeHorrorEventType = evt?.type || null
        this._onHorrorEvent?.(evt)
        this.config.horrorDirector?.onEvent?.(evt)
      },
      onEventEnd: (evt) => {
        if (!evt?.type || evt.type === this._activeHorrorEventType) {
          this._activeHorrorEventType = null
        }
        this.config.horrorDirector?.onEventEnd?.(evt)
      },
      onEventCancel: (evt) => {
        if (!evt?.type || evt.type === this._activeHorrorEventType) {
          this._activeHorrorEventType = null
        }
        this.config.horrorDirector?.onEventCancel?.(evt)
      },
    })

      this._envMapTarget = null
      this._envMapTexture = null
      this._activeAntialias = Boolean(this.performanceProfile.antialias)
      this._rendererCapabilities = {
        pixelRatioSupported: !this.isSoftwareGl,
        antialiasSupported: !this.isSoftwareGl,
        antialiasActive: this._activeAntialias,
      }
      this.renderer = this._createRendererInstance(this._activeAntialias)

      this.resize(initialWidth, initialHeight)

      if (
        this.renderer.domElement &&
        this.renderer.domElement.parentNode !== this.canvasHost
      ) {
        this.canvasHost.appendChild(this.renderer.domElement)
      }
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  _syncEnvironmentMap(renderer) {
    if (!this.scene) return
    if (this._envMapTarget || this._envMapTexture) {
      if (this.scene.environment === this._envMapTexture) {
        this.scene.environment = null
      }
      this._envMapTarget?.dispose?.()
      this._envMapTexture?.dispose?.()
      this._envMapTarget = null
      this._envMapTexture = null
    }
    if (!renderer?.isWebGLRenderer) return
    try {
      const pmremGenerator = new THREE.PMREMGenerator(renderer)
      const roomEnv = new RoomEnvironment()
      const target = pmremGenerator.fromScene(roomEnv, 0.04)
      this._envMapTarget = target
      this._envMapTexture = target.texture
      this.scene.environment = this._envMapTexture
      this.scene.environmentIntensity = 0.13
      roomEnv.dispose?.()
      pmremGenerator.dispose()
    } catch {
      // Ignore environment map errors on restricted/headless WebGL contexts
    }
  }

  invalidateFlashlightShadow(options = {}) {
    if (!this._flashlightShadowCache) return
    this._flashlightShadowCache.dirty = true
    if (options?.resetFirstRender) {
      this._flashlightShadowCache.hasRendered = false
    }
    if (this.spotlight?.shadow && this.spotlight.castShadow) {
      this.spotlight.shadow.needsUpdate = true
    }
  }

  _updateFlashlightShadowCache() {
    const cache = this._flashlightShadowCache
    const spot = this.spotlight
    const target = this.spotlightTarget
    if (!cache || !spot || !spot.shadow) return false

    const shadow = spot.shadow
    const shadowMapEnabled = this.renderer?.shadowMap
      ? Boolean(this.renderer.shadowMap.enabled)
      : true
    const isShadowActive = Boolean(spot.visible && spot.castShadow && shadowMapEnabled)

    if (!isShadowActive) {
      cache.wasVisible = false
      return false
    }

    if (shadow.map) {
      cache.hadShadowMap = true
    }

    spot.updateMatrixWorld?.(true)
    target?.updateMatrixWorld?.(true)

    const lm = spot.matrixWorld.elements
    const lx = lm[12]
    const ly = lm[13]
    const lz = lm[14]

    let tx = lx
    let ty = ly
    let tz = lz - 12
    if (target) {
      const tm = target.matrixWorld.elements
      tx = tm[12]
      ty = tm[13]
      tz = tm[14]
    }

    let dx = tx - lx
    let dy = ty - ly
    let dz = tz - lz
    const dirLen = Math.hypot(dx, dy, dz)
    if (dirLen > 1e-6) {
      dx /= dirLen
      dy /= dirLen
      dz /= dirLen
    } else {
      dx = 0
      dy = 0
      dz = -1
    }

    // Evaluate dynamic shadow casters within or near the spotlight shadow frustum
    const casters = this._collectDynamicShadowCasters()
    const shadowCam = shadow.camera
    const maxRange = (shadowCam?.far || 28) + 2.5
    const maxRangeSq = maxRange * maxRange
    let relevantCount = 0
    let sigHash = 0

    if (casters && casters.length > 0) {
      for (let i = 0; i < casters.length; i += 1) {
        const c = casters[i]
        if (!c) continue
        const vx = c.x - lx
        const vy = (c.y || 0) + 0.9 - ly
        const vz = c.z - lz
        const distSq = vx * vx + vy * vy + vz * vz
        if (distSq > maxRangeSq) continue
        if (distSq > 5.29) {
          const forwardDot = vx * dx + vy * dy + vz * dz
          if (forwardDot < 0.62 * Math.sqrt(distSq)) continue
        }
        relevantCount += 1
        const qx = Math.round(c.x * 32)
        const qy = Math.round((c.y || 0) * 32)
        const qz = Math.round(c.z * 32)
        const qr = Math.round((c.ry || 0) * 16)
        sigHash =
          (sigHash +
            ((qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791) ^ (qr * 49979687))) |
          0
      }
    }

    const lightDeltaSq = Number.isFinite(cache.lastLightX)
      ? (lx - cache.lastLightX) * (lx - cache.lastLightX) +
        (ly - cache.lastLightY) * (ly - cache.lastLightY) +
        (lz - cache.lastLightZ) * (lz - cache.lastLightZ)
      : Infinity
    const targetDeltaSq = Number.isFinite(cache.lastTargetX)
      ? (tx - cache.lastTargetX) * (tx - cache.lastTargetX) +
        (ty - cache.lastTargetY) * (ty - cache.lastTargetY) +
        (tz - cache.lastTargetZ) * (tz - cache.lastTargetZ)
      : Infinity

    const poseChanged = lightDeltaSq >= 1e-6 || targetDeltaSq >= 1e-6
    const fov = shadowCam?.fov || 0
    const far = shadowCam?.far || 0
    const focus = shadow.focus || 0
    const cameraChanged =
      fov !== cache.lastFov || far !== cache.lastFar || focus !== cache.lastFocus
    const castersDirty =
      (relevantCount > 0 &&
        (relevantCount !== cache.lastCasterCount || sigHash !== cache.lastCasterHash)) ||
      (relevantCount === 0 && cache.lastCasterCount > 0)
    const mapRecreatedNeeded = cache.hadShadowMap && !shadow.map

    const needsInvalidation =
      cache.dirty ||
      !cache.hasRendered ||
      !cache.wasVisible ||
      mapRecreatedNeeded ||
      poseChanged ||
      cameraChanged ||
      castersDirty

    if (needsInvalidation) {
      shadow.needsUpdate = true
      cache.dirty = false
      cache.hasRendered = true
      cache.lastLightX = lx
      cache.lastLightY = ly
      cache.lastLightZ = lz
      cache.lastTargetX = tx
      cache.lastTargetY = ty
      cache.lastTargetZ = tz
      cache.lastFov = fov
      cache.lastFar = far
      cache.lastFocus = focus
      cache.lastCasterCount = relevantCount
      cache.lastCasterHash = sigHash
    }

    cache.wasVisible = true
    return needsInvalidation
  }

  _syncFlashlightShadowSettings() {
    if (!this.spotlight) return
    const shadowsEnabled =
      !this.isSoftwareGl && this.graphicsConfig?.qualityPreset !== 'performance'
    const wasEnabled = Boolean(this.spotlight.castShadow)
    this.spotlight.castShadow = shadowsEnabled
    if (this.spotlight.shadow) {
      this.spotlight.shadow.autoUpdate = false
      const targetSize = this.graphicsConfig?.qualityPreset === 'high' ? 1024 : 512
      let mapResized = false
      if (this.spotlight.shadow.mapSize) {
        if (
          this.spotlight.shadow.mapSize.width !== targetSize ||
          this.spotlight.shadow.mapSize.height !== targetSize
        ) {
          this.spotlight.shadow.mapSize.set(targetSize, targetSize)
          mapResized = true
          if (this.spotlight.shadow.map) {
            this.spotlight.shadow.map.dispose?.()
            this.spotlight.shadow.map = null
          }
          if (this._flashlightShadowCache) {
            this._flashlightShadowCache.hadShadowMap = false
          }
        }
      }
      this.spotlight.shadow.focus = 0.54
      if (this.spotlight.shadow.camera) {
        this.spotlight.shadow.camera.near = 0.25
        this.spotlight.shadow.camera.far = 28
        this.spotlight.shadow.camera.fov = 60
        this.spotlight.shadow.camera.updateProjectionMatrix?.()
      }
      this.spotlight.shadow.bias = -0.0006
      this.spotlight.shadow.normalBias = 0.025
      this.spotlight.shadow.radius = 1.6

      if (!shadowsEnabled) {
        this.spotlight.shadow.needsUpdate = false
        if (this._flashlightShadowCache) {
          this._flashlightShadowCache.castShadow = false
          this._flashlightShadowCache.mapSize = targetSize
          this._flashlightShadowCache.dirty = true
        }
      } else if (
        !wasEnabled ||
        mapResized ||
        !this._flashlightShadowCache?.hasRendered ||
        this._flashlightShadowCache?.mapSize !== targetSize
      ) {
        this.invalidateFlashlightShadow({ resetFirstRender: true })
        if (this._flashlightShadowCache) {
          this._flashlightShadowCache.castShadow = true
          this._flashlightShadowCache.mapSize = targetSize
        }
      }
    }
  }

  _applyRendererSettings(renderer, requestedAntialias) {
    if (!renderer) return
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = this.config.toneMappingExposure
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled =
        !this.isSoftwareGl && this.graphicsConfig?.qualityPreset !== 'performance'
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.shadowMap.needsUpdate = true
    }
    this._syncFlashlightShadowSettings()
    this._syncEnvironmentMap(renderer)
    syncMazeSurfaceTextureAnisotropy(renderer)

    let resolvedAntialias = Boolean(requestedAntialias)
    try {
      const gl = typeof renderer.getContext === 'function' ? renderer.getContext() : null
      const attrs =
        gl && typeof gl.getContextAttributes === 'function'
          ? gl.getContextAttributes()
          : null
      if (attrs && typeof attrs.antialias === 'boolean') {
        resolvedAntialias = attrs.antialias
        if (requestedAntialias && !attrs.antialias) {
          this._rendererCapabilities.antialiasSupported = false
        } else if (attrs.antialias) {
          this._rendererCapabilities.antialiasSupported = true
        }
      } else if (!this.isSoftwareGl) {
        this._rendererCapabilities.antialiasSupported = true
      }
    } catch {
      // Ignore context attribute inspection errors on restricted/headless contexts
    }

    this._activeAntialias = resolvedAntialias
    this._rendererCapabilities.antialiasActive = resolvedAntialias
  }

  _createRendererInstance(antialias) {
    const rendererOptions = {
      antialias: Boolean(antialias),
      powerPreference: this.config.powerPreference,
    }

    let renderer
    if (typeof this.config.createRenderer === 'function') {
      renderer = this.config.createRenderer(rendererOptions)
    } else {
      try {
        renderer = new THREE.WebGLRenderer(rendererOptions)
      } catch (error) {
        if (rendererOptions.antialias) {
          this._rendererCapabilities.antialiasSupported = false
          renderer = new THREE.WebGLRenderer({
            ...rendererOptions,
            antialias: false,
          })
        } else {
          throw error
        }
      }
    }

    this._applyRendererSettings(renderer, rendererOptions.antialias)
    return renderer
  }

  _recreateRenderer(antialias) {
    if (this.isDisposed || !this.canvasHost) {
      return {
        applied: false,
        supported: Boolean(this._rendererCapabilities?.antialiasSupported),
      }
    }

    const prevRenderer = this.renderer
    const requested = Boolean(antialias)
    const rendererOptions = {
      antialias: requested,
      powerPreference: this.config.powerPreference,
    }

    let nextRenderer
    try {
      nextRenderer =
        typeof this.config.createRenderer === 'function'
          ? this.config.createRenderer(rendererOptions)
          : new THREE.WebGLRenderer(rendererOptions)
    } catch {
      this._rendererCapabilities.antialiasSupported = false
      this._rendererCapabilities.antialiasActive = this._activeAntialias
      return { applied: false, supported: false }
    }

    if (!nextRenderer) {
      this._rendererCapabilities.antialiasSupported = false
      this._rendererCapabilities.antialiasActive = this._activeAntialias
      return { applied: false, supported: false }
    }

    if (nextRenderer !== prevRenderer && prevRenderer) {
      const prevDom = prevRenderer.domElement
      if (prevDom && prevDom.parentNode === this.canvasHost) {
        this.canvasHost.removeChild(prevDom)
      }
      if (typeof prevRenderer.dispose === 'function') {
        prevRenderer.dispose()
      }
    }

    if (this.spotlight?.shadow?.map) {
      this.spotlight.shadow.map.dispose?.()
      this.spotlight.shadow.map = null
    }
    if (this._flashlightShadowCache) {
      this._flashlightShadowCache.hadShadowMap = false
    }

    this.renderer = nextRenderer
    this._applyRendererSettings(nextRenderer, requested)
    this.invalidateFlashlightShadow({ resetFirstRender: true })
    invalidateOverheadShadowCache(this._ceilingLightsGroup || this._mazeGroup)
    this.resize(undefined, undefined, { render: false })

    if (
      this.renderer.domElement &&
      this.renderer.domElement.parentNode !== this.canvasHost
    ) {
      this.canvasHost.appendChild(this.renderer.domElement)
    }

    return {
      applied: true,
      supported: Boolean(this._rendererCapabilities.antialiasSupported),
      antialiasActive: this._activeAntialias,
    }
  }

  getGraphicsConfig() {
    return { ...this.graphicsConfig }
  }

  getRendererCapabilities() {
    return { ...this._rendererCapabilities }
  }

  setHighContrast(enabled) {
    if (this.isDisposed) return false
    const next = Boolean(enabled)
    this.graphicsConfig.highContrast = next
    applyHighContrastToScene({
      mazeGroup: this._mazeGroup,
      collectibleManager: this.collectibleManager,
      hazardManager: this.hazardManager,
      hidingSpotManager: this.hidingSpotManager,
      enemyManager: this.enemyManager,
      enabled: next,
    })
    this._syncCeilingLights()
    if (this.isPaused) {
      this.renderFrame()
    }
    return next
  }

  updateGraphicsConfig(partialConfig = {}) {
    if (this.isDisposed || !this.scene || !partialConfig || typeof partialConfig !== 'object') {
      return this.getGraphicsConfig()
    }

    const prevQualityPreset = this.graphicsConfig?.qualityPreset
    const prevDynamicLights = this.graphicsConfig?.dynamicLights
    const prevHighContrast = this.graphicsConfig?.highContrast

    const next = normalizeGraphicsSettings({
      ...this.graphicsConfig,
      ...partialConfig,
    })
    const preset =
      GRAPHICS_QUALITY_PRESETS[next.qualityPreset] || GRAPHICS_QUALITY_PRESETS.high

    const nextPixelRatioCap = this.isSoftwareGl ? 1 : preset.pixelRatioCap
    const nextParticleCount = next.particlesEnabled ? preset.particleCount : 0
    const nextMaxEnemyLights =
      this.isSoftwareGl || !next.dynamicLights ? 0 : preset.maxEnemyLights
    const effectiveAntialias = this.isSoftwareGl ? false : next.antialias

    this.graphicsConfig = next
    this.performanceProfile = {
      ...this.performanceProfile,
      qualityPreset: next.qualityPreset,
      pixelRatioCap: nextPixelRatioCap,
      particlesEnabled: next.particlesEnabled,
      particleCount: nextParticleCount,
      maxEnemyLights: nextMaxEnemyLights,
      antialias: effectiveAntialias,
    }

    this.updateEnvironment({
      fogEnabled: next.volumetricFog,
      particlesEnabled: next.particlesEnabled,
      particleCount: nextParticleCount,
      localizedLightsEnabled: next.dynamicLights,
      qualityPreset: next.qualityPreset,
    })

    this.enemyManager?.setMaxEnemyLights?.(nextMaxEnemyLights)
    this.enemyManager?.setParticlesEnabled?.(next.particlesEnabled)
    syncWorldSpaceConcreteQuality(this._mazeGroup, next.qualityPreset)
    syncWorldSpaceConcreteQuality(this._environment?.group, next.qualityPreset)
    syncMazeGroupSurfaceTextures(this._mazeGroup, next.qualityPreset)
    syncEnvironmentalPropsQuality(
      this._mazeGroup?.userData?.environmentalPropsGroup ||
        this._mazeGroup?.getObjectByName?.('maze-environmental-props'),
      next.qualityPreset
    )
    syncStructuralDeteriorationQuality(
      this._mazeGroup?.userData?.structuralDeteriorationGroup ||
        this._mazeGroup?.getObjectByName?.('maze-structural-deterioration'),
      next.qualityPreset
    )
    syncCeilingVentsQuality(
      this._mazeGroup?.userData?.ceilingVentsGroup ||
        this._mazeGroup?.getObjectByName?.('maze-ceiling-vents-group'),
      next.qualityPreset
    )
    syncCeilingElectricalQuality(
      this._mazeGroup?.userData?.ceilingElectricalGroup ||
        this._mazeGroup?.getObjectByName?.('maze-ceiling-electrical-group'),
      next.qualityPreset
    )
    syncCeilingLightsQuality(
      this._ceilingLightsGroup ||
        this._mazeGroup?.userData?.ceilingLightsGroup ||
        this._mazeGroup?.getObjectByName?.('maze-ceiling-lights-group'),
      next.qualityPreset
    )
    syncElevatorShaftsQuality(
      this._elevatorShaftsGroup ||
        this._mazeGroup?.userData?.elevatorShaftsGroup ||
        this._mazeGroup?.getObjectByName?.('maze-elevator-shafts-group'),
      next.qualityPreset
    )
    if (this._elevatorShaftsGroup) {
      const exState = this._elevatorExtractionSequence?.getState?.()
      syncExtractionShaftState(this._elevatorShaftsGroup, {
        isLocked: this.isExitLocked,
        stage: exState?.stage || EXTRACTION_SEQUENCE_STAGES.IDLE,
        departureProgress: exState?.departureProgress || 0,
        reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
        localizedLightsEnabled: next.dynamicLights !== false,
      })
    }
    if (this._playerGroup) {
      syncPlayerQuality(this._playerGroup, next.qualityPreset)
    }
    if (
      prevQualityPreset !== next.qualityPreset &&
      getActiveSharedPoolOwnerCount() <= 1
    ) {
      pruneUnusedPlayerTexturePools(next.qualityPreset)
    }
    if (this.renderer) {
      syncMazeSurfaceTextureAnisotropy(this.renderer)
    }

    if (effectiveAntialias !== this._activeAntialias) {
      const result = this._recreateRenderer(effectiveAntialias)
      if (!result.applied) {
        this.performanceProfile.antialias = this._activeAntialias
      }
    } else if (this.renderer?.shadowMap) {
      const nextShadowsEnabled = !this.isSoftwareGl && next.qualityPreset !== 'performance'
      const shadowStateChanged = this.renderer.shadowMap.enabled !== nextShadowsEnabled
      this.renderer.shadowMap.enabled = nextShadowsEnabled
      if (shadowStateChanged) {
        this.renderer.shadowMap.needsUpdate = true
      }
    }
    this._syncFlashlightShadowSettings()

    this.resize(undefined, undefined, { render: false })

    applyHighContrastToScene({
      mazeGroup: this._mazeGroup,
      collectibleManager: this.collectibleManager,
      hazardManager: this.hazardManager,
      hidingSpotManager: this.hidingSpotManager,
      enemyManager: this.enemyManager,
      enabled: next.highContrast,
    })
    if (this._environment) {
      stepEnvironmentAtmosphere(this._environment, this._elapsedSec, {
        reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
      })
    }
    if (
      prevQualityPreset !== next.qualityPreset ||
      prevDynamicLights !== next.dynamicLights ||
      prevHighContrast !== next.highContrast
    ) {
      invalidateOverheadShadowCache(this._ceilingLightsGroup || this._mazeGroup)
    }
    this._syncCeilingLights()
    this._updateFlashlightShadowCache()

    if (this.isPaused) {
      this.renderFrame()
    }

    return this.getGraphicsConfig()
  }

  _collectDynamicShadowCasters() {
    const out = this._dynamicShadowCasters
    const pool = this._dynamicShadowCasterPool
    if (!out || !pool) return null
    let count = 0
    const pushCaster = (x, y, z, ry = 0) => {
      let entry = pool[count]
      if (!entry) {
        entry = { x: 0, y: 0, z: 0, ry: 0 }
        pool[count] = entry
      }
      entry.x = x
      entry.y = y
      entry.z = z
      entry.ry = ry
      out[count] = entry
      count += 1
    }

    if (this._playerGroup?.visible) {
      pushCaster(
        this._playerWorldPos.x,
        this._playerWorldPos.y,
        this._playerWorldPos.z,
        this._playerGroup.rotation?.y || 0
      )
    }

    const enemies = this.enemyManager?.enemies
    if (enemies && enemies.size > 0) {
      for (const enemy of enemies.values()) {
        const mesh = enemy?.mesh
        if (!mesh || !mesh.visible) continue
        pushCaster(mesh.position.x, mesh.position.y, mesh.position.z, mesh.rotation?.y || 0)
      }
    }

    const hidingSpots = this.hidingSpotManager?.spots
    if (hidingSpots && hidingSpots.size > 0) {
      for (const spot of hidingSpots.values()) {
        const pivot = spot?.mesh?.userData?.doorPivot
        if (!pivot || !spot?.worldPos) continue
        pushCaster(spot.worldPos.x, 0, spot.worldPos.z, pivot.rotation?.y || 0)
      }
    }

    out.length = count
    return out
  }

  _syncCeilingLights(lightScaleOverride = null) {
    const lightsTarget = this._ceilingLightsGroup || this._mazeGroup
    if (!lightsTarget) return false
    let lightScale = lightScaleOverride
    if (!Number.isFinite(lightScale)) {
      const baseAmbient = this._environment?.config?.ambientIntensity || 1
      const currentAmbient = this._environment?.lights?.ambientLight?.intensity ?? baseAmbient
      lightScale = baseAmbient > 1e-4 ? currentAmbient / baseAmbient : 1
    }
    const overheadShadowBudget = resolveOverheadShadowLightBudget({
      qualityPreset: this.graphicsConfig?.qualityPreset,
      dynamicLights: this.graphicsConfig?.dynamicLights,
      isSoftwareGl: this.isSoftwareGl,
    })
    const dynamicShadowCasters =
      overheadShadowBudget > 0 ? this._collectDynamicShadowCasters() : null
    return stepCeilingLights(lightsTarget, this._elapsedSec, {
      playerWorldPos: this._playerWorldPos,
      lightScale,
      reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
      highContrast: Boolean(this.graphicsConfig?.highContrast),
      qualityPreset: this.graphicsConfig?.qualityPreset,
      dynamicLights: this.graphicsConfig?.dynamicLights,
      isSoftwareGl: this.isSoftwareGl,
      dynamicShadowCasters,
    })
  }

  getEnvironment() {
    return this._environment
  }

  clearEnvironment() {
    if (this._environment) {
      this._environment.onLightScaleChange = null
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
    env.onLightScaleChange = (scale) => {
      this._syncCeilingLights(scale)
    }
    this._environment = env
    applyEnvironmentToScene(this.scene, env)
    this.horrorDirector?.setEnvironment(env)
    this._syncCeilingLights(1)
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
    const enemy = this.enemyManager ? this.enemyManager.spawnEnemy(options) : null
    if (enemy && this.graphicsConfig?.highContrast) {
      syncEnemyHighContrast(enemy.getMesh?.(), true)
    }
    return enemy
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
    if (this.graphicsConfig?.highContrast) {
      for (const entry of this.collectibleManager.coins?.values?.() || []) {
        syncCollectibleHighContrast(entry.mesh, true)
      }
      for (const entry of this.collectibleManager.powerUps?.values?.() || []) {
        syncCollectibleHighContrast(entry.mesh, true)
      }
      for (const entry of this.collectibleManager.keycards?.values?.() || []) {
        syncCollectibleHighContrast(entry.mesh, true)
      }
      for (const entry of this.collectibleManager.echoMarkers?.values?.() || []) {
        syncCollectibleHighContrast(entry.mesh, true)
      }
    }
  }

  syncEchoPath(echoPath = []) {
    if (this.isDisposed || !this.collectibleManager) return
    this.collectibleManager.syncEchoPath(echoPath, this._currentMaze)
    if (this.graphicsConfig?.highContrast) {
      for (const entry of this.collectibleManager.echoMarkers?.values?.() || []) {
        syncCollectibleHighContrast(entry.mesh, true)
      }
    }
  }

  setExitLocked(locked, options = {}) {
    if (this.isDisposed) return false
    const nextLocked = Boolean(locked)
    const wasLocked = this.isExitLocked
    this.isExitLocked = nextLocked

    if (nextLocked && this.isExtractionSequenceActive()) {
      this.cancelExtractionSequence()
    }

    if (this._exitGateGroup) {
      setExitGateState(this._exitGateGroup, nextLocked, options)
      if (wasLocked !== nextLocked) {
        invalidateOverheadShadowCache(this._ceilingLightsGroup || this._mazeGroup)
        this.invalidateFlashlightShadow()
      }
    }
    if (this.graphicsConfig?.highContrast) {
      syncExitGateOutlineColor(
        this._exitGateGroup,
        nextLocked,
        this._elevatorShaftsGroup
      )
    }

    if (this._environment?.lights?.exitLight) {
      const exitLight = this._environment.lights.exitLight
      exitLight.color.setHex(
        nextLocked
          ? ELEVATOR_PALETTE.exitLockedAccent
          : ELEVATOR_PALETTE.exitUnlockedAccent
      )
      if (!this.isExtractionSequenceActive()) {
        const envCfg = this._environment.config || DEFAULT_ENVIRONMENT_CONFIG
        const localizedEnabled = envCfg.localizedLightsEnabled !== false
        const baseIntensity = localizedEnabled
          ? Number.isFinite(envCfg.exitLightIntensity)
            ? envCfg.exitLightIntensity
            : DEFAULT_ENVIRONMENT_CONFIG.exitLightIntensity
          : 0
        exitLight.intensity = baseIntensity
      }
    }

    if (this._elevatorShaftsGroup) {
      const exState = this._elevatorExtractionSequence?.getState?.()
      syncExtractionShaftState(this._elevatorShaftsGroup, {
        isLocked: nextLocked,
        stage: exState?.stage || EXTRACTION_SEQUENCE_STAGES.IDLE,
        departureProgress: exState?.departureProgress || 0,
        reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
        localizedLightsEnabled:
          this._environment?.config?.localizedLightsEnabled !== false,
      })
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
    if (!this.hasWon) {
      this._hasCompletedExtractionThisRun = false
    }
    this.audioEngine?.setHasWon?.(this.hasWon)
    if (this.hasWon) {
      this._activeHorrorEventType = null
      this._motionSample.moved = false
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = 0
      this.horrorDirector?.setPaused(true)
    } else {
      this.horrorDirector?.setPaused(Boolean(this.isPaused))
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

  getAudioOptions() {
    return this.audioEngine ? this.audioEngine.getAudioOptions() : null
  }

  setAudioOptions(partial = {}) {
    if (this.isDisposed || !this.audioEngine) return null
    return this.audioEngine.setAudioOptions(partial)
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
    const updated = this.horrorDirector.updateConfig(partial)
    this.enemyManager?.setReducedMotion?.(Boolean(this.horrorDirector.reducedMotion))
    if (this._startElevatorGroup?.userData) {
      this._startElevatorGroup.userData.reducedMotion = Boolean(
        this.horrorDirector.reducedMotion
      )
    }
    if (this._exitGateGroup?.userData) {
      this._exitGateGroup.userData.reducedMotion = Boolean(this.horrorDirector.reducedMotion)
    }
    this._activeHorrorEventType = this.horrorDirector._activeEvent?.type || null
    this._syncCeilingLights()
    return updated
  }

  setHorrorConfig(partial = {}) {
    return this.updateHorrorConfig(partial)
  }

  setHorrorPaused(paused) {
    if (this.isDisposed || !this.horrorDirector) return
    this.horrorDirector.setPaused(paused)
  }

  getPaused() {
    return Boolean(this.isPaused)
  }

  setPaused(paused) {
    if (this.isDisposed) return
    const nextPaused = Boolean(paused)
    const wasPaused = Boolean(this.isPaused)
    this.isPaused = nextPaused
    if (nextPaused) {
      this._motionSample.moved = false
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = 0
      this._isSprintingThisTick = false
    } else if (wasPaused) {
      this._lastTimestamp =
        typeof performance !== 'undefined' ? performance.now() : Date.now()
    }
    this.audioEngine?.setPaused(nextPaused)
    this.horrorDirector?.setPaused(nextPaused)
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
      this.hasWon ||
      this.isSpawnSequenceActive() ||
      this.isExtractionSequenceActive() ||
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
      this.cameraRig.snap()
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

    const restoreYaw = Number.isFinite(result?.restoreYaw) ? result.restoreYaw : undefined

    if (options?.restorePosition !== false && result?.exitPos) {
      const floorY = getElevatorFloorHeightAtWorld(
        result.exitPos.x,
        result.exitPos.z,
        this._currentMaze
      )
      this.setPlayerWorldPosition(
        result.exitPos.x,
        floorY,
        result.exitPos.z,
        {
          immediate: Boolean(options?.immediate),
          yaw: restoreYaw,
        }
      )
    } else {
      const floorY = getElevatorFloorHeightAtWorld(
        this._playerWorldPos.x,
        this._playerWorldPos.z,
        this._currentMaze
      )
      this._playerWorldPos.y = floorY
      this.cameraRig?.setPlayerPosition(
        this._playerWorldPos.x,
        floorY,
        this._playerWorldPos.z
      )
      if (restoreYaw !== undefined) {
        this.cameraRig?.setLookDirection(restoreYaw, 0)
        if (options?.immediate) {
          this.cameraRig?.snap()
        }
      }
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
    if (
      this.isDisposed ||
      this.isGameOver ||
      !this._currentMaze ||
      this.isSpawnSequenceActive() ||
      this.isExtractionSequenceActive()
    ) {
      return { handled: false, action: null }
    }

    if (this.isHidden) {
      const res = this.exitHidingSpot()
      return { handled: res.exited, action: res.exited ? 'exit' : null, spot: res.spot }
    }

    const res = this.enterHidingSpot()
    if (res.entered) {
      return { handled: true, action: 'enter', spot: res.spot }
    }

    if (this._currentMaze?.exit && !this.hasWon) {
      const playerCell = this.getPlayerGridCell()
      const isAdjacentWalkable = Boolean(
        playerCell &&
          isCellWalkable(playerCell.row, playerCell.col, this._currentMaze) &&
          Math.abs(playerCell.row - this._currentMaze.exit.row) +
            Math.abs(playerCell.col - this._currentMaze.exit.col) <=
            1
      )
      const exitWorld = gridToWorld(
        this._currentMaze.exit.row,
        this._currentMaze.exit.col,
        this._currentMaze
      )
      if (exitWorld && isAdjacentWalkable) {
        const dist = Math.hypot(
          this._playerWorldPos.x - exitWorld.x,
          this._playerWorldPos.z - exitWorld.z
        )
        if (dist <= CELL_SIZE * 0.72) {
          if (this.isExitLocked) {
            this.audioEngine?.onLockedExit?.()
            return { handled: true, action: 'locked_exit', spot: null }
          }
          if (
            !this._hasCompletedExtractionThisRun &&
            !this.config?.skipExtractionSequence &&
            this.startExtractionSequence({ forceNotify: true })
          ) {
            return { handled: true, action: 'extract', spot: null }
          }
        }
      }
    }

    return { handled: false, action: null, spot: res.spot }
  }

  _notifySpawnSequenceChange(force = false) {
    const active = this.isSpawnSequenceActive()
    if (!force && active === this._lastNotifiedSpawnActive) {
      return
    }
    this._lastNotifiedSpawnActive = active
    this._onSpawnSequenceChange?.(active, this.getSpawnSequenceState())
  }

  setOnSpawnSequenceChange(callback) {
    this._onSpawnSequenceChange =
      typeof callback === 'function' ? callback : null
    if (!this.isDisposed) {
      this._notifySpawnSequenceChange(true)
    }
  }

  isSpawnSequenceActive() {
    return Boolean(!this.isDisposed && this._elevatorExitSequence?.isActive?.())
  }

  getSpawnSequenceState() {
    return this._elevatorExitSequence
      ? this._elevatorExitSequence.getState()
      : null
  }

  startSpawnSequence(options = {}) {
    if (this.isDisposed || !this._currentMaze || !this._elevatorExitSequence) {
      return false
    }
    const maze = this._currentMaze
    const startWorld = maze.start
      ? gridToWorld(maze.start.row, maze.start.col, maze)
      : null
    if (!startWorld) {
      return false
    }

    const spawnY = getElevatorFloorHeightAtWorld(startWorld.x, startWorld.z, maze)
    const initialYaw = Number.isFinite(this._currentInitialYaw)
      ? this._currentInitialYaw
      : 0

    this._startDescentCueFired = false
    this._startImpactCueFired = false
    this.audioEngine?.stopElevatorCues?.({ immediate: true })

    const started = this._elevatorExitSequence.start(maze, {
      exitYaw: initialYaw,
      walkSpeed: this.movementConfig.walkSpeed,
      ...options,
    })

    const seqState = this._elevatorExitSequence.getState()
    const posX = started && seqState ? seqState.x : startWorld.x
    const posY = started && seqState ? seqState.y : spawnY
    const posZ = started && seqState ? seqState.z : startWorld.z
    const facingYaw = started && seqState ? seqState.yaw : initialYaw

    this._playerWorldPos.x = posX
    this._playerWorldPos.y = posY
    this._playerWorldPos.z = posZ
    this._lastGridCell = maze.start
      ? { row: maze.start.row, col: maze.start.col }
      : worldToGrid(posX, posZ, maze)
    this._motionSample.moved = false
    this._motionSample.isSprinting = false
    this._motionSample.actualSpeed = 0
    this._isSprintingThisTick = false
    this._playerAnimator?.reset()

    if (this.cameraRig) {
      this.cameraRig.setPlayerPosition(posX, posY, posZ)
      if (options?.resetCamera !== false) {
        this.cameraRig.setLookDirection(initialYaw, 0)
      }
      this.cameraRig.snap()
    }

    if (this._playerGroup) {
      positionPlayerAtWorld(
        this._playerGroup,
        posX,
        posY,
        posZ,
        facingYaw
      )
    }

    if (this._startElevatorGroup) {
      setStartElevatorSequenceState(this._startElevatorGroup, {
        stage: started && seqState ? seqState.stage : SPAWN_SEQUENCE_STAGES.IDLE,
        elevatorY: started && seqState ? seqState.elevatorY : 0,
        vibrationY: started && seqState ? seqState.vibrationY : 0,
        reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
      })
    }

    this._syncFlashlightRig()
    this._updateFlashlightShadowCache()
    this._notifySpawnSequenceChange(Boolean(options?.forceNotify))
    return started
  }

  restartSpawnSequence(options = {}) {
    return this.startSpawnSequence({
      resetCamera: true,
      forceNotify: true,
      ...options,
    })
  }

  cancelSpawnSequence(options = {}) {
    if (!this._elevatorExitSequence) return false
    const wasActive = this._elevatorExitSequence.cancel()
    this._startDescentCueFired = false
    this._startImpactCueFired = false
    this.audioEngine?.stopElevatorCues?.({ immediate: true })
    if (this._startElevatorGroup) {
      setStartElevatorSequenceState(this._startElevatorGroup, {
        stage: SPAWN_SEQUENCE_STAGES.IDLE,
        elevatorY: 0,
        vibrationY: 0,
      })
    }
    if (wasActive && this._currentMaze) {
      const floorY = getElevatorFloorHeightAtWorld(
        this._playerWorldPos.x,
        this._playerWorldPos.z,
        this._currentMaze
      )
      this._playerWorldPos.y = floorY
      if (this._playerGroup) {
        this._playerGroup.position.y = floorY
      }
      this.cameraRig?.setPlayerPosition(
        this._playerWorldPos.x,
        floorY,
        this._playerWorldPos.z
      )
      this._syncFlashlightRig()
    }
    if (options?.syncYaw !== false && this._playerGroup && this.cameraRig) {
      this._playerGroup.rotation.y = this.cameraRig.getLookDirection().yaw
    }
    this.cameraRig?.setShakePitch?.(0)
    this.cameraRig?.setShakeRoll?.(0)
    if (this._playerGroup) {
      this._playerAnimator?.update(0, this._motionSample)
    }
    if (options?.notify !== false) {
      this._notifySpawnSequenceChange(Boolean(options?.forceNotify))
    } else {
      this._lastNotifiedSpawnActive = false
    }
    return wasActive
  }

  _notifyExtractionSequenceChange(force = false) {
    const active = this.isExtractionSequenceActive()
    if (!force && active === this._lastNotifiedExtractionActive) {
      return
    }
    this._lastNotifiedExtractionActive = active
    this._onExtractionSequenceChange?.(active, this.getExtractionSequenceState())
  }

  setOnExtractionSequenceChange(callback) {
    this._onExtractionSequenceChange =
      typeof callback === 'function' ? callback : null
    if (!this.isDisposed) {
      this._notifyExtractionSequenceChange(true)
    }
  }

  setOnExtractionComplete(callback) {
    this._onExtractionComplete =
      typeof callback === 'function' ? callback : null
  }

  isExtractionSequenceActive() {
    return Boolean(!this.isDisposed && this._elevatorExtractionSequence?.isActive?.())
  }

  getExtractionSequenceState() {
    return this._elevatorExtractionSequence
      ? this._elevatorExtractionSequence.getState()
      : null
  }

  _syncExtractionElevatorVisuals(
    stage,
    doorCloseProgress = 0,
    departureProgress = 0,
    elevatorY = 0
  ) {
    if (this._exitGateGroup) {
      setExitGateSequenceState(this._exitGateGroup, {
        stage,
        doorCloseProgress,
        departureProgress,
        elevatorY,
        reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
      })
    }
    if (this._environment?.lights?.exitLight && !this.isExitLocked) {
      const exitLight = this._environment.lights.exitLight
      const envCfg = this._environment.config || DEFAULT_ENVIRONMENT_CONFIG
      const localizedEnabled = envCfg.localizedLightsEnabled !== false
      const baseIntensity = localizedEnabled
        ? Number.isFinite(envCfg.exitLightIntensity)
          ? envCfg.exitLightIntensity
          : DEFAULT_ENVIRONMENT_CONFIG.exitLightIntensity
        : 0
      if (
        stage === EXTRACTION_SEQUENCE_STAGES.DOORS_CLOSING ||
        (stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING && departureProgress < 0.38)
      ) {
        exitLight.color.setHex(ELEVATOR_PALETTE.exitExtractingAccent)
        exitLight.intensity = baseIntensity * 1.15
      } else if (stage === EXTRACTION_SEQUENCE_STAGES.DEPARTURE_PAUSE) {
        exitLight.color.setHex(ELEVATOR_PALETTE.exitUnlockedAccent)
        exitLight.intensity = baseIntensity * 1.25
      } else if (
        stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING ||
        stage === EXTRACTION_SEQUENCE_STAGES.COMPLETED
      ) {
        exitLight.color.setHex(ELEVATOR_PALETTE.exitUnlockedAccent)
        exitLight.intensity = baseIntensity * 1.3
      } else {
        exitLight.color.setHex(ELEVATOR_PALETTE.exitUnlockedAccent)
        exitLight.intensity = baseIntensity
      }
    }

    if (this._elevatorShaftsGroup) {
      syncExtractionShaftState(this._elevatorShaftsGroup, {
        isLocked: this.isExitLocked,
        stage,
        departureProgress,
        reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
        localizedLightsEnabled:
          this._environment?.config?.localizedLightsEnabled !== false,
      })
    }
  }

  startExtractionSequence(options = {}) {
    if (
      this.isDisposed ||
      !this._currentMaze?.exit ||
      !this._elevatorExtractionSequence ||
      this.isGameOver ||
      this.hasWon ||
      this.isExitLocked ||
      this.isExtractionSequenceActive() ||
      this.isSpawnSequenceActive()
    ) {
      return false
    }

    if (this.isHidden) {
      this.exitHidingSpot({ silent: true })
    }

    this._extractionDoorsCloseCueFired = false
    this._extractionLockPauseCueFired = false
    this._extractionDepartCueFired = false

    const isFreeLook = Boolean(this.cameraRig?.isFreeLookActive?.())
    const initialYaw = isFreeLook
      ? Number.isFinite(this._playerGroup?.rotation?.y)
        ? this._playerGroup.rotation.y
        : this.cameraRig?.getLookDirection?.().yaw || 0
      : this.cameraRig?.getLookDirection?.().yaw ??
        this._playerGroup?.rotation?.y ??
        0

    const started = this._elevatorExtractionSequence.start(
      this._currentMaze,
      this._playerWorldPos,
      {
        initialYaw,
        ...options,
      }
    )

    if (!started) {
      return false
    }

    this._motionSample.moved = false
    this._motionSample.isSprinting = false
    this._motionSample.actualSpeed = 0
    this._isSprintingThisTick = false

    const extState = this._elevatorExtractionSequence.getState()
    if (extState) {
      this._syncExtractionElevatorVisuals(
        extState.stage,
        extState.doorCloseProgress,
        extState.departureProgress,
        extState.elevatorY
      )
    }

    this._notifyExtractionSequenceChange(Boolean(options?.forceNotify))
    return true
  }

  _syncExtractionShaftDarkness(elevatorY = 0, { forceRestore = false } = {}) {
    const env = this._environment
    if (this.isDisposed || !env?.lights) return
    const lights = env.lights
    const cfg = env.config || DEFAULT_ENVIRONMENT_CONFIG

    const safeY = Number.isFinite(elevatorY) ? Math.max(0, elevatorY) : 0
    if (safeY <= 2.2) {
      if (forceRestore) {
        if (lights.ambientLight && Number.isFinite(cfg.ambientIntensity)) {
          lights.ambientLight.intensity = cfg.ambientIntensity
        }
        if (lights.hemiLight && Number.isFinite(cfg.hemiIntensity)) {
          lights.hemiLight.intensity = cfg.hemiIntensity
        }
        if (lights.directionalLight && Number.isFinite(cfg.directionalIntensity)) {
          lights.directionalLight.intensity = cfg.directionalIntensity
        }
        if (lights.fillLight && Number.isFinite(cfg.fillIntensity)) {
          lights.fillLight.intensity = cfg.fillIntensity
        }
        if (env.fog && env.fog.isFogExp2 && Number.isFinite(cfg.fogDensity)) {
          env.fog.density = cfg.fogDensity
        }
      }
      return
    }

    const u = Math.max(0, Math.min(1, (safeY - 2.2) / 10.0))
    const darkness = u * u * (3 - 2 * u)
    const scale = Math.max(0.14, 1 - darkness * 0.86)

    if (lights.ambientLight) {
      lights.ambientLight.intensity *= scale
    }
    if (lights.hemiLight) {
      lights.hemiLight.intensity *= scale
    }
    if (lights.directionalLight) {
      lights.directionalLight.intensity *= scale
    }
    if (lights.fillLight) {
      lights.fillLight.intensity *= scale
    }
    if (env.fog && env.fog.isFogExp2 && Number.isFinite(cfg.fogDensity)) {
      env.fog.density = cfg.fogDensity * (1 + darkness * 1.45)
    }
  }

  cancelExtractionSequence(options = {}) {
    if (!this._elevatorExtractionSequence) return false
    const wasActive = this._elevatorExtractionSequence.cancel()
    this._pendingExtractionCellChange = null
    this._extractionDoorsCloseCueFired = false
    this._extractionLockPauseCueFired = false
    this._extractionDepartCueFired = false
    this._syncExtractionElevatorVisuals(EXTRACTION_SEQUENCE_STAGES.IDLE, 0, 0, 0)
    this._syncExtractionShaftDarkness(0, { forceRestore: true })
    if (options?.notify !== false) {
      this._notifyExtractionSequenceChange(Boolean(options?.forceNotify))
    } else {
      this._lastNotifiedExtractionActive = false
    }
    return wasActive
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
      this._activeHorrorEventType = null
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

  resetCombat(options = {}) {
    if (options?.restartSpawnSequence) {
      // Handled below after combat state is reset
    } else if (!options?.preserveSpawnSequence) {
      this.cancelSpawnSequence({ syncYaw: false })
    }
    if (!options?.preserveExtractionSequence) {
      this.cancelExtractionSequence()
      this._hasCompletedExtractionThisRun = false
      if (this._exitGateGroup) {
        setExitGateState(this._exitGateGroup, this.isExitLocked, { animate: false })
      }
    }
    this.isHidden = false
    this._activeHorrorEventType = null
    this._soundEvent = null
    this._soundTimer = 0
    this.health = this.maxHealth
    this.isGameOver = false
    this.hasWon = false
    this.audioEngine?.setHasWon?.(false)
    this.damageImmunityTimer = 0
    this.damageFeedbackTimer = 0
    this.cameraShakeIntensity = 0
    this.stamina = this.maxStamina
    this.recoveryDelayTimer = 0
    this.isExhausted = false
    this.staminaBreathingTimer = 0
    this._isSprintingThisTick = false
    this.flashlightActive = false
    this.battery = this.maxBattery
    if (this.spotlight) {
      this.spotlight.visible = false
      this.spotlight.intensity = 0
    }
    this._onFlashlightChange?.(false)
    this.cameraRig?.setShakePitch?.(0)
    this.cameraRig?.setShakeRoll?.(0)
    if (Number.isFinite(this._currentInitialYaw)) {
      this.cameraRig?.setLookDirection(this._currentInitialYaw, 0)
    }
    this.cameraRig?.update(0, { immediate: true })
    this.enemyManager?.resetEnemyStates()
    this.hazardManager?.resetHazardStates()
    this.hidingSpotManager?.resetStates()
    this.audioEngine?.reset()
    this.horrorDirector?.reset()
    this.horrorDirector?.setPaused(Boolean(this.isPaused))
    this._playerWorldPos.y = getElevatorFloorHeightAtWorld(
      this._playerWorldPos.x,
      this._playerWorldPos.z,
      this._currentMaze
    )
    if (this._playerGroup) {
      this._playerGroup.position.y = this._playerWorldPos.y
    }
    this.cameraRig?.setPlayerPosition?.(
      this._playerWorldPos.x,
      this._playerWorldPos.y,
      this._playerWorldPos.z
    )
    this.syncPlayerVisibility()
    this._notifyStealthChange(true)
    if (options?.restartSpawnSequence && this._currentMaze) {
      this.restartSpawnSequence()
    }
  }

  _syncFlashlightRig() {
    if (this.isDisposed || !this.spotlight || !this.spotlightTarget) {
      return
    }

    const mode = this.cameraRig?.getMode?.() ?? CAMERA_MODES.FIRST_PERSON
    const look = this.cameraRig?.getLookDirection?.() ?? { yaw: 0, pitch: 0 }

    if (mode === CAMERA_MODES.THIRD_PERSON && this.flashlightRig) {
      if (this.spotlight.parent !== this.flashlightRig) {
        this.flashlightRig.add(this.spotlight)
      }
      if (this.spotlightTarget.parent !== this.flashlightRig) {
        this.flashlightRig.add(this.spotlightTarget)
      }
      this.flashlightRig.position.set(
        this._playerWorldPos.x,
        this._playerWorldPos.y + 1.35,
        this._playerWorldPos.z
      )
      this.flashlightRig.rotation.set(look.pitch, look.yaw, 0, 'YXZ')
      this.spotlight.position.set(0, 0, -0.45)
      this.spotlightTarget.position.set(0, 0, -12.45)
      this.flashlightRig.updateMatrixWorld(true)
    } else if (this.camera) {
      if (this.spotlight.parent !== this.camera) {
        this.camera.add(this.spotlight)
      }
      if (this.spotlightTarget.parent !== this.camera) {
        this.camera.add(this.spotlightTarget)
      }
      this.spotlight.position.set(0, -0.05, 0)
      this.spotlightTarget.position.set(0, -0.05, -12)
      this.camera.updateMatrixWorld(true)
    }
  }

  toggleFlashlight() {
    if (this.isDisposed || this.isGameOver || this.hasWon) return false
    this.flashlightActive = !this.flashlightActive
    this._syncFlashlightRig()
    if (this.spotlight) {
      this.spotlight.visible = this.flashlightActive && this.battery > 0
      this.spotlight.intensity =
        this.flashlightActive && this.battery > 0 ? ACTIVE_FLASHLIGHT_INTENSITY : 0
    }
    this._updateFlashlightShadowCache()
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
      this.hasWon ||
      this.isExtractionSequenceActive() ||
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
    this.cameraShakeIntensity =
      this.cameraShakeEnabled && !this.horrorDirector?.reducedMotion ? 0.28 : 0

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
      this._activeHorrorEventType = null
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
    if (this._moveCollisionOptions) {
      this._moveCollisionOptions.radius = this.movementConfig.radius
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

  getCameraMode() {
    return this.cameraRig?.getMode?.() ?? null
  }

  setCameraMode(mode, options = {}) {
    if (this.isDisposed || !this.cameraRig) return null
    const nextMode = this.cameraRig.setMode(mode, options)
    this.syncPlayerVisibility()
    this._syncFlashlightRig()
    this._updateFlashlightShadowCache()
    return nextMode
  }

  toggleCameraMode(options = {}) {
    if (this.isDisposed || !this.cameraRig || this.isGameOver || this.hasWon) {
      return null
    }
    const nextMode =
      this.cameraRig.getMode() === CAMERA_MODES.THIRD_PERSON
        ? CAMERA_MODES.FIRST_PERSON
        : CAMERA_MODES.THIRD_PERSON
    return this.setCameraMode(nextMode, options)
  }

  getThirdPersonCameraMode() {
    return this.cameraRig?.getThirdPersonCameraMode?.() ?? null
  }

  setThirdPersonCameraMode(mode, options = {}) {
    if (this.isDisposed || !this.cameraRig) return null
    const nextMode = this.cameraRig.setThirdPersonCameraMode(mode, options)
    this.syncPlayerVisibility()
    this._syncFlashlightRig()
    this._updateFlashlightShadowCache()
    return nextMode
  }

  getCameraDistancePreset() {
    return this.cameraRig?.getCameraDistancePreset?.() ?? null
  }

  getCameraFollowDistance() {
    return this.cameraRig?.getFollowDistance?.() ?? null
  }

  setCameraDistancePreset(preset, options = {}) {
    if (this.isDisposed || !this.cameraRig) return null
    const nextPreset = this.cameraRig.setCameraDistancePreset(preset, options)
    this._updateFlashlightShadowCache()
    this._onCameraDistanceChange?.(
      nextPreset,
      this.cameraRig.getFollowDistance()
    )
    return nextPreset
  }

  cycleCameraDistance(options = {}) {
    if (this.isDisposed || !this.cameraRig || this.isGameOver || this.hasWon) {
      return null
    }
    const nextPreset = this.cameraRig.cycleCameraDistance(options)
    this._updateFlashlightShadowCache()
    this._onCameraDistanceChange?.(
      nextPreset,
      this.cameraRig.getFollowDistance()
    )
    return nextPreset
  }

  updateCameraConfig(partialConfig = {}) {
    if (this.isDisposed || !this.cameraRig) return null
    let shouldRenderFrame = false
    if (partialConfig && typeof partialConfig === 'object') {
      if (typeof partialConfig.cameraShake === 'boolean') {
        this.cameraShakeEnabled = partialConfig.cameraShake
        if (!this.cameraShakeEnabled) {
          this.cameraShakeIntensity = 0
          this.cameraRig.setShakeRoll(0)
        }
      }
      if (
        partialConfig.fov !== null &&
        partialConfig.fov !== undefined &&
        typeof partialConfig.fov !== 'boolean' &&
        Number.isFinite(Number(partialConfig.fov))
      ) {
        const nextFov = Math.max(55, Math.min(85, Number(partialConfig.fov)))
        this.config.fov = nextFov
        if (this.camera && this.camera.fov !== nextFov) {
          this.camera.fov = nextFov
          this.camera.updateProjectionMatrix?.()
          shouldRenderFrame = true
        }
      }
    }
    const nextConfig = this.cameraRig.updateConfig(partialConfig)
    this.syncPlayerVisibility()
    this._syncFlashlightRig()
    this._updateFlashlightShadowCache()
    if (shouldRenderFrame && this.isPaused) {
      this.renderFrame()
    }
    return nextConfig
  }

  /**
   * Repositions the 3D player character and camera rig anchor in world space
   * without rebuilding maze geometry or restarting the WebGLRenderer.
   */
  setPlayerWorldPosition(xOrVec, y = 0, z = 0, options = {}) {
    if (this.isDisposed) return null

    if (!options?.preserveSpawnSequence && this.isSpawnSequenceActive()) {
      this.cancelSpawnSequence({ syncYaw: false })
    }
    if (!options?.preserveExtractionSequence && this.isExtractionSequenceActive()) {
      this.cancelExtractionSequence()
    }

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

    let targetYaw = options?.yaw
    let targetPitch = options?.pitch
    if (!Number.isFinite(targetYaw) && this._currentMaze?.start) {
      const startW = gridToWorld(
        this._currentMaze.start.row,
        this._currentMaze.start.col,
        this._currentMaze
      )
      if (
        startW &&
        Math.hypot(nextX - startW.x, nextZ - startW.z) < 1.0 &&
        Number.isFinite(this._currentInitialYaw)
      ) {
        targetYaw = this._currentInitialYaw
        targetPitch = 0
      }
    }

    if (this.cameraRig) {
      this.cameraRig.setPlayerPosition(nextX, nextY, nextZ)
      if (targetYaw !== undefined) {
        this.cameraRig.setLookDirection(
          targetYaw,
          Number.isFinite(targetPitch) ? targetPitch : 0
        )
      }
      if (options?.immediate) {
        this.cameraRig.snap()
      }
    }

    this._syncFlashlightRig()

    if (this._playerGroup) {
      const res = positionPlayerAtWorld(
        this._playerGroup,
        nextX,
        nextY,
        nextZ,
        options?.yaw
      )
      this._updateFlashlightShadowCache()
      return res
    }

    this._updateFlashlightShadowCache()
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

    const y = Number.isFinite(options?.y)
      ? options.y
      : getElevatorFloorHeightAtWorld(worldPos.x, worldPos.z, this._currentMaze)
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
    this._syncFlashlightRig()
    this._updateFlashlightShadowCache()
  }

  applyLookDelta(deltaX = 0, deltaY = 0, options = {}) {
    if (this.isDisposed || !this.cameraRig) return
    this.cameraRig.applyLookDelta(deltaX, deltaY, options)
    if (
      this._playerGroup &&
      !this.cameraRig.isFreeLookActive() &&
      !this.isExtractionSequenceActive()
    ) {
      const yawOffset = this.isSpawnSequenceActive()
        ? this._elevatorExitSequence._currentYawOffset || 0
        : 0
      this._playerGroup.rotation.y = this.cameraRig.getLookDirection().yaw + yawOffset
    }
    this._syncFlashlightRig()
    this._updateFlashlightShadowCache()
  }

  /**
   * Advances continuous player movement using delta-time kinematics,
   * normalized diagonal vectors, maze.grid anti-tunneling collision,
   * optional Wall Pass consumption, and single-fire cell-entry notifications.
   */
  stepMovement(inputState, delta = 0, options = {}) {
    if (!this._steppingSpawnSequence && this.isSpawnSequenceActive()) {
      this.cancelSpawnSequence()
    }
    if (
      this.isDisposed ||
      this.isPaused ||
      this.isGameOver ||
      this.isHidden ||
      this.isExtractionSequenceActive() ||
      !this._currentMaze?.grid ||
      !inputState ||
      !Number.isFinite(delta) ||
      delta <= 0
    ) {
      this._motionSample.moved = false
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = 0
      this._isSprintingThisTick = false
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

    const isFreeLook = Boolean(this.cameraRig?.isFreeLookActive?.())
    if (this.cameraRig) {
      if (isFreeLook) {
        this.cameraRig.getCameraForwardVector(this._tmpForward)
        this.cameraRig.getCameraRightVector(this._tmpRight)
      } else {
        this.cameraRig.getForwardVector(this._tmpForward)
        this.cameraRig.getRightVector(this._tmpRight)
      }
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

    if (isFreeLook && this.cameraRig) {
      const targetYaw = Math.atan2(-dirX, -dirZ)
      const currentYaw = this.cameraRig.getCharacterDirection().yaw
      const angleDiff = Math.atan2(
        Math.sin(targetYaw - currentYaw),
        Math.cos(targetYaw - currentYaw)
      )
      const turnRate = Number.isFinite(this.cameraRig.config?.freeLookTurnSpeed)
        ? Math.max(0, this.cameraRig.config.freeLookTurnSpeed)
        : 14
      const turnAlpha = turnRate <= 0 ? 1 : 1 - Math.exp(-turnRate * delta)
      const nextYaw =
        Math.abs(angleDiff) < 1e-4
          ? targetYaw
          : currentYaw + angleDiff * turnAlpha
      this.cameraRig.setCharacterYaw(nextYaw)
      if (this._playerGroup) {
        this._playerGroup.rotation.y = nextYaw
      }
      this._syncFlashlightRig()
      this._updateFlashlightShadowCache()
    }

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
    this._isSprintingThisTick = effectiveSprint
    if (effectiveSprint) {
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

    this._moveCollisionOptions.radius = this.movementConfig.radius
    this._moveCollisionOptions.propColliders = this._propCollisionIndex

    const moveResult = moveWithSubsteps(
      startX,
      startZ,
      deltaX,
      deltaZ,
      this._currentMaze,
      this._moveCollisionOptions
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
      const nextY = getElevatorFloorHeightAtWorld(nextX, nextZ, this._currentMaze)
      this._playerWorldPos.x = nextX
      this._playerWorldPos.y = nextY
      this._playerWorldPos.z = nextZ

      if (this._playerGroup) {
        this._playerGroup.position.set(nextX, nextY, nextZ)
        if (this.cameraRig) {
          this._playerGroup.rotation.y = this.cameraRig.getLookDirection().yaw
        }
      }

      if (this.cameraRig) {
        this.cameraRig.setPlayerPosition(nextX, nextY, nextZ)
        if (usedWallPass) {
          this.cameraRig.snap()
        }
      }
      this._syncFlashlightRig()
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

      const isEnteringExit = Boolean(
        this._currentMaze?.exit &&
          nextCell.row === this._currentMaze.exit.row &&
          nextCell.col === this._currentMaze.exit.col
      )
      const shouldDeferForExtraction = Boolean(
        isEnteringExit &&
          this._steppingInFrame &&
          !this.isExitLocked &&
          !this.hasWon &&
          !this.isGameOver &&
          !this.config?.skipExtractionSequence &&
          !this._hasCompletedExtractionThisRun &&
          this._elevatorExtractionSequence?.config?.enabled !== false
      )

      const onCellChange =
        options?.onCellChange || this._movementOptions?.onPlayerCellChange

      if (shouldDeferForExtraction) {
        this._pendingExtractionCellChange = {
          cell: { row: nextCell.row, col: nextCell.col },
          meta: {
            direction,
            countMove: true,
            usedWallPass,
            passedWall,
          },
          onCellChange,
        }
        const started = this.startExtractionSequence({ forceNotify: true })
        if (!started) {
          this._pendingExtractionCellChange = null
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
      } else {
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

  _extractAmbientAnchors(maze, mazeGroup) {
    const vents = []
    const ducts = []
    const corridors = []

    const rawVents = mazeGroup?.userData?.ceilingVentsGroup?.userData?.ventMetadata
    if (Array.isArray(rawVents)) {
      for (let i = 0; i < rawVents.length; i += 1) {
        const v = rawVents[i]
        const vx = Number.isFinite(v?.cx) ? v.cx : v?.x
        const vz = Number.isFinite(v?.cz) ? v.cz : v?.z
        if (Number.isFinite(vx) && Number.isFinite(vz)) {
          vents.push({
            x: vx,
            y: Number.isFinite(v.frameBottomY) ? v.frameBottomY : 3.12,
            z: vz,
          })
        }
      }
    }

    if (Array.isArray(maze?.grid)) {
      const rows = maze.grid.length
      const cols = maze.grid[0]?.length || 0
      const rawTrunks = mazeGroup?.userData?.ceilingVentsGroup?.userData?.ductTrunks
      const trunkZs = []
      const trunkXs = []
      if (Array.isArray(rawTrunks)) {
        for (let i = 0; i < rawTrunks.length; i += 1) {
          const t = rawTrunks[i]
          if (t && Number.isFinite(t.z)) trunkZs.push(t.z)
          if (t && Number.isFinite(t.x)) trunkXs.push(t.x)
        }
      }

      for (let r = 0; r < rows; r += 1) {
        const rowArr = maze.grid[r]
        if (!rowArr) continue
        for (let c = 0; c < cols; c += 1) {
          if (rowArr[c] !== CELL_TYPES.PATH) continue
          const wp = gridToWorld(r, c, maze)
          if (!wp) continue
          corridors.push({ x: wp.x, y: 1.4, z: wp.z })

          if ((r + c) % 2 === 0) {
            for (let tz = 0; tz < trunkZs.length; tz += 1) {
              if (Math.abs(wp.z - trunkZs[tz]) <= CELL_SIZE * 0.82) {
                ducts.push({ x: wp.x, y: 3.18, z: trunkZs[tz] })
                break
              }
            }
            for (let tx = 0; tx < trunkXs.length; tx += 1) {
              if (Math.abs(wp.x - trunkXs[tx]) <= CELL_SIZE * 0.82) {
                ducts.push({ x: trunkXs[tx], y: 3.16, z: wp.z })
                break
              }
            }
          }
        }
      }
    }

    return { vents, ducts, corridors }
  }

  getMazeGroup() {
    return this._mazeGroup
  }

  clearMaze() {
    this.cancelSpawnSequence({ syncYaw: false })
    this.cancelExtractionSequence({ notify: false })
    this._hasCompletedExtractionThisRun = false
    this._lastNotifiedExtractionActive = false
    this.resetCombat()
    if (this._mazeGroup) {
      disposeMazeGroup(this._mazeGroup)
      this._mazeGroup = null
    }
    this._startElevatorGroup = null
    this._exitGateGroup = null
    this._elevatorShaftsGroup = null
    this._ceilingLightsGroup = null
    this._cachedAmbientAnchors = null
    this._startDescentCueFired = false
    this._startImpactCueFired = false
    this._extractionDoorsCloseCueFired = false
    this._extractionLockPauseCueFired = false
    this._extractionDepartCueFired = false
    this._activeHorrorEventType = null
    this.isExitLocked = false
    this.clearCollectibles()
    this.clearPlayer()
    this.clearEnemies()
    this.clearHazards()
    this.clearHidingSpots()
    this._cachedHidingSpotCells = []
    this._propCollisionIndex = null
    if (this._moveCollisionOptions) {
      this._moveCollisionOptions.propColliders = null
    }
    this._currentMaze = null
    this.collectibleManager?.setMaze(null)
    this.horrorDirector?.setMaze(null)
    this.audioEngine?.setMaze(null)
    this.cameraRig?.setMaze(null)
    if (this._environment && !this.isDisposed) {
      syncEnvironmentToMaze(this._environment, this.scene, null)
    }
    this.invalidateFlashlightShadow({ resetFirstRender: true })
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

    const nextGroup = buildMazeMeshes(maze, {
      qualityPreset: this.graphicsConfig?.qualityPreset,
      dynamicLights: this.graphicsConfig?.dynamicLights,
      isSoftwareGl: this.isSoftwareGl,
    })
    if (!nextGroup) {
      return null
    }

    this._currentMaze = maze
    this._mazeGroup = nextGroup
    const placedProps =
      nextGroup.userData?.environmentalPropsGroup?.userData?.placedProps ||
      placeEnvironmentalProps(maze)
    const elevatorColliders = getElevatorColliderDescriptors(maze)
    const allColliders =
      elevatorColliders.length > 0
        ? placedProps.concat(elevatorColliders)
        : placedProps
    this._propCollisionIndex = buildPropCollisionIndex(maze, allColliders)
    if (this._moveCollisionOptions) {
      this._moveCollisionOptions.propColliders = this._propCollisionIndex
    }
    this._startElevatorGroup =
      nextGroup.userData?.startElevator ||
      nextGroup.getObjectByName?.('maze-marker-start') ||
      null
    if (this._startElevatorGroup?.userData) {
      this._startElevatorGroup.userData.reducedMotion = Boolean(
        this.horrorDirector?.reducedMotion
      )
    }
    this._exitGateGroup = nextGroup.userData?.exitGate || null
    this._elevatorShaftsGroup =
      nextGroup.userData?.elevatorShaftsGroup ||
      nextGroup.getObjectByName?.('maze-elevator-shafts-group') ||
      null
    this._ceilingLightsGroup =
      nextGroup.userData?.ceilingLightsGroup ||
      nextGroup.userData?.ceilingGroup?.userData?.ceilingLightsGroup ||
      nextGroup.getObjectByName?.('maze-ceiling-lights-group') ||
      null
    this._cachedAmbientAnchors = this._extractAmbientAnchors(maze, nextGroup)
    const defaultLocked = Array.isArray(maze.keycards) && maze.keycards.length > 0
    this.setExitLocked(defaultLocked, { animate: false })

    this.audioEngine?.setMaze(maze, this._cachedAmbientAnchors)
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
        maxEnemyLights: this.performanceProfile.maxEnemyLights,
        particlesEnabled: this.performanceProfile.particlesEnabled,
        reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
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
    this._currentInitialYaw = initialYaw

    // Create and mount 3D player character positioned flush on the starting elevator deck
    const resolvedSpawn = startWorld || { x: 0, z: 0 }
    const spawnY = getElevatorFloorHeightAtWorld(
      resolvedSpawn.x,
      resolvedSpawn.z,
      maze
    )
    const isThirdPerson =
      this.cameraRig?.getMode?.() === CAMERA_MODES.THIRD_PERSON
    this._playerGroup = buildPlayer({
      maze,
      spawnCell: null,
      position: { x: resolvedSpawn.x, y: spawnY, z: resolvedSpawn.z },
      yaw: initialYaw,
      visible: isThirdPerson,
      qualityPreset: this.graphicsConfig?.qualityPreset,
    })
    if (this._playerGroup) {
      this.scene.add(this._playerGroup)
    }
    if (this._playerAnimator) {
      this._playerAnimator.setPlayerGroup(this._playerGroup)
    }

    this._playerWorldPos.x = resolvedSpawn.x
    this._playerWorldPos.y = spawnY
    this._playerWorldPos.z = resolvedSpawn.z
    this._lastGridCell = maze.start
      ? { row: maze.start.row, col: maze.start.col }
      : worldToGrid(resolvedSpawn.x, resolvedSpawn.z, maze)

    // Anchor camera rig at the starting elevator deck facing the opening corridor
    if (this.cameraRig && startWorld) {
      this.cameraRig.setPlayerPosition(startWorld.x, spawnY, startWorld.z)
      this.cameraRig.setLookDirection(initialYaw, 0)
      this.cameraRig.snap()
    }
    this._syncFlashlightRig()
    this.invalidateFlashlightShadow({ resetFirstRender: true })
    this._updateFlashlightShadowCache()

    if (this.graphicsConfig?.highContrast) {
      applyHighContrastToScene({
        mazeGroup: this._mazeGroup,
        collectibleManager: this.collectibleManager,
        hazardManager: this.hazardManager,
        hidingSpotManager: this.hidingSpotManager,
        enemyManager: this.enemyManager,
        enabled: true,
      })
    }
    if (this.renderer) {
      syncMazeSurfaceTextureAnisotropy(this.renderer)
    }
    this._syncCeilingLights(1)

    if (!this.config?.skipSpawnSequence) {
      this.startSpawnSequence({ resetCamera: false, forceNotify: true })
    } else {
      this._notifySpawnSequenceChange(true)
    }
    this._notifyExtractionSequenceChange(true)

    return nextGroup
  }

  getPerformanceProfile() {
    return { ...this.performanceProfile }
  }

  getPixelRatio() {
    const deviceRatio =
      typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
        ? window.devicePixelRatio
        : 1
    const maxCap = Math.max(1, Number(this.performanceProfile?.pixelRatioCap) || 2)
    return this.isSoftwareGl ? 1 : Math.min(deviceRatio, maxCap)
  }

  setFrameCallback(callback) {
    this._onFrame = typeof callback === 'function' ? callback : null
  }

  resize(width, height, options = {}) {
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
    if (this.isPaused && options?.render !== false) {
      this.renderFrame()
    }
  }

  renderFrame(options = {}) {
    if (this.isDisposed || !this.renderer || !this.scene || !this.camera) {
      return
    }
    if (!options?.skipFlashlightShadowCacheUpdate) {
      this._updateFlashlightShadowCache()
    }
    this.renderer.render(this.scene, this.camera)
  }

  _scheduleNextTick(tickFn, renderDurationMs = 0) {
    if (!this.isRunning || this.isDisposed) return

    if (this.isSoftwareGl || typeof requestAnimationFrame !== 'function') {
      const delayMs = computeAdaptiveFrameDelayMs(renderDurationMs, this.isPaused)
      const scheduleTimeout =
        typeof window !== 'undefined' && typeof window.setTimeout === 'function'
          ? window.setTimeout.bind(window)
          : setTimeout
      this._timeoutId = scheduleTimeout(tickFn, delayMs)
      return
    }

    this._frameId = requestAnimationFrame(tickFn)
  }

  stepFrame(delta = 0, options = {}) {
    if (this.isDisposed || this.isPaused) {
      this._motionSample.moved = false
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = 0
      this._isSprintingThisTick = false
      return false
    }

    const safeDelta = Number.isFinite(delta) && delta > 0 ? delta : 0
    this._elapsedSec += safeDelta

    this._motionSample.moved = false
    this._motionSample.isSprinting = false
    this._motionSample.actualSpeed = 0
    this._isSprintingThisTick = false

    // Countdown combat timers outside React state updates
    this.damageImmunityTimer = Math.max(0, this.damageImmunityTimer - safeDelta)
    this.damageFeedbackTimer = Math.max(0, this.damageFeedbackTimer - safeDelta)

    // Dynamic trauma / camera shake decay (respects cameraShakeEnabled & reducedMotion)
    let shakeZ = 0
    if (this.cameraShakeIntensity > 0) {
      this.cameraShakeIntensity = Math.max(
        0,
        this.cameraShakeIntensity - safeDelta * 0.95
      )
      if (this.cameraShakeEnabled && !this.horrorDirector?.reducedMotion) {
        shakeZ = this.cameraShakeIntensity * (Math.random() - 0.5) * 0.14
      }
    }
    if (!this.cameraShakeEnabled || this.horrorDirector?.reducedMotion) {
      shakeZ = 0
    }
    this.cameraRig?.setShakePitch?.(0)
    this.cameraRig?.setShakeRoll(shakeZ)

    let spawnActive = this.isSpawnSequenceActive()
    let extractionActive = this.isExtractionSequenceActive()

    if (spawnActive && !this.isGameOver && !this.hasWon) {
      const reducedMotion = Boolean(this.horrorDirector?.reducedMotion)
      const isFirstPerson = this.cameraRig?.getMode?.() === CAMERA_MODES.FIRST_PERSON
      const allowCamShake = Boolean(this.cameraShakeEnabled && !reducedMotion)
      this._steppingSpawnSequence = true
      const seqState = this._elevatorExitSequence.update(safeDelta, {
        reducedMotion,
      })
      this._steppingSpawnSequence = false

      if (this._startElevatorGroup) {
        setStartElevatorSequenceState(this._startElevatorGroup, {
          stage: seqState.stage,
          elevatorY: seqState.elevatorY,
          vibrationY: seqState.vibrationY,
          reducedMotion,
        })
        updateStartElevator(this._startElevatorGroup, safeDelta, this._elapsedSec)
      }

      if (
        seqState.stage === SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND &&
        !this._startDescentCueFired
      ) {
        this._startDescentCueFired = true
        this.audioEngine?.onStartElevatorDescent?.(
          this._elevatorExitSequence._descentDuration || 1.4
        )
      }

      if (seqState.impactTriggered && !this._startImpactCueFired) {
        this._startImpactCueFired = true
        this.audioEngine?.onStartElevatorImpact?.()
        if (this._startElevatorGroup) {
          const allowParticles =
            !reducedMotion && this.performanceProfile?.particlesEnabled !== false
          triggerStartElevatorLandingDust(this._startElevatorGroup, {
            reducedMotion: !allowParticles,
          })
        }
        if (allowCamShake) {
          this.cameraShakeIntensity = Math.max(
            this.cameraShakeIntensity,
            isFirstPerson ? 0.18 : 0.24
          )
          this.cameraRig?.setShakeRoll(this.cameraShakeIntensity * 0.06)
        }
      }

      this._playerWorldPos.x = seqState.x
      this._playerWorldPos.y = seqState.y
      this._playerWorldPos.z = seqState.z

      if (this._currentMaze) {
        const nextCell = worldToGrid(seqState.x, seqState.z, this._currentMaze)
        if (nextCell && isCellWalkable(nextCell.row, nextCell.col, this._currentMaze)) {
          this._lastGridCell = nextCell
        }
      }

      this._motionSample.moved = seqState.moved
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = seqState.actualSpeed
      this._motionSample.walkSpeed = this.movementConfig.walkSpeed
      this._motionSample.sprintSpeed = this.movementConfig.sprintSpeed

      const isFreeLook = Boolean(this.cameraRig?.isFreeLookActive?.())
      const targetCharYaw = isFreeLook
        ? seqState.yaw
        : (this.cameraRig
            ? this.cameraRig.getLookDirection().yaw
            : this._elevatorExitSequence._exitYaw) + seqState.yawOffset

      if (this._playerGroup) {
        this._playerGroup.position.set(seqState.x, seqState.y, seqState.z)
        this._playerGroup.rotation.y = targetCharYaw
      }
      if (this.cameraRig) {
        const camEyeOffsetY = allowCamShake
          ? isFirstPerson
            ? seqState.fpEyeOffsetY
            : seqState.fpEyeOffsetY * 0.22
          : 0
        this.cameraRig.setPlayerPosition(
          seqState.x,
          seqState.y + camEyeOffsetY,
          seqState.z
        )
        if (isFreeLook) {
          this.cameraRig.setCharacterYaw(targetCharYaw)
        }
        if (allowCamShake) {
          this.cameraRig.setShakePitch?.(
            isFirstPerson ? seqState.fpCameraPitch || 0 : 0
          )
          this.cameraRig.setShakeRoll?.(
            shakeZ +
              (isFirstPerson
                ? seqState.fpCameraRoll || 0
                : (seqState.fpCameraRoll || 0) * 0.35)
          )
        } else {
          this.cameraRig.setShakePitch?.(0)
          this.cameraRig.setShakeRoll?.(0)
        }
      }

      if (this._playerAnimator) {
        this._playerAnimator.update(safeDelta, this._motionSample)
      }
      this._elevatorExitSequence.applyPoseAdjustments(this._playerGroup)
      this._syncFlashlightRig()

      if (seqState.completed) {
        spawnActive = false
        this.cameraRig?.setShakePitch?.(0)
        this.cameraRig?.setShakeRoll?.(0)
        this._notifySpawnSequenceChange()
      }
    } else if (extractionActive && !this.isGameOver && !this.hasWon) {
      const reducedMotion = Boolean(this.horrorDirector?.reducedMotion)
      this._steppingExtractionSequence = true
      const deckOffsetY = getExitGateDeckOffsetY(this._exitGateGroup)
      const extState = this._elevatorExtractionSequence.update(safeDelta, {
        reducedMotion,
        deckOffsetY,
      })
      this._steppingExtractionSequence = false

      this._playerWorldPos.x = extState.x
      this._playerWorldPos.y = extState.y
      this._playerWorldPos.z = extState.z

      if (this._currentMaze) {
        const nextCell = worldToGrid(extState.x, extState.z, this._currentMaze)
        if (nextCell && isCellWalkable(nextCell.row, nextCell.col, this._currentMaze)) {
          this._lastGridCell = nextCell
        }
      }

      this._motionSample.moved = extState.moved
      this._motionSample.isSprinting = false
      this._motionSample.actualSpeed = extState.actualSpeed
      this._motionSample.walkSpeed = this.movementConfig.walkSpeed
      this._motionSample.sprintSpeed = this.movementConfig.sprintSpeed

      if (this._playerGroup) {
        this._playerGroup.position.set(extState.x, extState.y, extState.z)
        this._playerGroup.rotation.y = extState.yaw
      }

      const isFreeLook = Boolean(this.cameraRig?.isFreeLookActive?.())
      if (this.cameraRig) {
        this.cameraRig.setPlayerPosition(
          extState.x,
          extState.y + extState.fpEyeOffsetY,
          extState.z
        )
        if (isFreeLook) {
          this.cameraRig.setCharacterYaw(extState.yaw)
        } else if (Math.abs(extState.deltaYaw) > 1e-6) {
          const curLook = this.cameraRig.getLookDirection()
          this.cameraRig.setLookDirection(
            curLook.yaw + extState.deltaYaw,
            curLook.pitch
          )
        }
      }

      if (this._playerAnimator) {
        this._playerAnimator.update(safeDelta, this._motionSample)
      }
      this._elevatorExtractionSequence.applyPoseAdjustments(this._playerGroup)
      this._syncFlashlightRig()

      this._syncExtractionElevatorVisuals(
        extState.stage,
        extState.doorCloseProgress,
        extState.departureProgress,
        extState.elevatorY
      )

      if (
        extState.stage === EXTRACTION_SEQUENCE_STAGES.DOORS_CLOSING &&
        !this._extractionDoorsCloseCueFired
      ) {
        this._extractionDoorsCloseCueFired = true
        this.audioEngine?.onExtractionDoorsClose?.()
      }
      if (
        extState.stage === EXTRACTION_SEQUENCE_STAGES.DEPARTURE_PAUSE &&
        !this._extractionLockPauseCueFired
      ) {
        this._extractionLockPauseCueFired = true
        this.audioEngine?.onExtractionLockPause?.()
      }
      if (
        (extState.stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING ||
          extState.stage === EXTRACTION_SEQUENCE_STAGES.COMPLETED) &&
        !this._extractionDepartCueFired
      ) {
        this._extractionDepartCueFired = true
        this.audioEngine?.onExtractionDepart?.(
          this._elevatorExtractionSequence._departDuration || 2.35
        )
        if (this.cameraShakeEnabled && !reducedMotion) {
          this.cameraShakeIntensity = Math.max(this.cameraShakeIntensity, 0.14)
        }
      }
      if (
        extState.stage === EXTRACTION_SEQUENCE_STAGES.DEPARTING &&
        this.cameraShakeEnabled &&
        !reducedMotion
      ) {
        const sustainVib =
          0.045 *
          Math.sin(extState.departureProgress * Math.PI) *
          (0.6 + 0.4 * Math.sin(this._elapsedSec * 29))
        this.cameraShakeIntensity = Math.max(this.cameraShakeIntensity, sustainVib)
        this.cameraRig?.setShakeRoll(
          this.cameraShakeIntensity * Math.sin(this._elapsedSec * 37) * 0.08
        )
      }

      if (extState.completed) {
        extractionActive = false
        this._hasCompletedExtractionThisRun = true
        this._notifyExtractionSequenceChange(true)

        const pending = this._pendingExtractionCellChange
        this._pendingExtractionCellChange = null
        if (pending?.onCellChange && this._currentMaze?.exit) {
          pending.onCellChange(
            { row: this._currentMaze.exit.row, col: this._currentMaze.exit.col },
            pending.meta
          )
        }
        this._onExtractionComplete?.({
          exitCell: this._currentMaze?.exit
            ? { row: this._currentMaze.exit.row, col: this._currentMaze.exit.col }
            : null,
          position: { ...this._playerWorldPos },
        })
      }
    } else {
      if (this._inputSource && !this.isGameOver && !this.hasWon) {
        const inputState = this._inputSource()
        if (inputState) {
          this._steppingInFrame = true
          try {
            this.stepMovement(inputState, safeDelta, { updateAnimation: false })
          } finally {
            this._steppingInFrame = false
          }
          extractionActive = this.isExtractionSequenceActive()
        }
      }

      if (this._playerAnimator) {
        this._playerAnimator.update(safeDelta, this._motionSample)
      }
    }

    const sequenceProtected = spawnActive || extractionActive

    if (this.collectibleManager) {
      this.collectibleManager.update(safeDelta)
    }

    if (!spawnActive && this._startElevatorGroup?.userData?.dustTimer > 0) {
      updateStartElevator(this._startElevatorGroup, safeDelta, this._elapsedSec)
    }

    if (this._exitGateGroup) {
      updateExitGate(this._exitGateGroup, safeDelta, this._elapsedSec)
    }

    if (!this.isGameOver && !this.hasWon) {
      if (this.isHidden) {
        this.recoveryDelayTimer = 0
        this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * 1.5 * safeDelta)
        if (this.stamina >= 35) this.isExhausted = false
      } else if (!this._isSprintingThisTick && !this._motionSample.isSprinting) {
        if (this.recoveryDelayTimer > 0) {
          this.recoveryDelayTimer = Math.max(0, this.recoveryDelayTimer - safeDelta)
        } else {
          this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * safeDelta)
          if (this.stamina >= 35 && this.isExhausted) {
            this.isExhausted = false
          }
        }
      }

      if (this.stamina < 30 && !this.isHidden) {
        this.staminaBreathingTimer = (this.staminaBreathingTimer || 0) + safeDelta
        if (this.staminaBreathingTimer >= 2.2) {
          this.staminaBreathingTimer = 0
          this.audioEngine?.onStaminaWarning(this.isExhausted ? 'heartbeat' : 'breathing')
        }
      } else {
        this.staminaBreathingTimer = 0
      }
    }

    if (this.flashlightActive && !this.isGameOver && !this.hasWon) {
      this.battery = Math.max(0, this.battery - this.batteryDrainRate * safeDelta)
      if (this.battery <= 0) {
        this.flashlightActive = false
        this.audioEngine?.onFlashlightToggle(false)
        this._onFlashlightChange?.(false)
      }
    } else if (!this.flashlightActive && !this.isGameOver && !this.hasWon) {
      this.battery = Math.min(this.maxBattery, this.battery + this.batteryRechargeRate * safeDelta)
    }

    let cachedPlayerGridCell
    const resolvePlayerGridCell = () => {
      if (cachedPlayerGridCell === undefined) {
        cachedPlayerGridCell = this.getPlayerGridCell()
      }
      return cachedPlayerGridCell
    }

    if (this._onFrame) {
      const payload = this._framePayload
      payload.delta = safeDelta
      payload.elapsed = this._elapsedSec
      payload.scene = this.scene
      payload.camera = this.camera
      payload.cameraRig = this.cameraRig
      payload.renderer = this.renderer
      payload.health = this.health
      payload.maxHealth = this.maxHealth
      payload.stamina = this.stamina
      payload.maxStamina = this.maxStamina
      payload.isExhausted = this.isExhausted
      payload.flashlightActive = this.flashlightActive
      payload.battery = this.battery
      payload.maxBattery = this.maxBattery
      payload.isImmune = this.damageImmunityTimer > 0
      payload.isSpawnSequenceActive = spawnActive
      payload.isExtractionSequenceActive = extractionActive
      payload.damageFeedbackAlpha =
        this.damageFeedbackTimer > 0 ? this.damageFeedbackTimer / 0.55 : 0
      payload.isGameOver = this.isGameOver
      payload.playerGridCell = resolvePlayerGridCell()
      payload.playerWorldPos = this._playerWorldPos
      payload.yaw = this.cameraRig ? this.cameraRig.getLookDirection().yaw : 0
      this._onFrame(payload)
    }

    if (this._soundTimer > 0) {
      this._soundTimer = Math.max(0, this._soundTimer - safeDelta)
      if (this._soundTimer === 0) {
        this._soundEvent = null
      }
    }

    if (this.spotlight) {
      if (this.flashlightActive && this.battery > 0 && !this.isGameOver && !this.hasWon) {
        this.spotlight.visible = true
        let intensity = ACTIVE_FLASHLIGHT_INTENSITY
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
      const stealthInfo = this.hidingSpotManager.update(safeDelta, {
        playerWorldPos: this._playerWorldPos,
        playerGridCell: resolvePlayerGridCell(),
      })
      this._notifyStealthChange(false, stealthInfo)
    }

    let enemyResult = null
    if (this.enemyManager && !this.isGameOver && !this.hasWon) {
      enemyResult = this.enemyManager.update(
        safeDelta,
        {
          playerWorldPos: this._playerWorldPos,
          playerGridCell: resolvePlayerGridCell(),
          playerMotion: this._motionSample,
          playerHidden: this.isHidden || sequenceProtected,
          soundEvent: sequenceProtected ? null : this._soundEvent,
          hidingSpotCells: this._cachedHidingSpotCells,
        },
        {
          particlesEnabled: Boolean(this.performanceProfile?.particlesEnabled),
          reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
        }
      )
      if (!sequenceProtected && enemyResult?.attackHits?.length > 0) {
        for (let i = 0; i < enemyResult.attackHits.length; i += 1) {
          const hit = enemyResult.attackHits[i]
          this.applyDamage(hit.damage, {
            enemyId: hit.enemyId,
            enemyType: hit.enemyType,
          })
        }
      }
    }

    if (
      this.hazardManager &&
      !this.isGameOver &&
      !this.hasWon &&
      !this.isHidden &&
      !sequenceProtected
    ) {
      const hazardResult = this.hazardManager.update(safeDelta, {
        playerWorldPos: this._playerWorldPos,
        playerGridCell: resolvePlayerGridCell(),
      })
      if (hazardResult?.hazardHits?.length > 0) {
        for (let i = 0; i < hazardResult.hazardHits.length; i += 1) {
          const hit = hazardResult.hazardHits[i]
          this.applyDamage(hit.damage, { hazardId: hit.hazardId, hazardType: hit.type })
        }
      }
    } else if (
      this.hazardManager &&
      !this.isGameOver &&
      !this.hasWon &&
      (this.isHidden || sequenceProtected)
    ) {
      // Still advance environmental hazard visual timers while player hides or rides elevator safely
      this.hazardManager.update(safeDelta, null)
    }

    if (this.cameraRig) {
      this.cameraRig.update(safeDelta)
    }
    this._syncFlashlightRig()

    if (this.horrorDirector) {
      const playerForward = this.cameraRig
        ? this.cameraRig.getForwardVector(this._tmpForward)
        : null
      this.horrorDirector.update(safeDelta, {
        playerWorldPos: this._playerWorldPos,
        playerForward,
        playerGridCell: resolvePlayerGridCell(),
        isHidden: this.isHidden,
        suppressAutoEvents: sequenceProtected,
        health: this.health,
        maxHealth: this.maxHealth,
        elapsedTime: this._elapsedSec,
        enemies: this.enemyManager?.enemies?.values(),
      })
    }

    const extractionAltY =
      extractionActive || this._hasCompletedExtractionThisRun
        ? this._elevatorExtractionSequence?.getState?.()?.elevatorY || 0
        : 0
    if (extractionAltY > 2.2) {
      this._syncExtractionShaftDarkness(extractionAltY)
    } else if (
      this._environment?.fog?.isFogExp2 &&
      Number.isFinite(this._environment?.config?.fogDensity) &&
      this._environment.fog.density !== this._environment.config.fogDensity
    ) {
      this._environment.fog.density = this._environment.config.fogDensity
    }

    if (this._environment) {
      stepEnvironmentAtmosphere(this._environment, this._elapsedSec, {
        reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
      })
    }
    this._syncCeilingLights()
    this._updateFlashlightShadowCache()

    if (this.audioEngine) {
      this._activeHorrorEventType = this.horrorDirector?._activeEvent?.type || null
      this.audioEngine.update(safeDelta, {
        camera: this.camera,
        playerWorldPos: this._playerWorldPos,
        playerMotion: this._motionSample,
        isHidden: this.isHidden,
        isGameOver: this.isGameOver,
        hasWon: this.hasWon,
        ceilingLightsGroup: this._ceilingLightsGroup,
        activeHorrorEventType: this._activeHorrorEventType,
        reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
        highContrast: Boolean(this.graphicsConfig?.highContrast),
        enemies: this.enemyManager?.enemies?.values(),
        hazards: this.hazardManager?.hazards?.values(),
        attackHits: sequenceProtected ? null : enemyResult?.attackHits || null,
      })
    }

    if (options.render !== false) {
      this.renderFrame({ skipFlashlightShadowCacheUpdate: true })
    }
    return true
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

      if (this.isPaused) {
        this._lastTimestamp = now
        this._motionSample.moved = false
        this._motionSample.isSprinting = false
        this._motionSample.actualSpeed = 0
        this._isSprintingThisTick = false
        this._scheduleNextTick(tick)
        return
      }

      const delta = Math.min(0.05, Math.max(0, (now - this._lastTimestamp) / 1000))
      this._lastTimestamp = now
      const frameStart =
        typeof performance !== 'undefined' ? performance.now() : Date.now()
      this.stepFrame(delta)
      const frameEnd =
        typeof performance !== 'undefined' ? performance.now() : Date.now()
      this._scheduleNextTick(tick, Math.max(0, frameEnd - frameStart))
    }

    if (!this.isSoftwareGl && typeof requestAnimationFrame === 'function') {
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
    this._onPlayerDamage = null
    this._onGameOver = null
    this._onFlashlightChange = null
    this._onSpawnSequenceChange = null
    this._onExtractionSequenceChange = null
    this._onExtractionComplete = null
    this._inputSource = null
    this._movementOptions = {}
    if (this._elevatorExitSequence) {
      this._elevatorExitSequence.dispose()
      this._elevatorExitSequence = null
    }
    if (this._elevatorExtractionSequence) {
      this._elevatorExtractionSequence.dispose()
      this._elevatorExtractionSequence = null
    }
    this.clearMaze()
    this.clearPlayer()
    this.clearEnvironment()

    if (this.spotlight) {
      if (this.spotlight.shadow?.map) {
        this.spotlight.shadow.map.dispose?.()
        this.spotlight.shadow.map = null
      }
      this.spotlight.target = null
      if (this.spotlight.parent) {
        this.spotlight.parent.remove(this.spotlight)
      }
      this.spotlight.dispose?.()
      this.spotlight = null
    }
    this._flashlightShadowCache = null
    this._dynamicShadowCasters = null
    this._dynamicShadowCasterPool = null
    if (this.spotlightTarget) {
      if (this.spotlightTarget.parent) {
        this.spotlightTarget.parent.remove(this.spotlightTarget)
      }
      this.spotlightTarget = null
    }
    if (this.flashlightRig) {
      if (this.flashlightRig.parent) {
        this.flashlightRig.parent.remove(this.flashlightRig)
      }
      this.flashlightRig = null
    }

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
        if (
          obj.geometry &&
          !isSharedResource(obj.geometry) &&
          typeof obj.geometry.dispose === 'function'
        ) {
          obj.geometry.dispose()
        }
        if (obj.material) {
          disposeMaterial(obj.material)
        }
        if (typeof obj.dispose === 'function' && obj !== this.scene) {
          obj.dispose()
        }
      })
      if (this._envMapTarget && typeof this._envMapTarget.dispose === 'function') {
        this._envMapTarget.dispose()
      } else if (this.scene.environment && typeof this.scene.environment.dispose === 'function') {
        this.scene.environment.dispose()
      }
      this.scene.environment = null
      this._envMapTarget = null
      this._envMapTexture = null
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

    this._mazeGroup = null
    this._startElevatorGroup = null
    this._exitGateGroup = null
    this._ceilingLightsGroup = null
    this._cachedAmbientAnchors = null
    this._activeHorrorEventType = null
    this._currentMaze = null
    this._framePayload = null
    this.scene = null
    this.camera = null
    this.renderer = null
    this.canvasHost = null

    releaseSharedPools(this)

    return true
  }
}
