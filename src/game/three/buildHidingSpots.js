import * as THREE from 'three'
import { HIDING_SPOT_TYPES } from '../generation/hidingSpotPlacement.js'

export const HIDING_SPOT_PALETTE = {
  plinth: 0x0b0f17,
  bodySteel: 0x1e293b,
  bodyCabinet: 0x262b36,
  frameIron: 0x111827,
  accentTrim: 0x475569,
  grilleDark: 0x090d14,
  slitIdle: 0x334155,
  slitIdleEmissive: 0x0f172a,
  slitHighlight: 0x10b981,
  slitOccupied: 0x38bdf8,
}

/**
 * Builds a composite procedural 3D hiding-spot locker/cabinet mesh grounded at y = 0.
 * Front door faces -Z in local space to match yaw = 0 forward convention.
 */
export function buildHidingSpotMesh(spotData = {}) {
  const type = spotData.type || HIDING_SPOT_TYPES.CONTAINMENT_LOCKER
  const isCabinet = type === HIDING_SPOT_TYPES.SUPPLY_CABINET

  const root = new THREE.Group()
  root.name = `hiding-spot-${type}-${spotData.id || 'default'}`

  const width = isCabinet ? 1.38 : 1.24
  const height = isCabinet ? 2.18 : 2.34
  const depth = isCabinet ? 1.12 : 1.06
  const wallThick = 0.08

  const bodyColor = isCabinet
    ? HIDING_SPOT_PALETTE.bodyCabinet
    : HIDING_SPOT_PALETTE.bodySteel

  const plinthMat = new THREE.MeshStandardMaterial({
    color: HIDING_SPOT_PALETTE.plinth,
    roughness: 0.9,
    metalness: 0.2,
  })
  const shellMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.62,
    metalness: 0.55,
  })
  const frameMat = new THREE.MeshStandardMaterial({
    color: HIDING_SPOT_PALETTE.frameIron,
    roughness: 0.86,
    metalness: 0.35,
  })
  const trimMat = new THREE.MeshStandardMaterial({
    color: HIDING_SPOT_PALETTE.accentTrim,
    roughness: 0.28,
    metalness: 0.85,
  })
  const indicatorMat = new THREE.MeshStandardMaterial({
    color: HIDING_SPOT_PALETTE.slitIdle,
    emissive: HIDING_SPOT_PALETTE.slitIdleEmissive,
    emissiveIntensity: 0.45,
    roughness: 0.22,
    metalness: 0.3,
  })

  // 1. Grounded floor plinth
  const plinthGeo = new THREE.BoxGeometry(width + 0.08, 0.08, depth + 0.08)
  const plinth = new THREE.Mesh(plinthGeo, plinthMat)
  plinth.position.set(0, 0.04, 0)
  root.add(plinth)

  // 2. Back wall (+Z)
  const backGeo = new THREE.BoxGeometry(width, height - 0.12, wallThick)
  const backWall = new THREE.Mesh(backGeo, shellMat)
  backWall.position.set(0, 0.08 + (height - 0.12) / 2, depth / 2 - wallThick / 2)
  root.add(backWall)

  // 3-4. Left and right side walls
  const sideGeo = new THREE.BoxGeometry(wallThick, height - 0.12, depth - wallThick)
  const leftWall = new THREE.Mesh(sideGeo, shellMat)
  leftWall.position.set(-width / 2 + wallThick / 2, 0.08 + (height - 0.12) / 2, 0)
  root.add(leftWall)

  const rightWall = new THREE.Mesh(sideGeo, shellMat)
  rightWall.position.set(width / 2 - wallThick / 2, 0.08 + (height - 0.12) / 2, 0)
  root.add(rightWall)

  // 5. Heavy top cornice cap
  const topGeo = new THREE.BoxGeometry(width + 0.1, 0.1, depth + 0.08)
  const topCap = new THREE.Mesh(topGeo, frameMat)
  topCap.position.set(0, height - 0.05, 0)
  root.add(topCap)

  // 6-7. Front vertical jambs framing door aperture
  const jambGeo = new THREE.BoxGeometry(0.09, height - 0.14, 0.1)
  const leftJamb = new THREE.Mesh(jambGeo, frameMat)
  leftJamb.position.set(-width / 2 + 0.045, 0.08 + (height - 0.14) / 2, -depth / 2 + 0.03)
  root.add(leftJamb)

  const rightJamb = new THREE.Mesh(jambGeo, frameMat)
  rightJamb.position.set(width / 2 - 0.045, 0.08 + (height - 0.14) / 2, -depth / 2 + 0.03)
  root.add(rightJamb)

  // 8. Articulated front door hinged at left jamb (-X, -Z)
  const doorWidth = width - 0.18
  const doorPivot = new THREE.Group()
  doorPivot.name = 'hiding-spot-door-pivot'
  doorPivot.position.set(-doorWidth / 2, 0.08, -depth / 2 + 0.03)

  // Lower solid door panel (below camera eye-level viewport grille)
  const lowerDoorHeight = 1.02
  const lowerDoorGeo = new THREE.BoxGeometry(doorWidth, lowerDoorHeight, 0.06)
  const lowerDoor = new THREE.Mesh(lowerDoorGeo, shellMat)
  lowerDoor.position.set(doorWidth / 2, lowerDoorHeight / 2, 0)
  doorPivot.add(lowerDoor)

  // Upper transom panel (above eye-level grille)
  const upperDoorHeight = 0.56
  const upperDoorGeo = new THREE.BoxGeometry(doorWidth, upperDoorHeight, 0.06)
  const upperDoor = new THREE.Mesh(upperDoorGeo, frameMat)
  upperDoor.position.set(doorWidth / 2, height - 0.18 - upperDoorHeight / 2, 0)
  doorPivot.add(upperDoor)

  // Eye-level slatted observation grille (clear viewing gaps for 1st-person stealth)
  const grilleBarGeo = new THREE.BoxGeometry(doorWidth - 0.06, 0.035, 0.03)
  const grilleHeights = [1.14, 1.30, 1.48]
  for (let i = 0; i < grilleHeights.length; i += 1) {
    const bar = new THREE.Mesh(grilleBarGeo, trimMat)
    bar.position.set(doorWidth / 2, grilleHeights[i], 0)
    doorPivot.add(bar)
  }

  // Vertical side stiles around grille
  const stileGeo = new THREE.BoxGeometry(0.06, 0.58, 0.055)
  const leftStile = new THREE.Mesh(stileGeo, shellMat)
  leftStile.position.set(0.03, 1.31, 0)
  doorPivot.add(leftStile)

  const rightStile = new THREE.Mesh(stileGeo, shellMat)
  rightStile.position.set(doorWidth - 0.03, 1.31, 0)
  doorPivot.add(rightStile)

  // 9. Brushed steel latch handle + recessed stealth status indicator strip
  const latchGeo = new THREE.BoxGeometry(0.06, 0.22, 0.05)
  const latch = new THREE.Mesh(latchGeo, trimMat)
  latch.position.set(doorWidth - 0.1, 0.92, -0.04)
  doorPivot.add(latch)

  const indicatorGeo = new THREE.BoxGeometry(doorWidth * 0.42, 0.045, 0.03)
  const indicator = new THREE.Mesh(indicatorGeo, indicatorMat)
  indicator.position.set(doorWidth / 2, 1.72, -0.04)
  doorPivot.add(indicator)

  root.add(doorPivot)

  // 10. Top exterior bezel indicator strip visible down long corridors
  const topBeaconGeo = new THREE.BoxGeometry(width * 0.55, 0.035, 0.04)
  const topBeacon = new THREE.Mesh(topBeaconGeo, indicatorMat)
  topBeacon.position.set(0, height - 0.04, -depth / 2 - 0.03)
  root.add(topBeacon)

  root.userData = {
    isHidingSpot: true,
    spotType: type,
    doorPivot,
    indicatorMat,
    currentDoorAngle: 0,
  }

  return root
}

