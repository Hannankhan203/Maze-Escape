import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  PROP_COLLIDER_SPECS,
  PROP_PLACEMENT_SPECS,
  PROP_TYPES,
} from '../generation/environmentalPropPlacement.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { moveWithSubsteps, resolveGridCollision } from '../world/gridCollision.js'
import { buildPropCollisionIndex } from '../world/propCollision.js'
import { CELL_SIZE, PLAYER_RADIUS, gridToWorld } from '../world/worldCoords.js'
import {
  createEnvironmentalPropMesh,
  disposeEnvironmentalPropPools,
} from './buildEnvironmentalProps.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { disposeAllSharedPools } from './sharedResources.js'

console.log('--- RUNNING ENVIRONMENTAL PROP PHYSICAL REALISM & COLLISION TESTS ---')

function createMockRenderer() {
  return {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: null, needsUpdate: false },
    pixelRatio: 1,
    setPixelRatio() {},
    setSize() {},
    render() {},
    dispose() {},
    getContext: () => null,
  }
}

function createHeadlessEngine(config = {}) {
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 1280,
    clientHeight: 720,
  }
  return new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => createMockRenderer(),
    isSoftwareGl: false,
    lowPerformance: false,
    ...config,
  })
}

function collectWorldVertices(root, filterFn = null) {
  root.updateMatrixWorld(true)
  const pts = []
  const v = new THREE.Vector3()
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return
    if (filterFn && !filterFn(obj)) return
    const pos = obj.geometry.attributes.position
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld)
      pts.push({ x: v.x, y: v.y, z: v.z, name: obj.name })
    }
  })
  return pts
}

function minDistToPropIndex(x, z, index) {
  if (!index?.colliders) return Infinity
  let minEdgeDist = Infinity
  for (let i = 0; i < index.colliders.length; i += 1) {
    const col = index.colliders[i]
    if (col.kind === 2) {
      const d = Math.hypot(x - col.cx, z - col.cz) - col.radius
      if (d < minEdgeDist) minEdgeDist = d
    } else {
      const dx = x - col.cx
      const dz = z - col.cz
      const lx = dx * col.ux + dz * col.uz
      const lz = dx * col.vx + dz * col.vz
      const cx = Math.max(-col.halfW, Math.min(col.halfW, lx))
      const cz = Math.max(-col.halfD, Math.min(col.halfD, lz))
      const edgeDist = Math.hypot(lx - cx, lz - cz)
      if (edgeDist < minEdgeDist) minEdgeDist = edgeDist
    }
  }
  return minEdgeDist
}

function createOpenCorrMaze(rows = 5, cols = 5) {
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) =>
      r === 0 || r === rows - 1 || c === 0 || c === cols - 1
        ? CELL_TYPES.WALL
        : CELL_TYPES.PATH
    )
  )
  return {
    rows,
    cols,
    start: { row: 1, col: 1 },
    exit: { row: rows - 2, col: cols - 2 },
    grid,
  }
}

disposeAllSharedPools()

