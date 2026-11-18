import * as THREE from 'three'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { gridToWorld } from '../world/worldCoords.js'
import {
  applyEnvironmentToScene,
  buildEnvironment,
  DEFAULT_ENVIRONMENT_CONFIG,
  disposeEnvironment,
  syncEnvironmentToMaze,
  updateEnvironmentConfig,
} from './buildEnvironment.js'
import { buildMazeMeshes, disposeMazeGroup } from './buildMazeMeshes.js'
import { CameraRig } from './CameraRig.js'

export const LUMEN_VAULT_SCENE_COLORS = {
  voidBackground: DEFAULT_ENVIRONMENT_CONFIG.backgroundColor,
  chamberSurface: 0x101722,
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
    this._environment = null
    this._onFrame =
      typeof this.config.onFrame === 'function' ? this.config.onFrame : null

    const initialWidth = Math.max(1, Math.floor(canvasHost.clientWidth || 1))
    const initialHeight = Math.max(1, Math.floor(canvasHost.clientHeight || 1))

    this.scene = new THREE.Scene()

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

    const initialEnvConfig = {
      ...(this.config.environment || {}),
      ...(typeof config?.backgroundColor === 'number'
        ? { backgroundColor: config.backgroundColor }
        : {}),
    }
    this.setEnvironment(initialEnvConfig)

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

  setCameraMode(mode, options = {}) {
    if (this.isDisposed || !this.cameraRig) return null
    return this.cameraRig.setMode(mode, options)
  }

  updateCameraConfig(partialConfig = {}) {
    if (this.isDisposed || !this.cameraRig) return null
    return this.cameraRig.updateConfig(partialConfig)
  }

  setPlayerWorldPosition(x, y = 0, z = 0) {
    if (this.isDisposed || !this.cameraRig) return
    this.cameraRig.setPlayerPosition(x, y, z)
  }

  setLookDirection(yaw, pitch) {
    if (this.isDisposed || !this.cameraRig) return
    this.cameraRig.setLookDirection(yaw, pitch)
  }

  getMazeGroup() {
    return this._mazeGroup
  }

  clearMaze() {
    if (this._mazeGroup) {
      disposeMazeGroup(this._mazeGroup)
      this._mazeGroup = null
    }
    this._currentMaze = null
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
    this.scene.add(nextGroup)

    if (this._environment) {
      syncEnvironmentToMaze(this._environment, this.scene, maze)
    }

    // Anchor camera rig at the maze starting cell facing the opening corridor
    if (this.cameraRig && maze.start) {
      const startWorld = gridToWorld(maze.start.row, maze.start.col, maze)
      if (startWorld) {
        let initialYaw = 0
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

        this.cameraRig.setPlayerPosition(startWorld.x, 0, startWorld.z)
        this.cameraRig.setLookDirection(initialYaw, 0)
        this.cameraRig.snap()
      }
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

      if (this._onFrame) {
        this._onFrame({
          delta,
          elapsed: this._elapsedSec,
          scene: this.scene,
          camera: this.camera,
          cameraRig: this.cameraRig,
          renderer: this.renderer,
        })
      }

      if (this.cameraRig) {
        this.cameraRig.update(delta)
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
    this.clearMaze()
    this.clearEnvironment()

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
