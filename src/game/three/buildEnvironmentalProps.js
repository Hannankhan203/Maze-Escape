import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'
import { placeEnvironmentalProps, PROP_TYPES } from '../generation/environmentalPropPlacement.js'

const PROP_MATERIALS = {
  rustyMetal: new THREE.MeshStandardMaterial({
    color: 0x5c3d2e,
    roughness: 0.75,
    metalness: 0.8,
  }),
  darkSteel: new THREE.MeshStandardMaterial({
    color: 0x3b4659,
    roughness: 0.65,
    metalness: 0.85,
  }),
  weatheredWood: new THREE.MeshStandardMaterial({
    color: 0x6b4f3b,
    roughness: 0.85,
    metalness: 0.05,
  }),
  cabinetGreen: new THREE.MeshStandardMaterial({
    color: 0x3e574c,
    roughness: 0.6,
    metalness: 0.4,
  }),
  lockerBlue: new THREE.MeshStandardMaterial({
    color: 0x2b3e50,
    roughness: 0.55,
    metalness: 0.5,
  }),
  warningYellow: new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    roughness: 0.4,
    metalness: 0.2,
  }),
  paperWhite: new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.9,
    metalness: 0.0,
  }),
  debrisConcrete: new THREE.MeshStandardMaterial({
    color: 0x8a99b2,
    roughness: 0.85,
    metalness: 0.05,
  }),
  cableBlack: new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.7,
    metalness: 0.3,
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

function buildBrokenDesk() {
  const group = new THREE.Group()
  group.name = 'prop-desk-broken'

  // Top slab (tilted / damaged)
  const topGeo = new THREE.BoxGeometry(1.2, 0.09, 0.7)
  const topMesh = new THREE.Mesh(topGeo, PROP_MATERIALS.weatheredWood)
  topMesh.position.set(0, 0.74, 0)
  topMesh.rotation.z = 0.12
  topMesh.rotation.x = -0.05
  group.add(topMesh)

  // 4 Legs (one missing/broken)
  const legGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8)
  const legPositions = [
    [-0.52, 0.36, -0.28],
    [0.52, 0.36, -0.28],
    [-0.52, 0.31, 0.28],
  ]
  for (let i = 0; i < legPositions.length; i += 1) {
    const p = legPositions[i]
    const leg = new THREE.Mesh(legGeo, PROP_MATERIALS.rustyMetal)
    leg.position.set(p[0], p[1], p[2])
    group.add(leg)
  }

  // Broken leg leaning underneath
  const brokenLeg = new THREE.Mesh(legGeo, PROP_MATERIALS.rustyMetal)
  brokenLeg.position.set(0.3, 0.15, 0.1)
  brokenLeg.rotation.z = Math.PI / 3
  group.add(brokenLeg)

  // Scattered papers & folders on desk
  const paperGeo = new THREE.BoxGeometry(0.28, 0.015, 0.2)
  const paper1 = new THREE.Mesh(paperGeo, PROP_MATERIALS.paperWhite)
  paper1.position.set(-0.2, 0.8, 0.1)
  paper1.rotation.y = 0.35
  group.add(paper1)

  const paper2 = new THREE.Mesh(paperGeo, PROP_MATERIALS.paperWhite)
  paper2.position.set(0.25, 0.79, -0.1)
  paper2.rotation.y = -0.55
  group.add(paper2)

  configureShadows(group)
  return group
}

function buildBrokenChair() {
  const group = new THREE.Group()
  group.name = 'prop-chair-broken'

  // Seat
  const seatGeo = new THREE.BoxGeometry(0.44, 0.07, 0.44)
  const seat = new THREE.Mesh(seatGeo, PROP_MATERIALS.weatheredWood)
  seat.position.set(0, 0.42, 0)
  seat.rotation.z = 0.15
  group.add(seat)

  // Broken backrest slat
  const backGeo = new THREE.BoxGeometry(0.4, 0.42, 0.06)
  const back = new THREE.Mesh(backGeo, PROP_MATERIALS.weatheredWood)
  back.position.set(-0.1, 0.68, -0.18)
  back.rotation.z = -0.3
  group.add(back)

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.42, 8)
  const legPositions = [
    [-0.18, 0.21, -0.18],
    [0.18, 0.21, -0.18],
    [-0.18, 0.18, 0.18],
    [0.16, 0.15, 0.18],
  ]
  for (let i = 0; i < legPositions.length; i += 1) {
    const p = legPositions[i]
    const leg = new THREE.Mesh(legGeo, PROP_MATERIALS.rustyMetal)
    leg.position.set(p[0], p[1], p[2])
    if (i === 3) leg.rotation.x = 0.4
    group.add(leg)
  }

  configureShadows(group)
  return group
}

