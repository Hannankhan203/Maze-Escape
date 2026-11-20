import * as THREE from 'three'
import { createRng } from '../../utils/rng.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  CELL_SIZE,
  WALL_HEIGHT,
  gridToWorld,
} from '../world/worldCoords.js'

const FACE_DIRS = [
  { name: 'north', dr: -1, dc: 0, nx: 0, nz: -1, tx: 1, tz: 0, yaw: 0 },
  { name: 'south', dr: 1, dc: 0, nx: 0, nz: 1, tx: -1, tz: 0, yaw: Math.PI },
  { name: 'west', dr: 0, dc: -1, nx: -1, nz: 0, tx: 0, tz: -1, yaw: Math.PI / 2 },
  { name: 'east', dr: 0, dc: 1, nx: 1, nz: 0, tx: 0, tz: 1, yaw: -Math.PI / 2 },
]

const DETERIORATION_MATERIALS = {
  weatheredConcrete: new THREE.MeshStandardMaterial({
    color: 0x47515e,
    roughness: 0.94,
    metalness: 0.02,
  }),
  innerConcrete: new THREE.MeshStandardMaterial({
    color: 0x222730,
    roughness: 0.98,
    metalness: 0.01,
  }),
  spalledSurface: new THREE.MeshStandardMaterial({
    color: 0x38404c,
    roughness: 0.95,
    metalness: 0.02,
  }),
  rustyRebar: new THREE.MeshStandardMaterial({
    color: 0x3d2112,
    roughness: 0.7,
    metalness: 0.88,
  }),
  rebarCore: new THREE.MeshStandardMaterial({
    color: 0x24130a,
    roughness: 0.65,
    metalness: 0.92,
  }),
  floorRubble: new THREE.MeshStandardMaterial({
    color: 0x323a46,
    roughness: 0.96,
    metalness: 0.01,
  }),
}

function configureShadows(group) {
  group.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })
}

const DETERIORATION_PROFILES = [
  'hairlineCracks',
  'surfaceSpalling',
  'deepBreakage',
  'exposedReinforcement',
  'heavyCollapse',
]

/**
 * Builds photorealistic procedural structural deterioration (varied fracture cavities,
 * multi-layered spalling, oxidized bent rebar grids, and floor rubble) without altering wall collision.
 */
