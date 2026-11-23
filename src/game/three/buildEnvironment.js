import * as THREE from 'three'
import { CELL_SIZE, WALL_HEIGHT } from '../world/worldCoords.js'
import { getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import { isSharedResource } from './sharedResources.js'
import {
  buildUndergroundBackdrop,
  disposeUndergroundBackdrop,
  updateUndergroundBackdrop,
} from './undergroundBackdrop.js'
import {
  ELEVATOR_SHAFT_CONFIG,
  resolveElevatorShaftCutouts,
} from './buildElevatorShafts.js'

export const DEFAULT_ENVIRONMENT_CONFIG = {
  backgroundColor: 0x0b111b, // Deep dark midnight slate
  fogEnabled: true,
  fogType: 'exp2', // 'exp2' | 'linear'
  fogColor: 0x0b111b,
  fogDensity: 0.0072,
  fogNear: 16,
  fogFar: 130,
  ambientColor: 0x33445e, // Low cool slate ambient so dark corridors stay atmospheric
  ambientIntensity: 0.26,
  hemiSkyColor: 0x3b5170, // Subdued underground hemisphere fill without washing out shadows
  hemiGroundColor: 0x0f1521,
  hemiIntensity: 0.76,
  directionalColor: 0xcfe0f5,
  directionalIntensity: 0.56,
  directionalPosition: { x: 24, y: 48, z: 32 },
  fillColor: 0x4c6588, // Gentle counter-directional fill for unlit wall relief
  fillIntensity: 0.28,
  fillPosition: { x: -28, y: 34, z: -26 },
  particlesEnabled: true,
  particleCount: 110,
  particleColor: 0x64748b,
  particleOpacity: 0.28,
  plinthEnabled: true,
  plinthColor: 0x0e1522,
  backdropEnabled: true,
  qualityPreset: 'high',
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
  const surfaceSet = getMazeSurfaceTextureSet({ qualityPreset: config.qualityPreset })
  const material = new THREE.MeshStandardMaterial({
    color: config.plinthColor,
    map: surfaceSet?.cap?.map || null,
    roughness: 0.96,
    metalness: 0.05,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'maze-env-plinth'
  mesh.receiveShadow = true
  // Sit strictly beneath maze-floor (y = -0.25..0) to prevent any Z-fighting
  mesh.position.set(0, -0.26 - plinthHeight / 2, 0)
  return mesh
}

function createBackdropLayer(config, maze) {
  if (config.backdropEnabled === false) {
    return null
  }
  const shaftCutouts = maze
    ? resolveElevatorShaftCutouts(maze, ELEVATOR_SHAFT_CONFIG.wallOuterHalfSpan)
    : []
  return buildUndergroundBackdrop({
    span: getMazeSpan(maze),
    backgroundColor: config.backgroundColor,
    fogColor: config.fogColor,
    qualityPreset: config.qualityPreset,
    shaftCutouts,
  })
}

function syncDirectionalShadowBounds(directionalLight, maze) {
  if (!directionalLight?.shadow?.camera) return
  const { width, depth } = getMazeSpan(maze)
  const halfSpan = Math.max(24, Math.max(width, depth) * 0.58)
  const shadowCam = directionalLight.shadow.camera
  shadowCam.left = -halfSpan
  shadowCam.right = halfSpan
  shadowCam.top = halfSpan
  shadowCam.bottom = -halfSpan
  shadowCam.near = 2
  shadowCam.far = Math.max(140, halfSpan * 2.6 + 50)
  shadowCam.updateProjectionMatrix()
}

/**
 * Builds a dark Lumen Vault horror atmosphere bundle (fog, balanced global lights,
 * recessed vault plinth, underground backdrop, and subtle dust motes).
 */
export function buildEnvironment({ maze = null, config = {} } = {}) {
  const resolvedConfig = {
    ...DEFAULT_ENVIRONMENT_CONFIG,
    ...(config || {}),
    directionalPosition: {
      ...DEFAULT_ENVIRONMENT_CONFIG.directionalPosition,
      ...(config?.directionalPosition || {}),
    },
    fillPosition: {
      ...DEFAULT_ENVIRONMENT_CONFIG.fillPosition,
      ...(config?.fillPosition || {}),
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
  directionalLight.castShadow = false
  if (directionalLight.shadow) {
    directionalLight.shadow.mapSize?.set?.(2048, 2048)
    directionalLight.shadow.bias = -0.0005
    directionalLight.shadow.normalBias = 0.03
    directionalLight.shadow.radius = 2.5
    syncDirectionalShadowBounds(directionalLight, maze)
  }

  const fillLight = new THREE.DirectionalLight(
    resolvedConfig.fillColor,
    resolvedConfig.fillIntensity
  )
  fillLight.name = 'maze-env-light-fill'
  fillLight.position.set(
    resolvedConfig.fillPosition.x,
    resolvedConfig.fillPosition.y,
    resolvedConfig.fillPosition.z
  )

  group.add(ambientLight)
  group.add(hemiLight)
  group.add(directionalLight)
  group.add(fillLight)

  const plinthMesh = createOuterPlinth(resolvedConfig, maze)
  if (plinthMesh) {
    group.add(plinthMesh)
  }

  const backdropGroup = createBackdropLayer(resolvedConfig, maze)
  if (backdropGroup) {
    group.add(backdropGroup)
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
      fillLight,
    },
    details: {
      plinthMesh,
      backdropGroup,
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
 * Re-anchors shadow bounds and environmental footprint details to a newly
 * loaded maze without recreating the renderer or maze wall geometry.
 */
export function syncEnvironmentToMaze(env, scene, maze) {
  if (!env) return

  syncDirectionalShadowBounds(env.lights?.directionalLight, maze)

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

  if (env.details?.backdropGroup) {
    disposeUndergroundBackdrop(env.details.backdropGroup)
    env.details.backdropGroup = null
  }

  const nextBackdrop = createBackdropLayer(env.config, maze)
  if (nextBackdrop && env.group) {
    env.details.backdropGroup = nextBackdrop
    env.group.add(nextBackdrop)
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

export function stepEnvironmentAtmosphere(env, elapsedSec = 0, options = {}) {
  const backdrop = env?.details?.backdropGroup
  if (!backdrop) return

  const baseAmbient = env?.config?.ambientIntensity || 1
  const currentAmbient = env?.lights?.ambientLight?.intensity ?? baseAmbient
  const lightScale = baseAmbient > 1e-4 ? currentAmbient / baseAmbient : 1

  updateUndergroundBackdrop(backdrop, elapsedSec, {
    lightScale: Number.isFinite(options?.lightScale) ? options.lightScale : lightScale,
    reducedMotion: Boolean(options?.reducedMotion),
  })
}

/**
 * Updates environment configuration in place on an existing scene without
 * touching maze wall/floor geometry or recreating the WebGLRenderer.
 */
export function updateEnvironmentConfig(env, scene, partialConfig = {}, maze = null) {
  if (!env || !scene) return null

  const prevConfig = env.config || DEFAULT_ENVIRONMENT_CONFIG
  const nextConfig = {
    ...prevConfig,
    ...(partialConfig || {}),
    directionalPosition: {
      ...prevConfig.directionalPosition,
      ...(partialConfig?.directionalPosition || {}),
    },
    fillPosition: {
      ...(prevConfig.fillPosition || DEFAULT_ENVIRONMENT_CONFIG.fillPosition),
      ...(partialConfig?.fillPosition || {}),
    },
  }
  env.config = nextConfig
  env.backgroundColor = nextConfig.backgroundColor
  if (!scene.background || !scene.background.isColor) {
    scene.background = new THREE.Color(nextConfig.backgroundColor)
  } else if (prevConfig.backgroundColor !== nextConfig.backgroundColor) {
    scene.background.setHex(nextConfig.backgroundColor)
  }

  // Update fog only if enabled/type/parameters actually changed or missing when enabled
  const fogNeedsRefresh =
    Boolean(prevConfig.fogEnabled) !== Boolean(nextConfig.fogEnabled) ||
    (nextConfig.fogEnabled &&
      (!env.fog ||
        prevConfig.fogType !== nextConfig.fogType ||
        prevConfig.fogColor !== nextConfig.fogColor ||
        prevConfig.fogDensity !== nextConfig.fogDensity ||
        prevConfig.fogNear !== nextConfig.fogNear ||
        prevConfig.fogFar !== nextConfig.fogFar))
  if (fogNeedsRefresh) {
    env.fog = createFogFromConfig(nextConfig)
    scene.fog = env.fog
  }

  // Update lights in-place
  const {
    ambientLight,
    hemiLight,
    directionalLight,
    fillLight,
  } = env.lights || {}

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
    syncDirectionalShadowBounds(directionalLight, maze)
  }
  if (fillLight) {
    fillLight.color.setHex(nextConfig.fillColor)
    fillLight.intensity = nextConfig.fillIntensity
    fillLight.position.set(
      nextConfig.fillPosition.x,
      nextConfig.fillPosition.y,
      nextConfig.fillPosition.z
    )
  }

  if (!env.details) {
    env.details = {}
  }

  // Sync plinth: rebuild only if enabled/color changed, or swap cap texture in-place on preset change
  const prevPlinthEnabled = prevConfig.plinthEnabled !== false
  const nextPlinthEnabled = nextConfig.plinthEnabled !== false
  const plinthRebuildRequired =
    prevPlinthEnabled !== nextPlinthEnabled ||
    (nextPlinthEnabled &&
      (!env.details.plinthMesh || prevConfig.plinthColor !== nextConfig.plinthColor))

  if (plinthRebuildRequired) {
    if (env.details.plinthMesh) {
      if (env.details.plinthMesh.parent) {
        env.details.plinthMesh.parent.remove(env.details.plinthMesh)
      }
      env.details.plinthMesh.geometry?.dispose()
      env.details.plinthMesh.material?.dispose()
      env.details.plinthMesh = null
    }
    const nextPlinth = createOuterPlinth(nextConfig, maze)
    if (nextPlinth && env.group) {
      env.details.plinthMesh = nextPlinth
      env.group.add(nextPlinth)
    }
  } else if (
    nextPlinthEnabled &&
    env.details.plinthMesh?.material &&
    prevConfig.qualityPreset !== nextConfig.qualityPreset
  ) {
    const nextCapMap =
      getMazeSurfaceTextureSet({ qualityPreset: nextConfig.qualityPreset })?.cap?.map || null
    if (env.details.plinthMesh.material.map !== nextCapMap) {
      env.details.plinthMesh.material.map = nextCapMap
      env.details.plinthMesh.material.needsUpdate = true
    }
  }

  // Sync underground backdrop only when backdrop enablement, quality tier, or sky/horizon colors change
  const prevBackdropEnabled = prevConfig.backdropEnabled !== false
  const nextBackdropEnabled = nextConfig.backdropEnabled !== false
  const backdropRebuildRequired =
    prevBackdropEnabled !== nextBackdropEnabled ||
    (nextBackdropEnabled &&
      (!env.details.backdropGroup ||
        prevConfig.qualityPreset !== nextConfig.qualityPreset ||
        prevConfig.backgroundColor !== nextConfig.backgroundColor ||
        prevConfig.fogColor !== nextConfig.fogColor))

  if (backdropRebuildRequired) {
    if (env.details.backdropGroup) {
      disposeUndergroundBackdrop(env.details.backdropGroup)
      env.details.backdropGroup = null
    }
    const nextBackdrop = createBackdropLayer(nextConfig, maze)
    if (nextBackdrop && env.group) {
      env.details.backdropGroup = nextBackdrop
      env.group.add(nextBackdrop)
    }
  }

  // Sync dust particles only when enabled/count change (or update material props in-place)
  const prevParticlesActive =
    Boolean(prevConfig.particlesEnabled) && Math.floor(prevConfig.particleCount || 0) > 0
  const nextParticlesActive =
    Boolean(nextConfig.particlesEnabled) && Math.floor(nextConfig.particleCount || 0) > 0
  const dustRebuildRequired =
    prevParticlesActive !== nextParticlesActive ||
    (nextParticlesActive &&
      (!env.details.dustPoints ||
        Math.floor(prevConfig.particleCount || 0) !== Math.floor(nextConfig.particleCount || 0)))

  if (dustRebuildRequired) {
    if (env.details.dustPoints) {
      if (env.details.dustPoints.parent) {
        env.details.dustPoints.parent.remove(env.details.dustPoints)
      }
      env.details.dustPoints.geometry?.dispose()
      env.details.dustPoints.material?.dispose()
      env.details.dustPoints = null
    }
    const nextDust = createVaultDustParticles(nextConfig, maze)
    if (nextDust && env.group) {
      env.details.dustPoints = nextDust
      env.group.add(nextDust)
    }
  } else if (
    nextParticlesActive &&
    env.details.dustPoints?.material &&
    (prevConfig.particleColor !== nextConfig.particleColor ||
      prevConfig.particleOpacity !== nextConfig.particleOpacity)
  ) {
    env.details.dustPoints.material.color?.setHex?.(nextConfig.particleColor)
    env.details.dustPoints.material.opacity = nextConfig.particleOpacity
  }

  return env
}

/**
 * Safely disposes all geometries, materials, lights, and scene references
 * belonging to an environment bundle.
 */
export function disposeEnvironment(env, scene = null) {
  if (!env) return false

  if (env.details?.backdropGroup) {
    disposeUndergroundBackdrop(env.details.backdropGroup)
    env.details.backdropGroup = null
  }

  if (env.group) {
    env.group.traverse((node) => {
      if (node.geometry && !isSharedResource(node.geometry) && typeof node.geometry.dispose === 'function') {
        node.geometry.dispose()
      }
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material]
        for (let i = 0; i < mats.length; i += 1) {
          const mat = mats[i]
          if (mat && !isSharedResource(mat)) {
            mat.dispose?.()
          }
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
