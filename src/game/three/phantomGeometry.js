import * as THREE from 'three'
import { mergeIndexedGeometries } from './geometryOptimization.js'

const TWO_PI = Math.PI * 2

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function ensureVertexColors(geometry, r = 1, g = 1, b = 1) {
  if (!geometry?.attributes?.position) return geometry
  const count = geometry.attributes.position.count
  const existing = geometry.attributes.color
  if (existing && existing.count === count) {
    if (r !== 1 || g !== 1 || b !== 1) {
      const arr = existing.array
      for (let i = 0; i < count; i += 1) {
        const idx = i * 3
        arr[idx] *= r
        arr[idx + 1] *= g
        arr[idx + 2] *= b
      }
      existing.needsUpdate = true
    }
    return geometry
  }

  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const idx = i * 3
    colors[idx] = r
    colors[idx + 1] = g
    colors[idx + 2] = b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function mergeAndDispose(parts) {
  const valid = []
  for (let i = 0; i < parts.length; i += 1) {
    const g = parts[i]
    if (g) {
      ensureVertexColors(g)
      valid.push(g)
    }
  }
  const merged = mergeIndexedGeometries(valid, { stripTangent: true })
  for (let i = 0; i < valid.length; i += 1) {
    valid[i]?.dispose?.()
  }
  return merged
}

function recomputeNormalsSafe(geometry, centerY = 0, centerZ = 0) {
  geometry.computeVertexNormals()
  const norm = geometry.attributes.normal
  const pos = geometry.attributes.position
  for (let i = 0; i < norm.count; i += 1) {
    const nx = norm.getX(i)
    const ny = norm.getY(i)
    const nz = norm.getZ(i)
    const len = Math.hypot(nx, ny, nz)
    if (!Number.isFinite(len) || len < 1e-4) {
      const dx = pos.getX(i)
      const dy = pos.getY(i) - centerY
      const dz = pos.getZ(i) - centerZ
      const dLen = Math.hypot(dx, dy, dz)
      if (dLen > 1e-5) {
        norm.setXYZ(i, dx / dLen, dy / dLen, dz / dLen)
      } else {
        norm.setXYZ(i, 0, 1, 0)
      }
    }
  }
  norm.needsUpdate = true
  return geometry
}

function weldSeamNormals(geometry, ringCount, radialSegments) {
  const norm = geometry.attributes.normal
  const cols = radialSegments + 1
  for (let rIdx = 0; rIdx < ringCount; rIdx += 1) {
    const i0 = rIdx * cols
    const i1 = i0 + radialSegments
    const nx = norm.getX(i0) + norm.getX(i1)
    const ny = norm.getY(i0) + norm.getY(i1)
    const nz = norm.getZ(i0) + norm.getZ(i1)
    const len = Math.hypot(nx, ny, nz)
    if (len > 1e-5) {
      const ix = nx / len
      const iy = ny / len
      const iz = nz / len
      norm.setXYZ(i0, ix, iy, iz)
      norm.setXYZ(i1, ix, iy, iz)
    }
  }
  norm.needsUpdate = true
  return geometry
}

function buildLoftedPartGeometry(
  rings,
  {
    radialSegments = 16,
    uRepeat = 1,
    vRepeat = 1,
    capBottom = true,
    capTop = true,
    capBottomDome = 0,
    capTopDome = 0,
    tiltX = 0,
  } = {}
) {
  const ringCount = rings.length
  const cols = radialSegments + 1
  const wallVertCount = ringCount * cols
  const capVertCount =
    (capBottom ? 1 + radialSegments : 0) + (capTop ? 1 + radialSegments : 0)
  const totalVerts = wallVertCount + capVertCount

  const positions = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const colors = new Float32Array(totalVerts * 3)
  const indices = []

  const minY = rings[0].y
  const maxY = rings[ringCount - 1].y
  const spanY = Math.max(1e-5, Math.abs(maxY - minY))

  let vCursor = 0
  for (let rIdx = 0; rIdx < ringCount; rIdx += 1) {
    const ring = rings[rIdx]
    const cx = ring.x ?? 0
    const cy = ring.y
    const cz = ring.z ?? 0
    const rx = Math.max(0.0012, ring.rx)
    const rz = Math.max(0.0012, ring.rz)
    const exp = ring.superExp ?? 2.0
    const frontScale = ring.frontScale ?? 1.0
    const backScale = ring.backScale ?? 1.0
    const leftScale = ring.leftScale ?? 1.0
    const rightScale = ring.rightScale ?? 1.0
    const ringTiltX = ring.tiltX ?? tiltX
    const ringTiltZ = ring.tiltZ ?? 0
    const foldAmp = ring.foldAmp ?? 0
    const foldFreq = ring.foldFreq ?? 5
    const foldPhase = ring.foldPhase ?? 0
    const jagAmp = ring.jagAmp ?? 0
    const cr = ring.colorR ?? 1.0
    const cg = ring.colorG ?? 1.0
    const cb = ring.colorB ?? 1.0
    const ao = ring.ao ?? 1.0
    const vCoord = ((cy - minY) / spanY) * vRepeat

    for (let s = 0; s <= radialSegments; s += 1) {
      const frac = s / radialSegments
      const theta = frac * TWO_PI
      const rawCos = Math.cos(theta)
      const rawSin = Math.sin(theta)
      let px = Math.sign(rawCos) * Math.pow(Math.abs(rawCos), 2 / exp) * rx
      let pz = Math.sign(rawSin) * Math.pow(Math.abs(rawSin), 2 / exp) * rz

      px *= px < 0 ? leftScale : rightScale
      pz *= pz < 0 ? frontScale : backScale

      let foldShade = 1.0
      if (foldAmp !== 0) {
        const foldWave = Math.sin(theta * foldFreq + foldPhase)
        const scale = 1 + foldAmp * foldWave
        px *= scale
        pz *= scale
        foldShade += foldWave * Math.min(0.16, Math.abs(foldAmp) * 1.4)
      }

      const edgeJag =
        jagAmp !== 0
          ? jagAmp * (Math.sin(theta * 7 + 0.5) * 0.6 + Math.cos(theta * 11 - 0.8) * 0.4)
          : 0

      const p = vCursor * 3
      const up = vCursor * 2
      positions[p] = cx + px
      positions[p + 1] = cy + pz * ringTiltX + px * ringTiltZ + edgeJag
      positions[p + 2] = cz + pz

      uvs[up] = frac * uRepeat
      uvs[up + 1] = vCoord

      const shade = clamp(ao * foldShade, 0.08, 1.05)
      colors[p] = shade * cr
      colors[p + 1] = shade * cg
      colors[p + 2] = shade * cb
      vCursor += 1
    }
  }

  for (let rIdx = 0; rIdx < ringCount - 1; rIdx += 1) {
    const rowA = rIdx * cols
    const rowB = (rIdx + 1) * cols
    for (let s = 0; s < radialSegments; s += 1) {
      const a = rowA + s
      const b = rowA + s + 1
      const c = rowB + s
      const d = rowB + s + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const addCap = (ringIdx, isTop, domeOffset) => {
    const ring = rings[ringIdx]
    const cx = ring.x ?? 0
    const cy = ring.y + (isTop ? domeOffset : -domeOffset)
    const cz = ring.z ?? 0
    const ao = (ring.ao ?? 1.0) * 0.86
    const cr = ring.colorR ?? 1.0
    const cg = ring.colorG ?? 1.0
    const cb = ring.colorB ?? 1.0
    const centerIdx = vCursor

    positions[centerIdx * 3] = cx
    positions[centerIdx * 3 + 1] = cy
    positions[centerIdx * 3 + 2] = cz
    uvs[centerIdx * 2] = 0.5
    uvs[centerIdx * 2 + 1] = isTop ? vRepeat : 0
    colors[centerIdx * 3] = ao * cr
    colors[centerIdx * 3 + 1] = ao * cg
    colors[centerIdx * 3 + 2] = ao * cb
    vCursor += 1

    const ringStart = ringIdx * cols
    const rimStart = vCursor
    for (let s = 0; s < radialSegments; s += 1) {
      const src = ringStart + s
      positions[vCursor * 3] = positions[src * 3]
      positions[vCursor * 3 + 1] = positions[src * 3 + 1]
      positions[vCursor * 3 + 2] = positions[src * 3 + 2]
      uvs[vCursor * 2] = 0.5 + 0.45 * Math.cos((s / radialSegments) * TWO_PI)
      uvs[vCursor * 2 + 1] = 0.5 + 0.45 * Math.sin((s / radialSegments) * TWO_PI)
      colors[vCursor * 3] = colors[src * 3]
      colors[vCursor * 3 + 1] = colors[src * 3 + 1]
      colors[vCursor * 3 + 2] = colors[src * 3 + 2]
      vCursor += 1
    }

    for (let s = 0; s < radialSegments; s += 1) {
      const next = (s + 1) % radialSegments
      if (isTop) {
        indices.push(centerIdx, rimStart + next, rimStart + s)
      } else {
        indices.push(centerIdx, rimStart + s, rimStart + next)
      }
    }
  }

  if (capBottom) addCap(0, false, capBottomDome)
  if (capTop) addCap(ringCount - 1, true, capTopDome)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  weldSeamNormals(geo, ringCount, radialSegments)
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

function buildSplineLoft(
  points,
  {
    tubularSegments = 10,
    radialSegments = 7,
    radiusX = 0.012,
    radiusY = 0.008,
    taperStart = 0.85,
    taperMid = 1.0,
    taperEnd = 0.16,
    aoStart = 0.82,
    aoEnd = 0.35,
    tintStart = [0.7, 0.65, 0.82],
    tintEnd = [0.45, 0.4, 0.58],
    upHint = [0, 0, -1],
    capStart = true,
    capEnd = true,
  } = {}
) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  )
  const rings = tubularSegments + 1
  const cols = radialSegments + 1
  const capCount = (capStart ? 1 + radialSegments : 0) + (capEnd ? 1 + radialSegments : 0)
  const totalVerts = rings * cols + capCount
  const positions = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const colors = new Float32Array(totalVerts * 3)
  const indices = []

  const refUp = new THREE.Vector3(upHint[0], upHint[1], upHint[2]).normalize()
  const tangent = new THREE.Vector3()
  const binormal = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const pt = new THREE.Vector3()

  let vCursor = 0
  for (let i = 0; i <= tubularSegments; i += 1) {
    const t = i / tubularSegments
    curve.getPoint(t, pt)
    curve.getTangent(t, tangent).normalize()
    binormal.crossVectors(tangent, refUp)
    if (binormal.lengthSq() < 1e-5) {
      binormal.set(1, 0, 0).crossVectors(tangent, binormal)
    }
    binormal.normalize()
    normal.crossVectors(binormal, tangent).normalize()

    const profile =
      t < 0.5
        ? lerp(taperStart, taperMid, smoothstep(0, 0.5, t))
        : lerp(taperMid, taperEnd, smoothstep(0.5, 1, t))
    const rx = Math.max(0.0008, radiusX * profile)
    const ry = Math.max(0.0008, radiusY * profile)
    const ao = lerp(aoStart, aoEnd, t)
    const cr = lerp(tintStart[0], tintEnd[0], t)
    const cg = lerp(tintStart[1], tintEnd[1], t)
    const cb = lerp(tintStart[2], tintEnd[2], t)

    for (let s = 0; s <= radialSegments; s += 1) {
      const frac = s / radialSegments
      const theta = frac * TWO_PI
      const ca = Math.cos(theta) * rx
      const sa = Math.sin(theta) * ry
      const p = vCursor * 3
      positions[p] = pt.x + binormal.x * ca + normal.x * sa
      positions[p + 1] = pt.y + binormal.y * ca + normal.y * sa
      positions[p + 2] = pt.z + binormal.z * ca + normal.z * sa
      uvs[vCursor * 2] = frac
      uvs[vCursor * 2 + 1] = t
      colors[p] = ao * cr
      colors[p + 1] = ao * cg
      colors[p + 2] = ao * cb
      vCursor += 1
    }
  }

  for (let i = 0; i < tubularSegments; i += 1) {
    const rowA = i * cols
    const rowB = (i + 1) * cols
    for (let s = 0; s < radialSegments; s += 1) {
      const a = rowA + s
      const b = rowA + s + 1
      const c = rowB + s
      const d = rowB + s + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const addSplineCap = (ringIdx, isEnd) => {
    const ringStart = ringIdx * cols
    let cx = 0
    let cy = 0
    let cz = 0
    for (let s = 0; s < radialSegments; s += 1) {
      const src = ringStart + s
      cx += positions[src * 3]
      cy += positions[src * 3 + 1]
      cz += positions[src * 3 + 2]
    }
    cx /= radialSegments
    cy /= radialSegments
    cz /= radialSegments

    const centerIdx = vCursor
    positions[centerIdx * 3] = cx
    positions[centerIdx * 3 + 1] = cy
    positions[centerIdx * 3 + 2] = cz
    uvs[centerIdx * 2] = 0.5
    uvs[centerIdx * 2 + 1] = isEnd ? 1 : 0
    colors[centerIdx * 3] = isEnd ? aoEnd * tintEnd[0] : aoStart * tintStart[0]
    colors[centerIdx * 3 + 1] = isEnd ? aoEnd * tintEnd[1] : aoStart * tintStart[1]
    colors[centerIdx * 3 + 2] = isEnd ? aoEnd * tintEnd[2] : aoStart * tintStart[2]
    vCursor += 1

    const rimStart = vCursor
    for (let s = 0; s < radialSegments; s += 1) {
      const src = ringStart + s
      positions[vCursor * 3] = positions[src * 3]
      positions[vCursor * 3 + 1] = positions[src * 3 + 1]
      positions[vCursor * 3 + 2] = positions[src * 3 + 2]
      uvs[vCursor * 2] = uvs[src * 2]
      uvs[vCursor * 2 + 1] = uvs[src * 2 + 1]
      colors[vCursor * 3] = colors[src * 3]
      colors[vCursor * 3 + 1] = colors[src * 3 + 1]
      colors[vCursor * 3 + 2] = colors[src * 3 + 2]
      vCursor += 1
    }

    for (let s = 0; s < radialSegments; s += 1) {
      const next = (s + 1) % radialSegments
      if (isEnd) {
        indices.push(centerIdx, rimStart + s, rimStart + next)
      } else {
        indices.push(centerIdx, rimStart + next, rimStart + s)
      }
    }
  }

  if (capStart) addSplineCap(0, false)
  if (capEnd) addSplineCap(tubularSegments, true)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  weldSeamNormals(geo, rings, radialSegments)
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

function buildFloatingTatterRibbon(points, widthStart, widthEnd, aoStart, aoEnd) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  )
  const segsU = 3
  const segsV = 9
  const cols = segsU + 1
  const rows = segsV + 1
  const positions = new Float32Array(cols * rows * 3)
  const uvs = new Float32Array(cols * rows * 2)
  const colors = new Float32Array(cols * rows * 3)
  const indices = []

  const tangent = new THREE.Vector3()
  const side = new THREE.Vector3()
  const up = new THREE.Vector3(0, 0, 1)
  const pt = new THREE.Vector3()

  for (let r = 0; r < rows; r += 1) {
    const v = r / segsV
    curve.getPoint(v, pt)
    curve.getTangent(v, tangent).normalize()
    side.crossVectors(tangent, up)
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0)
    side.normalize()

    const jag = 1 + Math.sin(v * 18.0) * 0.24 * smoothstep(0.3, 1.0, v)
    const halfW = lerp(widthStart, widthEnd, Math.pow(v, 0.8)) * jag
    const ao = lerp(aoStart, aoEnd, Math.pow(v, 1.1))

    for (let c = 0; c < cols; c += 1) {
      const u = c / segsU
      const s = u * 2 - 1
      const idx = r * cols + c
      positions[idx * 3] = pt.x + side.x * s * halfW
      positions[idx * 3 + 1] = pt.y + side.y * s * halfW
      positions[idx * 3 + 2] = pt.z + side.z * s * halfW + (1 - s * s) * 0.012
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = v
      const edgeFade = 1 - Math.abs(s) * 0.35
      colors[idx * 3] = ao * edgeFade * 0.82
      colors[idx * 3 + 1] = ao * edgeFade * 0.78
      colors[idx * 3 + 2] = ao * edgeFade
    }
  }

  for (let r = 0; r < segsV; r += 1) {
    for (let c = 0; c < segsU; c += 1) {
      const a = r * cols + c
      const b = a + 1
      const cIdx = a + cols
      const d = cIdx + 1
      indices.push(a, cIdx, b, b, cIdx, d)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

/**
 * Distorted towering apparition torso:
 * - torsoCore: pinched wasp waist flaring sharply into an asymmetric, hunched, dislocated shoulder arch.
 * - torsoShroud: partially transparent, layered spectral body & tattered trailing shadow cloak with fading edges.
 */
export function buildPhantomTorsoGeometries() {
  const torsoCore = buildLoftedPartGeometry(
    [
      { y: -0.1, x: 0.0, z: 0.02, rx: 0.085, rz: 0.056, ao: 0.28, colorR: 0.78, colorG: 0.74, colorB: 0.94 },
      { y: 0.09, x: -0.008, z: 0.008, rx: 0.072, rz: 0.052, ao: 0.44, colorR: 0.8, colorG: 0.76, colorB: 0.96 },
      { y: 0.27, x: -0.014, z: -0.006, rx: 0.118, rz: 0.076, foldAmp: 0.08, foldFreq: 5, ao: 0.62, colorR: 0.84, colorG: 0.8, colorB: 1.0 },
      {
        y: 0.46,
        x: -0.006,
        z: -0.02,
        rx: 0.21,
        rz: 0.102,
        leftScale: 1.08,
        rightScale: 0.94,
        tiltZ: -0.11,
        foldAmp: 0.09,
        foldFreq: 6,
        ao: 0.76,
        colorR: 0.88,
        colorG: 0.84,
        colorB: 1.0,
      },
      {
        y: 0.62,
        x: 0.01,
        z: -0.032,
        rx: 0.248,
        rz: 0.112,
        leftScale: 1.1,
        rightScale: 0.92,
        tiltZ: -0.15,
        foldAmp: 0.07,
        foldFreq: 4,
        ao: 0.82,
        colorR: 0.9,
        colorG: 0.86,
        colorB: 1.0,
      },
      { y: 0.72, x: 0.014, z: -0.044, rx: 0.088, rz: 0.068, tiltZ: -0.08, ao: 0.62 },
    ],
    { radialSegments: 18, capBottom: true, capTop: true, capTopDome: 0.02 }
  )

  const shroudMantle = buildLoftedPartGeometry(
    [
      { y: -0.58, x: 0.0, z: 0.05, rx: 0.26, rz: 0.17, foldAmp: 0.26, foldFreq: 8, jagAmp: 0.045, ao: 0.18, colorR: 0.72, colorG: 0.68, colorB: 0.95 },
      { y: -0.25, x: 0.0, z: 0.032, rx: 0.21, rz: 0.145, foldAmp: 0.22, foldFreq: 7, jagAmp: 0.02, ao: 0.42, colorR: 0.78, colorG: 0.74, colorB: 0.98 },
      { y: 0.08, x: -0.008, z: 0.018, rx: 0.165, rz: 0.11, foldAmp: 0.16, foldFreq: 6, ao: 0.66, colorR: 0.84, colorG: 0.8, colorB: 1.0 },
      { y: 0.36, x: -0.008, z: -0.006, rx: 0.22, rz: 0.128, leftScale: 1.06, rightScale: 0.96, tiltZ: -0.1, foldAmp: 0.14, foldFreq: 6, ao: 0.82, colorR: 0.88, colorG: 0.85, colorB: 1.0 },
      { y: 0.61, x: 0.008, z: -0.025, rx: 0.278, rz: 0.138, leftScale: 1.1, rightScale: 0.94, tiltZ: -0.14, foldAmp: 0.11, foldFreq: 5, ao: 0.86, colorR: 0.9, colorG: 0.86, colorB: 1.0 },
      { y: 0.73, x: 0.014, z: -0.04, rx: 0.135, rz: 0.095, tiltZ: -0.06, ao: 0.56 },
    ],
    { radialSegments: 20, capBottom: false, capTop: false }
  )

  const tatters = [
    shroudMantle,
    buildFloatingTatterRibbon(
      [
        [-0.21, 0.58, 0.02],
        [-0.25, 0.22, 0.07],
        [-0.24, -0.22, 0.13],
        [-0.27, -0.68, 0.19],
      ],
      0.068,
      0.01,
      0.78,
      0.12
    ),
    buildFloatingTatterRibbon(
      [
        [0.21, 0.52, 0.01],
        [0.24, 0.18, 0.06],
        [0.22, -0.26, 0.12],
        [0.25, -0.72, 0.18],
      ],
      0.064,
      0.01,
      0.76,
      0.12
    ),
    buildFloatingTatterRibbon(
      [
        [0.0, 0.55, 0.095],
        [-0.02, 0.16, 0.14],
        [0.01, -0.3, 0.18],
        [-0.03, -0.82, 0.24],
      ],
      0.092,
      0.014,
      0.74,
      0.1
    ),
  ]

  return {
    torsoCore,
    torsoShroud: mergeAndDispose(tatters),
  }
}

/**
 * Unnaturally elongated, craned, twisted neck jutting forward from hunched shoulder arch.
 */
export function buildPhantomNeckGeometry() {
  return buildLoftedPartGeometry(
    [
      { y: -0.02, x: 0.0, z: 0.012, rx: 0.048, rz: 0.044, ao: 0.54, colorR: 0.8, colorG: 0.76, colorB: 0.96 },
      { y: 0.06, x: 0.008, z: -0.012, rx: 0.036, rz: 0.038, foldAmp: 0.06, foldFreq: 4, ao: 0.68, colorR: 0.85, colorG: 0.82, colorB: 1.0 },
      { y: 0.14, x: 0.016, z: -0.036, rx: 0.033, rz: 0.037, ao: 0.72, colorR: 0.88, colorG: 0.84, colorB: 1.0 },
      { y: 0.21, x: 0.018, z: -0.052, rx: 0.038, rz: 0.044, ao: 0.62, colorR: 0.84, colorG: 0.8, colorB: 0.98 },
    ],
    { radialSegments: 14, capBottom: false, capTop: true }
  )
}

/**
 * Dark, almost featureless elongated apparition visage + swirling translucent veil
 * + narrow glowing supernatural eyes emerging from empty shadow hollows.
 */
export function buildPhantomHeadAndEyesGeometries() {
  const centerY = 0.135
  const centerZ = -0.022

  // Smooth, unsettlingly elongated dark featureless skull (no nose bridge, no mouth, no ears)
  const headCore = new THREE.SphereGeometry(1, 30, 22)
  const pos = headCore.attributes.position
  const cols = new Float32Array(pos.count * 3)

  for (let i = 0; i < pos.count; i += 1) {
    const ux = pos.getX(i)
    const uy = pos.getY(i)
    const uz = pos.getZ(i)

    let sx = ux * 0.072
    let sy = uy * 0.132
    let sz = uz * 0.094

    // Narrow jaw taper downward into an elongated spectral visage
    const lowerTaper = smoothstep(0.05, -0.92, uy)
    sx *= 1 - lowerTaper * 0.44
    sz *= 1 - lowerTaper * 0.28

    // Faint haunting hollow orbital band across smooth featureless front plane
    if (uz < 0) {
      const frontW = smoothstep(-0.15, -0.78, uz)
      const faceFlatten = frontW * 0.012
      sz += faceFlatten

      const eyeBand = Math.exp(-Math.pow((uy - 0.08) / 0.16, 2))
      const leftEye = Math.exp(-(Math.pow((ux + 0.36) / 0.24, 2) + Math.pow((uy - 0.08) / 0.14, 2)))
      const rightEye = Math.exp(-(Math.pow((ux - 0.36) / 0.24, 2) + Math.pow((uy - 0.08) / 0.14, 2)))
      const eyeDip = (leftEye + rightEye) * frontW
      sz += eyeDip * 0.014 + eyeBand * frontW * 0.004
    }

    pos.setXYZ(i, sx, sy + centerY, sz + centerZ)

    const crownDark = smoothstep(0.4, 0.95, uy) * 0.18
    const frontAbyss = uz < 0 ? smoothstep(-0.1, -0.85, uz) * 0.24 : 0
    const shade = clamp(0.66 - crownDark - frontAbyss, 0.18, 0.85)
    cols[i * 3] = shade * 0.84
    cols[i * 3 + 1] = shade * 0.8
    cols[i * 3 + 2] = shade
  }
  pos.needsUpdate = true
  headCore.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  recomputeNormalsSafe(headCore, centerY, centerZ)

  // Swirling translucent shadow-veil halo & ragged trailing crown wisps around the head
  const veilShell = buildLoftedPartGeometry(
    [
      { y: -0.02, z: centerZ + 0.012, rx: 0.095, rz: 0.112, foldAmp: 0.16, foldFreq: 6, ao: 0.26, colorR: 0.72, colorG: 0.68, colorB: 0.95 },
      { y: 0.08, z: centerZ + 0.008, rx: 0.096, rz: 0.116, foldAmp: 0.12, foldFreq: 5, ao: 0.56, colorR: 0.8, colorG: 0.76, colorB: 1.0 },
      { y: 0.2, z: centerZ + 0.012, rx: 0.086, rz: 0.106, foldAmp: 0.14, foldFreq: 5, ao: 0.72, colorR: 0.86, colorG: 0.82, colorB: 1.0 },
      { y: 0.285, z: centerZ + 0.024, rx: 0.044, rz: 0.068, jagAmp: 0.025, ao: 0.34, colorR: 0.76, colorG: 0.72, colorB: 0.98 },
    ],
    { radialSegments: 16, capBottom: false, capTop: false }
  )
  const headVeil = mergeAndDispose([
    veilShell,
    buildFloatingTatterRibbon(
      [
        [-0.068, 0.16, centerZ + 0.02],
        [-0.1, 0.02, centerZ + 0.09],
        [-0.12, -0.18, centerZ + 0.16],
      ],
      0.036,
      0.006,
      0.66,
      0.1
    ),
    buildFloatingTatterRibbon(
      [
        [0.068, 0.16, centerZ + 0.02],
        [0.1, 0.02, centerZ + 0.09],
        [0.12, -0.18, centerZ + 0.16],
      ],
      0.036,
      0.006,
      0.66,
      0.1
    ),
  ])

  // Faint, narrow, slightly slanted supernatural glowing eyes peering out of featureless abyss
  const eyeParts = []
  for (const sign of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.014, 10, 8)
    eye.scale(1.18, 0.38, 0.55)
    eye.rotateZ(sign * 0.18)
    eye.translate(sign * 0.028, centerY + 0.01, centerZ - 0.083)
    ensureVertexColors(eye, 1.0, 0.96, 0.92)
    eyeParts.push(eye)
  }

  return {
    headCore,
    headVeil,
    eyes: mergeAndDispose(eyeParts),
  }
}

/**
 * Shared hyper-elongated upper arm geometry (y = 0 shoulder down to y = -0.47 elbow).
 */
export function buildPhantomUpperArmGeometry() {
  return buildLoftedPartGeometry(
    [
      { y: -0.475, z: 0.0, rx: 0.025, rz: 0.025, foldAmp: 0.08, foldFreq: 4, ao: 0.54 },
      { y: -0.34, z: 0.004, rx: 0.027, rz: 0.026, foldAmp: 0.07, foldFreq: 4, ao: 0.68 },
      { y: -0.16, z: 0.002, rx: 0.033, rz: 0.031, ao: 0.78 },
      { y: 0.0, z: 0.0, rx: 0.04, rz: 0.038, ao: 0.72 },
      { y: 0.04, z: 0.0, rx: 0.032, rz: 0.032, ao: 0.56 },
    ],
    { radialSegments: 12, capBottom: true, capTop: true, capBottomDome: 0.012, capTopDome: 0.018 }
  )
}

/**
 * Shared jagged tattered shoulder cloak strip reused asymmetrically on shoulders.
 */
export function buildPhantomShoulderRagGeometry() {
  return buildLoftedPartGeometry(
    [
      { y: -0.4, z: 0.015, rx: 0.068, rz: 0.054, foldAmp: 0.24, foldFreq: 6, jagAmp: 0.032, ao: 0.2, colorR: 0.76, colorG: 0.72, colorB: 0.98 },
      { y: -0.22, z: 0.01, rx: 0.064, rz: 0.052, foldAmp: 0.16, foldFreq: 5, ao: 0.56, colorR: 0.84, colorG: 0.8, colorB: 1.0 },
      { y: -0.06, z: 0.0, rx: 0.062, rz: 0.05, ao: 0.8, colorR: 0.88, colorG: 0.84, colorB: 1.0 },
      { y: 0.055, z: 0.0, rx: 0.048, rz: 0.042, ao: 0.72 },
    ],
    { radialSegments: 12, capBottom: false, capTop: true, capTopDome: 0.014 }
  )
}

/**
 * Shared hyper-elongated gaunt forearm tapering down to wrist (y = 0 down to y = -0.50).
 */
export function buildPhantomForearmGeometry() {
  return buildLoftedPartGeometry(
    [
      { y: -0.505, z: -0.004, rx: 0.016, rz: 0.015, ao: 0.52 },
      { y: -0.34, z: 0.0, rx: 0.019, rz: 0.018, foldAmp: 0.1, foldFreq: 3, ao: 0.68 },
      { y: -0.14, z: 0.004, rx: 0.025, rz: 0.024, ao: 0.78 },
      { y: 0.015, z: 0.0, rx: 0.026, rz: 0.025, ao: 0.68 },
    ],
    { radialSegments: 10, capBottom: true, capTop: true, capBottomDome: 0.01, capTopDome: 0.014 }
  )
}

/**
 * Narrow shadowy palm with 5 long, razor-tapered unnatural shadow fingers.
 */
export function buildPhantomHandGeometry(sign = -1) {
  const palm = buildLoftedPartGeometry(
    [
      { y: -0.105, z: -0.008, rx: 0.032, rz: 0.011, foldAmp: 0.1, foldFreq: 4, ao: 0.72 },
      { y: -0.052, z: -0.004, rx: 0.026, rz: 0.011, ao: 0.76 },
      { y: -0.01, z: 0.0, rx: 0.018, rz: 0.012, ao: 0.68 },
      { y: 0.01, z: 0.0, rx: 0.016, rz: 0.012, ao: 0.58 },
    ],
    { radialSegments: 10, capBottom: true, capTop: true, capBottomDome: 0.008, capTopDome: 0.008 }
  )

  const parts = [palm]
  const fingerSpecs = [
    { x0: sign * 0.026, z0: -0.002, len: 0.165, splay: sign * 0.028, curl: -0.072 },
    { x0: sign * 0.009, z0: -0.006, len: 0.215, splay: sign * 0.01, curl: -0.092 },
    { x0: -sign * 0.009, z0: -0.008, len: 0.228, splay: -sign * 0.008, curl: -0.096 },
    { x0: -sign * 0.025, z0: -0.009, len: 0.192, splay: -sign * 0.026, curl: -0.08 },
  ]

  for (let i = 0; i < fingerSpecs.length; i += 1) {
    const f = fingerSpecs[i]
    const baseY = -0.1
    parts.push(
      buildSplineLoft(
        [
          [f.x0, baseY + 0.012, f.z0],
          [f.x0 + f.splay * 0.42, baseY - f.len * 0.34, f.z0 + f.curl * 0.22],
          [f.x0 + f.splay * 0.85, baseY - f.len * 0.72, f.z0 + f.curl * 0.62],
          [f.x0 + f.splay * 0.74, baseY - f.len, f.z0 + f.curl],
        ],
        {
          tubularSegments: 9,
          radialSegments: 6,
          radiusX: 0.0054,
          radiusY: 0.0048,
          taperStart: 1.0,
          taperMid: 0.64,
          taperEnd: 0.08,
          aoStart: 0.8,
          aoEnd: 0.3,
        }
      )
    )
  }

  parts.push(
    buildSplineLoft(
      [
        [-sign * 0.022, -0.036, -0.006],
        [-sign * 0.048, -0.082, -0.03],
        [-sign * 0.06, -0.135, -0.062],
        [-sign * 0.048, -0.175, -0.088],
      ],
      {
        tubularSegments: 7,
        radialSegments: 6,
        radiusX: 0.006,
        radiusY: 0.0052,
        taperStart: 1.0,
        taperMid: 0.65,
        taperEnd: 0.1,
        aoStart: 0.78,
        aoEnd: 0.3,
      }
    )
  )

  return mergeAndDispose(parts)
}

/**
 * Shared hyper-elongated shadow leg & fading lower drape tapering to sharp mist points
 * (y = 0 hip down to y = -1.03 hovering cleanly just above the floor).
 */
export function buildPhantomLegShadowGeometry() {
  const legCore = buildLoftedPartGeometry(
    [
      { y: -0.97, z: 0.035, rx: 0.012, rz: 0.014, foldAmp: 0.28, foldFreq: 5, jagAmp: 0.018, ao: 0.16, colorR: 0.7, colorG: 0.66, colorB: 0.94 },
      { y: -0.74, z: 0.018, rx: 0.03, rz: 0.034, foldAmp: 0.16, foldFreq: 5, ao: 0.42, colorR: 0.78, colorG: 0.74, colorB: 0.98 },
      { y: -0.45, z: -0.01, rx: 0.044, rz: 0.046, foldAmp: 0.1, foldFreq: 4, ao: 0.66 },
      { y: -0.17, z: 0.0, rx: 0.062, rz: 0.06, ao: 0.76 },
      { y: 0.03, z: 0.0, rx: 0.056, rz: 0.054, ao: 0.68 },
    ],
    { radialSegments: 12, capBottom: false, capTop: true, capTopDome: 0.022 }
  )

  const trailingWisp = buildFloatingTatterRibbon(
    [
      [0, -0.35, 0.035],
      [0.018, -0.66, 0.065],
      [-0.014, -0.96, 0.12],
    ],
    0.042,
    0.005,
    0.62,
    0.1
  )

  return mergeAndDispose([legCore, trailingWisp])
}

/**
 * Two counter-drifting procedural spectral particle clouds (inner rising embers/shadow motes
 * + outer haunting wisp aura) encoded cleanly into BufferGeometry for THREE.Points.
 */
export function buildPhantomParticlesGeometries() {
  const buildCloud = (count, minR, maxR, minY, maxY, seedOffset) => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)

    for (let i = 0; i < count; i += 1) {
      const frac = i / count
      const angle = i * 2.39996 + seedOffset
      const hWave = (Math.sin(i * 12.9898 + seedOffset) * 0.5 + 0.5)
      const r = lerp(minR, maxR, (Math.cos(i * 78.233 + seedOffset) * 0.5 + 0.5))
      const y = lerp(minY, maxY, frac * 0.78 + hWave * 0.22)

      positions[i * 3] = Math.cos(angle) * r
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = Math.sin(angle) * r

      // Alternate faint amber-ember sparks and misty violet-shadow motes
      const isEmber = i % 4 === 0
      const brightness = lerp(0.42, 0.95, 1 - Math.abs(frac - 0.5) * 1.3)
      if (isEmber) {
        colors[i * 3] = 0.98 * brightness
        colors[i * 3 + 1] = 0.52 * brightness
        colors[i * 3 + 2] = 0.22 * brightness
      } else {
        colors[i * 3] = 0.52 * brightness
        colors[i * 3 + 1] = 0.44 * brightness
        colors[i * 3 + 2] = 0.78 * brightness
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  }

  return {
    particlesInner: buildCloud(72, 0.18, 0.42, 0.18, 1.98, 1.7),
    particlesOuter: buildCloud(56, 0.36, 0.66, 0.12, 2.08, 9.3),
  }
}
