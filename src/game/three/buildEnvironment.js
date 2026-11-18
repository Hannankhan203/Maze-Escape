import * as THREE from 'three'
import { CELL_SIZE, WALL_HEIGHT, gridToWorld } from '../world/worldCoords.js'

export const DEFAULT_ENVIRONMENT_CONFIG = {
  backgroundColor: 0x090d14, // --color-bg-void
  fogEnabled: true,
  fogType: 'exp2', // 'exp2' | 'linear'
  fogColor: 0x090d14,
  fogDensity: 0.0095,
  fogNear: 12,
  fogFar: 110,
  ambientColor: 0x172130, // --color-bg-elevated
  ambientIntensity: 0.46,
  hemiSkyColor: 0x577399, // Balanced cool-slate hemisphere fill
  hemiGroundColor: 0x0b121e,
  hemiIntensity: 0.82,
  directionalColor: 0xdbe6f0,
  directionalIntensity: 1.02,
  directionalPosition: { x: 24, y: 48, z: 32 },
  localizedLightsEnabled: true,
  startLightColor: 0x818cf8, // --color-start
  startLightIntensity: 2.8,
  startLightDistance: 15,
  exitLightColor: 0x10b981, // --color-exit
  exitLightIntensity: 3.2,
  exitLightDistance: 18,
  particlesEnabled: true,
  particleCount: 110,
  particleColor: 0x64748b,
  particleOpacity: 0.28,
  plinthEnabled: true,
  plinthColor: 0x0b1018, // --color-bg-recessed
}

function getMazeSpan(maze) {
  const rows = Array.isArray(maze?.grid) && maze.grid.length > 0
    ? maze.grid.length
    : maze?.rows || 11
  const cols =
    Array.isArray(maze?.grid?.[0]) && maze.grid[0].length > 0
      ? maze.grid[0].length
      : maze?.cols || 11
  return {
    rows,
    cols,
    width: cols * CELL_SIZE,
    depth: rows * CELL_SIZE,
  }
}

function createFogFromConfig(config) {
  if (!config.fogEnabled) {
    return null
  }

  if (config.fogType === 'linear') {
    return new THREE.Fog(config.fogColor, config.fogNear, config.fogFar)
  }

  return new THREE.FogExp2(config.fogColor, config.fogDensity)
}

