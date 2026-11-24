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
  gratePit: 0x05080e,
  grateSubPipe: 0x151e2b,
  grateCurb: 0x262f3b,
  grateIron: 0x353f4c,
  grateRust: 0x4b2f21,
  grateBolt: 0x5c6773,
  grateDust: 0x8d97a4,
  wallConcrete: 0x354663,
  wallCavity: 0x141c29,
  wallCrack: 0x0b1019,
  wallRebar: 0x4b2d20,
  wallRubble: 0x3a4961,
  wallDust: 0x8f9aa8,
  tankSteel: 0x3b4a59,
  tankRust: 0x5c3422,
  tankBracket: 0x2a333e,
  tankPipe: 0x465564,
  tankSeam: 0x151e27,
  waterLeak: 0x67b7d8,
  waterSurge: 0x2b6f8c,
  waterPuddle: 0x1a465c,
  machineryGantry: 0x1e2a3c,
  machineryHousing: 0x3b4856,
  machineryStripe: 0xb58524,
  machineryChain: 0x4d5764,
  machineryRust: 0x563222,
  machineryDust: 0x8a95a3,
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

    case HAZARD_TYPES.COLLAPSING_FLOOR_GRATE: {
      const grateYaw = Number.isFinite(hazardData.grateYaw) ? hazardData.grateYaw : 0
      const corridorAxis = hazardData.corridorAxis === 'ew' ? 'ew' : 'ns'

      const grateRoot = new THREE.Group()
      grateRoot.name = 'hazard-floor-grate-root'
      grateRoot.rotation.y = grateYaw
      root.add(grateRoot)

      const pitMat = getPooledMaterial(
        'grate:pit',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.gratePit,
            roughness: 1.0,
            metalness: 0.0,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          })
      )
      const subPipeMat = getPooledMaterial(
        'grate:subPipe',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.grateSubPipe,
            roughness: 0.9,
            metalness: 0.35,
          })
      )
      const curbMat = getPooledMaterial(
        'grate:curb',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.grateCurb,
            roughness: 0.82,
            metalness: 0.48,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          })
      )
      const ironMat = getPooledMaterial(
        'grate:iron',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.grateIron,
            roughness: 0.78,
            metalness: 0.62,
          })
      )
      const rustMat = getPooledMaterial(
        'grate:rust',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.grateRust,
            roughness: 0.92,
            metalness: 0.28,
          })
      )
      const boltMat = getPooledMaterial(
        'grate:bolt',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.grateBolt,
            roughness: 0.55,
            metalness: 0.78,
          })
      )

      // Instance-owned dust material so each collapsing grate fades dust independently
      const dustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.grateDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      // 1. Recessed dark drainage pit flush at y = 0.004 (polygon-offset prevents floor Z-fighting)
      const pitGeo = getPooledGeometry('grate:pitPlane', () => new THREE.PlaneGeometry(2.14, 1.94))
      const pitMesh = new THREE.Mesh(pitGeo, pitMat)
      pitMesh.rotation.x = -Math.PI * 0.5
      pitMesh.position.set(0, 0.004, 0)
      grateRoot.add(pitMesh)

      // Subtle subfloor pipes crossing inside the recessed pit cavity
      const subPipeGeo = getPooledGeometry(
        'grate:subPipe',
        () => new THREE.CylinderGeometry(0.032, 0.032, 1.9, 6)
      )
      for (const px of [-0.52, 0.46]) {
        const subPipe = new THREE.Mesh(subPipeGeo, subPipeMat)
        subPipe.rotation.x = Math.PI * 0.5
        subPipe.position.set(px, 0.007, 0)
        grateRoot.add(subPipe)
      }

      // 2. Flush floor-embedded cast-iron perimeter curb (y = 0..0.020)
      const railHGeo = getPooledGeometry('grate:railH', () => new THREE.BoxGeometry(2.38, 0.02, 0.12))
      const railVGeo = getPooledGeometry('grate:railV', () => new THREE.BoxGeometry(0.12, 0.02, 1.94))
      for (const rz of [-1.03, 1.03]) {
        const rail = new THREE.Mesh(railHGeo, curbMat)
        rail.position.set(0, 0.01, rz)
        grateRoot.add(rail)
      }
      for (const rx of [-1.13, 1.13]) {
        const rail = new THREE.Mesh(railVGeo, curbMat)
        rail.position.set(rx, 0.01, 0)
        grateRoot.add(rail)
      }

      // 3. Corner anchor bolts (vibrate & loosen during warning, shear during collapse)
      const boltGeo = getPooledGeometry('grate:bolt', () => new THREE.CylinderGeometry(0.034, 0.034, 0.024, 6))
      const boltRestPositions = [
        { x: -1.11, y: 0.022, z: -1.01, sx: -1.24, sz: -1.12 },
        { x: 1.11, y: 0.022, z: -1.01, sx: 1.25, sz: -1.14 },
        { x: -1.11, y: 0.022, z: 1.01, sx: -1.22, sz: 1.16 },
        { x: 1.11, y: 0.022, z: 1.01, sx: 1.26, sz: 1.12 },
      ]
      const bolts = []
      for (let i = 0; i < boltRestPositions.length; i += 1) {
        const bp = boltRestPositions[i]
        const bolt = new THREE.Mesh(boltGeo, i % 2 === 0 ? boltMat : rustMat)
        bolt.position.set(bp.x, bp.y, bp.z)
        grateRoot.add(bolt)
        bolts.push(bolt)
      }

      // 4. Collapsible two-leaf corroded steel floor grate flush inside curb (y = 0.015)
      const grateRestY = 0.015
      const leafBarGeo = getPooledGeometry('grate:leafBar', () => new THREE.BoxGeometry(1.02, 0.018, 0.075))
      const leafCrossGeo = getPooledGeometry('grate:leafCross', () => new THREE.BoxGeometry(0.055, 0.014, 1.88))
      const seamRustGeo = getPooledGeometry('grate:seamRust', () => new THREE.BoxGeometry(0.07, 0.019, 1.84))

      const buildLeaf = (dirSign) => {
        const leaf = new THREE.Group()
        leaf.position.set(-dirSign * 1.04, grateRestY, 0)
        const zBars = [-0.82, -0.41, 0, 0.41, 0.82]
        for (let b = 0; b < zBars.length; b += 1) {
          const bar = new THREE.Mesh(leafBarGeo, b === 2 ? rustMat : ironMat)
          bar.position.set(dirSign * 0.51, 0, zBars[b])
          leaf.add(bar)
        }
        for (const cx of [0.22, 0.58, 0.92]) {
          const cross = new THREE.Mesh(leafCrossGeo, cx > 0.85 ? rustMat : ironMat)
          cross.position.set(dirSign * cx, -0.002, 0)
          leaf.add(cross)
        }
        const seam = new THREE.Mesh(seamRustGeo, rustMat)
        seam.position.set(dirSign * 0.99, 0.001, 0)
        leaf.add(seam)
        return leaf
      }

      const leftLeafGroup = buildLeaf(1)
      leftLeafGroup.name = 'hazard-grate-left-leaf'
      const rightLeafGroup = buildLeaf(-1)
      rightLeafGroup.name = 'hazard-grate-right-leaf'
      grateRoot.add(leftLeafGroup)
      grateRoot.add(rightLeafGroup)

      // 5. Jagged bent perimeter fracture stubs shown once grate breaks open
      const brokenStubsGroup = new THREE.Group()
      brokenStubsGroup.name = 'hazard-grate-broken-stubs'
      brokenStubsGroup.visible = false
      const stubGeo = getPooledGeometry('grate:stub', () => new THREE.BoxGeometry(0.24, 0.018, 0.065))
      const stubSpecs = [
        { x: -1.0, z: -0.62, rz: -0.58, ry: 0.14 },
        { x: -1.0, z: 0.24, rz: -0.72, ry: -0.18 },
        { x: 1.0, z: -0.35, rz: 0.64, ry: 0.12 },
        { x: 1.0, z: 0.66, rz: 0.52, ry: -0.16 },
      ]
      for (let i = 0; i < stubSpecs.length; i += 1) {
        const st = stubSpecs[i]
        const stub = new THREE.Mesh(stubGeo, i % 2 === 0 ? rustMat : ironMat)
        stub.position.set(st.x, 0.014, st.z)
        stub.rotation.set(0, st.ry, st.rz)
        brokenStubsGroup.add(stub)
      }
      grateRoot.add(brokenStubsGroup)

      // 6. Bounded warning falling fragments (6 chips dropping along seam during warning)
      const warningFragGroup = new THREE.Group()
      warningFragGroup.name = 'hazard-grate-warning-fragments'
      warningFragGroup.visible = false
      const fragGeo = getPooledGeometry('grate:frag', () => new THREE.BoxGeometry(0.055, 0.022, 0.055))
      const warningFragments = []
      const warningFragConfigs = []
      const MAX_WARNING_FRAGS = 6
      for (let i = 0; i < MAX_WARNING_FRAGS; i += 1) {
        const sx = (i % 2 === 0 ? -1 : 1) * (0.08 + (i % 3) * 0.12)
        const sz = -0.75 + i * 0.3
        warningFragConfigs.push({
          x: sx,
          z: sz,
          phase: (i * 0.29) % 1,
          speed: 1.8 + (i % 3) * 0.35,
        })
        const chip = new THREE.Mesh(fragGeo, i % 2 === 0 ? rustMat : ironMat)
        chip.position.set(sx, 0.02, sz)
        warningFragGroup.add(chip)
        warningFragments.push(chip)
      }
      grateRoot.add(warningFragGroup)

      // 7. Bounded collapse debris shards (8 fragments scattering & settling around broken curb)
      const debrisGroup = new THREE.Group()
      debrisGroup.name = 'hazard-grate-debris'
      debrisGroup.visible = false
      const debrisGeo = getPooledGeometry('grate:debris', () => new THREE.BoxGeometry(0.11, 0.032, 0.075))
      const debrisMeshes = []
      const debrisConfigs = []
      const MAX_DEBRIS = 8
      for (let i = 0; i < MAX_DEBRIS; i += 1) {
        const angle = (i / MAX_DEBRIS) * Math.PI * 2 + 0.25
        const dist = 1.18 + (i % 3) * 0.16
        debrisConfigs.push({
          startX: Math.cos(angle) * 0.35,
          startZ: Math.sin(angle) * 0.3,
          endX: Math.cos(angle) * dist,
          endZ: Math.sin(angle) * dist,
          arcH: 0.22 + (i % 3) * 0.09,
          rotY: angle + i * 0.5,
        })
        const shard = new THREE.Mesh(debrisGeo, i % 2 === 0 ? rustMat : ironMat)
        debrisGroup.add(shard)
        debrisMeshes.push(shard)
      }
      grateRoot.add(debrisGroup)

      // 8. Bounded dust burst puffs (6 lightweight spheres rising & fading during collapse)
      const dustGroup = new THREE.Group()
      dustGroup.name = 'hazard-grate-dust'
      dustGroup.visible = false
      const dustGeo = getPooledGeometry('grate:dust', () => new THREE.SphereGeometry(0.24, 7, 7))
      const dustMeshes = []
      const dustConfigs = []
      const MAX_DUST = 6
      for (let i = 0; i < MAX_DUST; i += 1) {
        const angle = (i / MAX_DUST) * Math.PI * 2
        dustConfigs.push({
          dx: Math.cos(angle) * (0.48 + (i % 2) * 0.24),
          dz: Math.sin(angle) * (0.44 + (i % 2) * 0.2),
          riseY: 0.42 + (i % 3) * 0.18,
          baseScale: 0.65 + (i % 3) * 0.2,
        })
        const puff = new THREE.Mesh(dustGeo, dustMat)
        dustGroup.add(puff)
        dustMeshes.push(puff)
      }
      grateRoot.add(dustGroup)

      root.userData = {
        hazardType: type,
        floorY: 0,
        corridorAxis,
        grateYaw,
        grateRestY,
        grateRoot,
        pitMesh,
        leftLeafGroup,
        rightLeafGroup,
        bolts,
        boltRestPositions,
        brokenStubsGroup,
        warningFragGroup,
        warningFragments,
        warningFragConfigs,
        debrisGroup,
        debrisMeshes,
        debrisConfigs,
        dustGroup,
        dustMeshes,
        dustConfigs,
        dustMat,
      }
      break
    }

    case HAZARD_TYPES.WALL_COLLAPSE: {
      const wallYaw = Number.isFinite(hazardData.wallYaw) ? hazardData.wallYaw : 0
      const wallSide = hazardData.wallSide || 'north'
      const wallZ = -CELL_SIZE * 0.5

      const wallMountGroup = new THREE.Group()
      wallMountGroup.name = `hazard-wall-collapse-${wallSide}`
      wallMountGroup.rotation.y = wallYaw
      root.add(wallMountGroup)

      const concreteMat = getPooledMaterial(
        'wall_collapse:concrete',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wallConcrete,
            roughness: 0.94,
            metalness: 0.02,
          })
      )
      const cavityMat = getPooledMaterial(
        'wall_collapse:cavity',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wallCavity,
            roughness: 0.98,
            metalness: 0.01,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          })
      )
      const crackMat = getPooledMaterial(
        'wall_collapse:crack',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wallCrack,
            roughness: 1.0,
            metalness: 0.0,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3,
          })
      )
      const rebarMat = getPooledMaterial(
        'wall_collapse:rebar',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wallRebar,
            roughness: 0.88,
            metalness: 0.52,
          })
      )
      const rubbleMat = getPooledMaterial(
        'wall_collapse:rubble',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.wallRubble,
            roughness: 0.93,
            metalness: 0.03,
          })
      )

      // Instance-owned dust material so each collapsing wall fades independently
      const dustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.wallDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      // 1. Recessed fractured cavity backing flush on wall face (never removes actual maze wall)
      const cavityGeo = getPooledGeometry(
        'wall_collapse:cavityPlane',
        () => new THREE.PlaneGeometry(2.16, 2.32)
      )
      const cavityMesh = new THREE.Mesh(cavityGeo, cavityMat)
      cavityMesh.position.set(0, 1.32, wallZ + 0.008)
      wallMountGroup.add(cavityMesh)

      // Jagged fractured perimeter rim framing the damaged wall opening
      const rimGroup = new THREE.Group()
      rimGroup.name = 'hazard-wall-fracture-rim'
      const rimVGeo = getPooledGeometry('wall_collapse:rimV', () => new THREE.BoxGeometry(0.14, 2.38, 0.09))
      const rimHGeo = getPooledGeometry('wall_collapse:rimH', () => new THREE.BoxGeometry(2.3, 0.14, 0.09))
      for (const rx of [-1.08, 1.08]) {
        const post = new THREE.Mesh(rimVGeo, concreteMat)
        post.position.set(rx, 1.32, wallZ + 0.045)
        rimGroup.add(post)
      }
      const lintel = new THREE.Mesh(rimHGeo, concreteMat)
      lintel.position.set(0, 2.48, wallZ + 0.045)
      rimGroup.add(lintel)
      wallMountGroup.add(rimGroup)

      // 2. Exposed bent structural rebar revealed inside the broken cavity
      const rebarGroup = new THREE.Group()
      rebarGroup.name = 'hazard-wall-rebar'
      const rebarGeo = getPooledGeometry(
        'wall_collapse:rebar',
        () => new THREE.CylinderGeometry(0.014, 0.014, 1.95, 5)
      )
      const rebarSpecs = [
        { x: -0.62, y: 1.34, rz: 0.08, rx: 0.04 },
        { x: -0.18, y: 1.28, rz: -0.11, rx: 0.08 },
        { x: 0.28, y: 1.38, rz: 0.06, rx: -0.05 },
        { x: 0.68, y: 1.26, rz: -0.09, rx: 0.07 },
        { x: 0.0, y: 1.48, rz: Math.PI * 0.5 + 0.06, rx: 0.03 },
      ]
      for (let i = 0; i < rebarSpecs.length; i += 1) {
        const rb = rebarSpecs[i]
        const rod = new THREE.Mesh(rebarGeo, rebarMat)
        rod.position.set(rb.x, rb.y, wallZ + 0.035)
        rod.rotation.set(rb.rx, 0, rb.rz)
        rebarGroup.add(rod)
      }
      wallMountGroup.add(rebarGroup)

      // 3. Collapsible fractured concrete wall slabs (distinguishable weathered masonry section)
      const slabGroup = new THREE.Group()
      slabGroup.name = 'hazard-wall-slabs'
      const slabGeo = getPooledGeometry('wall_collapse:slab', () => new THREE.BoxGeometry(0.98, 1.04, 0.14))
      const slabConfigs = [
        {
          restX: -0.52,
          restY: 1.86,
          restZ: wallZ + 0.085,
          endX: -0.64,
          endY: 0.16,
          endZ: wallZ + 0.92,
          endRx: 1.42,
          endRy: 0.22,
          endRz: -0.18,
          bulgeZ: 0.095,
        },
        {
          restX: 0.52,
          restY: 1.84,
          restZ: wallZ + 0.085,
          endX: 0.66,
          endY: 0.18,
          endZ: wallZ + 1.02,
          endRx: 1.48,
          endRy: -0.26,
          endRz: 0.2,
          bulgeZ: 0.105,
        },
        {
          restX: -0.5,
          restY: 0.78,
          restZ: wallZ + 0.08,
          endX: -0.34,
          endY: 0.11,
          endZ: wallZ + 0.58,
          endRx: 1.54,
          endRy: -0.14,
          endRz: 0.12,
          bulgeZ: 0.075,
        },
        {
          restX: 0.5,
          restY: 0.78,
          restZ: wallZ + 0.08,
          endX: 0.36,
          endY: 0.12,
          endZ: wallZ + 0.64,
          endRx: 1.5,
          endRy: 0.18,
          endRz: -0.14,
          bulgeZ: 0.08,
        },
      ]
      const slabMeshes = []
      for (let i = 0; i < slabConfigs.length; i += 1) {
        const sc = slabConfigs[i]
        const slab = new THREE.Mesh(slabGeo, i % 2 === 0 ? concreteMat : rubbleMat)
        slab.position.set(sc.restX, sc.restY, sc.restZ)
        slabGroup.add(slab)
        slabMeshes.push(slab)
      }
      wallMountGroup.add(slabGroup)

      // 4. Spreading dark structural crack lines across the damaged masonry face
      const crackGroup = new THREE.Group()
      crackGroup.name = 'hazard-wall-cracks'
      crackGroup.position.set(0, 1.32, wallZ + 0.165)
      const crackGeo = getPooledGeometry('wall_collapse:crackStrip', () => new THREE.BoxGeometry(0.042, 0.92, 0.012))
      const crackSpecs = [
        { x: 0.0, y: 0.12, rz: 0.16, sy: 1.15 },
        { x: -0.32, y: 0.36, rz: -0.52, sy: 0.85 },
        { x: 0.36, y: 0.24, rz: 0.48, sy: 0.9 },
        { x: -0.26, y: -0.32, rz: 0.64, sy: 0.78 },
        { x: 0.28, y: -0.28, rz: -0.58, sy: 0.82 },
      ]
      for (let i = 0; i < crackSpecs.length; i += 1) {
        const cs = crackSpecs[i]
        const strip = new THREE.Mesh(crackGeo, crackMat)
        strip.position.set(cs.x, cs.y, 0)
        strip.rotation.z = cs.rz
        strip.scale.set(1, cs.sy, 1)
        crackGroup.add(strip)
      }
      wallMountGroup.add(crackGroup)

      // 5. Bounded warning loose masonry & falling dust flakes (6 chips)
      const warningGroup = new THREE.Group()
      warningGroup.name = 'hazard-wall-warning-masonry'
      warningGroup.visible = false
      const warnChipGeo = getPooledGeometry('wall_collapse:warnChip', () => new THREE.BoxGeometry(0.075, 0.065, 0.055))
      const warningChunks = []
      const warningChunkConfigs = []
      const MAX_WALL_WARN_CHIPS = 6
      for (let i = 0; i < MAX_WALL_WARN_CHIPS; i += 1) {
        const wx = -0.78 + i * 0.31
        const startY = 1.65 + (i % 3) * 0.28
        warningChunkConfigs.push({
          x: wx,
          startY,
          z: wallZ + 0.19 + (i % 2) * 0.06,
          phase: (i * 0.31) % 1,
          speed: 1.55 + (i % 3) * 0.3,
        })
        const chip = new THREE.Mesh(warnChipGeo, i % 2 === 0 ? rubbleMat : concreteMat)
        warningGroup.add(chip)
        warningChunks.push(chip)
      }
      wallMountGroup.add(warningGroup)

      // 6. Bounded collapse rubble chunks (8 blocks settling in controlled corridor apron)
      const wallRubbleGroup = new THREE.Group()
      wallRubbleGroup.name = 'hazard-wall-rubble'
      wallRubbleGroup.visible = false
      const rubbleBlockGeo = getPooledGeometry('wall_collapse:rubbleBlock', () => new THREE.BoxGeometry(0.24, 0.16, 0.2))
      const wallRubbleMeshes = []
      const wallRubbleConfigs = []
      const MAX_WALL_RUBBLE = 8
      for (let i = 0; i < MAX_WALL_RUBBLE; i += 1) {
        const lane = -0.96 + (i / (MAX_WALL_RUBBLE - 1)) * 1.92
        const reach = 0.34 + (i % 4) * 0.24 // Stays within 0.34..1.06m of wall face (leaves ~2.9m corridor open!)
        wallRubbleConfigs.push({
          startX: lane * 0.7,
          startY: 0.75 + (i % 3) * 0.58,
          startZ: wallZ + 0.14,
          endX: lane,
          endY: 0.08 + (i % 2) * 0.04,
          endZ: wallZ + reach,
          arcH: 0.28 + (i % 3) * 0.14,
          rotY: 0.4 + i * 0.75,
        })
        const block = new THREE.Mesh(rubbleBlockGeo, i % 2 === 0 ? rubbleMat : concreteMat)
        wallRubbleGroup.add(block)
        wallRubbleMeshes.push(block)
      }
      wallMountGroup.add(wallRubbleGroup)

      // 7. Bounded dust cloud puffs (6 spheres billowing outward and fading cleanly)
      const wallDustGroup = new THREE.Group()
      wallDustGroup.name = 'hazard-wall-dust'
      wallDustGroup.visible = false
      const wallDustGeo = getPooledGeometry('wall_collapse:dust', () => new THREE.SphereGeometry(0.32, 7, 7))
      const wallDustMeshes = []
      const wallDustConfigs = []
      const MAX_WALL_DUST = 6
      for (let i = 0; i < MAX_WALL_DUST; i += 1) {
        wallDustConfigs.push({
          x: -0.75 + i * 0.3,
          startY: 0.45 + (i % 3) * 0.42,
          riseY: 0.55 + (i % 2) * 0.28,
          reachZ: 0.45 + (i % 3) * 0.32,
          baseScale: 0.7 + (i % 3) * 0.22,
        })
        const puff = new THREE.Mesh(wallDustGeo, dustMat)
        wallDustGroup.add(puff)
        wallDustMeshes.push(puff)
      }
      wallMountGroup.add(wallDustGroup)

      root.userData = {
        hazardType: type,
        wallSide,
        wallYaw,
        wallZ,
        wallMountGroup,
        cavityMesh,
        rimGroup,
        rebarGroup,
        slabGroup,
        slabMeshes,
        slabConfigs,
        crackGroup,
        warningGroup,
        warningChunks,
        warningChunkConfigs,
        wallRubbleGroup,
        wallRubbleMeshes,
        wallRubbleConfigs,
        wallDustGroup,
        wallDustMeshes,
        wallDustConfigs,
        dustMat,
      }
      break
    }

    case HAZARD_TYPES.FALLING_WATER_TANK: {
      const mountType = hazardData.mountType || 'ceiling_suspended'
      const wallSide = hazardData.wallSide || null
      const tankYaw = Number.isFinite(hazardData.tankYaw) ? hazardData.tankYaw : 0
      const surgeLength = Number.isFinite(hazardData.surgeLength) ? hazardData.surgeLength : 2.55
      const surgeHalfWidth = Number.isFinite(hazardData.surgeHalfWidth) ? hazardData.surgeHalfWidth : 1.05
      const tankRestY = Number.isFinite(hazardData.tankRestY) ? hazardData.tankRestY : 2.48
      const ceilingAnchorY = Number.isFinite(hazardData.ceilingAnchorY) ? hazardData.ceilingAnchorY : 3.58
      const tankFallenY = 0.44

      const tankMountGroup = new THREE.Group()
      tankMountGroup.name = `hazard-water-tank-${mountType}`
      tankMountGroup.rotation.y = tankYaw
      root.add(tankMountGroup)

      const steelMat = getPooledMaterial(
        'water_tank:steel',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.tankSteel,
            roughness: 0.62,
            metalness: 0.58,
          })
      )
      const rustMat = getPooledMaterial(
        'water_tank:rust',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.tankRust,
            roughness: 0.92,
            metalness: 0.24,
          })
      )
      const bracketMat = getPooledMaterial(
        'water_tank:bracket',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.tankBracket,
            roughness: 0.52,
            metalness: 0.78,
          })
      )
      const pipeMat = getPooledMaterial(
        'water_tank:pipe',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.tankPipe,
            roughness: 0.68,
            metalness: 0.62,
          })
      )
      const seamMat = getPooledMaterial(
        'water_tank:seam',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.tankSeam,
            roughness: 0.96,
            metalness: 0.12,
          })
      )

      // Instance-owned translucent water materials (disposed per hazard instance)
      const leakMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.waterLeak,
        roughness: 0.14,
        metalness: 0.12,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      })
      const surgeMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.waterSurge,
        roughness: 0.12,
        metalness: 0.22,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
      const puddleMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.waterPuddle,
        roughness: 0.1,
        metalness: 0.28,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })

      // 1. Structural overhead support rig anchored to ceiling slab (never floating)
      const supportGroup = new THREE.Group()
      supportGroup.name = 'hazard-water-tank-supports'

      const beamGeo = getPooledGeometry(
        'water_tank:ceilingBeam',
        () => new THREE.BoxGeometry(1.56, 0.12, 0.24)
      )
      const ceilingBeam = new THREE.Mesh(beamGeo, bracketMat)
      ceilingBeam.position.set(0, ceilingAnchorY - 0.06, 0)
      supportGroup.add(ceilingBeam)

      const anchorPlateGeo = getPooledGeometry(
        'water_tank:anchorPlate',
        () => new THREE.BoxGeometry(0.26, 0.04, 0.28)
      )
      const upperRodGeo = getPooledGeometry(
        'water_tank:upperRod',
        () => new THREE.CylinderGeometry(0.024, 0.024, 0.56, 6)
      )
      const lowerStrapGeo = getPooledGeometry(
        'water_tank:lowerStrap',
        () => new THREE.BoxGeometry(0.075, 0.54, 0.024)
      )
      const strapRestY = 2.74
      const brokenStraps = []
      for (const sx of [-0.46, 0.46]) {
        const plate = new THREE.Mesh(anchorPlateGeo, rustMat)
        plate.position.set(sx, ceilingAnchorY - 0.01, 0)
        supportGroup.add(plate)

        const upperRod = new THREE.Mesh(upperRodGeo, bracketMat)
        upperRod.position.set(sx, ceilingAnchorY - 0.34, 0)
        supportGroup.add(upperRod)

        const lowerStrap = new THREE.Mesh(lowerStrapGeo, rustMat)
        lowerStrap.position.set(sx, strapRestY, 0)
        supportGroup.add(lowerStrap)
        brokenStraps.push(lowerStrap)
      }

      // Corroded overhead feeder pipe connected into ceiling deck
      const feederPipeGeo = getPooledGeometry(
        'water_tank:feederPipe',
        () => new THREE.CylinderGeometry(0.055, 0.055, 0.68, 8)
      )
      const feederPipe = new THREE.Mesh(feederPipeGeo, pipeMat)
      feederPipe.position.set(0.28, ceilingAnchorY - 0.34, -0.06)
      supportGroup.add(feederPipe)

      const feederFlangeGeo = getPooledGeometry(
        'water_tank:feederFlange',
        () => new THREE.CylinderGeometry(0.095, 0.095, 0.045, 8)
      )
      const feederFlange = new THREE.Mesh(feederFlangeGeo, rustMat)
      feederFlange.position.set(0.28, ceilingAnchorY - 0.68, -0.06)
      supportGroup.add(feederFlange)

      // Structural wall brace when backed by an actual maze wall at z = -CELL_SIZE/2
      let wallBraceGroup = null
      if (mountType === 'ceiling_wall_brace') {
        wallBraceGroup = new THREE.Group()
        wallBraceGroup.name = 'hazard-water-tank-wall-brace'
        const wallZ = -CELL_SIZE * 0.5
        const wallPlateGeo = getPooledGeometry(
          'water_tank:wallPlate',
          () => new THREE.BoxGeometry(1.16, 0.34, 0.06)
        )
        const wallPlate = new THREE.Mesh(wallPlateGeo, bracketMat)
        wallPlate.position.set(0, 2.74, wallZ + 0.035)
        wallBraceGroup.add(wallPlate)

        const braceStrutGeo = getPooledGeometry(
          'water_tank:braceStrut',
          () => new THREE.BoxGeometry(0.07, 0.07, 1.82)
        )
        for (const sx of [-0.42, 0.42]) {
          const strut = new THREE.Mesh(braceStrutGeo, rustMat)
          strut.position.set(sx, 3.04, wallZ * 0.52)
          strut.rotation.x = -0.34
          wallBraceGroup.add(strut)
        }
        supportGroup.add(wallBraceGroup)
      }
      tankMountGroup.add(supportGroup)

      // 2. Deteriorated horizontal industrial water tank body (composite multi-part assembly)
      const tankGroup = new THREE.Group()
      tankGroup.name = 'hazard-water-tank-body'
      tankGroup.position.set(0, tankRestY, 0)

      const hullGeo = getPooledGeometry(
        'water_tank:hull',
        () => new THREE.CylinderGeometry(0.45, 0.45, 1.36, 12)
      )
      const hullMesh = new THREE.Mesh(hullGeo, steelMat)
      hullMesh.rotation.z = Math.PI * 0.5
      tankGroup.add(hullMesh)

      const capGeo = getPooledGeometry(
        'water_tank:endCap',
        () => new THREE.SphereGeometry(0.445, 10, 8)
      )
      for (const sx of [-0.68, 0.68]) {
        const cap = new THREE.Mesh(capGeo, steelMat)
        cap.position.set(sx, 0, 0)
        cap.scale.set(0.42, 1, 1)
        tankGroup.add(cap)
      }

      const hoopGeo = getPooledGeometry(
        'water_tank:hoop',
        () => new THREE.TorusGeometry(0.465, 0.028, 6, 14)
      )
      for (const sx of [-0.44, 0.44]) {
        const hoop = new THREE.Mesh(hoopGeo, rustMat)
        hoop.position.set(sx, 0, 0)
        hoop.rotation.y = Math.PI * 0.5
        tankGroup.add(hoop)
      }

      // Corroded rust patch & damaged leaking seam on lower-front face
      const rustPatchGeo = getPooledGeometry(
        'water_tank:rustPatch',
        () => new THREE.BoxGeometry(0.74, 0.24, 0.06)
      )
      const rustPatch = new THREE.Mesh(rustPatchGeo, rustMat)
      rustPatch.position.set(-0.08, -0.28, 0.36)
      rustPatch.rotation.x = 0.55
      tankGroup.add(rustPatch)

      const seamGeo = getPooledGeometry(
        'water_tank:seamCrack',
        () => new THREE.BoxGeometry(0.62, 0.055, 0.04)
      )
      const seamMesh = new THREE.Mesh(seamGeo, seamMat)
      seamMesh.position.set(-0.08, -0.32, 0.375)
      seamMesh.rotation.x = 0.55
      tankGroup.add(seamMesh)

      // Top inlet collar + shutoff valve wheel
      const valveStemGeo = getPooledGeometry(
        'water_tank:valveStem',
        () => new THREE.CylinderGeometry(0.035, 0.045, 0.16, 6)
      )
      const valveStem = new THREE.Mesh(valveStemGeo, pipeMat)
      valveStem.position.set(0.28, 0.48, -0.06)
      tankGroup.add(valveStem)

      const valveWheelGeo = getPooledGeometry(
        'water_tank:valveWheel',
        () => new THREE.TorusGeometry(0.11, 0.018, 6, 10)
      )
      const valveWheel = new THREE.Mesh(valveWheelGeo, rustMat)
      valveWheel.position.set(-0.34, 0.12, 0.47)
      tankGroup.add(valveWheel)

      tankMountGroup.add(tankGroup)

      // 3. Bounded leaking water droplets & thin leak streams (6 droplets + 2 streams)
      const leakGroup = new THREE.Group()
      leakGroup.name = 'hazard-water-tank-leaks'
      const dropGeo = getPooledGeometry(
        'water_tank:droplet',
        () => new THREE.SphereGeometry(0.036, 6, 5)
      )
      const streamGeo = getPooledGeometry(
        'water_tank:leakStream',
        () => new THREE.CylinderGeometry(0.012, 0.022, 1.0, 5)
      )
      const leakDrops = []
      const leakDropConfigs = []
      const MAX_LEAK_DROPS = 6
      for (let i = 0; i < MAX_LEAK_DROPS; i += 1) {
        leakDropConfigs.push({
          x: -0.32 + i * 0.13,
          z: 0.22 + (i % 2) * 0.16,
          startY: tankRestY - 0.38,
          phase: (i * 0.29) % 1,
          speed: 1.45 + (i % 3) * 0.35,
        })
        const drop = new THREE.Mesh(dropGeo, leakMat)
        drop.scale.set(0.85, 1.45, 0.85)
        leakGroup.add(drop)
        leakDrops.push(drop)
      }
      const leakStreams = []
      for (const sx of [-0.2, 0.12]) {
        const stream = new THREE.Mesh(streamGeo, leakMat)
        stream.position.set(sx, 1.04, 0.3)
        stream.scale.set(1, 2.02, 1)
        stream.visible = false
        leakGroup.add(stream)
        leakStreams.push(stream)
      }
      tankMountGroup.add(leakGroup)

      // 4. Bounded fallen bracket/metal fragments (4 pieces)
      const tankDebrisGroup = new THREE.Group()
      tankDebrisGroup.name = 'hazard-water-tank-debris'
      tankDebrisGroup.visible = false
      const debrisGeo = getPooledGeometry(
        'water_tank:debrisFrag',
        () => new THREE.BoxGeometry(0.16, 0.045, 0.09)
      )
      const tankDebrisMeshes = []
      const tankDebrisConfigs = [
        { startX: -0.46, startY: 2.3, startZ: 0.1, endX: -0.84, endZ: 0.42, arcH: 0.35, rotY: 0.6 },
        { startX: 0.46, startY: 2.35, startZ: 0.1, endX: 0.88, endZ: 0.56, arcH: 0.42, rotY: -0.9 },
        { startX: -0.18, startY: 2.1, startZ: 0.32, endX: -0.52, endZ: 0.96, arcH: 0.28, rotY: 1.4 },
        { startX: 0.24, startY: 2.15, startZ: 0.28, endX: 0.64, endZ: 1.08, arcH: 0.31, rotY: -1.7 },
      ]
      for (let i = 0; i < tankDebrisConfigs.length; i += 1) {
        const frag = new THREE.Mesh(debrisGeo, i % 2 === 0 ? rustMat : bracketMat)
        tankDebrisGroup.add(frag)
        tankDebrisMeshes.push(frag)
      }
      tankMountGroup.add(tankDebrisGroup)

      // 5. Controlled directional water surge wave (sheet + leading wave crest + 8 bounded spray droplets)
      const surgeGroup = new THREE.Group()
      surgeGroup.name = 'hazard-water-tank-surge'
      surgeGroup.visible = false

      const surgeSheetGeo = getPooledGeometry(
        'water_tank:surgeSheet',
        () => new THREE.PlaneGeometry(1, 1)
      )
      const surgeSheetMesh = new THREE.Mesh(surgeSheetGeo, surgeMat)
      surgeSheetMesh.rotation.x = -Math.PI * 0.5
      surgeSheetMesh.position.set(0, 0.024, 0)
      surgeGroup.add(surgeSheetMesh)

      const crestGeo = getPooledGeometry(
        'water_tank:surgeCrest',
        () => new THREE.CylinderGeometry(0.14, 0.2, 1.0, 8, 1, false, 0, Math.PI)
      )
      const crestMesh = new THREE.Mesh(crestGeo, surgeMat)
      crestMesh.rotation.z = Math.PI * 0.5
      crestMesh.position.set(0, 0.09, 0.35)
      crestMesh.scale.set(1, surgeHalfWidth * 1.85, 1)
      surgeGroup.add(crestMesh)

      const sprayGeo = getPooledGeometry(
        'water_tank:sprayDrop',
        () => new THREE.SphereGeometry(0.068, 6, 5)
      )
      const sprayMeshes = []
      const sprayConfigs = []
      const MAX_SPRAY = 8
      for (let i = 0; i < MAX_SPRAY; i += 1) {
        const lane = -0.82 + (i / (MAX_SPRAY - 1)) * 1.64
        sprayConfigs.push({
          startX: lane * 0.4,
          endX: lane * surgeHalfWidth * 0.92,
          reachZ: 0.55 + ((i * 3 + 1) % MAX_SPRAY) / MAX_SPRAY * (surgeLength - 0.45),
          arcH: 0.24 + (i % 3) * 0.14,
          baseScale: 0.72 + (i % 3) * 0.22,
        })
        const sp = new THREE.Mesh(sprayGeo, leakMat)
        surgeGroup.add(sp)
        sprayMeshes.push(sp)
      }
      tankMountGroup.add(surgeGroup)

      // 6. Permanent flooded / wet reflective floor slick (single lightweight disc, zero overdraw spam)
      const puddleGeo = getPooledGeometry(
        'water_tank:puddleDisc',
        () => new THREE.CircleGeometry(1, 14)
      )
      const puddleMesh = new THREE.Mesh(puddleGeo, puddleMat)
      puddleMesh.rotation.x = -Math.PI * 0.5
      puddleMesh.position.set(0, 0.012, 0.15)
      puddleMesh.visible = false
      tankMountGroup.add(puddleMesh)

      root.userData = {
        hazardType: type,
        mountType,
        wallSide,
        tankYaw,
        surgeLength,
        surgeHalfWidth,
        tankRestY,
        tankFallenY,
        ceilingAnchorY,
        strapRestY,
        tankMountGroup,
        supportGroup,
        wallBraceGroup,
        brokenStraps,
        tankGroup,
        seamMesh,
        leakGroup,
        leakDrops,
        leakDropConfigs,
        leakStreams,
        tankDebrisGroup,
        tankDebrisMeshes,
        tankDebrisConfigs,
        surgeGroup,
        surgeSheetMesh,
        crestMesh,
        sprayMeshes,
        sprayConfigs,
        puddleMesh,
        leakMat,
        surgeMat,
        puddleMat,
      }
      break
    }

    case HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY: {
      const mountType = hazardData.mountType || 'ceiling_gantry_rail'
      const machineryYaw = Number.isFinite(hazardData.machineryYaw) ? hazardData.machineryYaw : 0
      const machineryRestY = Number.isFinite(hazardData.machineryRestY)
        ? hazardData.machineryRestY
        : 2.42
      const ceilingAnchorY = Number.isFinite(hazardData.ceilingAnchorY)
        ? hazardData.ceilingAnchorY
        : 3.58
      const pivotY = 3.22
      const restDropY = machineryRestY - pivotY // -0.80
      const fallenY = 0.4
      const impactLocalZ = 0.72

      const machineryMountGroup = new THREE.Group()
      machineryMountGroup.name = `hazard-suspended-machinery-${mountType}`
      machineryMountGroup.rotation.y = machineryYaw
      root.add(machineryMountGroup)

      const gantryMat = getPooledMaterial(
        'suspended_machinery:gantry',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.machineryGantry,
            roughness: 0.68,
            metalness: 0.56,
          })
      )
      const housingMat = getPooledMaterial(
        'suspended_machinery:housing',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.machineryHousing,
            roughness: 0.58,
            metalness: 0.64,
          })
      )
      const stripeMat = getPooledMaterial(
        'suspended_machinery:stripe',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.machineryStripe,
            roughness: 0.72,
            metalness: 0.18,
          })
      )
      const chainMat = getPooledMaterial(
        'suspended_machinery:chain',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.machineryChain,
            roughness: 0.46,
            metalness: 0.84,
          })
      )
      const rustMat = getPooledMaterial(
        'suspended_machinery:rust',
        () =>
          new THREE.MeshStandardMaterial({
            color: HAZARD_PALETTE.machineryRust,
            roughness: 0.9,
            metalness: 0.28,
          })
      )

      // Instance-owned impact dust material so each crash fades independently
      const dustMat = new THREE.MeshBasicMaterial({
        color: HAZARD_PALETTE.machineryDust,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })

      // 1. Structural Overhead Steel Gantry I-Beam & Ceiling/Wall Anchors (adapted from facility gantries)
      const gantryGroup = new THREE.Group()
      gantryGroup.name = 'hazard-machinery-gantry'

      const beamSpanX = mountType === 'wall_to_wall_gantry' ? CELL_SIZE - 0.08 : 2.35
      const flangeGeo = getPooledGeometry(
        mountType === 'wall_to_wall_gantry'
          ? 'suspended_machinery:flangeWall'
          : 'suspended_machinery:flangeCeil',
        () => new THREE.BoxGeometry(beamSpanX, 0.055, 0.26)
      )
      const webGeo = getPooledGeometry(
        mountType === 'wall_to_wall_gantry'
          ? 'suspended_machinery:webWall'
          : 'suspended_machinery:webCeil',
        () => new THREE.BoxGeometry(beamSpanX, 0.16, 0.075)
      )
      const topFlange = new THREE.Mesh(flangeGeo, gantryMat)
      topFlange.position.set(0, ceilingAnchorY - 0.03, 0)
      gantryGroup.add(topFlange)

      const beamWeb = new THREE.Mesh(webGeo, gantryMat)
      beamWeb.position.set(0, ceilingAnchorY - 0.135, 0)
      gantryGroup.add(beamWeb)

      const botFlange = new THREE.Mesh(flangeGeo, gantryMat)
      botFlange.position.set(0, ceilingAnchorY - 0.24, 0)
      gantryGroup.add(botFlange)

      // Ceiling anchor plates bolted into soffit slab
      const anchorGeo = getPooledGeometry(
        'suspended_machinery:anchorPlate',
        () => new THREE.BoxGeometry(0.28, 0.04, 0.36)
      )
      for (const ax of [-0.92, 0.92]) {
        const plate = new THREE.Mesh(anchorGeo, rustMat)
        plate.position.set(ax, ceilingAnchorY - 0.01, 0)
        gantryGroup.add(plate)
      }

      // Flanking wall corbel brackets when spanning wall-to-wall
      let wallBracketsGroup = null
      if (mountType === 'wall_to_wall_gantry') {
        wallBracketsGroup = new THREE.Group()
        wallBracketsGroup.name = 'hazard-machinery-wall-brackets'
        const corbelGeo = getPooledGeometry(
          'suspended_machinery:wallCorbel',
          () => new THREE.BoxGeometry(0.14, 0.34, 0.34)
        )
        const halfWallX = CELL_SIZE * 0.5 - 0.07
        for (const sx of [-halfWallX, halfWallX]) {
          const corbel = new THREE.Mesh(corbelGeo, rustMat)
          corbel.position.set(sx, ceilingAnchorY - 0.22, 0)
          wallBracketsGroup.add(corbel)
        }
        gantryGroup.add(wallBracketsGroup)
      }

      // Wheeled hoist trolley carriage gripping lower I-beam flange
      const trolleyGroup = new THREE.Group()
      trolleyGroup.name = 'hazard-machinery-trolley'
      trolleyGroup.position.set(0, pivotY, 0)
      const trolleyBodyGeo = getPooledGeometry(
        'suspended_machinery:trolleyBody',
        () => new THREE.BoxGeometry(0.58, 0.16, 0.38)
      )
      const trolleyBody = new THREE.Mesh(trolleyBodyGeo, gantryMat)
      trolleyBody.position.set(0, 0.06, 0)
      trolleyGroup.add(trolleyBody)

      const pulleyGeo = getPooledGeometry(
        'suspended_machinery:pulley',
        () => new THREE.CylinderGeometry(0.085, 0.085, 0.08, 8)
      )
      for (const pz of [-0.14, 0.14]) {
        const pulley = new THREE.Mesh(pulleyGeo, chainMat)
        pulley.rotation.z = Math.PI * 0.5
        pulley.position.set(0, -0.02, pz)
        trolleyGroup.add(pulley)
      }
      gantryGroup.add(trolleyGroup)

      // Overhead snapped cable stubs anchored to trolley (visible & bent after drop)
      const cableGeo = getPooledGeometry(
        'suspended_machinery:hoistCable',
        () => new THREE.CylinderGeometry(0.018, 0.018, 0.72, 6)
      )
      const rearCable = new THREE.Mesh(cableGeo, chainMat)
      rearCable.position.set(0, pivotY - 0.36, -0.24)
      gantryGroup.add(rearCable)

      const frontCable = new THREE.Mesh(cableGeo, chainMat)
      frontCable.position.set(0, pivotY - 0.36, 0.24)
      gantryGroup.add(frontCable)

      machineryMountGroup.add(gantryGroup)

      // 2. Heavy Suspended Industrial Motor / Winch Machinery Unit (composite multi-part silhouette)
      const machinePivotGroup = new THREE.Group()
      machinePivotGroup.name = 'hazard-machinery-pivot'
      machinePivotGroup.position.set(0, pivotY, 0)

      const machineBodyGroup = new THREE.Group()
      machineBodyGroup.name = 'hazard-machinery-unit'
      machineBodyGroup.position.set(0, restDropY, 0)

      // Primary ribbed cast-iron motor chassis
      const chassisGeo = getPooledGeometry(
        'suspended_machinery:chassis',
        () => new THREE.BoxGeometry(0.92, 0.52, 0.76)
      )
      const chassisMesh = new THREE.Mesh(chassisGeo, housingMat)
      machineBodyGroup.add(chassisMesh)

      // Cylindrical industrial motor/winch drum
      const drumGeo = getPooledGeometry(
        'suspended_machinery:drum',
        () => new THREE.CylinderGeometry(0.24, 0.24, 1.06, 10)
      )
      const drumMesh = new THREE.Mesh(drumGeo, gantryMat)
      drumMesh.rotation.z = Math.PI * 0.5
      drumMesh.position.set(0, 0.04, 0.06)
      machineBodyGroup.add(drumMesh)

      // Side gearbox casing & rusted mounting flange
      const gearboxGeo = getPooledGeometry(
        'suspended_machinery:gearbox',
        () => new THREE.BoxGeometry(0.24, 0.42, 0.48)
      )
      const gearboxMesh = new THREE.Mesh(gearboxGeo, rustMat)
      gearboxMesh.position.set(-0.52, -0.02, -0.04)
      machineBodyGroup.add(gearboxMesh)

      // Weathered caution-ochre underside skid bumper (visually signals heavy falling load)
      const bumperGeo = getPooledGeometry(
        'suspended_machinery:bumper',
        () => new THREE.BoxGeometry(0.98, 0.09, 0.82)
      )
      const bumperMesh = new THREE.Mesh(bumperGeo, stripeMat)
      bumperMesh.position.set(0, -0.28, 0)
      machineBodyGroup.add(bumperMesh)

      // Top lifting shackle eyes & hoist crossbar
      const shackleGeo = getPooledGeometry(
        'suspended_machinery:shackle',
        () => new THREE.TorusGeometry(0.065, 0.018, 6, 10)
      )
      for (const sz of [-0.24, 0.24]) {
        const shackle = new THREE.Mesh(shackleGeo, chainMat)
        shackle.position.set(0, 0.3, sz)
        machineBodyGroup.add(shackle)
      }

      machinePivotGroup.add(machineBodyGroup)
      machineryMountGroup.add(machinePivotGroup)

      // 3. Bounded Warning Loose Bolts & Metal Shavings (6 falling particles)
      const warnBoltGroup = new THREE.Group()
      warnBoltGroup.name = 'hazard-machinery-warning-bolts'
      warnBoltGroup.visible = false
      const boltFragGeo = getPooledGeometry(
        'suspended_machinery:warnBolt',
        () => new THREE.CylinderGeometry(0.024, 0.024, 0.07, 6)
      )
      const warnBoltMeshes = []
      const warnBoltConfigs = []
      const MAX_WARN_BOLTS = 6
      for (let i = 0; i < MAX_WARN_BOLTS; i += 1) {
        warnBoltConfigs.push({
          x: -0.36 + i * 0.145,
          z: -0.18 + (i % 3) * 0.22,
          startY: pivotY - 0.08 - (i % 2) * 0.35,
          phase: (i * 0.31) % 1,
          speed: 1.45 + (i % 3) * 0.32,
        })
        const bolt = new THREE.Mesh(boltFragGeo, i % 2 === 0 ? rustMat : chainMat)
        warnBoltGroup.add(bolt)
        warnBoltMeshes.push(bolt)
      }
      machineryMountGroup.add(warnBoltGroup)

      // 4. Bounded Impact Metal Debris (6 sheared plates/gears settling around impactLocalZ)
      const impactDebrisGroup = new THREE.Group()
      impactDebrisGroup.name = 'hazard-machinery-debris'
      impactDebrisGroup.visible = false
      const impactFragGeo = getPooledGeometry(
        'suspended_machinery:impactFrag',
        () => new THREE.BoxGeometry(0.18, 0.055, 0.12)
      )
      const impactDebrisMeshes = []
      const impactDebrisConfigs = []
      const MAX_IMPACT_DEBRIS = 6
      for (let i = 0; i < MAX_IMPACT_DEBRIS; i += 1) {
        const angle = (i / MAX_IMPACT_DEBRIS) * Math.PI * 2 + 0.35
        const dist = 0.56 + (i % 3) * 0.24
        impactDebrisConfigs.push({
          startX: (i % 2 === 0 ? -0.25 : 0.25),
          startY: 1.2 + (i % 2) * 0.6,
          startZ: 0.25,
          endX: Math.cos(angle) * dist,
          endZ: impactLocalZ + Math.sin(angle) * (dist * 0.85),
          arcH: 0.26 + (i % 3) * 0.12,
          rotY: angle + 0.6,
        })
        const frag = new THREE.Mesh(impactFragGeo, i % 3 === 0 ? stripeMat : i % 2 === 0 ? rustMat : housingMat)
        impactDebrisGroup.add(frag)
        impactDebrisMeshes.push(frag)
      }
      machineryMountGroup.add(impactDebrisGroup)

      // 5. Bounded Impact Dust Cloud (6 translucent spheres billowing around crash zone)
      const impactDustGroup = new THREE.Group()
      impactDustGroup.name = 'hazard-machinery-dust'
      impactDustGroup.visible = false
      const machDustGeo = getPooledGeometry(
        'suspended_machinery:dust',
        () => new THREE.SphereGeometry(0.26, 7, 6)
      )
      const impactDustMeshes = []
      const impactDustConfigs = []
      const MAX_MACH_DUST = 6
      for (let i = 0; i < MAX_MACH_DUST; i += 1) {
        const angle = (i / MAX_MACH_DUST) * Math.PI * 2
        impactDustConfigs.push({
          dx: Math.cos(angle) * (0.45 + (i % 2) * 0.32),
          dz: impactLocalZ + Math.sin(angle) * (0.45 + (i % 2) * 0.28),
          riseY: 0.42 + (i % 3) * 0.22,
          baseScale: 0.72 + (i % 3) * 0.22,
        })
        const puff = new THREE.Mesh(machDustGeo, dustMat)
        impactDustGroup.add(puff)
        impactDustMeshes.push(puff)
      }
      machineryMountGroup.add(impactDustGroup)

      root.userData = {
        hazardType: type,
        mountType,
        machineryYaw,
        machineryRestY,
        ceilingAnchorY,
        pivotY,
        restDropY,
        fallenY,
        impactLocalZ,
        machineryMountGroup,
        gantryGroup,
        wallBracketsGroup,
        trolleyGroup,
        rearCable,
        frontCable,
        machinePivotGroup,
        machineBodyGroup,
        warnBoltGroup,
        warnBoltMeshes,
        warnBoltConfigs,
        impactDebrisGroup,
        impactDebrisMeshes,
        impactDebrisConfigs,
        impactDustGroup,
        impactDustMeshes,
        impactDustConfigs,
        dustMat,
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

    case HAZARD_TYPES.COLLAPSING_FLOOR_GRATE: {
      const {
        grateRestY = 0.015,
        leftLeafGroup,
        rightLeafGroup,
        bolts,
        boltRestPositions,
        brokenStubsGroup,
        warningFragGroup,
        warningFragments,
        warningFragConfigs,
        debrisGroup,
        debrisMeshes,
        debrisConfigs,
        dustGroup,
        dustMeshes,
        dustConfigs,
        dustMat,
      } = data
      if (!leftLeafGroup || !rightLeafGroup) return

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        leftLeafGroup.rotation.z = -1.34
        rightLeafGroup.rotation.z = 1.28
        leftLeafGroup.position.y = grateRestY - 0.34
        rightLeafGroup.position.y = grateRestY - 0.34

        if (brokenStubsGroup) brokenStubsGroup.visible = true
        if (warningFragGroup) warningFragGroup.visible = false
        if (dustGroup) dustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (debrisGroup && debrisMeshes && debrisConfigs) {
          debrisGroup.visible = true
          for (let i = 0; i < debrisMeshes.length; i += 1) {
            const cfg = debrisConfigs[i]
            const shard = debrisMeshes[i]
            shard.position.set(cfg.endX, 0.016, cfg.endZ)
            shard.rotation.set(0.12, cfg.rotY, 0.08)
          }
        }
        if (bolts && boltRestPositions) {
          for (let i = 0; i < bolts.length; i += 1) {
            const bp = boltRestPositions[i]
            const bolt = bolts[i]
            bolt.position.set(bp.sx, 0.012, bp.sz)
            bolt.rotation.z = i % 2 === 0 ? 1.35 : -1.25
          }
        }
        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        const ease = clamped * clamped
        leftLeafGroup.rotation.z = -0.18 - ease * 1.16
        rightLeafGroup.rotation.z = 0.18 + ease * 1.1
        leftLeafGroup.position.y = grateRestY - ease * 0.34
        rightLeafGroup.position.y = grateRestY - ease * 0.34

        if (brokenStubsGroup) brokenStubsGroup.visible = true
        if (warningFragGroup) warningFragGroup.visible = false

        if (bolts && boltRestPositions) {
          for (let i = 0; i < bolts.length; i += 1) {
            const bp = boltRestPositions[i]
            const bolt = bolts[i]
            const jump = Math.sin(clamped * Math.PI) * 0.14
            bolt.position.set(
              bp.x + (bp.sx - bp.x) * clamped,
              0.012 + jump,
              bp.z + (bp.sz - bp.z) * clamped
            )
            bolt.rotation.z = (i % 2 === 0 ? 1.35 : -1.25) * clamped
          }
        }

        if (debrisGroup && debrisMeshes && debrisConfigs) {
          debrisGroup.visible = true
          for (let i = 0; i < debrisMeshes.length; i += 1) {
            const cfg = debrisConfigs[i]
            const shard = debrisMeshes[i]
            const arcY = Math.sin(clamped * Math.PI) * cfg.arcH
            shard.position.set(
              cfg.startX + (cfg.endX - cfg.startX) * clamped,
              0.016 + arcY,
              cfg.startZ + (cfg.endZ - cfg.startZ) * clamped
            )
            shard.rotation.set(clamped * 2.4, cfg.rotY, clamped * 1.8)
          }
        }

        if (dustGroup && dustMeshes && dustConfigs && dustMat) {
          dustGroup.visible = true
          dustMat.opacity = Math.max(0, Math.sin(clamped * Math.PI) * 0.42)
          for (let i = 0; i < dustMeshes.length; i += 1) {
            const cfg = dustConfigs[i]
            const puff = dustMeshes[i]
            puff.position.set(
              cfg.dx * (0.25 + clamped * 0.85),
              0.08 + cfg.riseY * clamped,
              cfg.dz * (0.25 + clamped * 0.85)
            )
            puff.scale.setScalar(cfg.baseScale * (0.55 + clamped * 1.15))
          }
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const vib = Math.sin(clamped * Math.PI * 28) * (0.006 + clamped * 0.012)
        const bend = 0.018 + clamped * 0.16

        leftLeafGroup.rotation.z = -bend + vib
        rightLeafGroup.rotation.z = bend - vib
        leftLeafGroup.position.y = grateRestY - clamped * 0.012 + Math.abs(vib) * 0.25
        rightLeafGroup.position.y = grateRestY - clamped * 0.012 - Math.abs(vib) * 0.2

        if (brokenStubsGroup) brokenStubsGroup.visible = false
        if (debrisGroup) debrisGroup.visible = false
        if (dustGroup) dustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (bolts && boltRestPositions) {
          for (let i = 0; i < bolts.length; i += 1) {
            const bp = boltRestPositions[i]
            const bolt = bolts[i]
            const rattle = Math.abs(Math.sin(clamped * Math.PI * (22 + i * 5))) * 0.012
            bolt.position.set(bp.x, bp.y + clamped * 0.022 + rattle, bp.z)
            bolt.rotation.z = Math.sin(clamped * Math.PI * 18 + i) * 0.18 * clamped
          }
        }

        if (warningFragGroup && warningFragments && warningFragConfigs) {
          warningFragGroup.visible = true
          for (let i = 0; i < warningFragments.length; i += 1) {
            const cfg = warningFragConfigs[i]
            const chip = warningFragments[i]
            const t = (clamped * cfg.speed + cfg.phase) % 1
            chip.position.set(
              cfg.x + Math.sin(t * Math.PI * 3 + i) * 0.04,
              0.025 - t * 0.08,
              cfg.z
            )
            chip.rotation.set(t * 3.1, i * 0.8, t * 2.4)
          }
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — flush floor-integrated corroded grate with subtle pre-stress sag
      leftLeafGroup.rotation.z = -0.015
      rightLeafGroup.rotation.z = 0.015
      leftLeafGroup.position.y = grateRestY
      rightLeafGroup.position.y = grateRestY

      if (brokenStubsGroup) brokenStubsGroup.visible = false
      if (warningFragGroup) warningFragGroup.visible = false
      if (debrisGroup) debrisGroup.visible = false
      if (dustGroup) dustGroup.visible = false
      if (dustMat) dustMat.opacity = 0

      if (bolts && boltRestPositions) {
        for (let i = 0; i < bolts.length; i += 1) {
          const bp = boltRestPositions[i]
          const bolt = bolts[i]
          bolt.position.set(bp.x, bp.y, bp.z)
          bolt.rotation.set(0, 0, 0)
        }
      }

      data._visualStateKey = 'dormant'
      break
    }

    case HAZARD_TYPES.WALL_COLLAPSE: {
      const {
        wallZ = -CELL_SIZE * 0.5,
        slabMeshes,
        slabConfigs,
        crackGroup,
        warningGroup,
        warningChunks,
        warningChunkConfigs,
        wallRubbleGroup,
        wallRubbleMeshes,
        wallRubbleConfigs,
        wallDustGroup,
        wallDustMeshes,
        wallDustConfigs,
        dustMat,
      } = data
      if (!slabMeshes || !slabConfigs) return

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        for (let i = 0; i < slabMeshes.length; i += 1) {
          const sc = slabConfigs[i]
          const slab = slabMeshes[i]
          slab.position.set(sc.endX, sc.endY, sc.endZ)
          slab.rotation.set(sc.endRx, sc.endRy, sc.endRz)
        }
        if (crackGroup) crackGroup.visible = false
        if (warningGroup) warningGroup.visible = false
        if (wallDustGroup) wallDustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (wallRubbleGroup && wallRubbleMeshes && wallRubbleConfigs) {
          wallRubbleGroup.visible = true
          for (let i = 0; i < wallRubbleMeshes.length; i += 1) {
            const rc = wallRubbleConfigs[i]
            const block = wallRubbleMeshes[i]
            block.position.set(rc.endX, rc.endY, rc.endZ)
            block.rotation.set(0.24, rc.rotY, 0.15)
          }
        }
        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        const ease = clamped * clamped

        for (let i = 0; i < slabMeshes.length; i += 1) {
          const sc = slabConfigs[i]
          const slab = slabMeshes[i]
          const startZ = sc.restZ + sc.bulgeZ
          slab.position.set(
            sc.restX + (sc.endX - sc.restX) * clamped,
            sc.restY + (sc.endY - sc.restY) * ease,
            startZ + (sc.endZ - startZ) * clamped
          )
          slab.rotation.set(
            sc.endRx * clamped,
            sc.endRy * clamped,
            sc.endRz * clamped
          )
        }

        if (crackGroup) crackGroup.visible = false
        if (warningGroup) warningGroup.visible = false

        if (wallRubbleGroup && wallRubbleMeshes && wallRubbleConfigs) {
          wallRubbleGroup.visible = true
          for (let i = 0; i < wallRubbleMeshes.length; i += 1) {
            const rc = wallRubbleConfigs[i]
            const block = wallRubbleMeshes[i]
            const arcY = Math.sin(clamped * Math.PI) * rc.arcH
            block.position.set(
              rc.startX + (rc.endX - rc.startX) * clamped,
              rc.startY + (rc.endY - rc.startY) * ease + arcY,
              rc.startZ + (rc.endZ - rc.startZ) * clamped
            )
            block.rotation.set(clamped * 2.6, rc.rotY, clamped * 1.9)
          }
        }

        if (wallDustGroup && wallDustMeshes && wallDustConfigs && dustMat) {
          wallDustGroup.visible = true
          dustMat.opacity = Math.max(0, Math.sin(clamped * Math.PI) * 0.48)
          for (let i = 0; i < wallDustMeshes.length; i += 1) {
            const dc = wallDustConfigs[i]
            const puff = wallDustMeshes[i]
            puff.position.set(
              dc.x * (0.65 + clamped * 0.5),
              dc.startY + dc.riseY * clamped,
              wallZ + 0.22 + dc.reachZ * clamped
            )
            puff.scale.setScalar(dc.baseScale * (0.55 + clamped * 1.25))
          }
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const vibAmp = 0.008 + clamped * 0.024

        for (let i = 0; i < slabMeshes.length; i += 1) {
          const sc = slabConfigs[i]
          const slab = slabMeshes[i]
          const vibX = Math.sin(clamped * Math.PI * (26 + i * 5)) * vibAmp
          const vibY = Math.cos(clamped * Math.PI * (22 + i * 4)) * (vibAmp * 0.65)
          slab.position.set(
            sc.restX + vibX,
            sc.restY + vibY,
            sc.restZ + sc.bulgeZ * clamped
          )
          slab.rotation.set(clamped * 0.085, 0, vibX * 1.5)
        }

        if (crackGroup) {
          crackGroup.visible = true
          const crackScale = 0.78 + clamped * 0.78
          crackGroup.scale.set(crackScale, crackScale, 1)
          crackGroup.position.z = wallZ + 0.165 + clamped * 0.095
        }

        if (warningGroup && warningChunks && warningChunkConfigs) {
          warningGroup.visible = true
          for (let i = 0; i < warningChunks.length; i += 1) {
            const wc = warningChunkConfigs[i]
            const chip = warningChunks[i]
            const t = (clamped * wc.speed + wc.phase) % 1
            chip.position.set(
              wc.x + Math.sin(t * Math.PI * 4 + i) * 0.05,
              Math.max(0.05, wc.startY * (1 - t * t)),
              wc.z + t * 0.24
            )
            chip.rotation.set(t * 3.4, i * 0.7, t * 2.8)
          }
        }

        if (wallRubbleGroup) wallRubbleGroup.visible = false

        if (wallDustGroup && wallDustMeshes && wallDustConfigs && dustMat) {
          wallDustGroup.visible = true
          dustMat.opacity = 0.08 + clamped * 0.14
          for (let i = 0; i < wallDustMeshes.length; i += 1) {
            const dc = wallDustConfigs[i]
            const puff = wallDustMeshes[i]
            puff.position.set(
              dc.x * 0.85,
              Math.max(0.18, dc.startY - clamped * 0.35),
              wallZ + 0.2 + clamped * 0.18
            )
            puff.scale.setScalar(dc.baseScale * (0.35 + clamped * 0.35))
          }
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — intact visibly weathered wall section flush against real maze wall
      for (let i = 0; i < slabMeshes.length; i += 1) {
        const sc = slabConfigs[i]
        const slab = slabMeshes[i]
        slab.position.set(sc.restX, sc.restY, sc.restZ)
        slab.rotation.set(0, 0, 0)
      }
      if (crackGroup) {
        crackGroup.visible = true
        crackGroup.scale.set(0.75, 0.75, 1)
        crackGroup.position.z = wallZ + 0.165
      }
      if (warningGroup) warningGroup.visible = false
      if (wallRubbleGroup) wallRubbleGroup.visible = false
      if (wallDustGroup) wallDustGroup.visible = false
      if (dustMat) dustMat.opacity = 0

      data._visualStateKey = 'dormant'
      break
    }

    case HAZARD_TYPES.FALLING_WATER_TANK: {
      const {
        tankRestY = 2.48,
        tankFallenY = 0.44,
        strapRestY = 2.74,
        surgeLength = 2.55,
        surgeHalfWidth = 1.05,
        brokenStraps,
        tankGroup,
        seamMesh,
        leakGroup,
        leakDrops,
        leakDropConfigs,
        leakStreams,
        tankDebrisGroup,
        tankDebrisMeshes,
        tankDebrisConfigs,
        surgeGroup,
        surgeSheetMesh,
        crestMesh,
        sprayMeshes,
        sprayConfigs,
        puddleMesh,
        leakMat,
        surgeMat,
        puddleMat,
      } = data
      if (!tankGroup) return

      const puddleCenterZ = (surgeLength - 0.65) * 0.5
      const puddleScaleX = surgeHalfWidth * 1.02
      const puddleScaleY = (surgeLength + 0.72) * 0.52

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        tankGroup.position.set(0.08, tankFallenY, 0.14)
        tankGroup.rotation.set(0.28, 0.14, -0.32)
        if (seamMesh) seamMesh.scale.set(1.28, 2.2, 1.3)

        if (brokenStraps) {
          for (let i = 0; i < brokenStraps.length; i += 1) {
            const strap = brokenStraps[i]
            strap.position.y = strapRestY + 0.14
            strap.rotation.z = i === 0 ? -0.58 : 0.64
            strap.rotation.x = 0.32
          }
        }

        if (leakGroup) leakGroup.visible = false
        if (leakStreams) {
          for (let i = 0; i < leakStreams.length; i += 1) leakStreams[i].visible = false
        }
        if (leakMat) leakMat.opacity = 0

        if (surgeGroup) surgeGroup.visible = false
        if (surgeMat) surgeMat.opacity = 0

        if (tankDebrisGroup && tankDebrisMeshes && tankDebrisConfigs) {
          tankDebrisGroup.visible = true
          for (let i = 0; i < tankDebrisMeshes.length; i += 1) {
            const dc = tankDebrisConfigs[i]
            const frag = tankDebrisMeshes[i]
            frag.position.set(dc.endX, 0.025, dc.endZ)
            frag.rotation.set(0.14, dc.rotY, 0.08)
          }
        }

        if (puddleMesh && puddleMat) {
          puddleMesh.visible = true
          puddleMesh.position.set(0, 0.012, puddleCenterZ)
          puddleMesh.scale.set(puddleScaleX, puddleScaleY, 1)
          puddleMat.opacity = 0.56
        }

        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Tank snaps and falls rapidly in first 34% of active phase; water surge sweeps across remaining 66%
        const fallT = Math.min(1, clamped / 0.34)
        const fallEase = fallT * fallT
        tankGroup.position.set(
          0.08 * fallT,
          tankRestY + (tankFallenY - tankRestY) * fallEase,
          0.14 * fallT
        )
        tankGroup.rotation.set(0.28 * fallT, 0.14 * fallT, -0.32 * fallT)
        if (seamMesh) seamMesh.scale.set(1 + 0.28 * fallT, 1 + 1.2 * fallT, 1 + 0.3 * fallT)

        if (brokenStraps) {
          for (let i = 0; i < brokenStraps.length; i += 1) {
            const strap = brokenStraps[i]
            strap.position.y = strapRestY + 0.14 * fallT
            strap.rotation.z = (i === 0 ? -0.58 : 0.64) * fallT
            strap.rotation.x = 0.32 * fallT
          }
        }

        if (tankDebrisGroup && tankDebrisMeshes && tankDebrisConfigs) {
          tankDebrisGroup.visible = true
          for (let i = 0; i < tankDebrisMeshes.length; i += 1) {
            const dc = tankDebrisConfigs[i]
            const frag = tankDebrisMeshes[i]
            const arcY = Math.sin(fallT * Math.PI) * dc.arcH
            frag.position.set(
              dc.startX + (dc.endX - dc.startX) * fallT,
              dc.startY + (0.025 - dc.startY) * fallEase + arcY,
              dc.startZ + (dc.endZ - dc.startZ) * fallT
            )
            frag.rotation.set(fallT * 2.8, dc.rotY, fallT * 2.1)
          }
        }

        // Hide warning drips once tank hits ground
        if (leakGroup) leakGroup.visible = fallT < 0.75
        if (leakStreams) {
          for (let i = 0; i < leakStreams.length; i += 1) leakStreams[i].visible = false
        }

        // Directional water surge expands smoothly from rupture point along +Z
        const surgeT = clamped <= 0.18 ? 0 : Math.min(1, (clamped - 0.18) / 0.82)
        const reachEase = 1 - (1 - surgeT) * (1 - surgeT)
        const currentFrontZ = 0.45 + reachEase * (surgeLength - 0.45)
        const backZ = -0.58
        const spanZ = Math.max(0.25, currentFrontZ - backZ)
        const spanX = surgeHalfWidth * (1.35 + reachEase * 0.65)

        if (surgeGroup && surgeSheetMesh && crestMesh && surgeMat) {
          surgeGroup.visible = surgeT > 0.01
          const surgeOpacity = surgeT > 0.01 ? Math.sin(surgeT * Math.PI) * 0.78 : 0
          surgeMat.opacity = Math.max(0, surgeOpacity)
          surgeSheetMesh.position.set(0, 0.024, (backZ + currentFrontZ) * 0.5)
          surgeSheetMesh.scale.set(spanX, spanZ, 1)

          crestMesh.position.set(0, 0.08 + Math.sin(surgeT * Math.PI) * 0.09, currentFrontZ - 0.08)
          crestMesh.scale.set(1, spanX * 0.92, 0.85 + Math.sin(surgeT * Math.PI) * 0.45)
        }

        if (sprayMeshes && sprayConfigs && leakMat) {
          leakMat.opacity = surgeT > 0.01 ? Math.sin(surgeT * Math.PI) * 0.75 : 0.45
          for (let i = 0; i < sprayMeshes.length; i += 1) {
            const sc = sprayConfigs[i]
            const sp = sprayMeshes[i]
            const arcY = Math.sin(surgeT * Math.PI) * sc.arcH
            sp.position.set(
              sc.startX + (sc.endX - sc.startX) * reachEase,
              0.08 + arcY,
              0.1 + sc.reachZ * reachEase
            )
            sp.scale.setScalar(sc.baseScale * (0.6 + Math.sin(surgeT * Math.PI) * 0.65))
          }
        }

        if (puddleMesh && puddleMat) {
          puddleMesh.visible = true
          const curPuddleZ = (backZ + currentFrontZ) * 0.5
          puddleMesh.position.set(0, 0.012, curPuddleZ)
          puddleMesh.scale.set(
            Math.max(0.55, spanX * 0.52),
            Math.max(0.55, spanZ * 0.52),
            1
          )
          puddleMat.opacity = 0.28 + reachEase * 0.34
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        const vibAmp = 0.012 + clamped * 0.032
        const swayZ = Math.sin(clamped * Math.PI * 22) * (0.045 + clamped * 0.085)
        const swayX = Math.cos(clamped * Math.PI * 16) * (0.025 + clamped * 0.045)

        tankGroup.position.set(
          Math.sin(clamped * Math.PI * 28) * vibAmp,
          tankRestY - clamped * 0.065 + Math.cos(clamped * Math.PI * 24) * (vibAmp * 0.45),
          Math.cos(clamped * Math.PI * 20) * (vibAmp * 0.5)
        )
        tankGroup.rotation.set(swayX, 0, swayZ)
        if (seamMesh) seamMesh.scale.set(1 + clamped * 0.18, 1 + clamped * 0.45, 1)

        if (brokenStraps) {
          for (let i = 0; i < brokenStraps.length; i += 1) {
            const strap = brokenStraps[i]
            strap.position.y = strapRestY - clamped * 0.03
            strap.rotation.z = swayZ * 0.45
            strap.rotation.x = 0
          }
        }

        if (tankDebrisGroup) tankDebrisGroup.visible = false
        if (surgeGroup) surgeGroup.visible = false
        if (surgeMat) surgeMat.opacity = 0

        // Intensifying dripping water & visible leaking streams during warning
        if (leakGroup && leakDrops && leakDropConfigs && leakMat) {
          leakGroup.visible = true
          leakMat.opacity = 0.55 + clamped * 0.32
          for (let i = 0; i < leakDrops.length; i += 1) {
            const cfg = leakDropConfigs[i]
            const drop = leakDrops[i]
            drop.visible = true
            const t = (clamped * (cfg.speed + clamped * 0.9) + cfg.phase) % 1
            drop.position.set(
              cfg.x + Math.sin(t * Math.PI * 3 + i) * 0.03,
              Math.max(0.03, cfg.startY * (1 - t * t)),
              cfg.z + t * 0.14
            )
            drop.scale.set(0.9 + clamped * 0.25, 1.55 + clamped * 0.45, 0.9 + clamped * 0.25)
          }
        }
        if (leakStreams) {
          for (let i = 0; i < leakStreams.length; i += 1) {
            const stream = leakStreams[i]
            stream.visible = clamped > 0.22
            const pulse = 0.75 + Math.abs(Math.sin(clamped * Math.PI * (14 + i * 5))) * 0.55
            stream.scale.set(pulse * (0.8 + clamped * 0.6), 2.02, pulse * (0.8 + clamped * 0.6))
          }
        }

        // Small warning puddle forming directly beneath leaking tank
        if (puddleMesh && puddleMat) {
          puddleMesh.visible = true
          puddleMesh.position.set(0, 0.012, 0.24)
          const r = 0.34 + clamped * 0.36
          puddleMesh.scale.set(r, r * 1.15, 1)
          puddleMat.opacity = 0.14 + clamped * 0.22
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — intact suspended rusted tank with faint trickle so it reads as visibly leaking
      tankGroup.position.set(0, tankRestY, 0)
      tankGroup.rotation.set(0, 0, 0)
      if (seamMesh) seamMesh.scale.set(1, 1, 1)

      if (brokenStraps) {
        for (let i = 0; i < brokenStraps.length; i += 1) {
          const strap = brokenStraps[i]
          strap.position.y = strapRestY
          strap.rotation.set(0, 0, 0)
        }
      }

      if (tankDebrisGroup) tankDebrisGroup.visible = false
      if (surgeGroup) surgeGroup.visible = false
      if (surgeMat) surgeMat.opacity = 0
      if (puddleMesh) puddleMesh.visible = false
      if (puddleMat) puddleMat.opacity = 0

      if (leakGroup && leakDrops && leakDropConfigs && leakMat) {
        leakGroup.visible = true
        leakMat.opacity = 0.32
        for (let i = 0; i < leakDrops.length; i += 1) {
          const drop = leakDrops[i]
          const cfg = leakDropConfigs[i]
          drop.visible = i < 2
          drop.position.set(cfg.x, cfg.startY - (i === 0 ? 0.32 : 1.1), cfg.z)
          drop.scale.set(0.75, 1.35, 0.75)
        }
      }
      if (leakStreams) {
        for (let i = 0; i < leakStreams.length; i += 1) leakStreams[i].visible = false
      }

      data._visualStateKey = 'dormant'
      break
    }

    case HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY: {
      const {
        pivotY = 3.22,
        restDropY = -0.8,
        fallenY = 0.4,
        impactLocalZ = 0.72,
        trolleyGroup,
        rearCable,
        frontCable,
        machinePivotGroup,
        machineBodyGroup,
        warnBoltGroup,
        warnBoltMeshes,
        warnBoltConfigs,
        impactDebrisGroup,
        impactDebrisMeshes,
        impactDebrisConfigs,
        impactDustGroup,
        impactDustMeshes,
        impactDustConfigs,
        dustMat,
      } = data
      if (!machinePivotGroup || !machineBodyGroup) return

      const fallenLocalY = fallenY - pivotY // -2.82

      if (state === 'disabled' || state === 'collapsed' || data.isPermanentlyCollapsed) {
        machinePivotGroup.position.set(0, pivotY, 0)
        machinePivotGroup.rotation.set(0, 0, 0)
        machineBodyGroup.position.set(0.08, fallenLocalY, impactLocalZ)
        machineBodyGroup.rotation.set(0.46, 0.16, -0.26)

        if (trolleyGroup) {
          trolleyGroup.position.set(0, pivotY, 0.14)
          trolleyGroup.rotation.set(0.14, 0, -0.1)
        }
        if (rearCable) {
          rearCable.position.set(-0.08, pivotY - 0.18, -0.3)
          rearCable.rotation.set(-0.72, 0, 0.35)
        }
        if (frontCable) {
          frontCable.position.set(0.06, pivotY - 0.24, 0.34)
          frontCable.rotation.set(0.54, 0, -0.22)
        }

        if (warnBoltGroup) warnBoltGroup.visible = false
        if (impactDustGroup) impactDustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (impactDebrisGroup && impactDebrisMeshes && impactDebrisConfigs) {
          impactDebrisGroup.visible = true
          for (let i = 0; i < impactDebrisMeshes.length; i += 1) {
            const dc = impactDebrisConfigs[i]
            const frag = impactDebrisMeshes[i]
            frag.position.set(dc.endX, 0.028, dc.endZ)
            frag.rotation.set(0.18, dc.rotY, 0.12)
          }
        }
        data._visualStateKey = 'disabled'
        break
      }

      if (state === 'active') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Controlled swing-drop: rear cable snaps first, machine swings forward (+Z) and crashes down by 55% progress
        const dropT = Math.min(1, clamped / 0.54)
        const dropEase = dropT * dropT
        const swingArcZ = Math.sin(dropT * Math.PI * 0.5) * impactLocalZ

        machinePivotGroup.position.set(0, pivotY, 0)
        machinePivotGroup.rotation.set(0, 0, 0)
        machineBodyGroup.position.set(
          0.08 * dropT,
          restDropY + (fallenLocalY - restDropY) * dropEase,
          swingArcZ
        )
        machineBodyGroup.rotation.set(0.46 * dropT, 0.16 * dropT, -0.26 * dropT)

        if (trolleyGroup) {
          trolleyGroup.position.set(0, pivotY, 0.14 * dropT)
          trolleyGroup.rotation.set(0.14 * dropT, 0, -0.1 * dropT)
        }
        if (rearCable) {
          const snapT = Math.min(1, clamped / 0.28)
          rearCable.position.set(-0.08 * snapT, pivotY - 0.36 + 0.18 * snapT, -0.24 - 0.06 * snapT)
          rearCable.rotation.set(-0.72 * snapT, 0, 0.35 * snapT)
        }
        if (frontCable) {
          frontCable.position.set(0.06 * dropT, pivotY - 0.36 + 0.12 * dropT, 0.24 + 0.1 * dropT)
          frontCable.rotation.set(0.54 * dropT, 0, -0.22 * dropT)
        }

        if (warnBoltGroup) warnBoltGroup.visible = false

        const impactT = clamped <= 0.36 ? 0 : Math.min(1, (clamped - 0.36) / 0.64)
        if (impactDebrisGroup && impactDebrisMeshes && impactDebrisConfigs) {
          impactDebrisGroup.visible = impactT > 0.01
          for (let i = 0; i < impactDebrisMeshes.length; i += 1) {
            const dc = impactDebrisConfigs[i]
            const frag = impactDebrisMeshes[i]
            const arcY = Math.sin(impactT * Math.PI) * dc.arcH
            frag.position.set(
              dc.startX + (dc.endX - dc.startX) * impactT,
              0.028 + (dc.startY - 0.028) * (1 - impactT) * (1 - impactT) + arcY,
              dc.startZ + (dc.endZ - dc.startZ) * impactT
            )
            frag.rotation.set(impactT * 3.0, dc.rotY, impactT * 2.2)
          }
        }

        if (impactDustGroup && impactDustMeshes && impactDustConfigs && dustMat) {
          impactDustGroup.visible = impactT > 0.01
          dustMat.opacity = impactT > 0.01 ? Math.max(0, Math.sin(impactT * Math.PI) * 0.5) : 0
          for (let i = 0; i < impactDustMeshes.length; i += 1) {
            const dc = impactDustConfigs[i]
            const puff = impactDustMeshes[i]
            puff.position.set(
              dc.dx * (0.25 + impactT * 0.85),
              0.12 + dc.riseY * impactT,
              dc.dz * (0.4 + impactT * 0.6)
            )
            puff.scale.setScalar(dc.baseScale * (0.5 + impactT * 1.25))
          }
        }

        data._visualStateKey = 'active'
        break
      }

      if (state === 'warning') {
        const clamped = Math.max(0, Math.min(1, progress))
        // Progressive mechanical strain: increasing pendulum sway forward (+Z) & lateral shudder
        const swayAmp = 0.06 + clamped * 0.19
        const swayPitch = Math.sin(clamped * Math.PI * 11) * swayAmp + clamped * 0.14
        const swayRoll = Math.cos(clamped * Math.PI * 9) * (0.03 + clamped * 0.08)
        const vib = Math.sin(clamped * Math.PI * 30) * (0.008 + clamped * 0.018)

        machinePivotGroup.position.set(vib, pivotY - clamped * 0.05, clamped * 0.08)
        machinePivotGroup.rotation.set(-swayPitch, 0, swayRoll)
        machineBodyGroup.position.set(0, restDropY - clamped * 0.04, 0)
        machineBodyGroup.rotation.set(clamped * 0.1, 0, vib * 1.4)

        if (trolleyGroup) {
          trolleyGroup.position.set(vib * 0.6, pivotY, clamped * 0.06)
          trolleyGroup.rotation.set(clamped * 0.05, 0, swayRoll * 0.35)
        }
        if (rearCable) {
          rearCable.position.set(0, pivotY - 0.36 - clamped * 0.03, -0.24)
          rearCable.rotation.set(-swayPitch * 0.6, 0, swayRoll * 0.6)
        }
        if (frontCable) {
          frontCable.position.set(0, pivotY - 0.36 - clamped * 0.02, 0.24)
          frontCable.rotation.set(-swayPitch * 0.6, 0, swayRoll * 0.6)
        }

        if (impactDebrisGroup) impactDebrisGroup.visible = false
        if (impactDustGroup) impactDustGroup.visible = false
        if (dustMat) dustMat.opacity = 0

        if (warnBoltGroup && warnBoltMeshes && warnBoltConfigs) {
          warnBoltGroup.visible = true
          for (let i = 0; i < warnBoltMeshes.length; i += 1) {
            const wc = warnBoltConfigs[i]
            const bolt = warnBoltMeshes[i]
            const t = (clamped * wc.speed + wc.phase) % 1
            bolt.position.set(
              wc.x + Math.sin(t * Math.PI * 4 + i) * 0.04,
              Math.max(0.04, wc.startY * (1 - t * t)),
              wc.z + t * 0.22
            )
            bolt.rotation.set(t * 4.2, i * 0.9, t * 3.1)
          }
        }

        data._visualStateKey = 'warning'
        break
      }

      // Dormant state — heavy machinery suspended cleanly from overhead gantry rail
      machinePivotGroup.position.set(0, pivotY, 0)
      machinePivotGroup.rotation.set(0, 0, 0)
      machineBodyGroup.position.set(0, restDropY, 0)
      machineBodyGroup.rotation.set(0, 0, 0)

      if (trolleyGroup) {
        trolleyGroup.position.set(0, pivotY, 0)
        trolleyGroup.rotation.set(0, 0, 0)
      }
      if (rearCable) {
        rearCable.position.set(0, pivotY - 0.36, -0.24)
        rearCable.rotation.set(0, 0, 0)
      }
      if (frontCable) {
        frontCable.position.set(0, pivotY - 0.36, 0.24)
        frontCable.rotation.set(0, 0, 0)
      }

      if (warnBoltGroup) warnBoltGroup.visible = false
      if (impactDebrisGroup) impactDebrisGroup.visible = false
      if (impactDustGroup) impactDustGroup.visible = false
      if (dustMat) dustMat.opacity = 0

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
    root.userData.grateRoot = null
    root.userData.pitMesh = null
    root.userData.leftLeafGroup = null
    root.userData.rightLeafGroup = null
    root.userData.bolts = null
    root.userData.boltRestPositions = null
    root.userData.brokenStubsGroup = null
    root.userData.warningFragGroup = null
    root.userData.warningFragments = null
    root.userData.warningFragConfigs = null
    root.userData.debrisGroup = null
    root.userData.debrisMeshes = null
    root.userData.debrisConfigs = null
    root.userData.dustGroup = null
    root.userData.dustMeshes = null
    root.userData.dustConfigs = null
    root.userData.dustMat = null
    root.userData.wallMountGroup = null
    root.userData.cavityMesh = null
    root.userData.rimGroup = null
    root.userData.rebarGroup = null
    root.userData.slabGroup = null
    root.userData.slabMeshes = null
    root.userData.slabConfigs = null
    root.userData.crackGroup = null
    root.userData.warningGroup = null
    root.userData.warningChunks = null
    root.userData.warningChunkConfigs = null
    root.userData.wallRubbleGroup = null
    root.userData.wallRubbleMeshes = null
    root.userData.wallRubbleConfigs = null
    root.userData.wallDustGroup = null
    root.userData.wallDustMeshes = null
    root.userData.wallDustConfigs = null
    root.userData.tankMountGroup = null
    root.userData.supportGroup = null
    root.userData.wallBraceGroup = null
    root.userData.brokenStraps = null
    root.userData.tankGroup = null
    root.userData.seamMesh = null
    root.userData.leakGroup = null
    root.userData.leakDrops = null
    root.userData.leakDropConfigs = null
    root.userData.leakStreams = null
    root.userData.tankDebrisGroup = null
    root.userData.tankDebrisMeshes = null
    root.userData.tankDebrisConfigs = null
    root.userData.surgeGroup = null
    root.userData.surgeSheetMesh = null
    root.userData.crestMesh = null
    root.userData.sprayMeshes = null
    root.userData.sprayConfigs = null
    root.userData.puddleMesh = null
    root.userData.leakMat = null
    root.userData.surgeMat = null
    root.userData.puddleMat = null
    root.userData.machineryMountGroup = null
    root.userData.gantryGroup = null
    root.userData.wallBracketsGroup = null
    root.userData.trolleyGroup = null
    root.userData.rearCable = null
    root.userData.frontCable = null
    root.userData.machinePivotGroup = null
    root.userData.machineBodyGroup = null
    root.userData.warnBoltGroup = null
    root.userData.warnBoltMeshes = null
    root.userData.warnBoltConfigs = null
    root.userData.impactDebrisGroup = null
    root.userData.impactDebrisMeshes = null
    root.userData.impactDebrisConfigs = null
    root.userData.impactDustGroup = null
    root.userData.impactDustMeshes = null
    root.userData.impactDustConfigs = null
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