function buildOverturnedChair() {
  const group = new THREE.Group()
  group.name = 'prop-chair-overturned'

  const seatGeo = new THREE.BoxGeometry(0.48, 0.08, 0.48)
  const seat = new THREE.Mesh(seatGeo, PROP_MATERIALS.darkSteel)
  seat.position.set(0, 0.22, 0)
  group.add(seat)

  const backGeo = new THREE.BoxGeometry(0.44, 0.46, 0.07)
  const back = new THREE.Mesh(backGeo, PROP_MATERIALS.darkSteel)
  back.position.set(0, 0.48, -0.22)
  group.add(back)

  const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8)
  const pole = new THREE.Mesh(poleGeo, PROP_MATERIALS.rustyMetal)
  pole.position.set(0.25, 0.25, 0)
  pole.rotation.z = Math.PI / 2
  group.add(pole)

  group.rotation.x = Math.PI / 2.3
  group.rotation.y = Math.PI * 0.4
  group.position.y = 0.15

  configureShadows(group)
  return group
}

function buildFilingCabinet() {
  const group = new THREE.Group()
  group.name = 'prop-filing-cabinet'

  const bodyGeo = new THREE.BoxGeometry(0.55, 1.3, 0.6)
  const body = new THREE.Mesh(bodyGeo, PROP_MATERIALS.cabinetGreen)
  body.position.set(0, 0.65, 0)
  group.add(body)

  // Top drawer pulled open
  const drawerGeo = new THREE.BoxGeometry(0.51, 0.26, 0.58)
  const drawer = new THREE.Mesh(drawerGeo, PROP_MATERIALS.rustyMetal)
  drawer.position.set(0, 1.1, 0.16)
  group.add(drawer)

  configureShadows(group)
  return group
}

function buildFilingCabinetOverturned() {
  const group = new THREE.Group()
  group.name = 'prop-filing-cabinet-overturned'

  const bodyGeo = new THREE.BoxGeometry(0.55, 1.3, 0.6)
  const body = new THREE.Mesh(bodyGeo, PROP_MATERIALS.cabinetGreen)
  body.position.set(0, 0.3, 0)
  group.add(body)

  group.rotation.z = Math.PI / 2
  group.rotation.y = 0.3
  group.position.y = 0.28

  configureShadows(group)
  return group
}

function buildStorageLocker() {
  const group = new THREE.Group()
  group.name = 'prop-storage-locker'

  const lockerGeo = new THREE.BoxGeometry(0.65, 1.8, 0.55)
  const locker = new THREE.Mesh(lockerGeo, PROP_MATERIALS.lockerBlue)
  locker.position.set(0, 0.9, 0)
  group.add(locker)

  // Locker door ajar
  const doorGeo = new THREE.BoxGeometry(0.62, 1.76, 0.04)
  const door = new THREE.Mesh(doorGeo, PROP_MATERIALS.rustyMetal)
  door.position.set(0.35, 0.9, 0.25)
  door.rotation.y = -0.75
  group.add(door)

  configureShadows(group)
  return group
}

function buildStorageShelf() {
  const group = new THREE.Group()
  group.name = 'prop-storage-shelf'

  const frameGeo = new THREE.BoxGeometry(0.95, 1.7, 0.48)
  const frame = new THREE.Mesh(frameGeo, PROP_MATERIALS.rustyMetal)
  frame.position.set(0, 0.85, 0)
  group.add(frame)

  const crateGeo = new THREE.BoxGeometry(0.42, 0.38, 0.4)
  const crate = new THREE.Mesh(crateGeo, PROP_MATERIALS.weatheredWood)
  crate.position.set(-0.16, 0.58, 0)
  group.add(crate)

  configureShadows(group)
  return group
}

function buildIndustrialBarrel() {
  const group = new THREE.Group()
  group.name = 'prop-industrial-barrel'

  const drumGeo = new THREE.CylinderGeometry(0.35, 0.33, 0.92, 16)
  const drum = new THREE.Mesh(drumGeo, PROP_MATERIALS.warningYellow)
  drum.position.set(0, 0.46, 0)
  group.add(drum)

  configureShadows(group)
  return group
}

function buildWoodenCrate() {
  const group = new THREE.Group()
  group.name = 'prop-wooden-crate'

  const crateGeo = new THREE.BoxGeometry(0.58, 0.58, 0.58)
  const crate = new THREE.Mesh(crateGeo, PROP_MATERIALS.weatheredWood)
  crate.position.set(0, 0.29, 0)
  group.add(crate)

  configureShadows(group)
  return group
}