function createVaultDustParticles(config, maze) {
  const { width, depth } = getMazeSpan(maze)
  const count = Math.max(0, Math.floor(config.particleCount || 0))
  if (!config.particlesEnabled || count === 0) {
    return null
  }

  const positions = new Float32Array(count * 3)
  // Deterministic spatial distribution so scenes are reproducible
  let seed = 1337
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }

  const spreadX = width * 0.96
  const spreadZ = depth * 0.96
  const maxHeight = WALL_HEIGHT * 1.45

  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (nextRand() - 0.5) * spreadX
    positions[i * 3 + 1] = 0.25 + nextRand() * maxHeight
    positions[i * 3 + 2] = (nextRand() - 0.5) * spreadZ
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const material = new THREE.PointsMaterial({
    color: config.particleColor,
    size: 0.11,
    sizeAttenuation: true,
    transparent: true,
    opacity: config.particleOpacity,
    depthWrite: false,
    fog: true,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'maze-env-dust'
  return points
}

function createOuterPlinth(config, maze) {
  if (!config.plinthEnabled) {
    return null
  }

  const { width, depth } = getMazeSpan(maze)
  const margin = CELL_SIZE * 2
  const plinthHeight = 0.4
  const geometry = new THREE.BoxGeometry(
    width + margin,
    plinthHeight,
    depth + margin
  )
  const material = new THREE.MeshStandardMaterial({
    color: config.plinthColor,
    roughness: 0.96,
    metalness: 0.04,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'maze-env-plinth'
  // Sit strictly beneath maze-floor (y = -0.25..0) to prevent any Z-fighting
  mesh.position.set(0, -0.26 - plinthHeight / 2, 0)
  return mesh
}

function createLocalizedLights(config, maze) {
  const startLight = new THREE.PointLight(
    config.startLightColor,
    config.localizedLightsEnabled ? config.startLightIntensity : 0,
    config.startLightDistance,
    2
  )
  startLight.name = 'maze-env-light-start'

  const exitLight = new THREE.PointLight(
    config.exitLightColor,
    config.localizedLightsEnabled ? config.exitLightIntensity : 0,
    config.exitLightDistance,
    2
  )
  exitLight.name = 'maze-env-light-exit'

  const envLights = { startLight, exitLight }
  syncLocalizedLightPositions(envLights, maze)
  return envLights
}

function syncLocalizedLightPositions({ startLight, exitLight }, maze) {
  if (startLight) {
    const startWorld =
      maze?.start && gridToWorld(maze.start.row, maze.start.col, maze)
    if (startWorld) {
      startLight.position.set(startWorld.x, 1.4, startWorld.z)
      startLight.visible = true
    } else {
      startLight.visible = false
    }
  }

  if (exitLight) {
    const exitWorld =
      maze?.exit && gridToWorld(maze.exit.row, maze.exit.col, maze)
    if (exitWorld) {
      exitLight.position.set(exitWorld.x, 1.5, exitWorld.z)
      exitLight.visible = true
    } else {
      exitLight.visible = false
    }
  }
}

/**
 * Builds a dark Lumen Vault horror atmosphere bundle (fog, balanced lights,
 * localized start/exit accents, recessed vault plinth, and subtle dust motes).
 */
export function buildEnvironment({ maze = null, config = {} } = {}) {
  const resolvedConfig = {
    ...DEFAULT_ENVIRONMENT_CONFIG,
    ...(config || {}),
    directionalPosition: {
      ...DEFAULT_ENVIRONMENT_CONFIG.directionalPosition,
      ...(config?.directionalPosition || {}),
    },
  }

  const group = new THREE.Group()
  group.name = 'maze-environment-root'

  const ambientLight = new THREE.AmbientLight(
    resolvedConfig.ambientColor,
    resolvedConfig.ambientIntensity
  )
  ambientLight.name = 'maze-env-light-ambient'

  const hemiLight = new THREE.HemisphereLight(
    resolvedConfig.hemiSkyColor,
    resolvedConfig.hemiGroundColor,
    resolvedConfig.hemiIntensity
  )
  hemiLight.name = 'maze-env-light-hemi'

  const directionalLight = new THREE.DirectionalLight(
    resolvedConfig.directionalColor,
    resolvedConfig.directionalIntensity
  )
  directionalLight.name = 'maze-env-light-directional'
  directionalLight.position.set(
    resolvedConfig.directionalPosition.x,
    resolvedConfig.directionalPosition.y,
    resolvedConfig.directionalPosition.z
  )

  const { startLight, exitLight } = createLocalizedLights(resolvedConfig, maze)

  group.add(ambientLight)
  group.add(hemiLight)
  group.add(directionalLight)
  group.add(startLight)
  group.add(exitLight)

  const plinthMesh = createOuterPlinth(resolvedConfig, maze)
  if (plinthMesh) {
    group.add(plinthMesh)
  }

  const dustPoints = createVaultDustParticles(resolvedConfig, maze)
  if (dustPoints) {
    group.add(dustPoints)
  }

  const fog = createFogFromConfig(resolvedConfig)

  return {
    config: resolvedConfig,
    group,
    fog,
    backgroundColor: resolvedConfig.backgroundColor,
    lights: {
      ambientLight,
      hemiLight,
      directionalLight,
      startLight,
      exitLight,
    },
    details: {
      plinthMesh,
      dustPoints,
    },
  }
}

/**
 * Attaches a built environment bundle to a Three.js Scene.
 */
export function applyEnvironmentToScene(scene, env) {
  if (!scene || !env) return
  scene.background = new THREE.Color(env.backgroundColor)
  scene.fog = env.fog || null
  if (env.group && env.group.parent !== scene) {
    scene.add(env.group)
  }
}

/**
 * Re-anchors localized lights and environmental footprint details to a newly
 * loaded maze without recreating the renderer or maze wall geometry.
 */
export function syncEnvironmentToMaze(env, scene, maze) {
  if (!env) return

  syncLocalizedLightPositions(env.lights || {}, maze)

  if (env.details?.plinthMesh) {
    if (env.details.plinthMesh.parent) {
      env.details.plinthMesh.parent.remove(env.details.plinthMesh)
    }
    env.details.plinthMesh.geometry?.dispose()
    env.details.plinthMesh.material?.dispose()
    env.details.plinthMesh = null
  }

  const nextPlinth = createOuterPlinth(env.config, maze)
  if (nextPlinth && env.group) {
    env.details.plinthMesh = nextPlinth
    env.group.add(nextPlinth)
  }

  if (env.details?.dustPoints) {
    if (env.details.dustPoints.parent) {
      env.details.dustPoints.parent.remove(env.details.dustPoints)
    }
    env.details.dustPoints.geometry?.dispose()
    env.details.dustPoints.material?.dispose()
    env.details.dustPoints = null
  }

  const nextDust = createVaultDustParticles(env.config, maze)
  if (nextDust && env.group) {
    env.details.dustPoints = nextDust
    env.group.add(nextDust)
  }

  if (scene && env.group && env.group.parent !== scene) {
    scene.add(env.group)
  }
}

/**
 * Updates environment configuration in place on an existing scene without
 * touching maze wall/floor geometry or recreating the WebGLRenderer.
 */
export function updateEnvironmentConfig(env, scene, partialConfig = {}, maze = null) {
  if (!env || !scene) return null

  const nextConfig = {
    ...env.config,
    ...(partialConfig || {}),
    directionalPosition: {
      ...env.config.directionalPosition,
      ...(partialConfig?.directionalPosition || {}),
    },
  }
  env.config = nextConfig
  env.backgroundColor = nextConfig.backgroundColor
  scene.background = new THREE.Color(nextConfig.backgroundColor)

  // Update fog
  env.fog = createFogFromConfig(nextConfig)
  scene.fog = env.fog

  // Update lights in-place
  const { ambientLight, hemiLight, directionalLight, startLight, exitLight } =
    env.lights || {}

  if (ambientLight) {
    ambientLight.color.setHex(nextConfig.ambientColor)
    ambientLight.intensity = nextConfig.ambientIntensity
  }
  if (hemiLight) {
    hemiLight.color.setHex(nextConfig.hemiSkyColor)
    hemiLight.groundColor.setHex(nextConfig.hemiGroundColor)
    hemiLight.intensity = nextConfig.hemiIntensity
  }
  if (directionalLight) {
    directionalLight.color.setHex(nextConfig.directionalColor)
    directionalLight.intensity = nextConfig.directionalIntensity
    directionalLight.position.set(
      nextConfig.directionalPosition.x,
      nextConfig.directionalPosition.y,
      nextConfig.directionalPosition.z
    )
  }
  if (startLight) {
    startLight.color.setHex(nextConfig.startLightColor)
    startLight.intensity = nextConfig.localizedLightsEnabled
      ? nextConfig.startLightIntensity
      : 0
    startLight.distance = nextConfig.startLightDistance
  }
  if (exitLight) {
    exitLight.color.setHex(nextConfig.exitLightColor)
    exitLight.intensity = nextConfig.localizedLightsEnabled
      ? nextConfig.exitLightIntensity
      : 0
    exitLight.distance = nextConfig.exitLightDistance
  }

  // Refresh optional plinth & particle layers
  if (
    'plinthEnabled' in partialConfig ||
    'plinthColor' in partialConfig ||
    'particlesEnabled' in partialConfig ||
    'particleCount' in partialConfig ||
    'particleColor' in partialConfig ||
    'particleOpacity' in partialConfig
  ) {
    syncEnvironmentToMaze(env, scene, maze)
  }

  return env
}

/**
 * Safely disposes all geometries, materials, lights, and scene references
 * belonging to an environment bundle.
 */
export function disposeEnvironment(env, scene = null) {
  if (!env) return false

  if (env.group) {
    env.group.traverse((node) => {
      if (node.geometry && typeof node.geometry.dispose === 'function') {
        node.geometry.dispose()
      }
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material]
        for (let i = 0; i < mats.length; i += 1) {
          mats[i]?.dispose?.()
        }
      }
      if (typeof node.dispose === 'function' && node !== env.group) {
        node.dispose()
      }
    })

    if (env.group.parent) {
      env.group.parent.remove(env.group)
    }
    env.group.clear()
  }

  if (scene) {
    scene.fog = null
  }

  env.fog = null
  env.lights = null
  env.details = null
  env.group = null

  return true
}
