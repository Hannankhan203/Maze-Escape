import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { resolveWallPassStep } from '../mechanics/powerups.js'
import { isCellWalkable, moveWithSubsteps } from '../world/gridCollision.js'
import { PLAYER_RADIUS, gridToWorld, worldToGrid } from '../world/worldCoords.js'
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
  setExitGateState,
  updateExitGate,
} from './buildMazeMeshes.js'
import { stepCeilingLights } from './buildCeilingLights.js'
import { syncMazeSurfaceTextureAnisotropy } from './mazeSurfaceTextures.js'
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
import {
  acquireSharedPools,
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
      maxEnemyLights: this.performanceProfile.maxEnemyLights,
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
        this._onHorrorEvent?.(evt)
        this.config.horrorDirector?.onEvent?.(evt)
      },
      onEventEnd: (evt) => {
        this.config.horrorDirector?.onEventEnd?.(evt)
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
      this.scene.environmentIntensity = 0.25
      roomEnv.dispose?.()
      pmremGenerator.dispose()
    } catch {
      // Ignore environment map errors on restricted/headless WebGL contexts
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

    this.renderer = nextRenderer
    this._applyRendererSettings(nextRenderer, requested)
    this.resize()

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

    this.graphicsConfig = next
    this.performanceProfile = {
      ...this.performanceProfile,
      qualityPreset: next.qualityPreset,
      pixelRatioCap: nextPixelRatioCap,
      particlesEnabled: next.particlesEnabled,
      particleCount: nextParticleCount,
      maxEnemyLights: nextMaxEnemyLights,
      antialias: next.antialias,
    }

    this.updateEnvironment({
      fogEnabled: next.volumetricFog,
      particlesEnabled: next.particlesEnabled,
      particleCount: nextParticleCount,
      localizedLightsEnabled: next.dynamicLights,
      qualityPreset: next.qualityPreset,
    })

    this.enemyManager?.setMaxEnemyLights?.(nextMaxEnemyLights)

    if (next.antialias !== this._activeAntialias) {
      const result = this._recreateRenderer(next.antialias)
      if (!result.applied) {
        this.performanceProfile.antialias = this._activeAntialias
      }
    } else if (this.renderer?.shadowMap) {
      this.renderer.shadowMap.enabled =
        !this.isSoftwareGl && next.qualityPreset !== 'performance'
      this.renderer.shadowMap.needsUpdate = true
    }

    this.resize()

    applyHighContrastToScene({
      mazeGroup: this._mazeGroup,
      collectibleManager: this.collectibleManager,
      hazardManager: this.hazardManager,
      hidingSpotManager: this.hidingSpotManager,
      enemyManager: this.enemyManager,
      enabled: next.highContrast,
    })
    this._syncCeilingLights()

    if (this.isPaused) {
      this.renderFrame()
    }

    return this.getGraphicsConfig()
  }

  _syncCeilingLights(lightScaleOverride = null) {
    if (!this._mazeGroup) return false
    let lightScale = lightScaleOverride
    if (!Number.isFinite(lightScale)) {
      const baseAmbient = this._environment?.config?.ambientIntensity || 1
      const currentAmbient = this._environment?.lights?.ambientLight?.intensity ?? baseAmbient
      lightScale = baseAmbient > 1e-4 ? currentAmbient / baseAmbient : 1
    }
    return stepCeilingLights(this._mazeGroup, this._elapsedSec, {
      playerWorldPos: this._playerWorldPos,
      lightScale,
      reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
      highContrast: Boolean(this.graphicsConfig?.highContrast),
      qualityPreset: this.graphicsConfig?.qualityPreset,
      dynamicLights: this.graphicsConfig?.dynamicLights,
      isSoftwareGl: this.isSoftwareGl,
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

    if (this._exitGateGroup) {
      setExitGateState(this._exitGateGroup, nextLocked, options)
      if (this.graphicsConfig?.highContrast) {
        syncExitGateOutlineColor(this._exitGateGroup, nextLocked)
      }
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
    this._syncCeilingLights()
    return updated
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
      this.setPlayerWorldPosition(
        result.exitPos.x,
        0,
        result.exitPos.z,
        {
          immediate: Boolean(options?.immediate),
          yaw: restoreYaw,
        }
      )
    } else {
      this._playerWorldPos.y = 0
      this.cameraRig?.setPlayerPosition(
        this._playerWorldPos.x,
        0,
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
    this._isSprintingThisTick = false
    this.flashlightActive = false
    this.battery = this.maxBattery
    if (this.spotlight) {
      this.spotlight.visible = false
      this.spotlight.intensity = 0
    }
    this._onFlashlightChange?.(false)
    this.cameraRig?.setShakeRoll(0)
    if (Number.isFinite(this._currentInitialYaw)) {
      this.cameraRig?.setLookDirection(this._currentInitialYaw, 0)
    }
    this.cameraRig?.update(0, { immediate: true })
    this.enemyManager?.resetEnemyStates()
    this.hazardManager?.resetHazardStates()
    this.hidingSpotManager?.resetStates()
    this.audioEngine?.reset()
    this.horrorDirector?.reset()
    this._playerWorldPos.y = 0
    this.syncPlayerVisibility()
    this._notifyStealthChange(true)
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
    this._syncFlashlightRig()
    return nextMode
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
    this._syncFlashlightRig()
  }

  applyLookDelta(deltaX = 0, deltaY = 0, options = {}) {
    if (this.isDisposed || !this.cameraRig) return
    this.cameraRig.applyLookDelta(deltaX, deltaY, options)
    if (this._playerGroup) {
      this._playerGroup.rotation.y = this.cameraRig.getLookDirection().yaw
    }
    this._syncFlashlightRig()
  }

  /**
   * Advances continuous player movement using delta-time kinematics,
   * normalized diagonal vectors, maze.grid anti-tunneling collision,
   * optional Wall Pass consumption, and single-fire cell-entry notifications.
   */
  stepMovement(inputState, delta = 0, options = {}) {
    if (
      this.isDisposed ||
      this.isPaused ||
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
        maxEnemyLights: this.performanceProfile.maxEnemyLights,
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
    this._currentInitialYaw = initialYaw

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
    this._syncFlashlightRig()

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
    this._syncCeilingLights(1)

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
    if (this.isPaused) {
      this.renderFrame()
    }
  }

  renderFrame() {
    if (this.isDisposed || !this.renderer || !this.scene || !this.camera) {
      return
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
    this.cameraRig?.setShakeRoll(shakeZ)

    if (this._inputSource && !this.isGameOver && !this.hasWon) {
      const inputState = this._inputSource()
      if (inputState) {
        this.stepMovement(inputState, safeDelta, { updateAnimation: false })
      }
    }

    if (this._playerAnimator) {
      this._playerAnimator.update(safeDelta, this._motionSample)
    }

    if (this.collectibleManager) {
      this.collectibleManager.update(safeDelta)
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

    if (this._onFrame) {
      this._onFrame({
        delta: safeDelta,
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
        playerGridCell: this.getPlayerGridCell(),
      })
      this._notifyStealthChange(false, stealthInfo)
    }

    let enemyResult = null
    if (this.enemyManager && !this.isGameOver && !this.hasWon) {
      enemyResult = this.enemyManager.update(safeDelta, {
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
      const hazardResult = this.hazardManager.update(safeDelta, {
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
      this.hazardManager.update(safeDelta, null)
    }

    if (this.cameraRig) {
      this.cameraRig.update(safeDelta)
    }
    this._syncFlashlightRig()

    if (this.horrorDirector) {
      this.horrorDirector.update(safeDelta, {
        playerWorldPos: this._playerWorldPos,
        playerGridCell: this.getPlayerGridCell(),
        isHidden: this.isHidden,
        health: this.health,
        maxHealth: this.maxHealth,
        elapsedTime: this._elapsedSec,
        enemies: this.enemyManager?.enemies?.values(),
      })
    }

    if (this._environment) {
      stepEnvironmentAtmosphere(this._environment, this._elapsedSec, {
        reducedMotion: Boolean(this.horrorDirector?.reducedMotion),
      })
    }
    this._syncCeilingLights()

    if (this.audioEngine) {
      this.audioEngine.update(safeDelta, {
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

    if (options.render !== false) {
      this.renderFrame()
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
    this._inputSource = null
    this._movementOptions = {}
    this.clearMaze()
    this.clearPlayer()
    this.clearEnvironment()

    if (this.spotlight) {
      if (this.spotlight.parent) {
        this.spotlight.parent.remove(this.spotlight)
      }
      this.spotlight.dispose?.()
      this.spotlight = null
    }
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
    this._exitGateGroup = null
    this._currentMaze = null
    this.scene = null
    this.camera = null
    this.renderer = null
    this.canvasHost = null

    releaseSharedPools(this)

    return true
  }
}