function buildToolbox() {
  const group = new THREE.Group()
  group.name = 'prop-toolbox'

  const boxGeo = new THREE.BoxGeometry(0.45, 0.26, 0.28)
  const box = new THREE.Mesh(boxGeo, PROP_MATERIALS.warningYellow)
  box.position.set(0, 0.13, 0)
  group.add(box)

  configureShadows(group)
  return group
}

function buildElectricalPanel() {
  const group = new THREE.Group()
  group.name = 'prop-electrical-panel'

  const boxGeo = new THREE.BoxGeometry(0.5, 0.68, 0.2)
  const box = new THREE.Mesh(boxGeo, PROP_MATERIALS.darkSteel)
  box.position.set(0, 1.25, 0)
  group.add(box)

  const cableGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.65, 6)
  const cable = new THREE.Mesh(cableGeo, PROP_MATERIALS.cableBlack)
  cable.position.set(0.14, 0.88, 0.12)
  cable.rotation.z = 0.38
  group.add(cable)

  configureShadows(group)
  return group
}

function buildDebrisPile() {
  const group = new THREE.Group()
  group.name = 'prop-debris-pile'

  const chunkGeo1 = new THREE.BoxGeometry(0.38, 0.2, 0.32)
  const chunk1 = new THREE.Mesh(chunkGeo1, PROP_MATERIALS.debrisConcrete)
  chunk1.position.set(0, 0.1, 0)
  chunk1.rotation.y = 0.45
  group.add(chunk1)

  const chunkGeo2 = new THREE.BoxGeometry(0.26, 0.14, 0.28)
  const chunk2 = new THREE.Mesh(chunkGeo2, PROP_MATERIALS.debrisConcrete)
  chunk2.position.set(0.24, 0.07, -0.16)
  chunk2.rotation.y = -0.65
  group.add(chunk2)

  const paperGeo = new THREE.BoxGeometry(0.24, 0.015, 0.18)
  const paper = new THREE.Mesh(paperGeo, PROP_MATERIALS.paperWhite)
  paper.position.set(-0.28, 0.015, 0.14)
  paper.rotation.y = 0.85
  group.add(paper)

  configureShadows(group)
  return group
}

const PROP_BUILDERS = {
  [PROP_TYPES.DESK_BROKEN]: buildBrokenDesk,
  [PROP_TYPES.CHAIR_BROKEN]: buildBrokenChair,
  [PROP_TYPES.CHAIR_OVERTURNED]: buildOverturnedChair,
  [PROP_TYPES.FILING_CABINET]: buildFilingCabinet,
  [PROP_TYPES.FILING_CABINET_OVERTURNED]: buildFilingCabinetOverturned,
  [PROP_TYPES.STORAGE_LOCKER]: buildStorageLocker,
  [PROP_TYPES.STORAGE_SHELF]: buildStorageShelf,
  [PROP_TYPES.INDUSTRIAL_BARREL]: buildIndustrialBarrel,
  [PROP_TYPES.WOODEN_CRATE]: buildWoodenCrate,
  [PROP_TYPES.TOOLBOX]: buildToolbox,
  [PROP_TYPES.ELECTRICAL_PANEL]: buildElectricalPanel,
  [PROP_TYPES.DEBRIS_PILE]: buildDebrisPile,
}

/**
 * Builds and returns a THREE.Group containing procedurally placed environmental props.
 */
export function buildEnvironmentalProps(maze, options = {}) {
  const propList = placeEnvironmentalProps(maze, options)
  if (!propList || propList.length === 0) {
    return null
  }

  const rootGroup = new THREE.Group()
  rootGroup.name = 'maze-environmental-props'

  let builtCount = 0
  for (let i = 0; i < propList.length; i += 1) {
    const desc = propList[i]
    const builder = PROP_BUILDERS[desc.type] || buildDebrisPile
    const propMesh = builder()

    const worldPos = gridToWorld(desc.row, desc.col, maze)
    if (!worldPos) continue

    const px = worldPos.x + (desc.offsetX || 0)
    const pz = worldPos.z + (desc.offsetZ || 0)
    const py = desc.type === PROP_TYPES.ELECTRICAL_PANEL ? 0 : 0.01

    propMesh.position.set(px, py, pz)
    propMesh.rotation.y = desc.rotationYaw || 0
    if (desc.scale && desc.scale > 0) {
      propMesh.scale.setScalar(desc.scale)
    }

    rootGroup.add(propMesh)
    builtCount += 1
  }

  rootGroup.userData = {
    propCount: builtCount,
  }

  return builtCount > 0 ? rootGroup : null
}