// ---------------------------------------------------------------------------
// 1. Damaged & Tilted Furniture Physical Plausibility Contracts
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Physical Plausibility of Damaged & Tilted Props')

  // 1a. Broken desk: missing front-right leg (+X, +Z) -> that corner sags downward
  const desk = createEnvironmentalPropMesh(PROP_TYPES.DESK_BROKEN)
  desk.updateMatrixWorld(true)
  const deskTop = desk.getObjectByName('desk-top')
  assert.ok(deskTop, 'desk-broken exposes desk-top')
  const topVerts = collectWorldVertices(deskTop, (o) => o.name === 'desk-top')
  let minYBL = Infinity
  let minYFR = Infinity
  let maxYBL = -Infinity
  let maxYFR = -Infinity
  for (const p of topVerts) {
    if (p.x < -0.45 && p.z < -0.25) {
      if (p.y < minYBL) minYBL = p.y
      if (p.y > maxYBL) maxYBL = p.y
    }
    if (p.x > 0.45 && p.z > 0.25) {
      if (p.y < minYFR) minYFR = p.y
      if (p.y > maxYFR) maxYFR = p.y
    }
  }
  assert.ok(
    maxYFR < maxYBL - 0.05 && minYFR < minYBL - 0.05,
    `desk-broken unsupported front-right corner sags lower than supported back-left (FR max=${maxYFR.toFixed(4)} < BL max=${maxYBL.toFixed(4)})`
  )

  const legsStanding = desk.getObjectByName('desk-legs-standing')
  const legsBox = new THREE.Box3().setFromObject(legsStanding)
  assert.ok(
    Math.abs(legsBox.min.y) <= 0.002,
    `desk-legs-standing flush on floor (minY=${legsBox.min.y.toFixed(5)})`
  )
  assert.ok(
    legsBox.max.y >= minYBL - 0.04,
    `desk-legs-standing reaches up into tilted tabletop underside (legMaxY=${legsBox.max.y.toFixed(4)})`
  )

  const brokenLegBox = new THREE.Box3().setFromObject(desk.getObjectByName('desk-broken-leg'))
  assert.ok(
    Math.abs(brokenLegBox.min.y) <= 0.002,
    `desk-broken-leg rests flat on y=0 (minY=${brokenLegBox.min.y.toFixed(5)})`
  )

  // 1b. Broken chair: buckled front-right leg causes front-right seat corner to be lowest, leg reaches floor
  const chair = createEnvironmentalPropMesh(PROP_TYPES.CHAIR_BROKEN)
  const seatMesh = chair.getObjectByName('chair-seat')
  const seatVerts = collectWorldVertices(seatMesh)
  let seatBL = Infinity
  let seatFR = Infinity
  for (const p of seatVerts) {
    if (p.x < -0.15 && p.z < -0.1) seatBL = Math.min(seatBL, p.y)
    if (p.x > 0.15 && p.z > 0.15) seatFR = Math.min(seatFR, p.y)
  }
  assert.ok(
    seatFR < seatBL - 0.025,
    `chair-broken buckled front-right seat corner droops lower than back-left (FR=${seatFR.toFixed(4)} < BL=${seatBL.toFixed(4)})`
  )
  const chairLegsBox = new THREE.Box3().setFromObject(chair.getObjectByName('chair-legs'))
  assert.ok(
    Math.abs(chairLegsBox.min.y) <= 0.003,
    `chair-broken legs rest solidly at floor y=0 (minY=${chairLegsBox.min.y.toFixed(5)})`
  )

  // 1c. Overturned chair: wide multi-point floor contact polygon (not perched on 1 edge)
  const overturnedChair = createEnvironmentalPropMesh(PROP_TYPES.CHAIR_OVERTURNED)
  const otVerts = collectWorldVertices(overturnedChair)
  const floorContacts = otVerts.filter((p) => p.y <= 0.015)
  assert.ok(floorContacts.length >= 6, `chair-overturned has multi-point floor contact (got ${floorContacts.length} low verts)`)
  const minCX = Math.min(...floorContacts.map((p) => p.x))
  const maxCX = Math.max(...floorContacts.map((p) => p.x))
  const minCZ = Math.min(...floorContacts.map((p) => p.z))
  const maxCZ = Math.max(...floorContacts.map((p) => p.z))
  assert.ok(
    maxCX - minCX >= 0.45 && maxCZ - minCZ >= 0.25,
    `chair-overturned floor support polygon spans widely (${(maxCX - minCX).toFixed(3)}m x ${(maxCZ - minCZ).toFixed(3)}m)`
  )

  // 1d. Filing cabinet overturned: spilled paper lies cleanly outside oriented cabinet shell & within footprint spec
  const otCab = createEnvironmentalPropMesh(PROP_TYPES.FILING_CABINET_OVERTURNED)
  otCab.updateMatrixWorld(true)
  const cabBody = otCab.getObjectByName('cabinet-body')
  const spilledPaper = otCab.getObjectByName('cabinet-spilled-paper')
  const spilledPaperBox = new THREE.Box3().setFromObject(spilledPaper)
  assert.ok(
    Math.abs(spilledPaperBox.min.y) <= 0.002,
    `overturned cabinet spilled paper lies at y=0 (minY=${spilledPaperBox.min.y.toFixed(5)})`
  )
  assert.ok(
    spilledPaperBox.max.z <= PROP_PLACEMENT_SPECS[PROP_TYPES.FILING_CABINET_OVERTURNED].halfDepthFront + 1e-4,
    `spilled paper stays within spec front depth (maxZ=${spilledPaperBox.max.z.toFixed(4)})`
  )
  cabBody.geometry.computeBoundingBox()
  const localCabBox = cabBody.geometry.boundingBox
  const spilledVerts = collectWorldVertices(spilledPaper)
  const tmpPt = new THREE.Vector3()
  let insideCabBody = 0
  for (const pt of spilledVerts) {
    tmpPt.set(pt.x, pt.y, pt.z)
    cabBody.worldToLocal(tmpPt)
    if (
      tmpPt.x > localCabBox.min.x + 0.005 &&
      tmpPt.x < localCabBox.max.x - 0.005 &&
      tmpPt.y > localCabBox.min.y + 0.005 &&
      tmpPt.y < localCabBox.max.y - 0.005 &&
      tmpPt.z > localCabBox.min.z + 0.005 &&
      tmpPt.z < localCabBox.max.z - 0.005
    ) {
      insideCabBody += 1
    }
  }
  assert.equal(insideCabBody, 0, 'spilled papers do not clip inside overturned cabinet body')

  // 1e. Storage locker: right door swings outward (+Z) instead of inward into shelves
  const locker = createEnvironmentalPropMesh(PROP_TYPES.STORAGE_LOCKER)
  const lockerDoorsBox = new THREE.Box3().setFromObject(locker.getObjectByName('locker-doors'))
  assert.ok(
    lockerDoorsBox.max.z > 0.35 &&
      lockerDoorsBox.max.z <= PROP_PLACEMENT_SPECS[PROP_TYPES.STORAGE_LOCKER].halfDepthFront + 1e-4,
    `storage_locker open right door swings cleanly outward within footprint (maxZ=${lockerDoorsBox.max.z.toFixed(4)})`
  )

  console.log('✓ Damaged/tilted furniture physics contracts verified')
}

