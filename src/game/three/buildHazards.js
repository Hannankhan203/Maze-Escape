import * as THREE from 'three'
import { CELL_SIZE } from '../world/worldCoords.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import {
  isSharedResource,
  markSharedResource,
  registerSharedPoolClearer,
} from './sharedResources.js'

export const HAZARD_PALETTE = {
  basePlate: 0x29374d,
  spikeMetal: 0xaab8c9,
  spikeTip: 0xef4444,
  plateRim: 0x5b6b82,
  plateCoreDormant: 0x475569,
  plateCoreActive: 0xf59e0b,
  gridWire: 0x1a2538,
  gridEnergyDormant: 0x38bdf8,
  gridEnergyWarning: 0xf59e0b,
  gridEnergyActive: 0xef4444,
  wiringConduit: 0x4c5868,
  wiringHardware: 0x2b3440,
  wiringCable: 0x1a1f27,
  wiringCopper: 0xc8743a,
  wiringCaution: 0xb48a28,
  wiringSparkWarning: 0xffdf73,
  wiringSparkActive: 0xbae6fd,
  wiringArcActive: 0x93e5ff,
  wiringCharred: 0x1b1d21,
}

const hazardGeoPool = new Map()
const hazardMatPool = new Map()

function getPooledGeometry(key, factory) {
  let geo = hazardGeoPool.get(key)
  if (!geo) {
    geo = markSharedResource(factory())
    hazardGeoPool.set(key, geo)
  }
  return geo
}

function getPooledMaterial(key, factory) {
  let mat = hazardMatPool.get(key)
  if (!mat) {
    mat = markSharedResource(factory())
    hazardMatPool.set(key, mat)
  }
  return mat
}

export function disposeHazardPools() {
  for (const geo of hazardGeoPool.values()) {
    geo?.dispose?.()
  }
  hazardGeoPool.clear()

  for (const mat of hazardMatPool.values()) {
    mat?.dispose?.()
  }
  hazardMatPool.clear()
}

export function getHazardPoolStats() {
  return {
    geometries: hazardGeoPool.size,
    materials: hazardMatPool.size,
  }
}

registerSharedPoolClearer(disposeHazardPools)

/**
 * Builds procedural 3D hazards for the maze: floor spikes, pressure plates, and electrical grids.
 */
