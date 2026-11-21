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

function gaussian(x, center, width) {
  const d = (x - center) / width
  return Math.exp(-(d * d))
}

/**
 * Ensures every BufferGeometry passed into `mergeIndexedGeometries` carries a
 * valid RGB `color` attribute so per-vertex AO shading survives merging.
 */
export function ensureVertexColors(geometry, r = 1, g = 1, b = 1) {
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

function applyColorGradientY(geometry, minY, maxY, bottomScale, topScale) {
  ensureVertexColors(geometry)
  const pos = geometry.attributes.position
  const col = geometry.attributes.color
  const span = Math.max(1e-5, maxY - minY)
  for (let i = 0; i < pos.count; i += 1) {
    const t = clamp((pos.getY(i) - minY) / span, 0, 1)
    const s = lerp(bottomScale, topScale, t)
    col.setXYZ(i, col.getX(i) * s, col.getY(i) * s, col.getZ(i) * s)
  }
  col.needsUpdate = true
  return geometry
}

function transformGeo(
  geometry,
  {
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
    ao = 1,
    tintR = 1,
    tintG = 1,
    tintB = 1,
  } = {}
) {
  if (sx !== 1 || sy !== 1 || sz !== 1) {
    geometry.scale(sx, sy, sz)
  }
  if (rx !== 0) geometry.rotateX(rx)
  if (ry !== 0) geometry.rotateY(ry)
  if (rz !== 0) geometry.rotateZ(rz)
  if (x !== 0 || y !== 0 || z !== 0) {
    geometry.translate(x, y, z)
  }
  ensureVertexColors(geometry, ao * tintR, ao * tintG, ao * tintB)
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

/**
 * Builds a smooth parametric lofted anatomical/garment tube across ordered
 * cross-section rings with support for pectoral/spine contours, cloth folds,
 * tilted rings, rounded joint caps, and welded UV-seam normals.
 */
export function buildLoftedPartGeometry(
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
  const spanY = Math.max(1e-5, maxY - minY)

  let vCursor = 0
  for (let rIdx = 0; rIdx < ringCount; rIdx += 1) {
    const ring = rings[rIdx]
    const cx = ring.x ?? 0
    const cy = ring.y
    const cz = ring.z ?? 0
    const rx = Math.max(0.0015, ring.rx)
    const rz = Math.max(0.0015, ring.rz)
    const exp = ring.superExp ?? 2.0
    const frontScale = ring.frontScale ?? 1.0
    const backScale = ring.backScale ?? 1.0
    const leftScale = ring.leftScale ?? 1.0
    const rightScale = ring.rightScale ?? 1.0
    const ringTiltX = ring.tiltX ?? tiltX
    const ringTiltZ = ring.tiltZ ?? 0
    const pec = ring.pectoral ?? 0
    const spineGroove = ring.spineGroove ?? 0
    const foldAmp = ring.foldAmp ?? 0
    const foldFreq = ring.foldFreq ?? 5
    const foldPhase = ring.foldPhase ?? 0
    const pinchFront = ring.pinchFront ?? 0
    const ao = ring.ao ?? 1.0
    const cr = ring.colorR ?? 1.0
    const cg = ring.colorG ?? 1.0
    const cb = ring.colorB ?? 1.0
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

      if (pec !== 0 && rawSin < 0) {
        const frontW = -rawSin
        const sternumDip = Math.exp(-Math.pow(rawCos / 0.24, 2))
        const pecLobe = Math.exp(-Math.pow((Math.abs(rawCos) - 0.5) / 0.34, 2))
        pz += frontW * pec * (sternumDip * 0.55 - pecLobe)
      }

      if (spineGroove !== 0 && rawSin > 0.3) {
        const furrow = Math.exp(-Math.pow(rawCos / 0.2, 2)) * rawSin
        pz -= furrow * spineGroove
      }

      if (pinchFront !== 0 && rawSin < -0.25) {
        const ridge = Math.exp(-Math.pow(rawCos / 0.32, 2)) * (-rawSin)
        px *= 1 - ridge * pinchFront
      }

      let foldShade = 1.0
      if (foldAmp !== 0) {
        const foldWave = Math.sin(theta * foldFreq + foldPhase)
        const scale = 1 + foldAmp * foldWave
        px *= scale
        pz *= scale
        foldShade += foldWave * Math.min(0.06, Math.abs(foldAmp) * 1.4)
      }

      const p = vCursor * 3
      const up = vCursor * 2
      positions[p] = cx + px
      positions[p + 1] = cy + pz * ringTiltX + px * ringTiltZ
      positions[p + 2] = cz + pz

      uvs[up] = frac * uRepeat
      uvs[up + 1] = vCoord

      const shade = clamp(ao * foldShade, 0.55, 1.05)
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
    const ao = (ring.ao ?? 1.0) * 0.9
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
    radialSegments = 8,
    radiusX = 0.015,
    radiusY = 0.008,
    taperStart = 0.7,
    taperMid = 1.0,
    taperEnd = 0.25,
    aoStart = 0.78,
    aoEnd = 1.0,
    upHint = [0, 0, -1],
    profileFn = null,
  } = {}
) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  )
  const rings = tubularSegments + 1
  const cols = radialSegments + 1
  const totalVerts = rings * cols + 2 + radialSegments * 2
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

    const baseProfile =
      t < 0.5
        ? lerp(taperStart, taperMid, smoothstep(0, 0.5, t))
        : lerp(taperMid, taperEnd, smoothstep(0.5, 1, t))
    const profile = profileFn ? profileFn(t, baseProfile) : baseProfile
    const rx = Math.max(0.001, radiusX * profile)
    const ry = Math.max(0.001, radiusY * profile)
    const ao = lerp(aoStart, aoEnd, t)

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
      colors[p] = ao
      colors[p + 1] = ao
      colors[p + 2] = ao
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

  const addEndCap = (ringIdx, isEnd) => {
    const ringStart = ringIdx * cols
    let cx = 0
    let cy = 0
    let cz = 0
    for (let s = 0; s < radialSegments; s += 1) {
      const idx = (ringStart + s) * 3
      cx += positions[idx]
      cy += positions[idx + 1]
      cz += positions[idx + 2]
    }
    cx /= radialSegments
    cy /= radialSegments
    cz /= radialSegments
    const ao = isEnd ? aoEnd * 0.92 : aoStart * 0.9
    const centerIdx = vCursor
    positions[centerIdx * 3] = cx
    positions[centerIdx * 3 + 1] = cy
    positions[centerIdx * 3 + 2] = cz
    uvs[centerIdx * 2] = 0.5
    uvs[centerIdx * 2 + 1] = isEnd ? 1 : 0
    colors[centerIdx * 3] = ao
    colors[centerIdx * 3 + 1] = ao
    colors[centerIdx * 3 + 2] = ao
    vCursor += 1

    const rimStart = vCursor
    for (let s = 0; s < radialSegments; s += 1) {
      const src = ringStart + s
      positions[vCursor * 3] = positions[src * 3]
      positions[vCursor * 3 + 1] = positions[src * 3 + 1]
      positions[vCursor * 3 + 2] = positions[src * 3 + 2]
      uvs[vCursor * 2] = 0.5
      uvs[vCursor * 2 + 1] = isEnd ? 1 : 0
      colors[vCursor * 3] = ao
      colors[vCursor * 3 + 1] = ao
      colors[vCursor * 3 + 2] = ao
      vCursor += 1
    }
    for (let s = 0; s < radialSegments; s += 1) {
      const next = (s + 1) % radialSegments
      if (isEnd) {
        indices.push(centerIdx, rimStart + next, rimStart + s)
      } else {
        indices.push(centerIdx, rimStart + s, rimStart + next)
      }
    }
  }

  addEndCap(0, false)
  addEndCap(tubularSegments, true)

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

function buildConformedPatch({
  thetaCenter = -Math.PI * 0.5,
  thetaSpan = 0.45,
  yMin = -0.05,
  yMax = 0.05,
  rx = 0.17,
  rz = 0.125,
  superExp = 2.2,
  thickness = 0.012,
  bevelDepth = 0.005,
  segsU = 6,
  segsV = 5,
  xOffset = 0,
  yOffset = 0,
  zOffset = 0,
  aoCenter = 0.98,
  aoEdge = 0.82,
  flapFold = 0,
} = {}) {
  const cols = segsU + 1
  const rows = segsV + 1
  const gridVerts = cols * rows
  const totalVerts = gridVerts * 2
  const positions = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const colors = new Float32Array(totalVerts * 3)
  const indices = []

  const evalPoint = (u, v, isOuter) => {
    const theta = thetaCenter + (u - 0.5) * thetaSpan
    const rawCos = Math.cos(theta)
    const rawSin = Math.sin(theta)
    const baseX = Math.sign(rawCos) * Math.pow(Math.abs(rawCos), 2 / superExp) * rx
    const baseZ = Math.sign(rawSin) * Math.pow(Math.abs(rawSin), 2 / superExp) * rz
    const nLen = Math.hypot(rawCos, rawSin) || 1
    const edgeDistU = 1 - Math.abs(u * 2 - 1)
    const edgeDistV = 1 - Math.abs(v * 2 - 1)
    const bevel = Math.min(1, Math.min(edgeDistU, edgeDistV) * 3.0)
    const puff = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * bevelDepth
    const fold = flapFold !== 0 ? Math.sin(u * Math.PI * 2) * flapFold * Math.sin(v * Math.PI) : 0
    const offset = isOuter ? thickness * (0.45 + 0.55 * bevel) + puff + fold : -0.003
    return {
      x: xOffset + baseX + (rawCos / nLen) * offset,
      y: yOffset + lerp(yMin, yMax, v),
      z: zOffset + baseZ + (rawSin / nLen) * offset,
      ao: isOuter ? lerp(aoEdge, aoCenter, bevel) : aoEdge * 0.85,
    }
  }

  for (let layer = 0; layer < 2; layer += 1) {
    const isOuter = layer === 0
    const baseIdx = layer * gridVerts
    for (let r = 0; r < rows; r += 1) {
      const v = r / segsV
      for (let c = 0; c < cols; c += 1) {
        const u = c / segsU
        const pt = evalPoint(u, v, isOuter)
        const idx = baseIdx + r * cols + c
        positions[idx * 3] = pt.x
        positions[idx * 3 + 1] = pt.y
        positions[idx * 3 + 2] = pt.z
        uvs[idx * 2] = u
        uvs[idx * 2 + 1] = v
        colors[idx * 3] = pt.ao
        colors[idx * 3 + 1] = pt.ao
        colors[idx * 3 + 2] = pt.ao
      }
    }
  }

  for (let r = 0; r < segsV; r += 1) {
    for (let c = 0; c < segsU; c += 1) {
      const a = r * cols + c
      const b = a + 1
      const cIdx = a + cols
      const d = cIdx + 1
      indices.push(a, b, cIdx, b, d, cIdx)

      const ia = gridVerts + a
      const ib = gridVerts + b
      const ic = gridVerts + cIdx
      const id = gridVerts + d
      indices.push(ia, ic, ib, ib, ic, id)
    }
  }

  for (let c = 0; c < segsU; c += 1) {
    const f0 = c
    const f1 = c + 1
    const b0 = gridVerts + f0
    const b1 = gridVerts + f1
    indices.push(f0, b0, f1, f1, b0, b1)
    const tf0 = segsV * cols + c
    const tf1 = tf0 + 1
    const tb0 = gridVerts + tf0
    const tb1 = gridVerts + tf1
    indices.push(tf0, tf1, tb0, tf1, tb1, tb0)
  }
  for (let r = 0; r < segsV; r += 1) {
    const lf0 = r * cols
    const lf1 = (r + 1) * cols
    const lb0 = gridVerts + lf0
    const lb1 = gridVerts + lf1
    indices.push(lf0, lf1, lb0, lf1, lb1, lb0)
    const rf0 = r * cols + segsU
    const rf1 = (r + 1) * cols + segsU
    const rb0 = gridVerts + rf0
    const rb1 = gridVerts + rf1
    indices.push(rf0, rb0, rf1, rf1, rb0, rb1)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(indices)
  recomputeNormalsSafe(geo, yOffset + (yMin + yMax) * 0.5, zOffset)
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

function buildRoundedBox(w, h, d, segs = 2, ao = 1) {
  const geo = new THREE.BoxGeometry(w, h, d, segs, segs, segs)
  if (segs >= 2) {
    const pos = geo.attributes.position
    const hw = w * 0.5
    const hh = h * 0.5
    const hd = d * 0.5
    for (let i = 0; i < pos.count; i += 1) {
      const vx = pos.getX(i)
      const vy = pos.getY(i)
      const vz = pos.getZ(i)
      const nx = vx / Math.max(1e-5, hw)
      const ny = vy / Math.max(1e-5, hh)
      const nz = vz / Math.max(1e-5, hd)
      const corner = Math.max(0, (nx * nx + ny * ny + nz * nz - 1.35) * 0.1)
      const scale = 1 - corner
      pos.setXYZ(i, vx * scale, vy * scale, vz * scale)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
  }
  return ensureVertexColors(geo, ao, ao, ao)
}

/**
 * Builds an anatomical 3D eyelid fold whose inner tarsal lip hugs the eyeball
 * surface with subtle thickness while its outer margin tucks cleanly back into
 * the recessed orbital socket so it never floats off the face.
 */
function buildEyelidShell({
  eyeX,
  eyeY,
  eyeZ,
  eyeRadius = 0.0108,
  isUpper = true,
  sign = 1,
}) {
  const cols = 10
  // Row 0 = inner eyeball rim (tucked slightly behind lid edge),
  // Row 1 = lash margin edge (3D tarsal plate thickness),
  // Rows 2..5 = outer eyelid crease & orbital socket tuck.
  const rows = 5
  const totalVerts = (cols + 1) * (rows + 1)
  const positions = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const colors = new Float32Array(totalVerts * 3)
  const indices = []

  const rLid = eyeRadius + 0.001
  for (let r = 0; r <= rows; r += 1) {
    const v = r / rows
    for (let c = 0; c <= cols; c += 1) {
      const u = c / cols
      // Almond eye aperture: slightly higher inner arch, gentle lateral taper
      const almond = Math.sin(u * Math.PI) * (0.94 + 0.14 * Math.sin((u - 0.18) * Math.PI))
      const yaw = lerp(-0.62 * sign, 0.66 * sign, u)
      const marginPitch = isUpper
        ? lerp(0.06, 0.34 * almond, almond)
        : -lerp(0.08, 0.3 * almond, almond)
      const outerPitch = isUpper
        ? lerp(0.18, 0.84 * almond, almond)
        : -lerp(0.16, 0.66 * almond, almond)

      const pitch =
        r === 0
          ? marginPitch
          : lerp(marginPitch, outerPitch, smoothstep(0.16, 1.0, v))

      // Row 0 tucks against sclera for real lid-margin thickness; rows 2..5 sweep back into socket
      const rr =
        r === 0
          ? eyeRadius - 0.0005
          : rLid + (isUpper ? Math.sin(v * Math.PI) * 0.0018 : Math.sin(v * Math.PI) * 0.0009)
      const socketTuckZ =
        r === 0
          ? 0.0014
          : Math.pow(smoothstep(0.16, 1.0, v), 1.3) * 0.0155 +
            Math.pow(Math.abs(u * 2 - 1), 2.2) * 0.0045

      const px = eyeX + Math.sin(yaw) * Math.cos(pitch) * rr
      const py = eyeY + Math.sin(pitch) * rr
      const pz = eyeZ - Math.cos(yaw) * Math.cos(pitch) * rr * 0.9 + socketTuckZ

      const idx = r * (cols + 1) + c
      positions[idx * 3] = px
      positions[idx * 3 + 1] = py
      positions[idx * 3 + 2] = pz
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = v

      const lashShade =
        r <= 1
          ? isUpper
            ? 0.48
            : 0.68
          : isUpper
            ? lerp(0.56, 0.92, smoothstep(0.2, 0.72, v))
            : lerp(0.74, 0.94, smoothstep(0.2, 0.72, v))
      colors[idx * 3] = lashShade
      colors[idx * 3 + 1] = lashShade * 0.95
      colors[idx * 3 + 2] = lashShade * 0.93
    }
  }

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = r * (cols + 1) + c
      const b = a + 1
      const cIdx = a + (cols + 1)
      const d = cIdx + 1
      if (isUpper) {
        indices.push(a, cIdx, b, b, cIdx, d)
      } else {
        indices.push(a, b, cIdx, b, d, cIdx)
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(indices)
  recomputeNormalsSafe(geo, eyeY, eyeZ + 0.008)
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

function buildSculptedNose(headCenterY, headCenterZ) {
  // Sculpted nasal bridge, radix dip, defined dorsum, tip, flared alae & recessed nostril cavities
  const nose = buildLoftedPartGeometry(
    [
      {
        y: -0.024,
        z: 0.004,
        rx: 0.0135,
        rz: 0.011,
        frontScale: 0.92,
        backScale: 0.85,
        ao: 0.62,
        colorR: 1.02,
        colorG: 0.95,
        colorB: 0.93,
      },
      {
        y: -0.017,
        z: -0.007,
        rx: 0.016,
        rz: 0.0145,
        superExp: 2.1,
        frontScale: 1.15,
        backScale: 0.75,
        foldAmp: 0.09,
        foldFreq: 2,
        foldPhase: -Math.PI * 0.5,
        ao: 0.9,
        colorR: 1.04,
        colorG: 0.97,
        colorB: 0.94,
      },
      {
        y: -0.0085,
        z: -0.0135,
        rx: 0.0096,
        rz: 0.0125,
        frontScale: 1.16,
        backScale: 0.85,
        pinchFront: 0.16,
        ao: 1.0,
        colorR: 1.03,
        colorG: 0.97,
        colorB: 0.95,
      },
      {
        y: 0.006,
        z: -0.0082,
        rx: 0.0076,
        rz: 0.0112,
        frontScale: 1.1,
        pinchFront: 0.24,
        ao: 0.98,
      },
      {
        y: 0.022,
        z: -0.0022,
        rx: 0.0074,
        rz: 0.0094,
        frontScale: 1.02,
        pinchFront: 0.2,
        ao: 0.92,
      },
      {
        y: 0.036,
        z: 0.0055,
        rx: 0.0105,
        rz: 0.0078,
        ao: 0.84,
      },
    ],
    { radialSegments: 14, capBottom: true, capTop: false }
  )

  const nostrilLeft = transformGeo(new THREE.SphereGeometry(0.0042, 8, 6), {
    x: -0.0068,
    y: -0.0215,
    z: -0.0078,
    sx: 0.9,
    sy: 0.55,
    sz: 1.15,
    ao: 0.36,
  })
  const nostrilRight = transformGeo(new THREE.SphereGeometry(0.0042, 8, 6), {
    x: 0.0068,
    y: -0.0215,
    z: -0.0078,
    sx: 0.9,
    sy: 0.55,
    sz: 1.15,
    ao: 0.36,
  })

  return transformGeo(mergeAndDispose([nose, nostrilLeft, nostrilRight]), {
    x: 0,
    y: headCenterY - 0.006,
    z: headCenterZ - 0.085,
  })
}

function buildSculptedLips(headCenterY, headCenterZ) {
  // Seamless upper & lower vermilion meeting cleanly at the oral parting crease
  const mouthLineY = headCenterY - 0.0445
  const mouthLineZ = headCenterZ - 0.0845

  const buildLipHalf = (isUpper) => {
    const segsU = 12
    const segsV = 5
    const cols = segsU + 1
    const rows = segsV + 1
    const totalVerts = cols * rows
    const positions = new Float32Array(totalVerts * 3)
    const uvs = new Float32Array(totalVerts * 2)
    const colors = new Float32Array(totalVerts * 3)
    const indices = []

    const lipWidth = isUpper ? 0.0235 : 0.0205

    for (let r = 0; r < rows; r += 1) {
      const v = r / segsV
      for (let c = 0; c < cols; c += 1) {
        const u = c / segsU
        const s = u * 2 - 1
        const absS = Math.abs(s)
        const taper = Math.sqrt(Math.max(0, 1 - absS * absS))

        const cupidsBow = isUpper
          ? (gaussian(s, -0.26, 0.22) +
              gaussian(s, 0.26, 0.22) -
              gaussian(s, 0, 0.16) * 0.48) *
            0.0022
          : 0
        const commissureDrop = absS * absS * 0.0014
        const heightSpan = isUpper
          ? (0.0046 * taper + cupidsBow) * v
          : -(0.0054 * taper) * v

        const archZ = absS * absS * 0.0088
        // v=0 tucks inside the mouth seam (+0.0025); v=0.45 swells forward; v=1 tucks into face (+0.003)
        const seamTuck = (1 - smoothstep(0.0, 0.32, v)) * 0.0028
        const outerTuck = smoothstep(0.72, 1.0, v) * 0.0032
        const plumpZ =
          Math.sin(smoothstep(0.08, 0.92, v) * Math.PI) *
            taper *
            (isUpper ? 0.0048 : 0.0052) -
          (isUpper ? 0.0008 : 0.0)

        const px = s * lipWidth
        const py = mouthLineY + heightSpan - commissureDrop
        const pz = mouthLineZ + archZ - plumpZ + seamTuck + outerTuck

        const idx = r * cols + c
        positions[idx * 3] = px
        positions[idx * 3 + 1] = py
        positions[idx * 3 + 2] = pz
        uvs[idx * 2] = u
        uvs[idx * 2 + 1] = v

        const cornerAO = 1 - smoothstep(0.52, 1.0, absS) * 0.26
        const seamAO = lerp(0.46, 1.0, smoothstep(0.0, 0.42, v))
        const edgeBlendAO = 1 - smoothstep(0.78, 1.0, v) * 0.1
        const ao = clamp(cornerAO * seamAO * edgeBlendAO, 0.42, 1.0)
        colors[idx * 3] = ao
        colors[idx * 3 + 1] = ao * 0.94
        colors[idx * 3 + 2] = ao * 0.92
      }
    }

    for (let r = 0; r < segsV; r += 1) {
      for (let c = 0; c < segsU; c += 1) {
        const a = r * cols + c
        const b = a + 1
        const cIdx = a + cols
        const d = cIdx + 1
        if (isUpper) {
          indices.push(a, b, cIdx, b, d, cIdx)
        } else {
          indices.push(a, cIdx, b, b, cIdx, d)
        }
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.setIndex(indices)
    recomputeNormalsSafe(geo, mouthLineY, mouthLineZ + 0.012)
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  }

  return [buildLipHalf(true), buildLipHalf(false)]
}

/**
 * Builds sculpted human head, anatomical face (temporal planes, supraorbital
 * brow ridge, deeply recessed eye sockets, zygomatic cheekbones, sculpted nose
 * with nostril recesses, 3D thickened eyelids, multi-tone iris/pupil/cornea,
 * seamless Cupid's-bow lips, crisp mandibular jawline & chin, integrated ears)
 * and smooth side-parted layered hair relative to `headPivot` (world y = 1.52m).
 * Eyes sit at local y = +0.136m (world 1.656m); hair crown tops at ~+0.275m (world ~1.795m).
 */
export function buildHeadSegmentGeometries() {
  const headCenterY = 0.132
  const headCenterZ = -0.008

  // 1. Adult male cranial vault & sculpted facial planes (~2,050 tris)
  const cranium = new THREE.SphereGeometry(1, 38, 28)
  const pos = cranium.attributes.position
  const craniumColors = new Float32Array(pos.count * 3)

  for (let i = 0; i < pos.count; i += 1) {
    const ux = pos.getX(i)
    const uy = pos.getY(i)
    const uz = pos.getZ(i)

    // Classic 1:7.75 adult male cranial proportions (20.8cm skull height + hair -> ~23.2cm)
    let sx = ux * 0.077
    let sy = uy * 0.104
    let sz = uz * 0.097

    const isFront = uz < 0
    const frontMask = smoothstep(0.08, -0.35, uz)

    // Temporal plane flattening + subtle parietal crown fullness
    const templePinch =
      gaussian(uy, 0.16, 0.26) *
      frontMask *
      smoothstep(0.42, 0.86, Math.abs(ux)) *
      0.13
    sx *= 1 - templePinch
    const parietalWidth = gaussian(uy, 0.44, 0.26) * smoothstep(-0.1, 0.45, uz) * 0.045
    sx *= 1 + parietalWidth
    if (uz > 0.15) {
      sz += gaussian(uy, 0.08, 0.46) * uz * 0.011
    }

    // Crisp mandibular jawline & gonial angle separating jaw from neck
    const lowerFaceMask = smoothstep(-0.04, -0.84, uy)
    const gonialAngle =
      gaussian(uy, -0.45, 0.17) *
      smoothstep(0.32, 0.74, Math.abs(ux)) *
      smoothstep(0.25, -0.42, uz)
    sx *= 1 - lowerFaceMask * 0.34
    sx += Math.sign(ux) * gonialAngle * 0.009

    if (isFront) {
      // Squared male chin / mental protuberance
      const chinMask =
        gaussian(uy, -0.76, 0.15) *
        gaussian(ux, 0, 0.31) *
        smoothstep(-0.35, -0.86, uz)
      sz -= chinMask * 0.0145
      sy -= chinMask * 0.0045

      // Supraorbital brow ridge + subtle glabella dip
      const glabellaDip = gaussian(ux, 0, 0.12) * 0.25
      const browMask =
        gaussian(uy, 0.2, 0.1) *
        smoothstep(-0.2, -0.76, uz) *
        (1 - smoothstep(0.64, 0.92, Math.abs(ux))) *
        (1 - glabellaDip)
      sz -= browMask * 0.0115

      // Deeply recessed orbital sockets for realistic eye framing
      const eyeDistL = Math.hypot((ux + 0.38) / 0.22, (uy - 0.05) / 0.15)
      const eyeDistR = Math.hypot((ux - 0.38) / 0.22, (uy - 0.05) / 0.15)
      const socketMask =
        (Math.exp(-(eyeDistL * eyeDistL)) + Math.exp(-(eyeDistR * eyeDistR))) *
        smoothstep(-0.35, -0.84, uz)
      sz += socketMask * 0.0175

      // Zygomatic cheekbones + malar fullness
      const cheekL = Math.exp(
        -(Math.pow((ux + 0.56) / 0.21, 2) + Math.pow((uy + 0.12) / 0.15, 2))
      )
      const cheekR = Math.exp(
        -(Math.pow((ux - 0.56) / 0.21, 2) + Math.pow((uy + 0.12) / 0.15, 2))
      )
      const cheekMask = (cheekL + cheekR) * smoothstep(-0.22, -0.8, uz)
      sz -= cheekMask * 0.0095
      sx += Math.sign(ux) * cheekMask * 0.004

      // Subtle buccal cheek hollow under zygomatic arch
      const hollowL = Math.exp(
        -(Math.pow((ux + 0.52) / 0.21, 2) + Math.pow((uy + 0.35) / 0.17, 2))
      )
      const hollowR = Math.exp(
        -(Math.pow((ux - 0.52) / 0.21, 2) + Math.pow((uy + 0.35) / 0.17, 2))
      )
      const hollowMask = (hollowL + hollowR) * smoothstep(-0.24, -0.76, uz)
      sx -= Math.sign(ux) * hollowMask * 0.0045
      sz += hollowMask * 0.004

      // Mouth / dental arch support + delicate philtrum furrow
      const mouthSupport =
        gaussian(uy, -0.44, 0.15) *
        gaussian(ux, 0, 0.32) *
        smoothstep(-0.44, -0.9, uz)
      sz -= mouthSupport * 0.0085
      const philtrum =
        gaussian(uy, -0.31, 0.08) *
        gaussian(ux, 0, 0.09) *
        smoothstep(-0.6, -0.95, uz)
      sz += philtrum * 0.0028
    }

    // Crisp submental tuck under chin & jaw border so skull never looks like an egg
    if (uy < -0.72) {
      const underChin = smoothstep(-0.72, -0.98, uy)
      sx *= 1 - underChin * 0.32
      sz *= 1 - underChin * 0.26
      sz += underChin * 0.013
      sy += underChin * 0.011
    }

    pos.setXYZ(i, sx, sy + headCenterY, sz + headCenterZ)

    let ao = 1.0
    let warmR = 1.0
    const warmG = 0.992
    let warmB = 0.988
    if (isFront) {
      const eL = Math.hypot((ux + 0.38) / 0.22, (uy - 0.05) / 0.15)
      const eR = Math.hypot((ux - 0.38) / 0.22, (uy - 0.05) / 0.15)
      const orbAO =
        (Math.exp(-(eL * eL)) + Math.exp(-(eR * eR))) *
        smoothstep(-0.38, -0.86, uz)
      ao -= orbAO * 0.26

      const cheekWarmth =
        (Math.exp(
          -(Math.pow((ux + 0.48) / 0.24, 2) + Math.pow((uy + 0.16) / 0.2, 2))
        ) +
          Math.exp(
            -(Math.pow((ux - 0.48) / 0.24, 2) + Math.pow((uy + 0.16) / 0.2, 2))
          )) *
        smoothstep(-0.3, -0.85, uz)
      warmR += cheekWarmth * 0.038
      warmB -= cheekWarmth * 0.028

      const jawShade =
        (Math.exp(
          -(Math.pow((ux + 0.46) / 0.24, 2) + Math.pow((uy + 0.38) / 0.2, 2))
        ) +
          Math.exp(
            -(Math.pow((ux - 0.46) / 0.24, 2) + Math.pow((uy + 0.38) / 0.2, 2))
          )) *
        smoothstep(-0.2, -0.85, uz)
      ao -= jawShade * 0.085
    }
    if (uy < -0.66) {
      ao -= smoothstep(-0.66, -0.96, uy) * 0.28
    }
    ao = clamp(ao, 0.62, 1.0)
    craniumColors[i * 3] = clamp(ao * warmR, 0.52, 1.0)
    craniumColors[i * 3 + 1] = clamp(ao * warmG, 0.52, 1.0)
    craniumColors[i * 3 + 2] = clamp(ao * warmB, 0.52, 1.0)
  }
  pos.needsUpdate = true
  cranium.setAttribute('color', new THREE.BufferAttribute(craniumColors, 3))
  recomputeNormalsSafe(cranium, headCenterY, headCenterZ)

  // 2. Sculpted nose with radix, dorsum, tip, flared alae & nostril recesses
  const nose = buildSculptedNose(headCenterY, headCenterZ)

  // 3. Integrated 3D eyelids + detailed ears (helix + antihelix + concha + lobe)
  const skinParts = [cranium, nose]
  const eyeY = headCenterY + 0.004
  const eyeZ = headCenterZ - 0.0775

  for (const sign of [-1, 1]) {
    const eyeX = sign * 0.031

    skinParts.push(
      buildEyelidShell({ eyeX, eyeY, eyeZ, eyeRadius: 0.0108, isUpper: true, sign }),
      buildEyelidShell({ eyeX, eyeY, eyeZ, eyeRadius: 0.0108, isUpper: false, sign })
    )

    const earHelix = buildSplineLoft(
      [
        [sign * 0.073, headCenterY + 0.008, headCenterZ + 0.001],
        [sign * 0.08, headCenterY + 0.02, headCenterZ + 0.009],
        [sign * 0.081, headCenterY + 0.005, headCenterZ + 0.019],
        [sign * 0.078, headCenterY - 0.013, headCenterZ + 0.015],
        [sign * 0.073, headCenterY - 0.02, headCenterZ + 0.006],
      ],
      {
        tubularSegments: 8,
        radialSegments: 6,
        radiusX: 0.004,
        radiusY: 0.005,
        taperStart: 0.65,
        taperMid: 1.0,
        taperEnd: 0.92,
        aoStart: 0.84,
        aoEnd: 0.9,
        upHint: [sign, 0, 0],
      }
    )
    const earAntihelix = buildSplineLoft(
      [
        [sign * 0.075, headCenterY + 0.01, headCenterZ + 0.008],
        [sign * 0.077, headCenterY + 0.001, headCenterZ + 0.013],
        [sign * 0.075, headCenterY - 0.009, headCenterZ + 0.01],
      ],
      {
        tubularSegments: 4,
        radialSegments: 5,
        radiusX: 0.0026,
        radiusY: 0.0032,
        taperStart: 0.75,
        taperMid: 1.0,
        taperEnd: 0.75,
        aoStart: 0.82,
        aoEnd: 0.86,
        upHint: [sign, 0, 0],
      }
    )
    const earConcha = transformGeo(new THREE.SphereGeometry(0.011, 8, 6), {
      x: sign * 0.073,
      y: headCenterY + 0.001,
      z: headCenterZ + 0.01,
      ry: sign * 0.25,
      sx: 0.32,
      sy: 1.12,
      sz: 0.78,
      ao: 0.72,
      tintR: 1.04,
      tintG: 0.95,
      tintB: 0.93,
    })
    skinParts.push(earHelix, earAntihelix, earConcha)
  }

  // 4. Lifelike Recessed Eyes (upper-lid shaded sclera + radial-fiber iris + pupil + glint)
  const scleraParts = []
  const irisParts = []
  for (const sign of [-1, 1]) {
    const eyeX = sign * 0.031

    const scleraGeo = new THREE.SphereGeometry(0.0108, 12, 10)
    const sPos = scleraGeo.attributes.position
    const sCols = new Float32Array(sPos.count * 3)
    for (let i = 0; i < sPos.count; i += 1) {
      const ex = sPos.getX(i) / 0.0108
      const ey = sPos.getY(i) / 0.0108
      const ez = sPos.getZ(i) / 0.0108
      const topShadow = ey > 0.16 ? smoothstep(0.16, 0.78, ey) * 0.26 : 0
      const cornerShade = smoothstep(0.42, 0.95, Math.abs(ex)) * 0.16
      const val = clamp(1.0 - topShadow - cornerShade, 0.64, 1.0)
      sCols[i * 3] = val
      sCols[i * 3 + 1] = val * (1 - cornerShade * 0.28)
      sCols[i * 3 + 2] = val * (1 - cornerShade * 0.34)
      if (ez > 0.45) {
        sCols[i * 3] *= 0.82
        sCols[i * 3 + 1] *= 0.82
        sCols[i * 3 + 2] *= 0.82
      }
    }
    scleraGeo.setAttribute('color', new THREE.BufferAttribute(sCols, 3))
    scleraParts.push(
      transformGeo(scleraGeo, {
        x: eyeX,
        y: eyeY,
        z: eyeZ,
        sz: 0.9,
      })
    )

    const irisGeo = new THREE.SphereGeometry(0.0056, 12, 10)
    const iPos = irisGeo.attributes.position
    const irisColors = new Float32Array(iPos.count * 3)
    for (let i = 0; i < iPos.count; i += 1) {
      const ix = iPos.getX(i)
      const iy = iPos.getY(i)
      const iz = iPos.getZ(i)
      const radial = Math.hypot(ix, iy) / 0.0056
      const angle = Math.atan2(iy, ix)
      let ir = 0.92
      let ig = 0.95
      let ib = 0.98
      if (iz < 0) {
        if (radial < 0.38) {
          ir = 0.08
          ig = 0.08
          ib = 0.09
        } else if (radial < 0.52) {
          // Subtle warm peripupillary collarette ring
          ir = 0.95
          ig = 0.86
          ib = 0.72
        } else if (radial > 0.82) {
          // Dark limbal border ring
          ir = 0.3
          ig = 0.34
          ib = 0.38
        } else {
          const fiber = 0.86 + Math.sin(angle * 14) * 0.09
          ir = fiber * 0.94
          ig = fiber * 0.98
          ib = fiber * 1.02
        }
        // Subtle upper-left corneal catchlight glint
        const glint = Math.exp(
          -(Math.pow((ix / 0.0056 + 0.3) / 0.2, 2) + Math.pow((iy / 0.0056 - 0.34) / 0.2, 2))
        )
        ir = clamp(ir + glint * 0.55, 0.06, 1.0)
        ig = clamp(ig + glint * 0.55, 0.06, 1.0)
        ib = clamp(ib + glint * 0.58, 0.06, 1.0)
      }
      irisColors[i * 3] = ir
      irisColors[i * 3 + 1] = ig
      irisColors[i * 3 + 2] = ib
    }
    irisGeo.setAttribute('color', new THREE.BufferAttribute(irisColors, 3))
    irisParts.push(
      transformGeo(irisGeo, {
        x: eyeX,
        y: eyeY,
        z: eyeZ - 0.0064,
        sz: 0.54,
      })
    )
  }

  // 5. Seamless Sculpted Lips
  const lipParts = buildSculptedLips(headCenterY, headCenterZ)

  // 6. Smooth Natural Side-Parted Layered Hair (zero jagged step border)
  const hairCap = new THREE.SphereGeometry(1, 30, 22)
  const hPos = hairCap.attributes.position
  const hairColors = new Float32Array(hPos.count * 3)

  for (let i = 0; i < hPos.count; i += 1) {
    const ux = hPos.getX(i)
    const uy = hPos.getY(i)
    const uz = hPos.getZ(i)

    const partOffset = gaussian(ux + 0.32, 0, 0.14) * 0.08
    const widowPeak = gaussian(ux - 0.03, 0, 0.22) * 0.075
    const frontHairlineY =
      0.43 - widowPeak + partOffset + smoothstep(0.32, 0.82, Math.abs(ux)) * -0.34
    const backNapeY = -0.54
    const hairlineThresholdY = lerp(
      frontHairlineY,
      backNapeY,
      smoothstep(-0.28, 0.45, uz)
    )

    // Smooth two-stage feathering across the hairline eliminates sawtooth edges while keeping lower face/chin completely clear
    const hairlineDelta = uy - hairlineThresholdY
    const hairBlend = smoothstep(-0.07, 0.09, hairlineDelta)
    const innerTuck = smoothstep(-0.36, -0.1, hairlineDelta)
    const angleFromCrown = Math.atan2(ux - 0.12, uz - 0.25)
    const wave =
      Math.sin(angleFromCrown * 10 + uy * 4.5) * 0.015 * smoothstep(-0.08, 0.72, uy)
    const targetScale =
      1.06 +
      gaussian(uy, 0.76, 0.42) * 0.065 +
      gaussian(uz, 0.32, 0.45) * 0.025 +
      wave
    const baseInnerScale = lerp(0.8, 0.95, innerTuck)
    const radialScale = lerp(baseInnerScale, targetScale, hairBlend)

    const sx = ux * 0.079 * radialScale
    const sy = uy * 0.108 * lerp(baseInnerScale, radialScale, hairBlend)
    const sz = uz * 0.099 * radialScale

    hPos.setXYZ(i, sx, sy + headCenterY + 0.005, sz + headCenterZ + 0.004)

    const crownHighlight = 0.85 + smoothstep(0.05, 0.9, uy) * 0.17 + wave * 2.1
    const napeShade = uz > 0.2 && uy < -0.04 ? 0.78 : 1.0
    const shade = clamp(crownHighlight * napeShade, 0.68, 1.04)
    hairColors[i * 3] = shade
    hairColors[i * 3 + 1] = shade
    hairColors[i * 3 + 2] = shade
  }
  hPos.needsUpdate = true
  hairCap.setAttribute('color', new THREE.BufferAttribute(hairColors, 3))
  recomputeNormalsSafe(hairCap, headCenterY + 0.005, headCenterZ + 0.004)

  const hairParts = [hairCap]

  // Layered organic hair locks with natural curvature, side-part sweep & sideburn taper
  const curvedLocks = [
    // Forehead swept locks from left side-part
    {
      pts: [
        [-0.032, 0.106, -0.064],
        [-0.008, 0.098, -0.085],
        [0.022, 0.082, -0.09],
        [0.048, 0.064, -0.079],
      ],
      rx: 0.015,
      ry: 0.0062,
    },
    {
      pts: [
        [-0.046, 0.098, -0.058],
        [-0.026, 0.086, -0.081],
        [0.002, 0.068, -0.091],
        [0.024, 0.054, -0.087],
      ],
      rx: 0.013,
      ry: 0.0058,
    },
    {
      pts: [
        [-0.012, 0.118, -0.044],
        [0.015, 0.11, -0.071],
        [0.044, 0.09, -0.081],
        [0.063, 0.066, -0.066],
      ],
      rx: 0.016,
      ry: 0.0068,
    },
    // Left & right temple sweeps
    {
      pts: [
        [-0.036, 0.106, -0.05],
        [-0.057, 0.085, -0.066],
        [-0.069, 0.056, -0.06],
        [-0.072, 0.024, -0.04],
      ],
      rx: 0.012,
      ry: 0.0052,
    },
    {
      pts: [
        [0.038, 0.103, -0.04],
        [0.061, 0.08, -0.054],
        [0.071, 0.05, -0.044],
        [0.073, 0.018, -0.026],
      ],
      rx: 0.013,
      ry: 0.0052,
    },
    // Crown volume & occipital layers
    {
      pts: [
        [-0.028, 0.123, -0.02],
        [-0.004, 0.132, 0.01],
        [0.02, 0.124, 0.045],
        [0.035, 0.1, 0.076],
      ],
      rx: 0.022,
      ry: 0.0076,
    },
    {
      pts: [
        [0.012, 0.126, -0.022],
        [0.032, 0.128, 0.01],
        [0.048, 0.112, 0.048],
        [0.054, 0.082, 0.08],
      ],
      rx: 0.02,
      ry: 0.0072,
    },
    {
      pts: [
        [-0.048, 0.11, -0.004],
        [-0.059, 0.101, 0.03],
        [-0.057, 0.076, 0.066],
        [-0.044, 0.038, 0.09],
      ],
      rx: 0.018,
      ry: 0.0062,
    },
    {
      pts: [
        [-0.015, 0.104, 0.066],
        [-0.012, 0.065, 0.094],
        [-0.008, 0.018, 0.1],
        [-0.004, -0.028, 0.091],
      ],
      rx: 0.022,
      ry: 0.0068,
    },
    {
      pts: [
        [0.022, 0.101, 0.064],
        [0.026, 0.061, 0.09],
        [0.022, 0.014, 0.096],
        [0.016, -0.03, 0.088],
      ],
      rx: 0.02,
      ry: 0.0065,
    },
    // Tapered sideburns
    {
      pts: [
        [-0.071, 0.034, -0.02],
        [-0.073, 0.014, -0.015],
        [-0.071, -0.008, -0.011],
      ],
      rx: 0.0066,
      ry: 0.0036,
    },
    {
      pts: [
        [0.071, 0.034, -0.02],
        [0.073, 0.014, -0.015],
        [0.071, -0.008, -0.011],
      ],
      rx: 0.0066,
      ry: 0.0036,
    },
  ]

  for (const l of curvedLocks) {
    const worldPts = l.pts.map((p) => [
      p[0],
      headCenterY + p[1],
      headCenterZ + p[2],
    ])
    hairParts.push(
      buildSplineLoft(worldPts, {
        tubularSegments: 7,
        radialSegments: 6,
        radiusX: l.rx,
        radiusY: l.ry,
        taperStart: 0.65,
        taperMid: 1.0,
        taperEnd: 0.2,
        aoStart: 0.82,
        aoEnd: 1.0,
      })
    )
  }

  // Anatomical sculpted eyebrows seated cleanly on the supraorbital ridge
  for (const sign of [-1, 1]) {
    hairParts.push(
      buildSplineLoft(
        [
          [sign * 0.012, headCenterY + 0.0185, headCenterZ - 0.0865],
          [sign * 0.028, headCenterY + 0.0225, headCenterZ - 0.085],
          [sign * 0.045, headCenterY + 0.0195, headCenterZ - 0.0765],
        ],
        {
          tubularSegments: 6,
          radialSegments: 6,
          radiusX: 0.0044,
          radiusY: 0.0028,
          taperStart: 0.92,
          taperMid: 1.0,
          taperEnd: 0.28,
          aoStart: 0.88,
          aoEnd: 0.8,
        }
      )
    )
  }

  return {
    skin: mergeAndDispose(skinParts),
    lips: mergeAndDispose(lipParts),
    hair: mergeAndDispose(hairParts),
    eyesSclera: mergeAndDispose(scleraParts),
    eyesIris: mergeAndDispose(irisParts),
  }
}

/**
 * Builds sculpted anatomical neck relative to `neckPivot` (world y = 1.43m)
 * with flared trapezius base, sternocleidomastoid contour, subtle Adam's apple,
 * and natural forward cervical posture.
 */
export function buildNeckGeometry() {
  return buildLoftedPartGeometry(
    [
      {
        y: -0.055,
        z: 0.008,
        rx: 0.082,
        rz: 0.068,
        backScale: 1.08,
        ao: 0.72,
      },
      {
        y: -0.018,
        z: 0.004,
        rx: 0.06,
        rz: 0.057,
        backScale: 1.06,
        ao: 0.8,
      },
      {
        y: 0.018,
        z: 0.001,
        rx: 0.049,
        rz: 0.052,
        superExp: 1.95,
        frontScale: 1.06,
        ao: 0.88,
      },
      {
        y: 0.052,
        z: -0.003,
        rx: 0.047,
        rz: 0.051,
        superExp: 1.95,
        frontScale: 1.1,
        pinchFront: 0.16,
        ao: 0.92,
        colorR: 1.01,
        colorG: 0.99,
        colorB: 0.98,
      },
      {
        y: 0.088,
        z: -0.006,
        rx: 0.047,
        rz: 0.052,
        frontScale: 1.04,
        ao: 0.84,
      },
      {
        y: 0.128,
        z: -0.008,
        rx: 0.049,
        rz: 0.054,
        ao: 0.74,
      },
      {
        y: 0.158,
        z: -0.009,
        rx: 0.046,
        rz: 0.052,
        ao: 0.64,
      },
    ],
    { radialSegments: 16, uRepeat: 1, vRepeat: 1 }
  )
}

/**
 * Builds pelvis trousers bridge, contoured leather belt, and framed metallic buckle
 * relative to `pelvisPivot` (world y = 0.92m).
 */
export function buildPelvisGeometries() {
  const pelvis = buildLoftedPartGeometry(
    [
      {
        y: -0.072,
        z: 0.003,
        rx: 0.148,
        rz: 0.104,
        superExp: 2.18,
        backScale: 1.14,
        ao: 0.78,
      },
      {
        y: -0.025,
        z: 0.002,
        rx: 0.156,
        rz: 0.11,
        superExp: 2.22,
        backScale: 1.16,
        foldAmp: 0.014,
        foldFreq: 4,
        ao: 0.92,
      },
      {
        y: 0.022,
        z: 0.0,
        rx: 0.155,
        rz: 0.109,
        superExp: 2.22,
        backScale: 1.12,
        foldAmp: 0.01,
        foldFreq: 5,
        ao: 0.95,
      },
      {
        y: 0.058,
        z: -0.002,
        rx: 0.148,
        rz: 0.104,
        superExp: 2.15,
        backScale: 1.06,
        ao: 0.88,
      },
      {
        y: 0.078,
        z: -0.002,
        rx: 0.142,
        rz: 0.1,
        superExp: 2.15,
        ao: 0.8,
      },
    ],
    { radialSegments: 20, uRepeat: 2, vRepeat: 0.65 }
  )

  const belt = buildLoftedPartGeometry(
    [
      { y: 0.034, z: -0.002, rx: 0.154, rz: 0.11, superExp: 2.22, ao: 0.82 },
      { y: 0.072, z: -0.002, rx: 0.152, rz: 0.109, superExp: 2.22, ao: 0.96 },
    ],
    { radialSegments: 20, uRepeat: 3, vRepeat: 0.3 }
  )

  const bucklePlate = buildConformedPatch({
    thetaCenter: -Math.PI * 0.5,
    thetaSpan: 0.36,
    yMin: 0.033,
    yMax: 0.073,
    rx: 0.154,
    rz: 0.11,
    superExp: 2.22,
    thickness: 0.008,
    bevelDepth: 0.003,
    segsU: 5,
    segsV: 3,
    zOffset: -0.002,
    aoCenter: 0.98,
    aoEdge: 0.8,
  })
  const beltKeeper = buildConformedPatch({
    thetaCenter: -Math.PI * 0.5 - 0.28,
    thetaSpan: 0.09,
    yMin: 0.031,
    yMax: 0.075,
    rx: 0.154,
    rz: 0.11,
    superExp: 2.22,
    thickness: 0.009,
    bevelDepth: 0.002,
    segsU: 3,
    segsV: 2,
    zOffset: -0.002,
    aoCenter: 0.92,
    aoEdge: 0.78,
  })

  return {
    trousers: pelvis,
    belt,
    hardware: mergeAndDispose([bucklePlate, beltKeeper]),
  }
}

/**
 * Builds sculpted jacket torso with sloped trapezius shoulder yoke, open-V
 * folded collar with inner lapel facing, conformed chest bellows pockets,
 * zipper hardware, and ergonomically contoured explorer backpack relative to
 * `spinePivot` (world y = 0.97m). Preserves front chest clearance for spotlight
 * at z = -0.45m.
 */
export function buildTorsoAndBackpackGeometries() {
  // Athletic V-taper explorer field jacket (world y ~ 0.868 .. 1.426m)
  const torso = buildLoftedPartGeometry(
    [
      {
        y: -0.102,
        z: 0.004,
        rx: 0.164,
        rz: 0.118,
        superExp: 2.2,
        backScale: 1.07,
        foldAmp: 0.016,
        foldFreq: 6,
        foldPhase: 0.4,
        ao: 0.76,
      },
      {
        y: -0.045,
        z: 0.002,
        rx: 0.152,
        rz: 0.11,
        superExp: 2.18,
        backScale: 1.05,
        foldAmp: 0.017,
        foldFreq: 5,
        foldPhase: 1.1,
        ao: 0.88,
      },
      {
        y: 0.02,
        z: -0.001,
        rx: 0.147,
        rz: 0.107,
        superExp: 2.15,
        backScale: 1.04,
        foldAmp: 0.014,
        foldFreq: 5,
        foldPhase: 2.0,
        ao: 0.93,
      },
      {
        y: 0.095,
        z: -0.004,
        rx: 0.16,
        rz: 0.115,
        superExp: 2.2,
        pectoral: 0.007,
        spineGroove: 0.007,
        foldAmp: 0.01,
        foldFreq: 4,
        ao: 0.96,
      },
      {
        y: 0.21,
        z: -0.008,
        rx: 0.175,
        rz: 0.126,
        superExp: 2.28,
        frontScale: 1.07,
        pectoral: 0.013,
        spineGroove: 0.01,
        ao: 1.0,
      },
      {
        y: 0.325,
        z: -0.007,
        rx: 0.181,
        rz: 0.123,
        superExp: 2.3,
        frontScale: 1.05,
        pectoral: 0.011,
        spineGroove: 0.009,
        ao: 0.99,
      },
      {
        y: 0.388,
        z: -0.003,
        rx: 0.164,
        rz: 0.11,
        superExp: 2.22,
        backScale: 1.04,
        ao: 0.94,
      },
      {
        y: 0.428,
        z: 0.0,
        rx: 0.124,
        rz: 0.09,
        superExp: 2.1,
        ao: 0.88,
      },
      {
        y: 0.456,
        z: 0.002,
        rx: 0.08,
        rz: 0.072,
        ao: 0.78,
      },
    ],
    { radialSegments: 22, uRepeat: 2.4, vRepeat: 2.0 }
  )

  // Folded turned-down jacket collar curving smoothly around neck opening
  const collarPoints = []
  const collarSteps = 14
  for (let i = 0; i <= collarSteps; i += 1) {
    const t = i / collarSteps
    const angle = lerp(-Math.PI * 0.42, Math.PI * 1.42, t)
    const archFactor = Math.sin(t * Math.PI)
    collarPoints.push([
      Math.cos(angle) * 0.079,
      0.458 + archFactor * 0.016 - (1 - archFactor) * 0.018,
      0.002 + Math.sin(angle) * 0.075,
    ])
  }
  const collar = buildSplineLoft(collarPoints, {
    tubularSegments: 16,
    radialSegments: 8,
    radiusX: 0.0165,
    radiusY: 0.0135,
    taperStart: 0.65,
    taperMid: 1.05,
    taperEnd: 0.65,
    aoStart: 0.84,
    aoEnd: 0.84,
    upHint: [0, 1, 0],
  })

  // Contoured front storm placket + inner throat V-facing
  const placket = buildConformedPatch({
    thetaCenter: -Math.PI * 0.52,
    thetaSpan: 0.18,
    yMin: -0.088,
    yMax: 0.402,
    rx: 0.167,
    rz: 0.123,
    superExp: 2.25,
    thickness: 0.0075,
    bevelDepth: 0.003,
    segsU: 4,
    segsV: 10,
    zOffset: -0.005,
    aoCenter: 0.95,
    aoEdge: 0.8,
  })
  const innerFacing = buildConformedPatch({
    thetaCenter: -Math.PI * 0.5,
    thetaSpan: 0.42,
    yMin: 0.39,
    yMax: 0.448,
    rx: 0.086,
    rz: 0.074,
    superExp: 2.1,
    thickness: 0.005,
    bevelDepth: 0.002,
    segsU: 4,
    segsV: 3,
    zOffset: -0.002,
    aoCenter: 0.64,
    aoEdge: 0.56,
  })

  const jacketParts = [torso, collar, placket, innerFacing]

  // Conformed chest bellows pockets with flaps + angled lower side pocket welts
  for (const sign of [-1, 1]) {
    const thetaPos = -Math.PI * 0.5 + sign * 0.52
    const chestPocket = buildConformedPatch({
      thetaCenter: thetaPos,
      thetaSpan: 0.42,
      yMin: 0.185,
      yMax: 0.278,
      rx: 0.174,
      rz: 0.128,
      superExp: 2.28,
      thickness: 0.011,
      bevelDepth: 0.005,
      segsU: 6,
      segsV: 5,
      zOffset: -0.007,
      aoCenter: 0.97,
      aoEdge: 0.8,
      flapFold: 0.0024,
    })
    const chestFlap = buildConformedPatch({
      thetaCenter: thetaPos,
      thetaSpan: 0.44,
      yMin: 0.264,
      yMax: 0.294,
      rx: 0.175,
      rz: 0.129,
      superExp: 2.28,
      thickness: 0.014,
      bevelDepth: 0.003,
      segsU: 6,
      segsV: 3,
      zOffset: -0.007,
      aoCenter: 1.0,
      aoEdge: 0.82,
    })
    const sideWelt = buildConformedPatch({
      thetaCenter: -Math.PI * 0.5 + sign * 0.82,
      thetaSpan: 0.16,
      yMin: -0.025,
      yMax: 0.068,
      rx: 0.156,
      rz: 0.113,
      superExp: 2.18,
      thickness: 0.01,
      bevelDepth: 0.002,
      segsU: 3,
      segsV: 5,
      zOffset: -0.002,
      aoCenter: 0.9,
      aoEdge: 0.76,
    })
    jacketParts.push(chestPocket, chestFlap, sideWelt)
  }

  // Spine-hugging contoured expedition backpack on +Z (z ~ +0.12 .. +0.305)
  const packMain = buildLoftedPartGeometry(
    [
      {
        y: 0.028,
        z: 0.204,
        rx: 0.126,
        rz: 0.074,
        superExp: 2.5,
        frontScale: 0.86,
        backScale: 1.08,
        foldAmp: 0.018,
        foldFreq: 5,
        ao: 0.82,
      },
      {
        y: 0.155,
        z: 0.214,
        rx: 0.136,
        rz: 0.084,
        superExp: 2.45,
        frontScale: 0.86,
        backScale: 1.1,
        foldAmp: 0.016,
        foldFreq: 4,
        ao: 0.96,
      },
      {
        y: 0.315,
        z: 0.205,
        rx: 0.13,
        rz: 0.078,
        superExp: 2.4,
        frontScale: 0.88,
        backScale: 1.06,
        ao: 0.95,
      },
      {
        y: 0.405,
        z: 0.186,
        rx: 0.106,
        rz: 0.064,
        superExp: 2.25,
        ao: 0.88,
      },
    ],
    { radialSegments: 18, uRepeat: 2, vRepeat: 1.5 }
  )

  const packTopHood = buildConformedPatch({
    thetaCenter: Math.PI * 0.5,
    thetaSpan: 1.95,
    yMin: 0.34,
    yMax: 0.422,
    rx: 0.132,
    rz: 0.084,
    superExp: 2.35,
    thickness: 0.014,
    bevelDepth: 0.009,
    segsU: 8,
    segsV: 5,
    zOffset: 0.205,
    aoCenter: 0.98,
    aoEdge: 0.82,
    flapFold: 0.0025,
  })

  const packRearPocket = buildConformedPatch({
    thetaCenter: Math.PI * 0.5,
    thetaSpan: 1.45,
    yMin: 0.075,
    yMax: 0.245,
    rx: 0.132,
    rz: 0.088,
    superExp: 2.4,
    thickness: 0.022,
    bevelDepth: 0.011,
    segsU: 7,
    segsV: 6,
    zOffset: 0.215,
    aoCenter: 0.98,
    aoEdge: 0.78,
    flapFold: 0.002,
  })

  const bedroll = transformGeo(
    buildLoftedPartGeometry(
      [
        { y: -0.135, rx: 0.044, rz: 0.044, foldAmp: 0.03, foldFreq: 4, ao: 0.84 },
        { y: -0.06, rx: 0.049, rz: 0.049, foldAmp: 0.018, foldFreq: 5, ao: 0.98 },
        { y: 0.0, rx: 0.048, rz: 0.048, ao: 1.0 },
        { y: 0.06, rx: 0.049, rz: 0.049, foldAmp: 0.018, foldFreq: 5, ao: 0.98 },
        { y: 0.135, rx: 0.044, rz: 0.044, foldAmp: 0.03, foldFreq: 4, ao: 0.84 },
      ],
      { radialSegments: 14, uRepeat: 1.5, vRepeat: 1.5 }
    ),
    { x: 0, y: 0.435, z: 0.195, rz: Math.PI / 2 }
  )

  const backpackParts = [packMain, packTopHood, packRearPocket, bedroll]
  const hardwareParts = []

  // Side pouches, contoured S-curve shoulder straps over deltoid-chest, bedroll straps & buckles
  for (const sign of [-1, 1]) {
    const sidePouch = buildConformedPatch({
      thetaCenter: sign === -1 ? Math.PI : 0,
      thetaSpan: 0.9,
      yMin: 0.085,
      yMax: 0.245,
      rx: 0.138,
      rz: 0.082,
      superExp: 2.35,
      thickness: 0.024,
      bevelDepth: 0.01,
      segsU: 5,
      segsV: 5,
      zOffset: 0.205,
      aoCenter: 0.96,
      aoEdge: 0.78,
    })

    const shoulderHarness = buildSplineLoft(
      [
        [sign * 0.072, 0.35, 0.125],
        [sign * 0.098, 0.415, 0.045],
        [sign * 0.114, 0.39, -0.056],
        [sign * 0.106, 0.295, -0.125],
        [sign * 0.102, 0.175, -0.132],
        [sign * 0.118, 0.075, -0.111],
      ],
      {
        tubularSegments: 14,
        radialSegments: 6,
        radiusX: 0.02,
        radiusY: 0.007,
        taperStart: 0.85,
        taperMid: 1.0,
        taperEnd: 0.72,
        aoStart: 0.84,
        aoEnd: 0.88,
        upHint: [0, 0, -1],
      }
    )

    const rearStrap = buildSplineLoft(
      [
        [sign * 0.062, 0.365, 0.265],
        [sign * 0.065, 0.24, 0.305],
        [sign * 0.064, 0.1, 0.298],
      ],
      {
        tubularSegments: 8,
        radialSegments: 6,
        radiusX: 0.012,
        radiusY: 0.005,
        taperStart: 0.9,
        taperMid: 1.0,
        taperEnd: 0.9,
        aoStart: 0.85,
        aoEnd: 0.88,
      }
    )

    // Compression strap cinching the bedroll onto the top of the pack
    const bedrollStrap = buildSplineLoft(
      [
        [sign * 0.075, 0.405, 0.155],
        [sign * 0.075, 0.482, 0.18],
        [sign * 0.075, 0.478, 0.232],
        [sign * 0.075, 0.405, 0.245],
      ],
      {
        tubularSegments: 8,
        radialSegments: 5,
        radiusX: 0.009,
        radiusY: 0.004,
        taperStart: 0.92,
        taperMid: 1.0,
        taperEnd: 0.92,
        aoStart: 0.86,
        aoEnd: 0.86,
      }
    )

    backpackParts.push(sidePouch, shoulderHarness, rearStrap, bedrollStrap)

    hardwareParts.push(
      transformGeo(buildRoundedBox(0.036, 0.024, 0.014, 1, 0.96), {
        x: sign * 0.103,
        y: 0.185,
        z: -0.135,
        ry: sign * -0.24,
      }),
      transformGeo(buildRoundedBox(0.03, 0.02, 0.016, 1, 0.96), {
        x: sign * 0.064,
        y: 0.265,
        z: 0.308,
      })
    )
  }

  // Contoured sternum cross-strap & front zipper track + slider
  const sternumStrap = buildSplineLoft(
    [
      [-0.102, 0.24, -0.13],
      [-0.045, 0.24, -0.14],
      [0.0, 0.24, -0.142],
      [0.045, 0.24, -0.14],
      [0.102, 0.24, -0.13],
    ],
    {
      tubularSegments: 8,
      radialSegments: 6,
      radiusX: 0.011,
      radiusY: 0.005,
      taperStart: 0.95,
      taperMid: 1.0,
      taperEnd: 0.95,
      aoStart: 0.88,
      aoEnd: 0.88,
      upHint: [0, 1, 0],
    }
  )
  backpackParts.push(sternumStrap)

  const zipperTrack = buildSplineLoft(
    [
      [0.006, -0.07, -0.129],
      [0.006, 0.08, -0.134],
      [0.006, 0.23, -0.142],
      [0.006, 0.38, -0.132],
    ],
    {
      tubularSegments: 10,
      radialSegments: 6,
      radiusX: 0.005,
      radiusY: 0.004,
      taperStart: 0.9,
      taperMid: 1.0,
      taperEnd: 0.9,
      aoStart: 0.9,
      aoEnd: 0.94,
    }
  )
  hardwareParts.push(
    zipperTrack,
    transformGeo(buildRoundedBox(0.018, 0.022, 0.014, 1, 1.0), {
      x: 0.006,
      y: 0.38,
      z: -0.138,
    }),
    transformGeo(buildRoundedBox(0.024, 0.022, 0.016, 1, 0.98), {
      x: 0,
      y: 0.24,
      z: -0.144,
    })
  )

  return {
    jacket: mergeAndDispose(jacketParts),
    backpack: mergeAndDispose(backpackParts),
    hardware: mergeAndDispose(hardwareParts),
  }
}

/**
 * Builds articulated arm segments (`upperArm` relative to `shoulderPivot`,
 * `forearm` relative to `elbowPivot`, and sculpted anatomical gloved `hand`
 * with arched knuckles, thenar eminence, multi-segment curled fingers and
 * opposable thumb relative to `wristPivot`) for side `sign = -1` (left) or `+1` (right).
 */
export function buildArmSegmentGeometries(sign) {
  // Upper sleeve: rounded deltoid cap dome -> bicep/tricep contour -> elbow creases
  const upperArm = buildLoftedPartGeometry(
    [
      {
        y: -0.295,
        rx: 0.048,
        rz: 0.05,
        foldAmp: 0.024,
        foldFreq: 4,
        ao: 0.82,
      },
      {
        y: -0.255,
        rx: 0.05,
        rz: 0.052,
        foldAmp: 0.02,
        foldFreq: 5,
        ao: 0.88,
      },
      {
        y: -0.205,
        rx: 0.052,
        rz: 0.055,
        foldAmp: 0.014,
        foldFreq: 5,
        ao: 0.94,
      },
      {
        y: -0.125,
        rx: 0.057,
        rz: 0.062,
        frontScale: 1.06,
        backScale: 1.04,
        ao: 1.0,
      },
      {
        y: -0.04,
        rx: 0.063,
        rz: 0.067,
        frontScale: 1.04,
        backScale: 1.06,
        ao: 0.98,
      },
      {
        y: 0.006,
        x: -sign * 0.008,
        rx: 0.06,
        rz: 0.063,
        ao: 0.92,
      },
      {
        y: 0.038,
        x: -sign * 0.02,
        rx: 0.046,
        rz: 0.05,
        ao: 0.82,
      },
    ],
    { radialSegments: 16, uRepeat: 1.2, vRepeat: 1.2, capTopDome: 0.014, capBottomDome: 0.012 }
  )

  // Forearm sleeve: rounded elbow cap -> brachioradialis fullness -> layered wrist cuff
  const forearm = buildLoftedPartGeometry(
    [
      {
        y: -0.245,
        rx: 0.04,
        rz: 0.043,
        foldAmp: 0.018,
        foldFreq: 5,
        ao: 0.86,
      },
      {
        y: -0.222,
        rx: 0.041,
        rz: 0.044,
        ao: 0.94,
      },
      {
        y: -0.205,
        rx: 0.036,
        rz: 0.039,
        foldAmp: 0.022,
        foldFreq: 6,
        ao: 0.88,
      },
      {
        y: -0.145,
        rx: 0.042,
        rz: 0.046,
        frontScale: 1.04,
        ao: 0.97,
      },
      {
        y: -0.075,
        rx: 0.048,
        rz: 0.052,
        frontScale: 1.06,
        backScale: 1.04,
        ao: 1.0,
      },
      {
        y: -0.018,
        rx: 0.049,
        rz: 0.052,
        ao: 0.96,
      },
      {
        y: 0.016,
        rx: 0.045,
        rz: 0.047,
        ao: 0.88,
      },
      {
        y: 0.034,
        rx: 0.036,
        rz: 0.038,
        ao: 0.78,
      },
    ],
    { radialSegments: 16, uRepeat: 1.1, vRepeat: 1.1, capTopDome: 0.01, capBottomDome: 0.008 }
  )

  // Gloved hand: wrist cuff -> sculpted anatomical palm with thenar pad -> 3-segment fingers & thumb
  const gauntlet = buildLoftedPartGeometry(
    [
      { y: -0.016, rx: 0.023, rz: 0.031, superExp: 2.2, ao: 0.92 },
      { y: 0.006, rx: 0.028, rz: 0.035, superExp: 2.25, ao: 0.96 },
      { y: 0.024, rx: 0.029, rz: 0.036, superExp: 2.2, ao: 0.78 },
    ],
    { radialSegments: 12 }
  )

  const palm = buildLoftedPartGeometry(
    [
      {
        y: -0.086,
        x: -sign * 0.005,
        z: -0.004,
        rx: 0.0125,
        rz: 0.033,
        superExp: 2.35,
        ao: 0.94,
      },
      {
        y: -0.068,
        x: -sign * 0.004,
        z: -0.004,
        rx: 0.0155,
        rz: 0.0355,
        superExp: 2.35,
        frontScale: 1.06,
        ao: 1.0,
      },
      {
        y: -0.042,
        x: -sign * 0.003,
        z: -0.004,
        rx: 0.0175,
        rz: 0.036,
        superExp: 2.3,
        frontScale: 1.08,
        ao: 0.98,
      },
      {
        y: -0.015,
        x: 0,
        z: -0.002,
        rx: 0.02,
        rz: 0.032,
        superExp: 2.2,
        ao: 0.9,
      },
    ],
    { radialSegments: 14 }
  )

  // Subtle dorsal knuckle guard across MCP arch
  const knuckleRidge = buildSplineLoft(
    [
      [sign * 0.01, -0.074, -0.029],
      [sign * 0.012, -0.078, -0.01],
      [sign * 0.012, -0.076, 0.008],
      [sign * 0.009, -0.07, 0.022],
    ],
    {
      tubularSegments: 6,
      radialSegments: 5,
      radiusX: 0.0045,
      radiusY: 0.0038,
      taperStart: 0.78,
      taperMid: 1.0,
      taperEnd: 0.75,
      aoStart: 0.86,
      aoEnd: 0.86,
      upHint: [sign, 0, 0],
    }
  )

  // 4 naturally arched & phalanx-contoured curled fingers (index, middle, ring, pinky)
  const fingerParts = []
  const fingerOffsetsZ = [-0.024, -0.008, 0.008, 0.023]
  const fingerBaseY = [-0.079, -0.083, -0.08, -0.074]
  const fingerLengths = [0.056, 0.062, 0.057, 0.045]
  const fingerRadii = [0.007, 0.0074, 0.007, 0.0061]
  for (let f = 0; f < 4; f += 1) {
    const len = fingerLengths[f]
    const y0 = fingerBaseY[f]
    const fz = fingerOffsetsZ[f] - 0.0045
    const curlIn = sign * -(0.0055 + f * 0.0018)
    const splayZ = (f - 1.5) * 0.0011
    fingerParts.push(
      buildSplineLoft(
        [
          [-sign * 0.005, y0, fz],
          [-sign * 0.007 + curlIn * 0.35, y0 - len * 0.38, fz + splayZ * 0.35],
          [-sign * 0.011 + curlIn * 0.78, y0 - len * 0.7, fz + splayZ * 0.7],
          [-sign * 0.015 + curlIn * 1.15, y0 - len * 0.92, fz + splayZ * 0.9],
          [-sign * 0.018 + curlIn * 1.35, y0 - len, fz + splayZ],
        ],
        {
          tubularSegments: 7,
          radialSegments: 6,
          radiusX: fingerRadii[f],
          radiusY: fingerRadii[f] * 0.94,
          taperStart: 1.0,
          taperMid: 0.9,
          taperEnd: 0.65,
          aoStart: 0.92,
          aoEnd: 0.97,
          upHint: [sign, 0, 0],
          profileFn: (t, base) =>
            base * (1 + 0.06 * (gaussian(t, 0.38, 0.1) + gaussian(t, 0.7, 0.09))),
        }
      )
    )
  }

  // Articulated 2-joint curved opposable thumb emerging from thenar pad
  const thumb = buildSplineLoft(
    [
      [-sign * 0.008, -0.024, -0.026],
      [-sign * 0.016, -0.043, -0.039],
      [-sign * 0.02, -0.065, -0.047],
      [-sign * 0.017, -0.083, -0.048],
    ],
    {
      tubularSegments: 6,
      radialSegments: 6,
      radiusX: 0.0094,
      radiusY: 0.0084,
      taperStart: 1.06,
      taperMid: 0.9,
      taperEnd: 0.66,
      aoStart: 0.9,
      aoEnd: 0.96,
      upHint: [0, 0, -1],
    }
  )

  return {
    upperArm,
    forearm,
    hand: mergeAndDispose([gauntlet, palm, knuckleRidge, ...fingerParts, thumb]),
  }
}

/**
 * Builds articulated leg segments (`thigh` relative to `hipPivot`, `shin` with
 * integrated low-profile knee pad & bloused cuff relative to `kneePivot`, and
 * anatomically asymmetric left/right explorer `boot` + `hardware` eyelets
 * relative to `anklePivot`, outsole bottom strictly at y = -0.10m = 0.00m world).
 */
export function buildLegSegmentGeometries(sign) {
  // Anatomical thigh with rounded hip socket cap, quad/hamstring contour & creases
  const thighTube = buildLoftedPartGeometry(
    [
      {
        y: -0.438,
        rx: 0.061,
        rz: 0.065,
        superExp: 2.08,
        foldAmp: 0.022,
        foldFreq: 5,
        ao: 0.84,
      },
      {
        y: -0.355,
        rx: 0.064,
        rz: 0.069,
        superExp: 2.1,
        foldAmp: 0.016,
        foldFreq: 4,
        ao: 0.92,
      },
      {
        y: -0.255,
        rx: 0.072,
        rz: 0.079,
        superExp: 2.12,
        frontScale: 1.05,
        ao: 0.98,
      },
      {
        y: -0.145,
        rx: 0.081,
        rz: 0.088,
        superExp: 2.14,
        frontScale: 1.06,
        backScale: 1.03,
        ao: 1.0,
      },
      {
        y: -0.04,
        rx: 0.085,
        rz: 0.092,
        superExp: 2.18,
        backScale: 1.06,
        foldAmp: 0.012,
        foldFreq: 4,
        ao: 0.94,
      },
      {
        y: 0.02,
        rx: 0.077,
        rz: 0.083,
        ao: 0.84,
      },
      {
        y: 0.05,
        rx: 0.062,
        rz: 0.068,
        ao: 0.74,
      },
    ],
    { radialSegments: 18, uRepeat: 1.4, vRepeat: 1.5, capTopDome: 0.016, capBottomDome: 0.012 }
  )

  const outerTheta = sign === -1 ? Math.PI : 0
  const cargoPocket = buildConformedPatch({
    thetaCenter: outerTheta,
    thetaSpan: 1.05,
    yMin: -0.275,
    yMax: -0.148,
    rx: 0.079,
    rz: 0.087,
    superExp: 2.12,
    thickness: 0.011,
    bevelDepth: 0.0055,
    segsU: 6,
    segsV: 5,
    aoCenter: 0.96,
    aoEdge: 0.8,
    flapFold: 0.0022,
  })
  const cargoFlap = buildConformedPatch({
    thetaCenter: outerTheta,
    thetaSpan: 1.1,
    yMin: -0.158,
    yMax: -0.128,
    rx: 0.081,
    rz: 0.089,
    superExp: 2.14,
    thickness: 0.014,
    bevelDepth: 0.0035,
    segsU: 6,
    segsV: 3,
    aoCenter: 1.0,
    aoEdge: 0.82,
  })

  // Lower trouser leg: anatomical high calf gastrocnemius swell & bloused ankle gather
  const shinTube = buildLoftedPartGeometry(
    [
      {
        y: -0.405,
        rx: 0.052,
        rz: 0.056,
        superExp: 2.1,
        foldAmp: 0.025,
        foldFreq: 6,
        ao: 0.84,
      },
      {
        y: -0.372,
        rx: 0.054,
        rz: 0.058,
        superExp: 2.1,
        foldAmp: 0.028,
        foldFreq: 5,
        ao: 0.94,
      },
      {
        y: -0.315,
        rx: 0.048,
        rz: 0.052,
        foldAmp: 0.02,
        foldFreq: 5,
        ao: 0.92,
      },
      {
        y: -0.22,
        z: 0.004,
        rx: 0.054,
        rz: 0.06,
        backScale: 1.08,
        ao: 0.98,
      },
      {
        y: -0.145,
        z: 0.008,
        rx: 0.062,
        rz: 0.071,
        backScale: 1.17,
        ao: 1.0,
      },
      {
        y: -0.045,
        z: 0.0,
        rx: 0.058,
        rz: 0.064,
        foldAmp: 0.012,
        foldFreq: 4,
        ao: 0.95,
      },
      {
        y: 0.015,
        z: 0.0,
        rx: 0.055,
        rz: 0.06,
        ao: 0.88,
      },
      {
        y: 0.042,
        z: 0.0,
        rx: 0.048,
        rz: 0.052,
        ao: 0.78,
      },
    ],
    { radialSegments: 18, uRepeat: 1.3, vRepeat: 1.5, capTopDome: 0.012 }
  )

  // Low-profile knee pad integrated smoothly into trouser knee
  const kneePad = buildConformedPatch({
    thetaCenter: -Math.PI * 0.5,
    thetaSpan: 1.18,
    yMin: -0.044,
    yMax: 0.04,
    rx: 0.056,
    rz: 0.062,
    superExp: 2.1,
    thickness: 0.008,
    bevelDepth: 0.005,
    segsU: 6,
    segsV: 5,
    aoCenter: 0.92,
    aoEdge: 0.76,
  })

  // Anatomical asymmetric explorer boot (medial arch, lateral forefoot, padded collar, sole at y = -0.10)
  const bootUpper = buildLoftedPartGeometry(
    [
      {
        y: -0.076,
        x: sign * 0.003,
        z: -0.036,
        rx: 0.048,
        rz: 0.114,
        superExp: 2.22,
        frontScale: 1.16,
        backScale: 0.77,
        leftScale: sign === -1 ? 1.07 : 0.94,
        rightScale: sign === -1 ? 0.94 : 1.07,
        ao: 0.84,
      },
      {
        y: -0.052,
        x: sign * 0.002,
        z: -0.032,
        rx: 0.046,
        rz: 0.105,
        superExp: 2.18,
        frontScale: 1.15,
        backScale: 0.76,
        leftScale: sign === -1 ? 1.06 : 0.95,
        rightScale: sign === -1 ? 0.95 : 1.06,
        ao: 0.96,
      },
      {
        y: -0.022,
        x: 0,
        z: -0.018,
        rx: 0.046,
        rz: 0.082,
        superExp: 2.1,
        frontScale: 1.15,
        backScale: 0.78,
        ao: 0.98,
      },
      {
        y: 0.008,
        z: -0.003,
        rx: 0.047,
        rz: 0.056,
        superExp: 2.1,
        ao: 0.95,
      },
      {
        y: 0.036,
        z: 0.001,
        rx: 0.048,
        rz: 0.054,
        ao: 0.9,
      },
      {
        y: 0.048,
        z: 0.002,
        rx: 0.045,
        rz: 0.051,
        ao: 0.78,
      },
    ],
    { radialSegments: 18, uRepeat: 1.3, vRepeat: 1.1 }
  )

  const outsole = transformGeo(
    buildLoftedPartGeometry(
      [
        {
          y: -0.1,
          x: sign * 0.003,
          rx: 0.052,
          rz: 0.125,
          superExp: 2.32,
          frontScale: 1.16,
          backScale: 0.8,
          leftScale: sign === -1 ? 1.07 : 0.94,
          rightScale: sign === -1 ? 0.94 : 1.07,
          ao: 0.64,
        },
        {
          y: -0.086,
          x: sign * 0.003,
          rx: 0.051,
          rz: 0.123,
          superExp: 2.3,
          frontScale: 1.16,
          backScale: 0.8,
          leftScale: sign === -1 ? 1.07 : 0.94,
          rightScale: sign === -1 ? 0.94 : 1.07,
          ao: 0.68,
        },
        {
          y: -0.075,
          x: sign * 0.003,
          rx: 0.053,
          rz: 0.126,
          superExp: 2.32,
          frontScale: 1.16,
          backScale: 0.8,
          leftScale: sign === -1 ? 1.07 : 0.94,
          rightScale: sign === -1 ? 0.94 : 1.07,
          ao: 0.76,
        },
      ],
      { radialSegments: 18 }
    ),
    { x: 0, y: 0.0, z: -0.036 }
  )

  // Criss-cross boot laces (4 pairs) & metallic eyelets
  const laceParts = []
  const eyeletParts = []
  for (let e = 0; e < 4; e += 1) {
    const yEye = -0.028 + e * 0.0155
    const zEye = -0.068 + e * 0.0065
    laceParts.push(
      buildSplineLoft(
        [
          [-0.021, yEye, zEye],
          [0.0, yEye + 0.0055, zEye - 0.0045],
          [0.021, yEye + 0.0015, zEye],
        ],
        {
          tubularSegments: 4,
          radialSegments: 5,
          radiusX: 0.003,
          radiusY: 0.0022,
          taperStart: 0.9,
          taperMid: 1.0,
          taperEnd: 0.9,
          aoStart: 0.84,
          aoEnd: 0.84,
        }
      )
    )
    for (const side of [-1, 1]) {
      eyeletParts.push(
        transformGeo(new THREE.CylinderGeometry(0.0036, 0.0036, 0.0065, 6), {
          x: side * 0.022,
          y: yEye,
          z: zEye,
          rx: Math.PI / 2,
          ao: 0.96,
        })
      )
    }
  }

  return {
    thigh: mergeAndDispose([thighTube, cargoPocket, cargoFlap]),
    shin: applyColorGradientY(
      mergeAndDispose([shinTube, kneePad]),
      -0.405,
      0.042,
      0.9,
      1.0
    ),
    boot: mergeAndDispose([bootUpper, outsole, ...laceParts]),
    hardware: mergeAndDispose(eyeletParts),
  }
}