// ---------------------------------------------------------------------------
// 2. Direct Collision, Wall Sliding, Anti-Tunneling & Corner Safety
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Solid Prop Collision, Sliding, Anti-Tunneling & Corner Safety')
  const openMaze = createOpenCorrMaze(7, 7)
  const center = gridToWorld(3, 3, openMaze)
  const radius = PLAYER_RADIUS

  // Verify every solid prop type blocks direct approach & leaves non-blocking props passable
  for (const propType of Object.values(PROP_TYPES)) {
    const isSolid = (PROP_COLLIDER_SPECS[propType]?.length || 0) > 0

    // 2a. Head-on perpendicular collision (yaw=0; note chair_overturned/cabinet_overturned have internal oblique yaw)
    const placedHeadOn = [
      {
        propId: `unit-straight-${propType}`,
        propType,
        row: 3,
        col: 3,
        position: [center.x, 0, center.z],
        rotationYaw: 0,
        scale: 1,
      },
    ]
    const straightIndex = buildPropCollisionIndex(openMaze, placedHeadOn)

    if (!isSolid) {
      assert.equal(straightIndex, null, `Non-blocking prop ${propType} produces null collision index`)
      const passRes = moveWithSubsteps(
        center.x - 1.5,
        center.z,
        3.0,
        0,
        openMaze,
        { radius, propColliders: straightIndex }
      )
      assert.equal(passRes.collided, false, `${propType} does not block player traversal`)
      assert.ok(Math.abs(passRes.x - (center.x + 1.5)) < 1e-5, `Walked freely across ${propType}`)
      continue
    }

    assert.ok(straightIndex && straightIndex.colliders.length >= 1, `Solid prop ${propType} builds collider(s)`)

    // Short 1.5m head-on approach from center.x - 1.5 -> reaches center.x and stops at front face or deflects cleanly without ever entering collider
    let curX = center.x - 1.5
    let curZ = center.z
    let hitStraight = false
    let minEdgeStraight = Infinity
    for (let step = 0; step < 15; step += 1) {
      const res = moveWithSubsteps(curX, curZ, 0.12, 0, openMaze, {
        radius,
        propColliders: straightIndex,
      })
      curX = res.x
      curZ = res.z
      if (res.hitProp) hitStraight = true
      minEdgeStraight = Math.min(minEdgeStraight, minDistToPropIndex(curX, curZ, straightIndex))
    }
    assert.ok(hitStraight, `Walking into ${propType} registers prop collision`)
    assert.ok(
      minEdgeStraight >= radius - 0.005,
      `${propType} keeps player outer surface outside collider (edgeDist=${minEdgeStraight.toFixed(4)}, radius=${radius})`
    )
    if (curX >= center.x) {
      assert.ok(
        Math.abs(curZ - center.z) > 0.15,
        `${propType} only allowed X progress by sliding laterally around exterior (dz=${(curZ - center.z).toFixed(3)})`
      )
    }

    // 2b. Rotated placement (yaw = 0.35) + high-speed single-frame anti-tunneling
    const placedRotated = [
      {
        propId: `unit-rot-${propType}`,
        propType,
        row: 3,
        col: 3,
        position: [center.x, 0, center.z],
        rotationYaw: 0.35,
        scale: 1,
      },
    ]
    const rotIndex = buildPropCollisionIndex(openMaze, placedRotated)

    let rx = center.x - 1.5
    let rz = center.z
    let hitRot = false
    let minEdgeRot = Infinity
    for (let step = 0; step < 25; step += 1) {
      const res = moveWithSubsteps(rx, rz, 0.12, 0, openMaze, {
        radius,
        propColliders: rotIndex,
      })
      rx = res.x
      rz = res.z
      if (res.hitProp) hitRot = true
      minEdgeRot = Math.min(minEdgeRot, minDistToPropIndex(rx, rz, rotIndex))
    }
    assert.ok(hitRot, `Rotated ${propType} registers prop collision`)
    assert.ok(
      minEdgeRot >= radius - 0.005,
      `Rotated ${propType} never lets player clip inside collider (edgeDist=${minEdgeRot.toFixed(4)})`
    )

    // High-speed diagonal single-frame spike -> anti-tunneling must catch and stay clear of prop interior
    const fastRes = moveWithSubsteps(
      center.x - 1.4,
      center.z - 0.1,
      2.8,
      0.2,
      openMaze,
      { radius, propColliders: rotIndex }
    )
    assert.ok(fastRes.hitProp && fastRes.collided, `High-speed move catches ${propType}`)
    assert.ok(
      minDistToPropIndex(fastRes.x, fastRes.z, rotIndex) >= radius - 0.005,
      `High-speed sprint delta never ends inside ${propType}`
    )
  }

  // Sliding smoothly along angled desk without getting stuck
  const deskIndex = buildPropCollisionIndex(openMaze, [
    {
      propId: 'slide-desk',
      propType: PROP_TYPES.DESK_BROKEN,
      row: 3,
      col: 3,
      position: [center.x, 0, center.z],
      rotationYaw: 0,
      scale: 1,
    },
  ])
  let sx = center.x - 0.85
  let sz = center.z - 0.4
  let sawPropHit = false
  for (let i = 0; i < 45; i += 1) {
    // Move diagonally Southeast (+X, +Z) against the west side of the desk
    const res = moveWithSubsteps(sx, sz, 0.08, 0.08, openMaze, {
      radius,
      propColliders: deskIndex,
    })
    sx = res.x
    sz = res.z
    if (res.hitProp) sawPropHit = true
  }
  assert.ok(sawPropHit, 'Diagonal grazing against desk registers slide contact')
  assert.ok(
    sz > center.z + 0.6,
    `Player slides cleanly past South edge of desk instead of snagging (sz=${sz.toFixed(3)})`
  )

  // Corner pinch test: prop pressed near North wall (row 0 is WALL, center of row 1 is openMaze top corridor)
  const northCell = gridToWorld(1, 3, openMaze)
  const northWallMaxZ = northCell.z - CELL_SIZE * 0.5
  const pinchIndex = buildPropCollisionIndex(openMaze, [
    {
      propId: 'pinch-crate',
      propType: PROP_TYPES.WOODEN_CRATE,
      row: 1,
      col: 3,
      position: [northCell.x, 0, northWallMaxZ + 0.35],
      rotationYaw: 0,
      scale: 1,
    },
  ])
  const pinchRes = moveWithSubsteps(
    northCell.x - 0.6,
    northWallMaxZ + radius + 0.02,
    0.55,
    -0.45,
    openMaze,
    { radius, propColliders: pinchIndex }
  )
  assert.ok(
    pinchRes.z >= northWallMaxZ + radius - 1e-4,
    `Corner pinch with prop never pushes player into North wall (z=${pinchRes.z.toFixed(4)} >= min=${(northWallMaxZ + radius).toFixed(4)})`
  )
  const pinchResolve = resolveGridCollision(pinchRes.x, pinchRes.z, openMaze, {
    radius,
    propColliders: pinchIndex,
  })
  assert.ok(
    pinchResolve.z >= northWallMaxZ + radius - 1e-4,
    'Resolved corner position remains strictly outside maze wall'
  )

  console.log('✓ Direct collision, sliding, anti-tunneling, and corner pinch wall safety verified')
}