export function buildHazardMesh(hazardData = {}) {
  const type = hazardData.type || HAZARD_TYPES.FLOOR_SPIKES
  const root = new THREE.Group()
  root.name = `hazard-${type}-${hazardData.id || 'default'}`

  const size = CELL_SIZE * 0.85

  switch (type) {
    case HAZARD_TYPES.FLOOR_SPIKES: {
      const baseGeo = getPooledGeometry(
        'spikes:base',
        () => new THREE.BoxGeometry(size, 0.08, size)
      )
      const baseMat = getPooledMaterial(
        'spikes:base',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.basePlate,
            roughness: 0.8,
            metalness: 0.3,
          })
      )
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.position.set(0, 0.04, 0)
      root.add(base)

      const spikesGroup = new THREE.Group()
      spikesGroup.name = 'hazard-spikes-group'
      spikesGroup.position.set(0, 0.08, 0)

      const bladeGeo = getPooledGeometry(
        'spikes:blade',
        () => new THREE.ConeGeometry(0.1, 0.45, 4)
      )
      const bladeMat = getPooledMaterial(
        'spikes:blade',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.spikeMetal,
            roughness: 0.3,
            metalness: 0.85,
          })
      )

      const offsets = [
        [-0.4, 0, -0.4],
        [0.4, 0, -0.4],
        [0, 0, 0],
        [-0.4, 0, 0.4],
        [0.4, 0, 0.4],
      ]

      for (let i = 0; i < offsets.length; i += 1) {
        const [ox, oy, oz] = offsets[i]
        const blade = new THREE.Mesh(bladeGeo, bladeMat)
        blade.position.set(ox * (size * 0.4), oy, oz * (size * 0.4))
        spikesGroup.add(blade)
      }

      root.add(spikesGroup)
      root.userData = { hazardType: type, spikesGroup, activeY: 0.32, dormantY: -0.05 }
      break
    }

    case HAZARD_TYPES.PRESSURE_PLATE: {
      const baseGeo = getPooledGeometry(
        'plate:base',
        () => new THREE.BoxGeometry(size * 0.9, 0.06, size * 0.9)
      )
      const baseMat = getPooledMaterial(
        'plate:base',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.plateRim,
            roughness: 0.7,
            metalness: 0.4,
          })
      )
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.position.set(0, 0.03, 0)
      root.add(base)

      const plateGeo = getPooledGeometry(
        'plate:pad',
        () => new THREE.BoxGeometry(size * 0.55, 0.08, size * 0.55)
      )
      // Instance-owned material because each plate reflects its own trigger state
      const plateMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.plateCoreDormant,
        emissive: 0x000000,
        roughness: 0.4,
        metalness: 0.6,
      })
      const plate = new THREE.Mesh(plateGeo, plateMat)
      plate.position.set(0, 0.06, 0)
      root.add(plate)

      root.userData = { hazardType: type, plateMesh: plate, plateMat }
      break
    }

    case HAZARD_TYPES.ELECTRIC_GRID: {
      const baseGeo = getPooledGeometry(
        'electric:base',
        () => new THREE.BoxGeometry(size, 0.04, size)
      )
      const baseMat = getPooledMaterial(
        'electric:base',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.gridWire,
            roughness: 0.9,
            metalness: 0.2,
          })
      )
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.position.set(0, 0.02, 0)
      root.add(base)

      // Instance-owned material because electric grids pulse independently per phase
      const arcMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.gridEnergyDormant,
        emissive: HAZARD_PALETTE.gridEnergyDormant,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.1,
      })

      const arcGroup = new THREE.Group()
      const wireGeo = getPooledGeometry(
        'electric:wire',
        () => new THREE.BoxGeometry(size * 0.8, 0.03, 0.08)
      )
      for (let a = -1; a <= 1; a += 2) {
        const wire = new THREE.Mesh(wireGeo, arcMat)
        wire.position.set(0, 0.05, a * (size * 0.25))
        arcGroup.add(wire)
      }

      root.add(arcGroup)
      root.userData = { hazardType: type, arcMat, arcGroup }
      break
    }

    case HAZARD_TYPES.CEILING_COLLAPSE: {
      const markerGeo = getPooledGeometry(
        'ceiling_collapse:marker',
        () => new THREE.BoxGeometry(size * 0.8, 0.02, size * 0.8)
      )
      const markerMat = getPooledMaterial(
        'ceiling_collapse:marker',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x334155,
            roughness: 0.9,
            metalness: 0.1,
          })
      )
      const marker = new THREE.Mesh(markerGeo, markerMat)
      marker.position.set(0, 0.01, 0)
      root.add(marker)

      const rubbleGroup = new THREE.Group()
      rubbleGroup.name = 'hazard-ceiling-rubble'
      rubbleGroup.position.set(0, 2.4, 0)

      const chunkGeo = getPooledGeometry(
        'ceiling_collapse:chunk',
        () => new THREE.BoxGeometry(0.35, 0.35, 0.35)
      )
      const chunkMat = getPooledMaterial(
        'ceiling_collapse:chunk',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x3d4f6c,
            roughness: 0.85,
            metalness: 0.15,
          })
      )

      for (let c = 0; c < 5; c += 1) {
        const chunk = new THREE.Mesh(chunkGeo, chunkMat)
        const angle = (c / 5) * Math.PI * 2
        const rad = 0.2 + (c % 2) * 0.15
        chunk.position.set(Math.cos(angle) * rad, (c * 0.1) - 0.2, Math.sin(angle) * rad)
        chunk.rotation.set(c * 0.5, c * 0.7, c * 0.3)
        rubbleGroup.add(chunk)
      }

      root.add(rubbleGroup)
      root.userData = { hazardType: type, rubbleGroup, dormantY: 2.4, activeY: 0.05 }
      break
    }

    case HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE: {
      const furnitureGroup = new THREE.Group()
      furnitureGroup.name = 'hazard-rotten-furniture'
      furnitureGroup.position.set(0, 0, 0)

      const woodMat = getPooledMaterial(
        'rotten_furniture:wood',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x45352a,
            roughness: 0.94,
            metalness: 0.02,
          })
      )
      const metalMat = getPooledMaterial(
        'rotten_furniture:metal',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x3b2820,
            roughness: 0.9,
            metalness: 0.2,
          })
      )

      const topGeo = getPooledGeometry(
        'rotten_furniture:top',
        () => new THREE.BoxGeometry(0.9, 0.05, 0.5)
      )
      const topMesh = new THREE.Mesh(topGeo, woodMat)
      topMesh.position.set(0, 0.65, 0)
      furnitureGroup.add(topMesh)

      const legGeo = getPooledGeometry(
        'rotten_furniture:leg',
        () => new THREE.BoxGeometry(0.06, 0.65, 0.06)
      )
      const legOffsets = [
        [-0.38, 0.325, -0.2],
        [0.38, 0.325, -0.2],
        [-0.38, 0.325, 0.2],
        [0.38, 0.325, 0.2],
      ]
      for (let l = 0; l < legOffsets.length; l += 1) {
        const [lx, ly, lz] = legOffsets[l]
        const leg = new THREE.Mesh(legGeo, l < 2 ? woodMat : metalMat)
        leg.position.set(lx, ly, lz)
        if (l === 3) {
          leg.rotation.z = 0.35
          leg.rotation.x = -0.2
        }
        furnitureGroup.add(leg)
      }

      root.add(furnitureGroup)
      root.userData = { hazardType: type, furnitureGroup, uprightRotX: 0, uprightRotZ: 0, collapsedRotX: Math.PI * 0.48, collapsedRotZ: Math.PI * 0.15 }
      break
    }

    case HAZARD_TYPES.FALLING_PIPES_FIXTURES: {
      const pipeGroup = new THREE.Group()
      pipeGroup.name = 'hazard-falling-pipes'
      pipeGroup.position.set(0, 2.8, 0)

      const pipeMat = getPooledMaterial(
        'falling_pipes:metal',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x3b2820,
            roughness: 0.88,
            metalness: 0.45,
          })
      )
      const bracketMat = getPooledMaterial(
        'falling_pipes:bracket',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x262f3b,
            roughness: 0.9,
            metalness: 0.3,
          })
      )

      const pipeGeo = getPooledGeometry(
        'falling_pipes:segment',
        () => new THREE.CylinderGeometry(0.1, 0.1, 2.2, 8)
      )
      const pipe = new THREE.Mesh(pipeGeo, pipeMat)
      pipe.rotation.z = Math.PI * 0.5
      pipeGroup.add(pipe)

      const bracketGeo = getPooledGeometry(
        'falling_pipes:bracket',
        () => new THREE.BoxGeometry(0.15, 0.3, 0.15)
      )
      for (const bx of [-0.8, 0.8]) {
        const bracket = new THREE.Mesh(bracketGeo, bracketMat)
        bracket.position.set(bx, 0.2, 0)
        pipeGroup.add(bracket)
      }

      root.add(pipeGroup)
      root.userData = { hazardType: type, pipeGroup, dormantY: 2.8, activeY: 0.2, collapsedRotZ: Math.PI * 0.55, collapsedDropY: -1.9 }
      break
    }

    case HAZARD_TYPES.STEAM_PIPE_BURST: {
      const steamGroup = new THREE.Group()
      steamGroup.name = 'hazard-steam-pipe'
      steamGroup.position.set(0, 1.5, 0)

      const pipeMat = getPooledMaterial(
        'steam_pipe:metal',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x4a3b32,
            roughness: 0.85,
            metalness: 0.5,
          })
      )
      const steamMat = getPooledMaterial(
        'steam_pipe:cloud',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xd9e2ec,
            emissive: 0x9fb3c8,
            emissiveIntensity: 0.6,
            roughness: 0.9,
            transparent: true,
            opacity: 0.0,
          })
      )

      const pipeGeo = getPooledGeometry(
        'steam_pipe:segment',
        () => new THREE.CylinderGeometry(0.12, 0.12, 1.8, 8)
      )
      const pipe = new THREE.Mesh(pipeGeo, pipeMat)
      steamGroup.add(pipe)

      const cloudGeo = getPooledGeometry(
        'steam_pipe:cloud',
        () => new THREE.SphereGeometry(0.6, 8, 8)
      )
      const cloud = new THREE.Mesh(cloudGeo, steamMat)
      cloud.position.set(0, 0, 0.5)
      steamGroup.add(cloud)

      root.add(steamGroup)
      root.userData = { hazardType: type, steamGroup, steamMat }
      break
    }

    case HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING: {
      const mountType = hazardData.mountType === 'ceiling' ? 'ceiling' : 'wall'
      const wallYaw = Number.isFinite(hazardData.wallYaw) ? hazardData.wallYaw : 0

      const mountGroup = new THREE.Group()
      mountGroup.name = `hazard-wiring-${mountType}-mount`
      mountGroup.rotation.y = mountType === 'wall' ? wallYaw : 0
      root.add(mountGroup)

      const conduitMat = getPooledMaterial(
        'wiring:conduit',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wiringConduit,
            roughness: 0.52,
            metalness: 0.72,
          })
      )
      const hardwareMat = getPooledMaterial(
        'wiring:hardware',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wiringHardware,
            roughness: 0.72,
            metalness: 0.58,
          })
      )
      const cableMat = getPooledMaterial(
        'wiring:cable',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wiringCable,
            roughness: 0.85,
            metalness: 0.08,
          })
      )
      const cautionMat = getPooledMaterial(
        'wiring:caution',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wiringCaution,
            roughness: 0.76,
            metalness: 0.12,
          })
      )

      // Instance-owned materials for independent flickering, arcing, and burned-out states
      const tipMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.wiringCopper,
        emissive: HAZARD_PALETTE.wiringSparkWarning,
        emissiveIntensity: 0.18,
        roughness: 0.35,
        metalness: 0.82,
      })
      const arcMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.wiringArcActive,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const sparkMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.wiringSparkWarning,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const glowMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.wiringArcActive,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      const cableSegGeo = getPooledGeometry(
        'wiring:cableSeg',
        () => new THREE.CylinderGeometry(0.022, 0.02, 0.78, 6)
      )
      const tipGeo = getPooledGeometry(
        'wiring:copperTip',
        () => new THREE.CylinderGeometry(0.015, 0.008, 0.11, 5)
      )
      const clampGeo = getPooledGeometry(
        'wiring:clamp',
        () => new THREE.BoxGeometry(0.14, 0.05, 0.09)
      )
      const arcSegGeo = getPooledGeometry(
        'wiring:arcSeg',
        () => new THREE.BoxGeometry(0.026, 0.34, 0.026)
      )
      const sparkGeo = getPooledGeometry(
        'wiring:spark',
        () => new THREE.BoxGeometry(0.032, 0.075, 0.032)
      )
      const glowGeo = getPooledGeometry(
        'wiring:glow',
        () => new THREE.SphereGeometry(0.32, 8, 8)
      )

      const cableGroup = new THREE.Group()
      cableGroup.name = 'hazard-wiring-cables'
      let cableRestY
      let dischargeLocalY
      let dischargeLocalZ

      if (mountType === 'wall') {
        const wallZ = -CELL_SIZE * 0.5
        // Vertical conduit running from junction box up to ceiling soffit (y = 3.56)
        const conduitGeo = getPooledGeometry(
          'wiring:wallConduit',
          () => new THREE.CylinderGeometry(0.038, 0.038, 1.5, 8)
        )
        const conduit = new THREE.Mesh(conduitGeo, conduitMat)
        conduit.position.set(0, 2.81, wallZ + 0.06)
        mountGroup.add(conduit)

        for (const cy of [2.46, 3.16]) {
          const clamp = new THREE.Mesh(clampGeo, hardwareMat)
          clamp.position.set(0, cy, wallZ + 0.05)
          mountGroup.add(clamp)
        }

        // Ruptured wall-mounted junction box flush against wall face
        const boxGeo = getPooledGeometry(
          'wiring:junctionBox',
          () => new THREE.BoxGeometry(0.46, 0.56, 0.18)
        )
        const box = new THREE.Mesh(boxGeo, hardwareMat)
        box.position.set(0, 1.92, wallZ + 0.09)
        mountGroup.add(box)

        // Caution warning strip on upper housing
        const stripeGeo = getPooledGeometry(
          'wiring:cautionStripe',
          () => new THREE.BoxGeometry(0.36, 0.07, 0.02)
        )
        const stripe = new THREE.Mesh(stripeGeo, cautionMat)
        stripe.position.set(0, 2.1, wallZ + 0.185)
        mountGroup.add(stripe)

        // Blown-open crooked cover plate
        const coverGeo = getPooledGeometry(
          'wiring:coverPlate',
          () => new THREE.BoxGeometry(0.42, 0.44, 0.03)
        )
        const cover = new THREE.Mesh(coverGeo, conduitMat)
        cover.position.set(-0.22, 1.78, wallZ + 0.23)
        cover.rotation.set(0.38, 0.58, -0.28)
        mountGroup.add(cover)

        // Damaged live cables spilling from ruptured box into corridor
        cableRestY = 1.84
        cableGroup.position.set(0, cableRestY, wallZ + 0.16)
        const wallCableSpecs = [
          { x: -0.14, y: -0.28, z: 0.34, rx: 0.92, rz: 0.24 },
          { x: 0.04, y: -0.34, z: 0.38, rx: 0.84, rz: -0.12 },
          { x: 0.16, y: -0.26, z: 0.33, rx: 0.96, rz: -0.28 },
          { x: -0.05, y: -0.42, z: 0.3, rx: 0.62, rz: 0.08 },
        ]
        for (let i = 0; i < wallCableSpecs.length; i += 1) {
          const cs = wallCableSpecs[i]
          const seg = new THREE.Mesh(cableSegGeo, cableMat)
          seg.position.set(cs.x, cs.y, cs.z)
          seg.rotation.set(cs.rx, 0, cs.rz)
          cableGroup.add(seg)

          const tip = new THREE.Mesh(tipGeo, tipMat)
          tip.position.set(
            cs.x * 1.45,
            cs.y - 0.24,
            cs.z + 0.3
          )
          tip.rotation.set(cs.rx + 0.22, 0, cs.rz)
          cableGroup.add(tip)
        }
        mountGroup.add(cableGroup)

        dischargeLocalY = 1.45
        dischargeLocalZ = -1.18
      } else {
        // Ceiling-hanging damaged electrical conduit & cable bundle anchored to soffit (y = 3.6)
        const flangeGeo = getPooledGeometry(
          'wiring:ceilingFlange',
          () => new THREE.CylinderGeometry(0.24, 0.26, 0.08, 10)
        )
        const flange = new THREE.Mesh(flangeGeo, hardwareMat)
        flange.position.set(0, 3.56, 0)
        mountGroup.add(flange)

        const collarGeo = getPooledGeometry(
          'wiring:ceilingBox',
          () => new THREE.BoxGeometry(0.38, 0.22, 0.38)
        )
        const collar = new THREE.Mesh(collarGeo, hardwareMat)
        collar.position.set(0, 3.42, 0)
        mountGroup.add(collar)

        const hangingConduitGeo = getPooledGeometry(
          'wiring:ceilingConduit',
          () => new THREE.CylinderGeometry(0.042, 0.042, 0.95, 8)
        )
        const hangingConduit = new THREE.Mesh(hangingConduitGeo, conduitMat)
        hangingConduit.position.set(0.05, 2.94, 0)
        hangingConduit.rotation.z = 0.14
        mountGroup.add(hangingConduit)

        cableRestY = 2.48
        cableGroup.position.set(0, cableRestY, 0)
        const ceilingCableSpecs = [
          { x: -0.14, y: -0.4, z: 0.12, rx: 0.28, rz: 0.26 },
          { x: 0.16, y: -0.44, z: -0.1, rx: -0.22, rz: -0.3 },
          { x: 0.06, y: -0.5, z: 0.16, rx: 0.34, rz: -0.12 },
          { x: -0.1, y: -0.46, z: -0.15, rx: -0.28, rz: 0.18 },
        ]
        for (let i = 0; i < ceilingCableSpecs.length; i += 1) {
          const cs = ceilingCableSpecs[i]
          const seg = new THREE.Mesh(cableSegGeo, cableMat)
          seg.position.set(cs.x, cs.y, cs.z)
          seg.rotation.set(cs.rx, 0, cs.rz)
          cableGroup.add(seg)

          const tip = new THREE.Mesh(tipGeo, tipMat)
          tip.position.set(cs.x * 1.45, cs.y - 0.38, cs.z * 1.45)
          tip.rotation.set(cs.rx, 0, cs.rz)
          cableGroup.add(tip)
        }
        mountGroup.add(cableGroup)

        dischargeLocalY = 1.65
        dischargeLocalZ = 0
      }

      // Bounded electrical arc & spark assembly centered on the exposed copper tips
      const dischargeGroup = new THREE.Group()
      dischargeGroup.name = 'hazard-wiring-discharge'
      dischargeGroup.position.set(0, dischargeLocalY, dischargeLocalZ)
      mountGroup.add(dischargeGroup)

      const arcGroup = new THREE.Group()
      arcGroup.name = 'hazard-wiring-arcs'
      arcGroup.visible = false
      const arcBolts = []
      const boltConfigs = [
        { baseRotY: 0, baseRotZ: 0.35, offsetX: -0.12, offsetZ: 0.06 },
        { baseRotY: 1.9, baseRotZ: -0.42, offsetX: 0.14, offsetZ: -0.04 },
        { baseRotY: -1.6, baseRotZ: 0.28, offsetX: 0.02, offsetZ: 0.12 },
      ]
      for (let b = 0; b < boltConfigs.length; b += 1) {
        const bc = boltConfigs[b]
        const bolt = new THREE.Group()
        bolt.position.set(bc.offsetX, 0, bc.offsetZ)
        bolt.rotation.set(0, bc.baseRotY, bc.baseRotZ)

        for (let s = 0; s < 3; s += 1) {
          const seg = new THREE.Mesh(arcSegGeo, arcMat)
          const zig = s % 2 === 0 ? 0.08 : -0.08
          seg.position.set(zig, (s - 1) * 0.24, 0)
          seg.rotation.z = s % 2 === 0 ? 0.52 : -0.52
          bolt.add(seg)
        }
        arcGroup.add(bolt)
        arcBolts.push(bolt)
      }
      dischargeGroup.add(arcGroup)

      // Bounded 8 spark shards with deterministic trajectories (zero per-frame allocations)
      const sparkGroup = new THREE.Group()
      sparkGroup.name = 'hazard-wiring-sparks'
      sparkGroup.visible = false
      const sparkMeshes = []
      const sparkConfigs = []
      const MAX_WIRING_SPARKS = 8
      for (let i = 0; i < MAX_WIRING_SPARKS; i += 1) {
        const angle = (i / MAX_WIRING_SPARKS) * Math.PI * 2 + (i % 2) * 0.31
        const elev = 0.25 + (i % 3) * 0.22
        sparkConfigs.push({
          dx: Math.cos(angle) * 0.72,
          dy: elev,
          dz: Math.sin(angle) * 0.72,
          phase: (i * 0.37) % 1,
          speed: 2.2 + (i % 4) * 0.45,
        })
        const spark = new THREE.Mesh(sparkGeo, sparkMat)
        spark.rotation.set(i * 0.7, angle, i * 0.5)
        sparkGroup.add(spark)
        sparkMeshes.push(spark)
      }
      dischargeGroup.add(sparkGroup)

      const glowMesh = new THREE.Mesh(glowGeo, glowMat)
      glowMesh.visible = false
      dischargeGroup.add(glowMesh)

      root.userData = {
        hazardType: type,
        mountType,
        wallYaw,
        mountGroup,
        cableGroup,
        cableRestY,
        dischargeGroup,
        arcGroup,
        arcBolts,
        sparkGroup,
        sparkMeshes,
        sparkConfigs,
        glowMesh,
        tipMat,
        arcMat,
        sparkMat,
        glowMat,
      }
      break
    }

    default:
      break
  }

  root.traverse((node) => {
    if (node.isMesh) {
      node.receiveShadow = true
    }
  })

  return root
}