/**
 * Updates hiding-spot door aperture and indicator lights without object allocations.
 */
export function updateHidingSpotVisualState(
  root,
  { isHighlighted = false, isOccupied = false, delta = 0.016 } = {}
) {
  if (!root?.userData) return
  const data = root.userData

  let targetAngle = 0
  if (isOccupied) {
    // Slightly cracked stealth slit from hinge when occupied
    targetAngle = -0.08
  } else if (isHighlighted) {
    // Invitingly ajar when player approaches within interaction range
    targetAngle = -0.34
  }

  if (data.doorPivot) {
    const alpha = Math.min(1, Math.max(0.15, (Number(delta) || 0.016) * 14))
    data.currentDoorAngle += (targetAngle - data.currentDoorAngle) * alpha
    data.doorPivot.rotation.y = data.currentDoorAngle
  }

  const mat = data.indicatorMat
  if (mat) {
    if (isOccupied) {
      mat.color.setHex(HIDING_SPOT_PALETTE.slitOccupied)
      mat.emissive.setHex(HIDING_SPOT_PALETTE.slitOccupied)
      mat.emissiveIntensity = 1.15
    } else if (isHighlighted) {
      mat.color.setHex(HIDING_SPOT_PALETTE.slitHighlight)
      mat.emissive.setHex(HIDING_SPOT_PALETTE.slitHighlight)
      mat.emissiveIntensity = 1.4
    } else {
      mat.color.setHex(HIDING_SPOT_PALETTE.slitIdle)
      mat.emissive.setHex(HIDING_SPOT_PALETTE.slitIdleEmissive)
      mat.emissiveIntensity = 0.45
    }
  }
}

/**
 * Safely disposes all unique geometries and materials inside a hiding spot group.
 */
export function disposeHidingSpotMesh(root) {
  if (!root) return
  const geometries = new Set()
  const materials = new Set()

  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry)
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material]
      for (let i = 0; i < mats.length; i += 1) {
        if (mats[i]) materials.add(mats[i])
      }
    }
  })

  for (const geo of geometries) geo.dispose?.()
  for (const mat of materials) mat.dispose?.()

  if (root.parent) {
    root.parent.remove(root)
  }
  root.clear()
}