// ---------------------------------------------------------------------------
// 3. Full MazeSceneEngine Integration & Wall Pass Compatibility
// ---------------------------------------------------------------------------
{
  console.log('Test 3: MazeSceneEngine Integration & Wall Pass Parity')
  const { engine } = { engine: createHeadlessEngine() }

  for (const [label, seed] of [
    ['easy', 7101],
    ['medium', 7202],
    ['hard', 7303],
    ['hardcore', 7404],
  ]) {
    const maze = generateMaze({ difficulty: label, seed })
    const nav = findShortestPath(maze.grid, maze.start, maze.exit)
    assert.ok(nav.found, `${label} maze start-to-exit path stays navigable`)

    engine.setMaze(maze)
    assert.ok(
      engine._propCollisionIndex && engine._propCollisionIndex.colliders.length > 0,
      `${label} MazeSceneEngine builds prop collision index on setMaze()`
    )

    // Test real placed solid prop interaction via engine.stepMovement
    const placedProps =
      engine.getMazeGroup()?.userData?.environmentalPropsGroup?.userData?.placedProps || []
    const solidDesc =
      placedProps.find((p) => p.propType === PROP_TYPES.DESK_BROKEN) ||
      placedProps.find((p) => {
        const specs = PROP_COLLIDER_SPECS[p.propType]
        return Array.isArray(specs) && specs.length > 0
      })
    assert.ok(solidDesc, `${label} maze includes at least one solid environmental prop`)

    // Move player to clear corridor side facing the prop, then advance up to prop contact
    const cellCenter = gridToWorld(solidDesc.row, solidDesc.col, maze)
    const propWorld = { x: solidDesc.position[0], z: solidDesc.position[2] }
    const toPropX = propWorld.x - cellCenter.x
    const toPropZ = propWorld.z - cellCenter.z
    const distFromCenter = Math.hypot(toPropX, toPropZ)

    if (distFromCenter > 0.05) {
      const ux = toPropX / distFromCenter
      const uz = toPropZ / distFromCenter
      const yaw = Math.atan2(-ux, -uz)
      engine.setPlayerWorldPosition(cellCenter.x, 0, cellCenter.z, { immediate: true, yaw })

      // Advance ~1.125m toward prop with wallPassArmed=true -> blocked by prop cleanly WITHOUT consuming Wall Pass
      let minSeenEdgeDist = Infinity
      let usedWallPassOnProp = false
      let sawCollision = false
      for (let i = 0; i < 5; i += 1) {
        const stepRes = engine.stepMovement(
          { forwardAxis: 1, strafeAxis: 0, sprint: true },
          0.025,
          { wallPassArmed: true }
        )
        if (stepRes.usedWallPass) usedWallPassOnProp = true
        if (stepRes.collided) sawCollision = true
        const pos = engine.getPlayerWorldPosition()
        const edgeDist = minDistToPropIndex(pos.x, pos.z, engine._propCollisionIndex)
        if (edgeDist < minSeenEdgeDist) minSeenEdgeDist = edgeDist
      }
      assert.equal(
        usedWallPassOnProp,
        false,
        `${label} colliding with solid prop ${solidDesc.propType} never falsely consumes Wall Pass`
      )
      assert.ok(
        sawCollision || minSeenEdgeDist <= PLAYER_RADIUS + 0.35,
        `${label} stepMovement engages placed ${solidDesc.propType}`
      )
      assert.ok(
        minSeenEdgeDist >= PLAYER_RADIUS - 0.01,
        `${label} stepMovement keeps player cleanly outside placed ${solidDesc.propType} (edgeDist=${minSeenEdgeDist.toFixed(4)})`
      )
    }
  }

  engine.clearMaze()
  assert.equal(engine._propCollisionIndex, null, 'clearMaze() resets prop collision index')
  engine.dispose()
  console.log('✓ MazeSceneEngine prop collision and Wall Pass parity verified')
}

disposeAllSharedPools()
disposeEnvironmentalPropPools()
console.log('ALL ENVIRONMENTAL PROP PHYSICAL REALISM & COLLISION TESTS PASSED!')
