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
 * Deterministic spatial pseudo-cracks for withered, split corpse skin & weathered cloth.
 */
function crackPattern(x, y, z) {
  const w1 = Math.sin(x * 74 + y * 53 - z * 41)
  const w2 = Math.cos(y * 89 - x * 47 + z * 63)
  const line = Math.abs(w1 + w2 * 0.72)
  return 1 - smoothstep(0.06, 0.28, line)
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

function buildLoftedPartGeometry(
  rings,
  {
    radialSegments = 14,
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
        foldShade += foldWave * Math.min(0.14, Math.abs(foldAmp) * 1.5)
      }

      const p = vCursor * 3
      const up = vCursor * 2
      positions[p] = cx + px
      positions[p + 1] = cy + pz * ringTiltX + px * ringTiltZ
      positions[p + 2] = cz + pz

      uvs[up] = frac * uRepeat
      uvs[up + 1] = vCoord

      const shade = clamp(ao * foldShade, 0.25, 1.08)
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
    const ao = (ring.ao ?? 1.0) * 0.88
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
    radiusX = 0.014,
    radiusY = 0.008,
    taperStart = 0.75,
    taperMid = 1.0,
    taperEnd = 0.25,
    aoStart = 0.78,
    aoEnd = 1.0,
    tintStart = [1, 1, 1],
    tintEnd = [1, 1, 1],
    upHint = [0, 0, -1],
    profileFn = null,
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

    const baseProfile =
      t < 0.5
        ? lerp(taperStart, taperMid, smoothstep(0, 0.5, t))
        : lerp(taperMid, taperEnd, smoothstep(0.5, 1, t))
    const profile = profileFn ? profileFn(t, baseProfile) : baseProfile
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

// Color palettes encoded cleanly into vertex colors for white-base decayed flesh PBR material
const FLESH_BASE = [0.5, 0.52, 0.46]
const FLESH_NECROTIC = [0.27, 0.25, 0.23]
const FLESH_BRUISE = [0.33, 0.28, 0.31]
const BONE_IVORY = [0.83, 0.79, 0.7]
const MUD_STAIN = [0.24, 0.21, 0.18]

function paintSkinSurface(geometry, { boneZones = [], fleshBrightness = 1.0 } = {}) {
  ensureVertexColors(geometry)
  const pos = geometry.attributes.position
  const col = geometry.attributes.color
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const ao = clamp((col.getX(i) + col.getY(i) + col.getZ(i)) / 3, 0.22, 1.05)

    const crack = crackPattern(x, y, z)
    const rotNoise = Math.sin(x * 23 + y * 19 + z * 27) * 0.5 + 0.5
    const mudNoise = smoothstep(0.55, 0.92, Math.cos(x * 17 - y * 13 + z * 21) * 0.5 + 0.5)

    let r = lerp(FLESH_BASE[0], FLESH_BRUISE[0], rotNoise * 0.42)
    let g = lerp(FLESH_BASE[1], FLESH_BRUISE[1], rotNoise * 0.42)
    let b = lerp(FLESH_BASE[2], FLESH_BRUISE[2], rotNoise * 0.42)

    r = lerp(r, MUD_STAIN[0], mudNoise * 0.32)
    g = lerp(g, MUD_STAIN[1], mudNoise * 0.32)
    b = lerp(b, MUD_STAIN[2], mudNoise * 0.32)

    // Cracked split-flesh creases darken into raw necrotic lines
    r = lerp(r, FLESH_NECROTIC[0], crack * 0.68)
    g = lerp(g, FLESH_NECROTIC[1], crack * 0.74)
    b = lerp(b, FLESH_NECROTIC[2], crack * 0.72)

    // Exposed bone zones override mottled flesh with pale aged ivory bone & dark raw perimeter
    for (let zIdx = 0; zIdx < boneZones.length; zIdx += 1) {
      const bz = boneZones[zIdx]
      const dist = Math.hypot((x - bz.x) / bz.rx, (y - bz.y) / bz.ry, (z - bz.z) / bz.rz)
      if (dist < 1.35) {
        const rim = Math.exp(-Math.pow((dist - 1.0) / 0.22, 2))
        const boneMix = smoothstep(1.02, 0.65, dist)
        r = lerp(r, FLESH_NECROTIC[0] * 0.75, rim * 0.65)
        g = lerp(g, FLESH_NECROTIC[1] * 0.62, rim * 0.7)
        b = lerp(b, FLESH_NECROTIC[2] * 0.62, rim * 0.7)
        r = lerp(r, BONE_IVORY[0], boneMix)
        g = lerp(g, BONE_IVORY[1], boneMix)
        b = lerp(b, BONE_IVORY[2], boneMix)
      }
    }

    const scale = ao * fleshBrightness
    col.setXYZ(i, clamp(r * scale, 0.08, 0.96), clamp(g * scale, 0.08, 0.96), clamp(b * scale, 0.08, 0.96))
  }
  col.needsUpdate = true
  return geometry
}

function tintBoneGeometry(geometry, aoScale = 0.95) {
  ensureVertexColors(geometry)
  const col = geometry.attributes.color
  for (let i = 0; i < col.count; i += 1) {
    const ao = clamp(col.getX(i) * aoScale, 0.28, 1.02)
    col.setXYZ(i, BONE_IVORY[0] * ao, BONE_IVORY[1] * ao, BONE_IVORY[2] * ao)
  }
  col.needsUpdate = true
  return geometry
}

/**
 * Decayed, twisted torso flesh + exposed left clavicle + 3 fractured right ribs
 * + thoracic dorsal vertebrae peeking through the torn burial coat.
 */
export function buildRevenantTorsoGeometries() {
  // 1. Torso anatomical core (with scoliotic S-bend & asymmetrical shoulders)
  const torsoSkin = buildLoftedPartGeometry(
    [
      { y: -0.02, x: 0.0, z: 0.015, rx: 0.135, rz: 0.088, ao: 0.56 },
      { y: 0.12, x: -0.008, z: 0.008, rx: 0.128, rz: 0.084, ao: 0.72 },
      { y: 0.28, x: -0.016, z: 0.0, rx: 0.156, rz: 0.098, ao: 0.85 },
      {
        y: 0.44,
        x: -0.01,
        z: -0.008,
        rx: 0.184,
        rz: 0.106,
        leftScale: 0.94,
        rightScale: 1.05,
        tiltZ: 0.06,
        ao: 0.92,
      },
      {
        y: 0.57,
        x: 0.006,
        z: -0.012,
        rx: 0.194,
        rz: 0.095,
        leftScale: 0.92,
        rightScale: 1.06,
        tiltZ: 0.09,
        ao: 0.95,
      },
      { y: 0.64, x: 0.014, z: -0.018, rx: 0.085, rz: 0.064, ao: 0.82 },
    ],
    { radialSegments: 18, capBottom: true, capTop: false }
  )

  paintSkinSurface(torsoSkin, {
    boneZones: [
      { x: 0.115, y: 0.44, z: -0.05, rx: 0.085, ry: 0.12, rz: 0.075 },
      { x: -0.08, y: 0.6, z: -0.045, rx: 0.07, ry: 0.035, rz: 0.045 },
    ],
  })

  const fleshParts = [torsoSkin]

  // Exposed left clavicle bone (left shoulder sits lower)
  const leftClavicle = tintBoneGeometry(
    buildSplineLoft(
      [
        [-0.01, 0.585, -0.065],
        [-0.085, 0.575, -0.07],
        [-0.165, 0.558, -0.04],
        [-0.215, 0.545, -0.005],
      ],
      {
        tubularSegments: 7,
        radialSegments: 6,
        radiusX: 0.013,
        radiusY: 0.01,
        taperStart: 0.95,
        taperMid: 0.72,
        taperEnd: 1.15,
        aoStart: 0.92,
        aoEnd: 0.88,
      }
    )
  )
  fleshParts.push(leftClavicle)

  // 3 broken exposed right-lateral ribs protruding slightly from the torn coat gash
  const ribHeights = [0.47, 0.405, 0.34]
  for (let r = 0; r < ribHeights.length; r += 1) {
    const ry = ribHeights[r]
    const w = 1 - r * 0.07
    fleshParts.push(
      tintBoneGeometry(
        buildSplineLoft(
          [
            [0.045, ry + 0.012, -0.092 * w],
            [0.115 * w, ry, -0.088 * w],
            [0.168 * w, ry - 0.014, -0.038 * w],
            [0.174 * w, ry - 0.022, 0.025],
          ],
          {
            tubularSegments: 7,
            radialSegments: 6,
            radiusX: 0.0105,
            radiusY: 0.0085,
            taperStart: 0.65,
            taperMid: 1.05,
            taperEnd: 0.7,
            aoStart: 0.95,
            aoEnd: 0.8,
          }
        )
      )
    )
  }

  // Subtle exposed upper dorsal spine vertebrae along split back collar
  for (let v = 0; v < 4; v += 1) {
    fleshParts.push(
      tintBoneGeometry(
        transformGeo(new THREE.SphereGeometry(0.013, 6, 5), {
          x: 0.006 + v * 0.002,
          y: 0.48 + v * 0.042,
          z: 0.094 - v * 0.006,
          sx: 0.72,
          sy: 0.9,
          sz: 1.25,
          ao: 0.86,
        })
      )
    )
  }

  // 2. Old, ragged, grave-stained open coat & torn burial shirt (asymmetrical & flared clear of legs)
  const coatBody = buildOpenFrontCoat(
    [
      { y: -0.02, x: 0.0, z: 0.068, rx: 0.232, rz: 0.125, foldAmp: 0.1, foldFreq: 7, ao: 0.62 },
      { y: 0.065, x: -0.004, z: 0.038, rx: 0.204, rz: 0.12, foldAmp: 0.09, foldFreq: 6, ao: 0.74 },
      { y: 0.18, x: -0.012, z: 0.01, rx: 0.158, rz: 0.108, foldAmp: 0.09, foldFreq: 6, ao: 0.84 },
      { y: 0.39, x: -0.014, z: -0.004, rx: 0.188, rz: 0.118, foldAmp: 0.08, foldFreq: 5, ao: 0.9 },
      { y: 0.56, x: 0.002, z: -0.008, rx: 0.212, rz: 0.112, foldAmp: 0.06, foldFreq: 5, ao: 0.94 },
      { y: 0.64, x: 0.01, z: 0.0, rx: 0.128, rz: 0.092, ao: 0.8 },
    ],
    {
      thetaStart: -Math.PI * 0.04,
      thetaEnd: Math.PI * 1.04,
      radialSegments: 22,
      ribTearCenterY: 0.41,
    }
  )

  // Ragged coat lapels and flared rear coat tails clear of swinging thighs
  const clothParts = [coatBody]
  clothParts.push(
    buildRaggedStrip(
      [
        [-0.082, 0.58, -0.072],
        [-0.125, 0.37, -0.095],
        [-0.155, 0.18, -0.108],
        [-0.185, 0.04, -0.122],
      ],
      0.056,
      0.02,
      0.86,
      0.46
    ),
    buildRaggedStrip(
      [
        [0.078, 0.59, -0.068],
        [0.088, 0.46, -0.094],
        [0.112, 0.25, -0.108],
        [0.165, 0.05, -0.12],
      ],
      0.048,
      0.018,
      0.84,
      0.48
    ),
    // Tattered coat tails flaring outward behind hips well clear of backward thigh swing
    buildRaggedStrip(
      [
        [-0.095, 0.14, 0.112],
        [-0.125, -0.02, 0.185],
        [-0.145, -0.2, 0.265],
      ],
      0.07,
      0.022,
      0.74,
      0.38
    ),
    buildRaggedStrip(
      [
        [0.088, 0.14, 0.116],
        [0.112, -0.03, 0.195],
        [0.132, -0.22, 0.278],
      ],
      0.068,
      0.018,
      0.74,
      0.35
    )
  )

  return {
    torsoFlesh: mergeAndDispose(fleshParts),
    torsoClothes: mergeAndDispose(clothParts),
  }
}

/**
 * Crooked, corded undead neck with shrunken throat tendons & split skin.
 */
export function buildRevenantNeckGeometry() {
  const neck = buildLoftedPartGeometry(
    [
      { y: -0.02, x: 0.0, z: 0.008, rx: 0.052, rz: 0.048, ao: 0.68 },
      { y: 0.035, x: 0.004, z: 0.002, rx: 0.045, rz: 0.044, ao: 0.8 },
      { y: 0.095, x: 0.008, z: -0.006, rx: 0.042, rz: 0.043, ao: 0.88 },
      { y: 0.145, x: 0.01, z: -0.011, rx: 0.044, rz: 0.048, ao: 0.78 },
      { y: 0.184, x: 0.011, z: -0.013, rx: 0.041, rz: 0.045, ao: 0.68 },
    ],
    { radialSegments: 14, capBottom: false, capTop: true }
  )

  const parts = [neck]
  for (const sign of [-1, 1]) {
    parts.push(
      buildSplineLoft(
        [
          [sign * 0.038 + 0.008, 0.172, -0.002],
          [sign * 0.032 + 0.005, 0.075, -0.024],
          [sign * 0.014, -0.005, -0.044],
        ],
        {
          tubularSegments: 6,
          radialSegments: 5,
          radiusX: 0.009,
          radiusY: 0.0075,
          aoStart: 0.82,
          aoEnd: 0.64,
        }
      )
    )
  }

  // Prominent throat cartilage
  parts.push(
    transformGeo(new THREE.SphereGeometry(0.014, 8, 6), {
      x: 0.006,
      y: 0.085,
      z: -0.044,
      sx: 0.72,
      sy: 1.15,
      sz: 0.75,
      ao: 0.92,
    })
  )

  const merged = mergeAndDispose(parts)
  paintSkinSurface(merged, {
    boneZones: [{ x: 0.004, y: 0.075, z: 0.042, rx: 0.016, ry: 0.035, rz: 0.016 }],
  })
  return merged
}

/**
 * Asymmetrical decayed human face: sunken cheeks, cracked skin, exposed cheekbone bone,
 * crooked broken nose, slack parted split lips exposing dull teeth hint, tattered ears,
 * sparse matted grave hair, and dead sunken eyes.
 */
export function buildRevenantHeadAndEyesGeometries() {
  const headCenterY = 0.125
  const headCenterZ = -0.008

  const cranium = new THREE.SphereGeometry(1, 36, 26)
  const pos = cranium.attributes.position
  const colors = new Float32Array(pos.count * 3)

  for (let i = 0; i < pos.count; i += 1) {
    const ux = pos.getX(i)
    const uy = pos.getY(i)
    const uz = pos.getZ(i)

    let sx = ux * 0.074
    let sy = uy * 0.108
    let sz = uz * 0.097

    const isFront = uz < 0
    const frontMask = smoothstep(0.08, -0.35, uz)

    // Asymmetric temporal pinch (left temple more caved in)
    const leftTemple = ux < 0 ? 0.2 : 0.12
    const templePinch =
      gaussian(uy, 0.15, 0.24) *
      frontMask *
      smoothstep(0.38, 0.86, Math.abs(ux)) *
      leftTemple
    sx *= 1 - templePinch

    // Uneven twisted jaw: left side slacks lower slightly
    const lowerFaceMask = smoothstep(-0.04, -0.84, uy)
    const gonialAngle =
      gaussian(uy, -0.45, 0.17) *
      smoothstep(0.32, 0.74, Math.abs(ux)) *
      smoothstep(0.25, -0.42, uz)
    sx *= 1 - lowerFaceMask * 0.36
    sx += Math.sign(ux) * gonialAngle * 0.009
    if (ux < -0.15 && uy < -0.25) {
      sy -= 0.0045 * smoothstep(-0.25, -0.85, uy) * smoothstep(-0.15, -0.6, ux)
    }

    if (isFront) {
      // Gaunt crooked chin slightly off-axis
      const chinMask =
        gaussian(uy, -0.75, 0.15) *
        gaussian(ux + 0.05, 0, 0.3) *
        smoothstep(-0.34, -0.88, uz)
      sz -= chinMask * 0.015
      sy -= chinMask * 0.005

      // Uneven furrowed brow ridge
      const glabellaDip = gaussian(ux, 0, 0.12) * 0.28
      const browTilt = ux < 0 ? 0.011 : 0.0145
      const browMask =
        gaussian(uy - (ux > 0 ? 0.04 : -0.02), 0.2, 0.1) *
        smoothstep(-0.2, -0.78, uz) *
        (1 - smoothstep(0.64, 0.92, Math.abs(ux))) *
        (1 - glabellaDip)
      sz -= browMask * browTilt

      // Deeply sunken uneven orbital sockets (left eye slightly lower)
      const eyeDistL = Math.hypot((ux + 0.38) / 0.22, (uy - 0.02) / 0.15)
      const eyeDistR = Math.hypot((ux - 0.38) / 0.22, (uy - 0.06) / 0.15)
      const socketMask =
        (Math.exp(-(eyeDistL * eyeDistL)) + Math.exp(-(eyeDistR * eyeDistR))) *
        smoothstep(-0.34, -0.84, uz)
      sz += socketMask * 0.023

      // Sharp protruding cheekbones (right zygoma slightly more gaunt/exposed)
      const cheekL = Math.exp(
        -(Math.pow((ux + 0.56) / 0.21, 2) + Math.pow((uy + 0.12) / 0.15, 2))
      )
      const cheekR = Math.exp(
        -(Math.pow((ux - 0.56) / 0.21, 2) + Math.pow((uy + 0.1) / 0.14, 2))
      )
      const cheekMask = (cheekL * 0.95 + cheekR * 1.2) * smoothstep(-0.22, -0.82, uz)
      sz -= cheekMask * 0.0115
      sx += Math.sign(ux) * cheekMask * 0.005

      // Deep sunken buccal hollows (emaciated dead cheeks)
      const hollowL = Math.exp(
        -(Math.pow((ux + 0.51) / 0.21, 2) + Math.pow((uy + 0.36) / 0.17, 2))
      )
      const hollowR = Math.exp(
        -(Math.pow((ux - 0.51) / 0.21, 2) + Math.pow((uy + 0.35) / 0.17, 2))
      )
      const hollowMask = (hollowL * 1.15 + hollowR) * smoothstep(-0.22, -0.78, uz)
      sx -= Math.sign(ux) * hollowMask * 0.0115
      sz += hollowMask * 0.0095

      // Subtle micro skin-crack furrow indentation across brow & left cheek
      const crk = crackPattern(sx, sy + headCenterY, sz + headCenterZ)
      sz += crk * 0.0014 * frontMask
    }

    if (uy < -0.72) {
      const underChin = smoothstep(-0.72, -0.98, uy)
      sx *= 1 - underChin * 0.34
      sz *= 1 - underChin * 0.26
      sz += underChin * 0.013
      sy += underChin * 0.01
    }

    pos.setXYZ(i, sx, sy + headCenterY, sz + headCenterZ)

    let ao = 0.94
    if (isFront) {
      const eL = Math.hypot((ux + 0.38) / 0.22, (uy - 0.02) / 0.15)
      const eR = Math.hypot((ux - 0.38) / 0.22, (uy - 0.06) / 0.15)
      const orbAO =
        (Math.exp(-(eL * eL)) + Math.exp(-(eR * eR))) *
        smoothstep(-0.36, -0.86, uz)
      ao -= orbAO * 0.45

      const hollowAO =
        (Math.exp(-(Math.pow((ux + 0.51) / 0.21, 2) + Math.pow((uy + 0.36) / 0.17, 2))) +
          Math.exp(-(Math.pow((ux - 0.51) / 0.21, 2) + Math.pow((uy + 0.35) / 0.17, 2)))) *
        smoothstep(-0.22, -0.82, uz)
      ao -= hollowAO * 0.28
    }
    if (uy < -0.66) {
      ao -= smoothstep(-0.66, -0.96, uy) * 0.32
    }
    ao = clamp(ao, 0.28, 1.0)
    colors[i * 3] = ao
    colors[i * 3 + 1] = ao
    colors[i * 3 + 2] = ao
  }
  pos.needsUpdate = true
  cranium.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  recomputeNormalsSafe(cranium, headCenterY, headCenterZ)

  // Paint cracked skin + right zygomatic cheekbone & left brow bone exposure
  paintSkinSurface(cranium, {
    boneZones: [
      { x: 0.044, y: headCenterY - 0.008, z: headCenterZ - 0.072, rx: 0.018, ry: 0.014, rz: 0.022 },
      { x: -0.028, y: headCenterY + 0.032, z: headCenterZ - 0.078, rx: 0.017, ry: 0.011, rz: 0.018 },
    ],
  })

  // Crooked broken nose with subtle exposed bone ridge on dorsum
  const nose = buildRevenantNose(headCenterY, headCenterZ)
  paintSkinSurface(nose, {
    boneZones: [{ x: -0.001, y: headCenterY + 0.008, z: headCenterZ - 0.09, rx: 0.0055, ry: 0.012, rz: 0.008 }],
  })

  const fleshParts = [cranium, nose]

  // Asymmetrical sunken eyelids (left drooping half-shut, right staring wider)
  const eyePositions = [
    { sign: -1, x: -0.03, y: headCenterY + 0.001, z: headCenterZ - 0.075, upperOpen: 0.42 },
    { sign: 1, x: 0.03, y: headCenterY + 0.006, z: headCenterZ - 0.075, upperOpen: 0.96 },
  ]
  for (let e = 0; e < eyePositions.length; e += 1) {
    const ep = eyePositions[e]
    const lidTop = buildRevenantEyelid({
      eyeX: ep.x,
      eyeY: ep.y,
      eyeZ: ep.z,
      eyeRadius: 0.0104,
      isUpper: true,
      sign: ep.sign,
      openFactor: ep.upperOpen,
    })
    const lidBot = buildRevenantEyelid({
      eyeX: ep.x,
      eyeY: ep.y,
      eyeZ: ep.z,
      eyeRadius: 0.0104,
      isUpper: false,
      sign: ep.sign,
      openFactor: 0.9,
    })
    paintSkinSurface(lidTop, { fleshBrightness: 0.72 })
    paintSkinSurface(lidBot, { fleshBrightness: 0.78 })
    fleshParts.push(lidTop, lidBot)

    // Asymmetrical ears (left ear slightly notched/torn lower)
    const earDrop = ep.sign < 0 ? -0.004 : 0
    const earHelix = buildSplineLoft(
      [
        [ep.sign * 0.071, headCenterY + 0.008 + earDrop, headCenterZ + 0.002],
        [ep.sign * 0.078, headCenterY + 0.019 + earDrop, headCenterZ + 0.01],
        [ep.sign * 0.078, headCenterY + 0.003 + earDrop, headCenterZ + 0.02],
        [ep.sign * 0.075, headCenterY - 0.014 + earDrop, headCenterZ + 0.015],
        [ep.sign * 0.07, headCenterY - 0.02 + earDrop, headCenterZ + 0.006],
      ],
      { tubularSegments: 7, radialSegments: 5, radiusX: 0.0038, radiusY: 0.0046, upHint: [ep.sign, 0, 0] }
    )
    const earConcha = transformGeo(new THREE.SphereGeometry(0.01, 7, 5), {
      x: ep.sign * 0.07,
      y: headCenterY + 0.001 + earDrop,
      z: headCenterZ + 0.011,
      ry: ep.sign * 0.25,
      sx: 0.3,
      sy: 1.05,
      sz: 0.74,
      ao: 0.65,
    })
    paintSkinSurface(earHelix)
    paintSkinSurface(earConcha, { fleshBrightness: 0.75 })
    fleshParts.push(earHelix, earConcha)
  }

  // Slack twisted lips parted unevenly on one side exposing dull teeth hints
  const mouthParts = buildRevenantMouth(headCenterY, headCenterZ)
  fleshParts.push(...mouthParts)

  // Dead-looking sunken eyeballs (milky clouded sclera, faded dead iris, dull dark pupil)
  const eyeParts = []
  for (let e = 0; e < eyePositions.length; e += 1) {
    const ep = eyePositions[e]
    const eyeGeo = new THREE.SphereGeometry(0.0098, 12, 10)
    const ePos = eyeGeo.attributes.position
    const eCols = new Float32Array(ePos.count * 3)
    for (let i = 0; i < ePos.count; i += 1) {
      const ex = ePos.getX(i) / 0.0098
      const ey = ePos.getY(i) / 0.0098
      const ez = ePos.getZ(i) / 0.0098
      const radial = Math.hypot(ex, ey)
      let lum = 0.42
      if (ez < -0.15) {
        if (radial < 0.22) {
          lum = 0.16 // dulled dilated pupil
        } else if (radial < 0.56) {
          lum = 0.66 // milky clouded dead iris
        } else {
          lum = 0.82 // cloudy bloodshot-grey dead sclera
        }
      }
      eCols[i * 3] = lum * 0.92
      eCols[i * 3 + 1] = lum * 0.96
      eCols[i * 3 + 2] = lum * 0.94
    }
    eyeGeo.setAttribute('color', new THREE.BufferAttribute(eCols, 3))
    eyeParts.push(
      transformGeo(eyeGeo, {
        x: ep.x,
        y: ep.y,
        z: ep.z,
        sz: 0.88,
      })
    )
  }

  // Sparse matted grave-dirtied hair locks clinging unevenly to scalp
  const hairParts = []
  const lockSpecs = [
    { pts: [[-0.045, 0.22, -0.02], [-0.062, 0.19, -0.055], [-0.068, 0.145, -0.062]], rx: 0.011, ry: 0.0045 },
    { pts: [[-0.02, 0.23, 0.0], [-0.036, 0.21, -0.062], [-0.042, 0.17, -0.082]], rx: 0.01, ry: 0.004 },
    { pts: [[0.035, 0.225, 0.01], [0.06, 0.195, -0.035], [0.072, 0.14, -0.045]], rx: 0.012, ry: 0.0048 },
    { pts: [[0.0, 0.225, 0.015], [-0.018, 0.195, 0.072], [-0.028, 0.11, 0.09]], rx: 0.028, ry: 0.009 },
    { pts: [[0.022, 0.22, 0.02], [0.045, 0.18, 0.068], [0.052, 0.095, 0.086]], rx: 0.024, ry: 0.008 },
    { pts: [[-0.042, 0.2, 0.03], [-0.062, 0.15, 0.065], [-0.065, 0.07, 0.075]], rx: 0.02, ry: 0.007 },
  ]
  for (let i = 0; i < lockSpecs.length; i += 1) {
    const lk = lockSpecs[i]
    hairParts.push(
      buildSplineLoft(lk.pts, {
        tubularSegments: 9,
        radialSegments: 5,
        radiusX: lk.rx,
        radiusY: lk.ry,
        taperStart: 0.85,
        taperMid: 1.0,
        taperEnd: 0.06,
        aoStart: 0.72,
        aoEnd: 0.4,
      })
    )
  }

  return {
    headFlesh: mergeAndDispose(fleshParts),
    headHair: mergeAndDispose(hairParts),
    eyes: mergeAndDispose(eyeParts),
  }
}

/**
 * Tattered burial coat sleeve shred reused asymmetrically on left & right upper arms.
 */
export function buildRevenantSleeveRagGeometry() {
  const sleeve = buildLoftedPartGeometry(
    [
      { y: -0.22, z: 0.0, rx: 0.052, rz: 0.05, foldAmp: 0.18, foldFreq: 6, ao: 0.48 },
      { y: -0.14, z: 0.0, rx: 0.048, rz: 0.046, foldAmp: 0.1, foldFreq: 5, ao: 0.72 },
      { y: -0.04, z: 0.0, rx: 0.054, rz: 0.052, foldAmp: 0.08, foldFreq: 4, ao: 0.9 },
      { y: 0.035, z: 0.0, rx: 0.05, rz: 0.048, ao: 0.84 },
    ],
    { radialSegments: 12, capBottom: false, capTop: true, capTopDome: 0.015 }
  )
  return sleeve
}

/**
 * Unnaturally crooked, decayed upper arm (shoulder y = 0 down to elbow y = -0.37).
 */
export function buildRevenantUpperArmGeometry(sign = -1) {
  const arm = buildLoftedPartGeometry(
    [
      { y: -0.375, x: sign * 0.008, rx: 0.028, rz: 0.026, ao: 0.72 },
      { y: -0.3, x: sign * 0.006, rx: 0.026, rz: 0.025, ao: 0.8 },
      { y: -0.17, x: sign * 0.003, rx: 0.031, rz: 0.03, foldAmp: 0.06, foldFreq: 3, ao: 0.9 },
      { y: -0.04, x: 0, rx: 0.038, rz: 0.035, ao: 0.88 },
      { y: 0.02, x: -sign * 0.004, rx: 0.042, rz: 0.038, ao: 0.8 },
    ],
    { radialSegments: 12, capBottom: true, capTop: true, capBottomDome: 0.014, capTopDome: 0.016 }
  )
  const elbowKnob = transformGeo(new THREE.SphereGeometry(0.026, 8, 6), {
    x: sign * 0.009,
    y: -0.37,
    z: 0.012,
    sx: 0.85,
    sy: 1.0,
    sz: 0.92,
    ao: 0.84,
  })
  const merged = mergeAndDispose([arm, elbowKnob])
  paintSkinSurface(merged, {
    boneZones: [
      { x: sign * 0.01, y: -0.37, z: 0.015, rx: 0.018, ry: 0.018, rz: 0.018 },
    ],
  })
  return merged
}

/**
 * Long, scarred forearm with exposed bony ulna/wrist hints (elbow y = 0 down to wrist y = -0.39).
 */
export function buildRevenantForearmGeometry(sign = -1) {
  const forearm = buildLoftedPartGeometry(
    [
      { y: -0.395, x: sign * 0.003, rx: 0.019, rz: 0.015, ao: 0.72 },
      { y: -0.3, x: sign * 0.004, rx: 0.021, rz: 0.018, foldAmp: 0.08, foldFreq: 2, ao: 0.84 },
      { y: -0.15, x: sign * 0.004, rx: 0.026, rz: 0.024, foldAmp: 0.06, foldFreq: 3, ao: 0.92 },
      { y: -0.03, x: 0, rx: 0.028, rz: 0.026, ao: 0.86 },
      { y: 0.015, x: 0, rx: 0.026, rz: 0.024, ao: 0.78 },
    ],
    { radialSegments: 12, capBottom: true, capTop: true, capBottomDome: 0.01, capTopDome: 0.012 }
  )
  paintSkinSurface(forearm, {
    boneZones: [
      { x: sign * 0.012, y: -0.26, z: 0.012, rx: 0.012, ry: 0.065, rz: 0.012 },
      { x: sign * 0.01, y: -0.388, z: 0.004, rx: 0.014, ry: 0.014, rz: 0.014 },
    ],
  })
  return forearm
}

/**
 * Damaged undead human hand with exposed knuckles & long, bony crooked fingers.
 */
export function buildRevenantHandGeometry(sign = -1) {
  const palm = buildLoftedPartGeometry(
    [
      { y: -0.095, z: -0.005, rx: 0.031, rz: 0.011, foldAmp: 0.07, foldFreq: 4, ao: 0.84 },
      { y: -0.05, z: -0.002, rx: 0.028, rz: 0.012, foldAmp: 0.05, foldFreq: 4, ao: 0.9 },
      { y: -0.015, z: 0, rx: 0.022, rz: 0.013, ao: 0.84 },
      { y: 0.008, z: 0, rx: 0.019, rz: 0.013, ao: 0.78 },
    ],
    { radialSegments: 12, capBottom: true, capTop: true, capBottomDome: 0.008, capTopDome: 0.008 }
  )
  paintSkinSurface(palm, {
    boneZones: [{ x: 0, y: -0.06, z: 0.01, rx: 0.024, ry: 0.028, rz: 0.009 }],
  })

  const parts = [palm]
  const fingers = [
    { x0: sign * 0.024, z0: 0.004, len: 0.106, splayX: sign * 0.012, curlZ: -0.038, r: 0.0056 },
    { x0: sign * 0.008, z0: -0.002, len: 0.132, splayX: sign * 0.004, curlZ: -0.048, r: 0.0062 },
    { x0: -sign * 0.008, z0: -0.005, len: 0.142, splayX: -sign * 0.003, curlZ: -0.052, r: 0.0064 },
    { x0: -sign * 0.023, z0: -0.007, len: 0.126, splayX: -sign * 0.011, curlZ: -0.042, r: 0.006 },
  ]

  for (let i = 0; i < fingers.length; i += 1) {
    const f = fingers[i]
    const baseY = -0.09
    // Slightly twisted crooked angle on ring/index fingers
    const crookedJitter = i === 1 ? sign * 0.009 : i === 2 ? -sign * 0.007 : 0
    const finger = buildSplineLoft(
      [
        [f.x0, baseY + 0.008, f.z0],
        [f.x0 + f.splayX * 0.4 + crookedJitter, baseY - f.len * 0.35, f.z0 + f.curlZ * 0.2],
        [f.x0 + f.splayX * 0.78 - crookedJitter * 0.5, baseY - f.len * 0.72, f.z0 + f.curlZ * 0.62],
        [f.x0 + f.splayX * 0.68, baseY - f.len, f.z0 + f.curlZ],
      ],
      {
        tubularSegments: 9,
        radialSegments: 6,
        radiusX: f.r,
        radiusY: f.r * 0.9,
        taperStart: 1.0,
        taperMid: 0.76,
        taperEnd: 0.24,
        aoStart: 0.88,
        aoEnd: 0.52,
        profileFn: (t, base) => {
          const knuckle =
            gaussian(t, 0.34, 0.08) * 0.24 + gaussian(t, 0.68, 0.08) * 0.2
          return base * (1 + knuckle)
        },
      }
    )
    paintSkinSurface(finger, {
      boneZones: [
        { x: f.x0 + f.splayX * 0.4, y: baseY - f.len * 0.35, z: f.z0 + f.curlZ * 0.22, rx: 0.009, ry: 0.012, rz: 0.009 },
        { x: f.x0 + f.splayX * 0.68, y: baseY - f.len * 0.96, z: f.z0 + f.curlZ * 0.96, rx: 0.008, ry: 0.012, rz: 0.008 },
      ],
    })
    parts.push(finger)
  }

  const thumb = buildSplineLoft(
    [
      [-sign * 0.023, -0.032, -0.003],
      [-sign * 0.044, -0.064, -0.019],
      [-sign * 0.054, -0.1, -0.037],
      [-sign * 0.045, -0.128, -0.05],
    ],
    {
      tubularSegments: 7,
      radialSegments: 6,
      radiusX: 0.0068,
      radiusY: 0.0062,
      taperStart: 1.05,
      taperMid: 0.76,
      taperEnd: 0.24,
      aoStart: 0.86,
      aoEnd: 0.52,
    }
  )
  paintSkinSurface(thumb)
  parts.push(thumb)

  return mergeAndDispose(parts)
}

/**
 * Ragged, mud-stained burial trousers thigh (hip y = 0 down to knee y = -0.46).
 */
export function buildRevenantThighTrouserGeometry() {
  return buildLoftedPartGeometry(
    [
      { y: -0.45, z: 0.0, rx: 0.058, rz: 0.056, foldAmp: 0.16, foldFreq: 7, ao: 0.54 },
      { y: -0.34, z: 0.0, rx: 0.066, rz: 0.064, foldAmp: 0.1, foldFreq: 5, ao: 0.72 },
      { y: -0.18, z: 0.0, rx: 0.076, rz: 0.074, foldAmp: 0.08, foldFreq: 4, ao: 0.86 },
      { y: -0.02, z: 0.0, rx: 0.082, rz: 0.078, ao: 0.88 },
      { y: 0.068, z: 0.0, rx: 0.076, rz: 0.072, ao: 0.76 },
    ],
    { radialSegments: 14, capBottom: true, capTop: true, capTopDome: 0.028 }
  )
}

/**
 * Decayed lower leg (knee y = 0 down to heel y = -0.48) with asymmetrical shin flesh/bone exposure
 * and a ruined bare undead human foot with curled bony toes.
 */
export function buildRevenantShinAndFootGeometry(isRight = false) {
  const shin = buildLoftedPartGeometry(
    [
      { y: -0.43, z: 0.008, rx: 0.032, rz: 0.034, ao: 0.7 },
      { y: -0.32, z: 0.012, rx: 0.036, rz: 0.039, ao: 0.82 },
      { y: -0.18, z: 0.016, rx: 0.048, rz: 0.049, ao: 0.9 },
      { y: -0.05, z: 0.005, rx: 0.046, rz: 0.046, ao: 0.86 },
      { y: 0.02, z: 0.0, rx: 0.048, rz: 0.047, ao: 0.76 },
    ],
    { radialSegments: 12, capBottom: true, capTop: true, capTopDome: 0.02 }
  )

  // Bare ruined undead foot & heel
  const footCore = buildLoftedPartGeometry(
    [
      { y: -0.478, z: -0.045, rx: 0.044, rz: 0.082, frontScale: 1.15, backScale: 0.8, ao: 0.56 },
      { y: -0.456, z: -0.038, rx: 0.043, rz: 0.076, frontScale: 1.12, backScale: 0.82, ao: 0.8 },
      { y: -0.432, z: -0.012, rx: 0.035, rz: 0.048, ao: 0.88 },
    ],
    { radialSegments: 12, capBottom: true, capTop: true }
  )

  const parts = [shin, footCore]

  // 5 crooked bony toes
  for (let t = 0; t < 5; t += 1) {
    const frac = (t - 2) / 2
    const tx = frac * 0.03
    const len = 0.038 - Math.abs(frac) * 0.01
    parts.push(
      buildSplineLoft(
        [
          [tx, -0.458, -0.115],
          [tx * 1.08, -0.464, -0.115 - len * 0.55],
          [tx * 1.12, -0.474, -0.115 - len],
        ],
        {
          tubularSegments: 4,
          radialSegments: 5,
          radiusX: t === 0 ? 0.0085 : 0.0058,
          radiusY: 0.0065,
          taperStart: 1.0,
          taperMid: 0.85,
          taperEnd: 0.45,
          aoStart: 0.8,
          aoEnd: 0.54,
        }
      )
    )
  }

  const merged = mergeAndDispose(parts)
  // Expose tibia shin bone patch asymmetrically on the right shin
  const zones = isRight
    ? [{ x: 0.008, y: -0.22, z: -0.036, rx: 0.016, ry: 0.085, rz: 0.018 }]
    : [{ x: -0.006, y: -0.03, z: -0.036, rx: 0.022, ry: 0.025, rz: 0.022 }]
  paintSkinSurface(merged, { boneZones: zones })
  return merged
}

function buildRevenantEyelid({ eyeX, eyeY, eyeZ, eyeRadius, isUpper, sign, openFactor = 1.0 }) {
  const cols = 10
  const rows = 5
  const totalVerts = (cols + 1) * (rows + 1)
  const positions = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const colors = new Float32Array(totalVerts * 3)
  const indices = []

  const rLid = eyeRadius + 0.0014
  for (let r = 0; r <= rows; r += 1) {
    const v = r / rows
    for (let c = 0; c <= cols; c += 1) {
      const u = c / cols
      const almond = Math.sin(u * Math.PI) * (0.95 + 0.12 * Math.sin((u - 0.16) * Math.PI))
      const yaw = lerp(-0.62 * sign, 0.66 * sign, u)
      const marginPitch = isUpper
        ? lerp(0.04, 0.34 * almond * openFactor, almond)
        : -lerp(0.07, 0.28 * almond * openFactor, almond)
      const outerPitch = isUpper
        ? lerp(0.2, 0.86 * almond, almond)
        : -lerp(0.16, 0.68 * almond, almond)

      const pitch =
        r === 0
          ? marginPitch
          : lerp(marginPitch, outerPitch, smoothstep(0.16, 1.0, v))

      const rr = r === 0 ? eyeRadius - 0.0004 : rLid + Math.sin(v * Math.PI) * 0.0012
      const socketTuckZ =
        r === 0
          ? 0.0014
          : Math.pow(smoothstep(0.16, 1.0, v), 1.3) * 0.016 +
            Math.pow(Math.abs(u * 2 - 1), 2.1) * 0.0046

      const px = eyeX + Math.sin(yaw) * Math.cos(pitch) * rr
      const py = eyeY + Math.sin(pitch) * rr
      const pz = eyeZ - Math.cos(yaw) * Math.cos(pitch) * rr * 0.9 + socketTuckZ

      const idx = r * (cols + 1) + c
      positions[idx * 3] = px
      positions[idx * 3 + 1] = py
      positions[idx * 3 + 2] = pz
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = v

      const shade = lerp(0.38, 0.78, smoothstep(0.0, 0.85, v))
      colors[idx * 3] = shade
      colors[idx * 3 + 1] = shade
      colors[idx * 3 + 2] = shade
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

function buildRevenantNose(headCenterY, headCenterZ) {
  const nose = buildLoftedPartGeometry(
    [
      { y: -0.024, x: -0.001, z: 0.004, rx: 0.013, rz: 0.011, frontScale: 0.92, backScale: 0.85, ao: 0.6 },
      {
        y: -0.016,
        x: -0.0022,
        z: -0.007,
        rx: 0.0155,
        rz: 0.014,
        frontScale: 1.15,
        backScale: 0.75,
        foldAmp: 0.08,
        foldFreq: 2,
        foldPhase: -Math.PI * 0.5,
        ao: 0.88,
      },
      { y: -0.008, x: -0.002, z: -0.0135, rx: 0.009, rz: 0.012, frontScale: 1.16, pinchFront: 0.18, ao: 1.0 },
      { y: 0.007, x: -0.0005, z: -0.008, rx: 0.0072, rz: 0.0108, frontScale: 1.1, pinchFront: 0.24, ao: 0.96 },
      { y: 0.023, x: 0.0, z: -0.002, rx: 0.007, rz: 0.009, pinchFront: 0.2, ao: 0.88 },
      { y: 0.036, x: 0.0, z: 0.0055, rx: 0.01, rz: 0.0075, ao: 0.78 },
    ],
    { radialSegments: 12, capBottom: true, capTop: false }
  )

  const nostrilLeft = transformGeo(new THREE.SphereGeometry(0.0042, 7, 5), {
    x: -0.0082,
    y: -0.021,
    z: -0.0078,
    sx: 0.9,
    sy: 0.52,
    sz: 1.15,
    ao: 0.3,
  })
  const nostrilRight = transformGeo(new THREE.SphereGeometry(0.0042, 7, 5), {
    x: 0.0048,
    y: -0.02,
    z: -0.0078,
    sx: 0.9,
    sy: 0.52,
    sz: 1.15,
    ao: 0.3,
  })

  return transformGeo(mergeAndDispose([nose, nostrilLeft, nostrilRight]), {
    x: 0,
    y: headCenterY - 0.006,
    z: headCenterZ - 0.084,
  })
}

function buildRevenantMouth(headCenterY, headCenterZ) {
  const mouthLineY = headCenterY - 0.046
  const mouthLineZ = headCenterZ - 0.082

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

    const lipWidth = isUpper ? 0.024 : 0.021
    const partGap = isUpper ? 0.0036 : -0.0046

    for (let r = 0; r < rows; r += 1) {
      const v = r / segsV
      for (let c = 0; c < cols; c += 1) {
        const u = c / segsU
        const s = u * 2 - 1
        const absS = Math.abs(s)
        const taper = Math.sqrt(Math.max(0, 1 - absS * absS))

        // Uneven snarl/rot split on the right upper corner exposing dull teeth
        const asymGap = s > 0 ? 0.0022 * smoothstep(0.0, 0.7, s) : 0
        const cornerDrop = absS * absS * 0.003 + (s < 0 ? -s * 0.0028 : 0)
        const heightSpan = isUpper ? (0.0038 * taper + asymGap) * v : -(0.0042 * taper) * v

        const archZ = absS * absS * 0.009
        const seamTuck = (1 - smoothstep(0.0, 0.32, v)) * 0.0034
        const outerTuck = smoothstep(0.72, 1.0, v) * 0.0034
        const ridgeZ = Math.sin(smoothstep(0.1, 0.9, v) * Math.PI) * taper * 0.0038

        const px = s * lipWidth
        const py = mouthLineY + partGap * taper + heightSpan - cornerDrop
        const pz = mouthLineZ + archZ - ridgeZ + seamTuck + outerTuck

        const idx = r * cols + c
        positions[idx * 3] = px
        positions[idx * 3 + 1] = py
        positions[idx * 3 + 2] = pz
        uvs[idx * 2] = u
        uvs[idx * 2 + 1] = v

        const ao = clamp((1 - smoothstep(0.5, 1.0, absS) * 0.35) * lerp(0.35, 0.8, smoothstep(0.0, 0.5, v)), 0.25, 0.85)
        colors[idx * 3] = ao
        colors[idx * 3 + 1] = ao
        colors[idx * 3 + 2] = ao
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
    paintSkinSurface(geo, { fleshBrightness: 0.72 })
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  }

  const oralCavity = transformGeo(new THREE.SphereGeometry(0.016, 8, 6), {
    x: 0,
    y: mouthLineY - 0.001,
    z: mouthLineZ + 0.008,
    sx: 1.25,
    sy: 0.36,
    sz: 0.44,
    ao: 0.14,
    tintR: 0.45,
    tintG: 0.35,
    tintB: 0.35,
  })

  // Subtle dull crooked organic tapered teeth inside the parted necrotic mouth
  const teethParts = []
  for (let t = -3; t <= 3; t += 1) {
    const tx = t * 0.0046
    const tz = mouthLineZ + 0.0022 + Math.abs(t) * 0.0015
    const tooth = new THREE.CylinderGeometry(0.002, 0.001, 0.0052, 5)
    teethParts.push(
      tintBoneGeometry(
        transformGeo(tooth, {
          x: tx,
          y: mouthLineY + 0.0005 + (t % 2) * 0.0006,
          z: tz,
          rz: (t % 3) * 0.09,
          ao: 0.74,
        })
      )
    )
  }

  return [buildLipHalf(true), buildLipHalf(false), oralCavity, ...teethParts]
}

function buildOpenFrontCoat(rings, { thetaStart, thetaEnd, radialSegments = 20, ribTearCenterY = 0.41 }) {
  const cols = radialSegments + 1
  const totalVerts = rings.length * cols
  const positions = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const colors = new Float32Array(totalVerts * 3)
  const indices = []

  const minY = rings[0].y
  const spanY = Math.max(1e-5, rings[rings.length - 1].y - minY)

  for (let rIdx = 0; rIdx < rings.length; rIdx += 1) {
    const ring = rings[rIdx]
    const cx = ring.x ?? 0
    const cy = ring.y
    const cz = ring.z ?? 0
    const rx = ring.rx
    const rz = ring.rz
    const foldAmp = ring.foldAmp ?? 0
    const foldFreq = ring.foldFreq ?? 5
    const ao = ring.ao ?? 0.85
    const v = (cy - minY) / spanY

    for (let c = 0; c <= radialSegments; c += 1) {
      const u = c / radialSegments
      const theta = lerp(thetaStart, thetaEnd, u)
      const fold = foldAmp !== 0 ? Math.sin(theta * foldFreq + rIdx * 0.6) * foldAmp : 0
      let px = cx + Math.cos(theta) * rx * (1 + fold)
      let pz = cz + Math.sin(theta) * rz * (1 + fold)

      // Pull coat edges slightly inward at torn right-chest ribcage wound gap
      const ribGapDist = Math.hypot((px - 0.14) / 0.09, (cy - ribTearCenterY) / 0.14)
      if (ribGapDist < 1.0 && pz < 0.02) {
        const tuck = smoothstep(1.0, 0.2, ribGapDist)
        px -= tuck * 0.035
        pz += tuck * 0.02
      }

      const idx = rIdx * cols + c
      positions[idx * 3] = px
      positions[idx * 3 + 1] = cy
      positions[idx * 3 + 2] = pz
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = v

      const mudHem = smoothstep(0.35, 0.0, v) * 0.25
      const dirtPatch = (Math.cos(px * 22 + cy * 19) * 0.5 + 0.5) * 0.16
      const shade = clamp(ao * (0.86 + fold * 1.15 - mudHem - dirtPatch), 0.24, 1.0)
      colors[idx * 3] = shade
      colors[idx * 3 + 1] = shade * 0.96
      colors[idx * 3 + 2] = shade * 0.9
    }
  }

  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let c = 0; c < radialSegments; c += 1) {
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

function buildRaggedStrip(points, widthStart, widthEnd, aoStart, aoEnd) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  )
  const segsU = 3
  const segsV = 8
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

    const jag = 1 + Math.sin(v * 16.0) * 0.18 * smoothstep(0.35, 1.0, v)
    const halfW = lerp(widthStart, widthEnd, Math.pow(v, 0.85)) * jag
    const ao = lerp(aoStart, aoEnd, v)

    for (let c = 0; c < cols; c += 1) {
      const u = c / segsU
      const s = u * 2 - 1
      const idx = r * cols + c
      positions[idx * 3] = pt.x + side.x * s * halfW
      positions[idx * 3 + 1] = pt.y + side.y * s * halfW
      positions[idx * 3 + 2] = pt.z + side.z * s * halfW + (1 - s * s) * 0.01
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = v
      const edgeAO = 1 - Math.abs(s) * 0.22
      colors[idx * 3] = ao * edgeAO
      colors[idx * 3 + 1] = ao * edgeAO * 0.96
      colors[idx * 3 + 2] = ao * edgeAO * 0.9
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