/**
 * Updates hazard visual state (dormant, warning, active) based on its cycle phase.
 */
export function updateHazardVisualState(hazardRoot, state = 'dormant', progress = 0) {
  if (!hazardRoot?.userData) return

  const data = hazardRoot.userData
  const type = data.hazardType

  switch (type) {
    case HAZARD_TYPES.FLOOR_SPIKES: {
      const group = data.spikesGroup
      if (!group) return
      let targetY = data.dormantY

      if (state === 'active') {
        targetY = data.activeY
      } else if (state === 'warning') {
        targetY = data.dormantY + Math.sin(progress * Math.PI * 8) * 0.04
      }

      const diff = targetY - group.position.y
      if (state === 'warning' || Math.abs(diff) > 1e-5) {
        const nextY =
          state !== 'warning' && Math.abs(diff * 0.75) <= 1e-5
            ? targetY
            : group.position.y + diff * 0.25
        group.position.y = nextY
      }
      break
    }

    case HAZARD_TYPES.PRESSURE_PLATE: {
      const plate = data.plateMesh
      const mat = data.plateMat
      if (!plate || !mat) return

      const isTriggered = state === 'active' || state === 'warning'
      const nextKey = isTriggered ? 'triggered' : 'dormant'
      if (data._visualStateKey === nextKey) return
      data._visualStateKey = nextKey

      if (isTriggered) {
        plate.position.y = 0.03
        mat.color.setHex(HAZARD_PALETTE.plateCoreActive)
        mat.emissive.setHex(0xd97706)
        mat.emissiveIntensity = 1.2
      } else {
        plate.position.y = 0.06
        mat.color.setHex(HAZARD_PALETTE.plateCoreDormant)
        mat.emissive.setHex(0x000000)
        mat.emissiveIntensity = 0
      }
      break
    }

    case HAZARD_TYPES.ELECTRIC_GRID: {
      const mat = data.arcMat
      if (!mat) return

      if (state === 'active') {
        if (data._visualStateKey === 'active') return
        data._visualStateKey = 'active'
        data._warningPulse = null
        mat.color.setHex(HAZARD_PALETTE.gridEnergyActive)
        mat.emissive.setHex(HAZARD_PALETTE.gridEnergyActive)
        mat.emissiveIntensity = 3.5
      } else if (state === 'warning') {
        const pulse = Math.sin(progress * Math.PI * 10) > 0 ? 1 : 0.2
        if (data._visualStateKey === 'warning' && data._warningPulse === pulse) return
        if (data._visualStateKey !== 'warning') {
          mat.color.setHex(HAZARD_PALETTE.gridEnergyWarning)
          mat.emissive.setHex(HAZARD_PALETTE.gridEnergyWarning)
        }
        data._visualStateKey = 'warning'
        data._warningPulse = pulse
        mat.emissiveIntensity = 1.8 * pulse
      } else {
        if (data._visualStateKey === 'dormant') return
        data._visualStateKey = 'dormant'
        data._warningPulse = null
        mat.color.setHex(HAZARD_PALETTE.gridEnergyDormant)
        mat.emissive.setHex(HAZARD_PALETTE.gridEnergyDormant)
        mat.emissiveIntensity = 0.4
      }
      break
    }

    case HAZARD_TYPES.CEILING_COLLAPSE: {
      const group = data.rubbleGroup
      if (!group) return

      if (state === 'active') {
        group.position.y = data.activeY
      } else if (state === 'warning') {
        const shake = Math.sin(progress * Math.PI * 12) * 0.06
        group.position.y = data.dormantY + shake
      } else {
        group.position.y = data.dormantY
      }
      break
    }

    case HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE: {
      const group = data.furnitureGroup
      if (!group) return

      if (state === 'active' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        group.rotation.x = data.collapsedRotX
        group.rotation.z = data.collapsedRotZ
        group.position.y = -0.15
      } else if (state === 'warning') {
        const shakeX = Math.sin(progress * Math.PI * 16) * 0.06
        const shakeZ = Math.cos(progress * Math.PI * 14) * 0.05
        group.rotation.x = data.uprightRotX + shakeX
        group.rotation.z = data.uprightRotZ + shakeZ
        group.position.y = 0
      } else {
        group.rotation.x = data.uprightRotX
        group.rotation.z = data.uprightRotZ
        group.position.y = 0
      }
      break
    }

    case HAZARD_TYPES.FALLING_PIPES_FIXTURES: {
      const group = data.pipeGroup
      if (!group) return

      if (state === 'active' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        group.position.y = data.dormantY + data.collapsedDropY
        group.rotation.z = data.collapsedRotZ
      } else if (state === 'warning') {
        const rattle = Math.sin(progress * Math.PI * 22) * 0.08
        group.position.y = data.dormantY + rattle
        group.rotation.z = rattle * 0.5
      } else {
        group.position.y = data.dormantY
        group.rotation.z = 0
      }
      break
    }

    case HAZARD_TYPES.STEAM_PIPE_BURST: {
      const group = data.steamGroup
      const mat = data.steamMat
      if (!group || !mat) return

      if (state === 'active') {
        group.scale.setScalar(2.2)
        mat.opacity = 0.85
      } else if (state === 'warning') {
        const pulse = Math.sin(progress * Math.PI * 20) * 0.5 + 0.5
        group.scale.setScalar(0.8 + pulse * 0.4)
        mat.opacity = 0.3 + pulse * 0.3
      } else if (state === 'collapsed' || data.isPermanentlyCollapsed) {
        group.scale.setScalar(0.4)
        mat.opacity = 0.05
      } else {
        group.scale.setScalar(0.1)
        mat.opacity = 0.0
      }
      break
    }

    case HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING: {
      const {
        cableGroup,
        cableRestY,
        arcGroup,
        arcBolts,
        sparkGroup,
        sparkMeshes,
        sparkConfigs,
        glowMesh,
        tipMat,
        arcMat,
        sparkMat,
        glowMat,
      } = data
      if (!arcGroup || !sparkGroup || !tipMat || !arcMat || !sparkMat || !glowMat) return

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        arcGroup.visible = false
        sparkGroup.visible = false
        if (glowMesh) glowMesh.visible = false
        arcMat.opacity = 0
        sparkMat.opacity = 0
        glowMat.opacity = 0
        tipMat.color.setHex(HAZARD_PALETTE.wiringCharred)
        tipMat.emissive.setHex(0x000000)
        tipMat.emissiveIntensity = 0
        if (cableGroup) {
          cableGroup.position.y = (cableRestY ?? 1.84) - 0.06
          cableGroup.rotation.z = 0
        }
        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        const crackle = Math.abs(Math.sin(clamped * Math.PI * 34))
        arcGroup.visible = true
        sparkGroup.visible = true
        if (glowMesh) {
          glowMesh.visible = true
          const glowScale = 0.95 + crackle * 0.45
          glowMesh.scale.setScalar(glowScale)
        }

        arcMat.color.setHex(HAZARD_PALETTE.wiringArcActive)
        arcMat.opacity = 0.8 + crackle * 0.2
        sparkMat.color.setHex(HAZARD_PALETTE.wiringSparkActive)
        sparkMat.opacity = 0.92
        glowMat.color.setHex(HAZARD_PALETTE.wiringArcActive)
        glowMat.opacity = 0.48 + crackle * 0.28

        tipMat.color.setHex(HAZARD_PALETTE.wiringCopper)
        tipMat.emissive.setHex(HAZARD_PALETTE.wiringArcActive)
        tipMat.emissiveIntensity = 2.6 + crackle * 1.1

        if (arcBolts) {
          for (let b = 0; b < arcBolts.length; b += 1) {
            const bolt = arcBolts[b]
            const jitter = Math.sin(clamped * Math.PI * (28 + b * 11) + b * 2.1)
            bolt.rotation.y = b * 2.1 + jitter * 0.85
            bolt.rotation.x = Math.cos(clamped * Math.PI * (22 + b * 7)) * 0.45
            const s = 0.85 + Math.abs(jitter) * 0.5
            bolt.scale.set(1, s, 1)
          }
        }

        if (sparkMeshes && sparkConfigs) {
          for (let i = 0; i < sparkMeshes.length; i += 1) {
            const cfg = sparkConfigs[i]
            const t = (clamped * cfg.speed * 1.45 + cfg.phase) % 1
            const spark = sparkMeshes[i]
            spark.position.set(
              cfg.dx * t * 1.25,
              cfg.dy * t - 0.65 * t * t,
              cfg.dz * t * 1.25
            )
            const s = Math.max(0.2, 1.15 - t * 0.9)
            spark.scale.setScalar(s)
          }
        }

        if (cableGroup) {
          cableGroup.position.y = cableRestY ?? 1.84
          cableGroup.rotation.z = Math.sin(clamped * Math.PI * 36) * 0.045
        }
        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const intensity = 0.35 + clamped * 0.65
        const flicker = Math.sin(clamped * Math.PI * 26) * Math.cos(clamped * Math.PI * 11)
        const preArcFlash = clamped > 0.5 && flicker > 0.3

        arcGroup.visible = preArcFlash
        arcMat.color.setHex(HAZARD_PALETTE.wiringSparkWarning)
        arcMat.opacity = preArcFlash ? 0.55 + clamped * 0.3 : 0

        sparkGroup.visible = true
        sparkMat.color.setHex(HAZARD_PALETTE.wiringSparkWarning)
        sparkMat.opacity = 0.45 + intensity * 0.45

        if (glowMesh) {
          glowMesh.visible = true
          glowMesh.scale.setScalar(0.5 + intensity * 0.35 + Math.abs(flicker) * 0.15)
        }
        glowMat.color.setHex(HAZARD_PALETTE.wiringSparkWarning)
        glowMat.opacity = 0.12 + intensity * 0.22 * (0.5 + Math.abs(flicker) * 0.5)

        tipMat.color.setHex(HAZARD_PALETTE.wiringCopper)
        tipMat.emissive.setHex(HAZARD_PALETTE.wiringSparkWarning)
        tipMat.emissiveIntensity = 0.7 + intensity * 1.8 * (0.45 + Math.abs(flicker) * 0.55)

        if (sparkMeshes && sparkConfigs) {
          for (let i = 0; i < sparkMeshes.length; i += 1) {
            const cfg = sparkConfigs[i]
            const t = (clamped * cfg.speed + cfg.phase) % 1
            const spark = sparkMeshes[i]
            const spread = 0.45 + clamped * 0.45
            spark.position.set(
              cfg.dx * t * spread,
              cfg.dy * t * 0.75 - 0.55 * t * t,
              cfg.dz * t * spread
            )
            const s = Math.max(0.18, (0.75 + clamped * 0.35) * (1 - t * 0.85))
            spark.scale.setScalar(s)
          }
        }

        if (cableGroup) {
          cableGroup.position.y = cableRestY ?? 1.84
          cableGroup.rotation.z = Math.sin(clamped * Math.PI * 30) * 0.028 * intensity
        }
        data._visualStateKey = 'warning'
        break
      }

      // Dormant state
      arcGroup.visible = false
      sparkGroup.visible = false
      if (glowMesh) glowMesh.visible = false
      arcMat.opacity = 0
      sparkMat.opacity = 0
      glowMat.opacity = 0
      tipMat.color.setHex(HAZARD_PALETTE.wiringCopper)
      tipMat.emissive.setHex(HAZARD_PALETTE.wiringSparkWarning)
      tipMat.emissiveIntensity = 0.18
      if (cableGroup) {
        cableGroup.position.y = cableRestY ?? 1.84
        cableGroup.rotation.z = 0
      }
      data._visualStateKey = 'dormant'
      break
    }

    default:
      break
  }
}

