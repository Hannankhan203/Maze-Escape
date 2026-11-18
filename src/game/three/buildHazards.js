import * as THREE from 'three'
import { CELL_SIZE } from '../world/worldCoords.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'

export const HAZARD_PALETTE = {
  basePlate: 0x1e293b,
  spikeMetal: 0x94a3b8,
  spikeTip: 0xef4444,
  plateRim: 0x475569,
  plateCoreDormant: 0x334155,
  plateCoreActive: 0xf59e0b,
  gridWire: 0x0f172a,
  gridEnergyDormant: 0x38bdf8,
  gridEnergyWarning: 0xf59e0b,
  gridEnergyActive: 0xef4444,
}

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
      // Recessed floor base plate
      const baseGeo = new THREE.BoxGeometry(size, 0.08, size)
      const baseMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.basePlate,
        roughness: 0.8,
        metalness: 0.3,
      })
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.position.set(0, 0.04, 0)
      root.add(base)

      // Retractable metal spike blades (group that moves vertically)
      const spikesGroup = new THREE.Group()
      spikesGroup.name = 'hazard-spikes-group'
      spikesGroup.position.set(0, 0.08, 0)

      const bladeGeo = new THREE.ConeGeometry(0.1, 0.45, 4)
      const bladeMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.spikeMetal,
        roughness: 0.3,
        metalness: 0.85,
      })

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
      const baseGeo = new THREE.BoxGeometry(size * 0.9, 0.06, size * 0.9)
      const baseMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.plateRim,
        roughness: 0.7,
        metalness: 0.4,
      })
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.position.set(0, 0.03, 0)
      root.add(base)

      const plateGeo = new THREE.BoxGeometry(size * 0.55, 0.08, size * 0.55)
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
      const baseGeo = new THREE.BoxGeometry(size, 0.04, size)
      const baseMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.gridWire,
        roughness: 0.9,
        metalness: 0.2,
      })
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.position.set(0, 0.02, 0)
      root.add(base)

      // Glowing energy arc lines
      const arcMat = new THREE.MeshStandardMaterial({
        color: HAZARD_PALETTE.gridEnergyDormant,
        emissive: HAZARD_PALETTE.gridEnergyDormant,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.1,
      })

      const arcGroup = new THREE.Group()
      for (let a = -1; a <= 1; a += 2) {
        const wireGeo = new THREE.BoxGeometry(size * 0.8, 0.03, 0.08)
        const wire = new THREE.Mesh(wireGeo, arcMat)
        wire.position.set(0, 0.05, a * (size * 0.25))
        arcGroup.add(wire)
      }

      root.add(arcGroup)
      root.userData = { hazardType: type, arcMat, arcGroup }
      break
    }

    default:
      break
  }

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
        // Jitter or slight raise during warning
        targetY = data.dormantY + Math.sin(progress * Math.PI * 8) * 0.04
      }

      group.position.y += (targetY - group.position.y) * 0.25
      break
    }

    case HAZARD_TYPES.PRESSURE_PLATE: {
      const plate = data.plateMesh
      const mat = data.plateMat
      if (!plate || !mat) return

      if (state === 'active' || state === 'warning') {
        plate.position.y = 0.03 // depressed
        mat.color.setHex(HAZARD_PALETTE.plateCoreActive)
        mat.emissive.setHex(0xd97706)
        mat.emissiveIntensity = 1.2
      } else {
        plate.position.y = 0.06 // raised
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
        mat.color.setHex(HAZARD_PALETTE.gridEnergyActive)
        mat.emissive.setHex(HAZARD_PALETTE.gridEnergyActive)
        mat.emissiveIntensity = 3.5
      } else if (state === 'warning') {
        const pulse = Math.sin(progress * Math.PI * 10) > 0 ? 1 : 0.2
        mat.color.setHex(HAZARD_PALETTE.gridEnergyWarning)
        mat.emissive.setHex(HAZARD_PALETTE.gridEnergyWarning)
        mat.emissiveIntensity = 1.8 * pulse
      } else {
        mat.color.setHex(HAZARD_PALETTE.gridEnergyDormant)
        mat.emissive.setHex(HAZARD_PALETTE.gridEnergyDormant)
        mat.emissiveIntensity = 0.4
      }
      break
    }

    default:
      break
  }
}

/**
 * Safely disposes hazard group geometries and materials.
 */
export function disposeHazardMesh(root) {
  if (!root) return
  root.traverse((node) => {
    if (node.geometry) node.geometry.dispose?.()
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      for (const m of mats) m?.dispose?.()
    }
  })
  if (root.parent) root.parent.remove(root)
  root.clear()
}