export function buildStructuralDeterioration(maze) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0) {
    return null
  }

  const rows = grid.length
  const cols = grid[0].length
  const baseSeed = String(maze.seed ?? maze.id ?? 'maze')
  const rng = createRng(`${baseSeed}-photorealistic-deterioration-v2`)

  const rootGroup = new THREE.Group()
  rootGroup.name = 'maze-structural-deterioration'

  const bodyHeight = WALL_HEIGHT - 0.14
  const halfCell = CELL_SIZE / 2

  let damageCount = 0

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c] !== CELL_TYPES.WALL) continue

      // Check exposed faces
      let exposedCount = 0
      for (let f = 0; f < FACE_DIRS.length; f += 1) {
        const nr = r + FACE_DIRS[f].dr
        const nc = c + FACE_DIRS[f].dc
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === CELL_TYPES.PATH) {
          exposedCount += 1
        }
      }
      if (exposedCount === 0) continue

      for (let f = 0; f < FACE_DIRS.length; f += 1) {
        const dir = FACE_DIRS[f]
        const nr = r + dir.dr
        const nc = c + dir.dc
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
        if (grid[nr][nc] !== CELL_TYPES.PATH) continue

        // Unique coordinate hash so every wall coordinate produces genuinely distinct deterioration
        const faceHash = (((r * 73856093) ^ (c * 19349663) ^ (f * 83492791) ^ (Number(maze.seed) || 1337)) >>> 0) / 4294967295
        
        // 35% probability of intact / lightly aged wall section (natural spacing between damaged areas)
        if (faceHash > 0.65) continue

        const world = gridToWorld(r, c, maze)
        if (!world) continue

        // Select distinct profile deterministically from faceHash
        const profileIndex = Math.floor(faceHash * 7.9) % DETERIORATION_PROFILES.length
        const profile = DETERIORATION_PROFILES[profileIndex]

        const faceGroup = new THREE.Group()
        faceGroup.name = `deterioration-${profile}-${r}-${c}-${dir.name}`

        const lateralShift = (faceHash * 3.7 - Math.floor(faceHash * 3.7) - 0.5) * (CELL_SIZE - 0.9)
        const verticalCenter = 0.6 + (faceHash * 5.1 - Math.floor(faceHash * 5.1)) * (bodyHeight - 1.2)

        if (profile === 'hairlineCracks') {
          // Fine fractured surface lines & micro-spalls
          const crackGeo = new THREE.BoxGeometry(0.5 + faceHash * 0.4, 0.7 + faceHash * 0.5, 0.03)
          const crackMesh = new THREE.Mesh(crackGeo, DETERIORATION_MATERIALS.innerConcrete)
          crackMesh.position.set(
            world.x + dir.nx * (halfCell - 0.015) + dir.tx * lateralShift,
            verticalCenter,
            world.z + dir.nz * (halfCell - 0.015) + dir.tz * lateralShift
          )
          crackMesh.rotation.y = dir.yaw
          faceGroup.add(crackMesh)
        } else if (profile === 'surfaceSpalling') {
          // Aggregate exposure and surface scaling
          const spallWidth = 0.9 + faceHash * 0.8
          const spallHeight = 0.8 + faceHash * 0.7
          const spallGeo = new THREE.BoxGeometry(spallWidth, spallHeight, 0.06)
          const spallMesh = new THREE.Mesh(spallGeo, DETERIORATION_MATERIALS.spalledSurface)
          spallMesh.position.set(
            world.x + dir.nx * (halfCell - 0.03) + dir.tx * lateralShift,
            verticalCenter,
            world.z + dir.nz * (halfCell - 0.03) + dir.tz * lateralShift
          )
          spallMesh.rotation.y = dir.yaw
          faceGroup.add(spallMesh)
        } else if (profile === 'deepBreakage') {
          // Deep recessed cavity with irregular inner concrete
          const width = 0.8 + (faceHash * 2.3 % 0.7)
          const height = 0.9 + (faceHash * 4.1 % 0.8)
          const depth = 0.12 + (faceHash * 1.7 % 0.1)

          const cavityGeo = new THREE.BoxGeometry(width, height, depth)
          const cavityMesh = new THREE.Mesh(cavityGeo, DETERIORATION_MATERIALS.innerConcrete)
          cavityMesh.position.set(
            world.x + dir.nx * (halfCell - depth / 2) + dir.tx * lateralShift,
            verticalCenter,
            world.z + dir.nz * (halfCell - depth / 2) + dir.tz * lateralShift
          )
          cavityMesh.rotation.y = dir.yaw
          faceGroup.add(cavityMesh)

          const flakeGeo = new THREE.BoxGeometry(width + 0.16, height + 0.16, 0.03)
          const flakeMesh = new THREE.Mesh(flakeGeo, DETERIORATION_MATERIALS.weatheredConcrete)
          flakeMesh.position.set(
            world.x + dir.nx * (halfCell - 0.015) + dir.tx * lateralShift,
            verticalCenter,
            world.z + dir.nz * (halfCell - 0.015) + dir.tz * lateralShift
          )
          flakeMesh.rotation.y = dir.yaw
          faceGroup.add(flakeMesh)
        } else if (profile === 'exposedReinforcement' || profile === 'heavyCollapse') {
          // Severe damage with exposed oxidized rebar grid and chunks
          const width = 1.0 + (faceHash * 1.9 % 0.9)
          const height = 1.1 + (faceHash * 3.3 % 1.0)
          const depth = 0.16 + (faceHash * 1.4 % 0.12)

          const cavityGeo = new THREE.BoxGeometry(width, height, depth)
          const cavityMesh = new THREE.Mesh(cavityGeo, DETERIORATION_MATERIALS.innerConcrete)
          cavityMesh.position.set(
            world.x + dir.nx * (halfCell - depth / 2) + dir.tx * lateralShift,
            verticalCenter,
            world.z + dir.nz * (halfCell - depth / 2) + dir.tz * lateralShift
          )
          cavityMesh.rotation.y = dir.yaw
          faceGroup.add(cavityMesh)

          // Protruding bent rusty rebar grid (2 to 4 distinct bars)
          const rebarCount = 2 + Math.floor((faceHash * 7.1) % 3)
          for (let rb = 0; rb < rebarCount; rb += 1) {
            const barLen = 0.5 + (rb * 0.12)
            const barGeo = new THREE.CylinderGeometry(0.018 + rb * 0.005, 0.018 + rb * 0.005, barLen, 6)
            const barMesh = new THREE.Mesh(barGeo, rb % 2 === 0 ? DETERIORATION_MATERIALS.rustyRebar : DETERIORATION_MATERIALS.rebarCore)

            const rx = (rb - (rebarCount - 1) / 2) * 0.32
            const ry = (rb * 0.15 - 0.1)

            barMesh.position.set(
              world.x + dir.nx * (halfCell - depth * 0.5) + dir.tx * (lateralShift + rx),
              verticalCenter + ry,
              world.z + dir.nz * (halfCell - depth * 0.5) + dir.tz * (lateralShift + rx)
            )
            barMesh.rotation.x = 0.3 + (rb * 0.2)
            barMesh.rotation.z = (dir.nx !== 0 ? Math.PI / 2 : 0) + (rb * 0.25 - 0.15)
            faceGroup.add(barMesh)
          }

          // Scattered concrete rubble on floor at base of heavy damage
          if (profile === 'heavyCollapse' && rng() < 0.85) {
            const rubbleCount = 2 + Math.floor((faceHash * 5.3) % 2)
            for (let rb = 0; rb < rubbleCount; rb += 1) {
              const rGeo = new THREE.BoxGeometry(0.3 + rb * 0.15, 0.06 + rb * 0.03, 0.3 + rb * 0.12)
              const rMesh = new THREE.Mesh(rGeo, DETERIORATION_MATERIALS.floorRubble)
              rMesh.position.set(
                world.x + dir.nx * (halfCell + 0.55 + rb * 0.2) + dir.tx * (lateralShift + (rb === 0 ? 0.2 : -0.2)),
                0.03,
                world.z + dir.nz * (halfCell + 0.55 + rb * 0.2) + dir.tz * (lateralShift + (rb === 0 ? 0.2 : -0.2))
              )
              rMesh.rotation.y = faceHash * (rb + 1) * 2.5
              rMesh.rotation.x = 0.12 * (rb % 2 === 0 ? 1 : -1)
              faceGroup.add(rMesh)
            }
          }
        }

        configureShadows(faceGroup)
        rootGroup.add(faceGroup)
        damageCount += 1
      }
    }
  }

  rootGroup.userData = {
    damageFeatureCount: damageCount,
  }

  return damageCount > 0 ? rootGroup : null
}