/**
 * Safely disposes instance-owned hazard geometries and materials without destroying shared pools.
 */
export function disposeHazardMesh(root) {
  if (!root) return
  if (root.userData) {
    root.userData._visualStateKey = null
    root.userData._warningPulse = null
    root.userData.sparkMeshes = null
    root.userData.sparkConfigs = null
    root.userData.arcBolts = null
    root.userData.arcGroup = null
    root.userData.sparkGroup = null
    root.userData.cableGroup = null
    root.userData.dischargeGroup = null
    root.userData.mountGroup = null
    root.userData.glowMesh = null
    root.userData.tipMat = null
    root.userData.arcMat = null
    root.userData.sparkMat = null
    root.userData.glowMat = null
  }
  const geos = new Set()
  const mats = new Set()

  root.traverse((node) => {
    if (node.geometry && !isSharedResource(node.geometry)) {
      geos.add(node.geometry)
    }
    if (node.material) {
      const list = Array.isArray(node.material) ? node.material : [node.material]
      for (let i = 0; i < list.length; i += 1) {
        const m = list[i]
        if (m && !isSharedResource(m)) mats.add(m)
      }
    }
  })

  for (const geo of geos) geo?.dispose?.()
  for (const mat of mats) mat?.dispose?.()

  if (root.parent) root.parent.remove(root)
  root.clear()
}
