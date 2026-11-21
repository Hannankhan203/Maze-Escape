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
    const sternalHollow = ring.sternalHollow ?? 0
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

      let ribShade = 1.0
      if (sternalHollow !== 0 && rawSin < 0) {
        const frontW = -rawSin
        const sternumDip = Math.exp(-Math.pow(rawCos / 0.2, 2))
        const ribArch = Math.exp(-Math.pow((Math.abs(rawCos) - 0.56) / 0.28, 2))
        pz += frontW * sternalHollow * (sternumDip * 0.9 - ribArch * 0.55)
        ribShade -= sternumDip * frontW * 0.14
      }

      if (spineGroove !== 0 && rawSin > 0.3) {
        const ridge = Math.exp(-Math.pow(rawCos / 0.16, 2)) * rawSin
        const flank = Math.exp(-Math.pow((Math.abs(rawCos) - 0.34) / 0.18, 2)) * rawSin
        pz += ridge * spineGroove - flank * spineGroove * 0.55
        ribShade -= flank * 0.12
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
        foldShade += foldWave * Math.min(0.12, Math.abs(foldAmp) * 1.4)
      }

      const p = vCursor * 3
      const up = vCursor * 2
      positions[p] = cx + px
      positions[p + 1] = cy + pz * ringTiltX + px * ringTiltZ
      positions[p + 2] = cz + pz

      uvs[up] = frac * uRepeat
      uvs[up + 1] = vCoord

      const shade = clamp(ao * foldShade * ribShade, 0.32, 1.08)
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

/**
 * Builds gaunt eyelid margins sculpted tightly into deep recessed orbital sockets.
 */
function buildWraithEyelid({ eyeX, eyeY, eyeZ, eyeRadius, isUpper, sign }) {
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
      const almond = Math.sin(u * Math.PI) * (0.96 + 0.12 * Math.sin((u - 0.16) * Math.PI))
      const yaw = lerp(-0.64 * sign, 0.68 * sign, u)
      const marginPitch = isUpper
        ? lerp(0.05, 0.32 * almond, almond)
        : -lerp(0.07, 0.28 * almond, almond)
      const outerPitch = isUpper
        ? lerp(0.22, 0.88 * almond, almond)
        : -lerp(0.18, 0.72 * almond, almond)

      const pitch =
        r === 0
          ? marginPitch
          : lerp(marginPitch, outerPitch, smoothstep(0.15, 1.0, v))

      const rr = r === 0 ? eyeRadius - 0.0004 : rLid + Math.sin(v * Math.PI) * 0.0012
      const socketTuckZ =
        r === 0
          ? 0.0015
          : Math.pow(smoothstep(0.15, 1.0, v), 1.25) * 0.017 +
            Math.pow(Math.abs(u * 2 - 1), 2.1) * 0.0048

      const px = eyeX + Math.sin(yaw) * Math.cos(pitch) * rr
      const py = eyeY + Math.sin(pitch) * rr
      const pz = eyeZ - Math.cos(yaw) * Math.cos(pitch) * rr * 0.92 + socketTuckZ

      const idx = r * (cols + 1) + c
      positions[idx * 3] = px
      positions[idx * 3 + 1] = py
      positions[idx * 3 + 2] = pz
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = v

      // Deep dark orbital shadow around the sunken eyes
      const shade = lerp(0.26, 0.62, smoothstep(0.0, 0.85, v))
      colors[idx * 3] = shade * 0.86
      colors[idx * 3 + 1] = shade * 0.92
      colors[idx * 3 + 2] = shade * 1.0
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

function buildWraithNose(headCenterY, headCenterZ) {
  // Narrow, gaunt, sharply sculpted human nasal bridge, pinched tip & recessed nostrils
  const nose = buildLoftedPartGeometry(
    [
      {
        y: -0.024,
        z: 0.005,
        rx: 0.0115,
        rz: 0.01,
        frontScale: 0.9,
        backScale: 0.85,
        ao: 0.56,
        colorR: 0.88,
        colorG: 0.93,
        colorB: 1.0,
      },
      {
        y: -0.016,
        z: -0.007,
        rx: 0.0138,
        rz: 0.0135,
        superExp: 2.1,
        frontScale: 1.18,
        backScale: 0.75,
        foldAmp: 0.08,
        foldFreq: 2,
        foldPhase: -Math.PI * 0.5,
        ao: 0.86,
      },
      {
        y: -0.0075,
        z: -0.0145,
        rx: 0.0078,
        rz: 0.012,
        frontScale: 1.2,
        backScale: 0.85,
        pinchFront: 0.22,
        ao: 1.0,
      },
      {
        y: 0.009,
        z: -0.0086,
        rx: 0.0064,
        rz: 0.0108,
        frontScale: 1.12,
        pinchFront: 0.28,
        ao: 0.96,
      },
      {
        y: 0.025,
        z: -0.0018,
        rx: 0.0062,
        rz: 0.0088,
        frontScale: 1.0,
        pinchFront: 0.24,
        ao: 0.84,
      },
      {
        y: 0.039,
        z: 0.006,
        rx: 0.0092,
        rz: 0.0072,
        ao: 0.72,
      },
    ],
    { radialSegments: 12, capBottom: true, capTop: false }
  )

  const nostrilLeft = transformGeo(new THREE.SphereGeometry(0.0038, 8, 6), {
    x: -0.0058,
    y: -0.021,
    z: -0.0076,
    sx: 0.85,
    sy: 0.52,
    sz: 1.15,
    ao: 0.26,
  })
  const nostrilRight = transformGeo(new THREE.SphereGeometry(0.0038, 8, 6), {
    x: 0.0058,
    y: -0.021,
    z: -0.0076,
    sx: 0.85,
    sy: 0.52,
    sz: 1.15,
    ao: 0.26,
  })

  return transformGeo(mergeAndDispose([nose, nostrilLeft, nostrilRight]), {
    x: 0,
    y: headCenterY - 0.006,
    z: headCenterZ - 0.083,
  })
}

function buildWraithLipsAndMouth(headCenterY, headCenterZ) {
  // Slightly parted gaunt desiccated human lips over a shadowy recessed mouth hollow
  const mouthLineY = headCenterY - 0.052
  const mouthLineZ = headCenterZ - 0.079

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

    const lipWidth = isUpper ? 0.0245 : 0.0215
    const partGap = isUpper ? 0.0032 : -0.0038

    for (let r = 0; r < rows; r += 1) {
      const v = r / segsV
      for (let c = 0; c < cols; c += 1) {
        const u = c / segsU
        const s = u * 2 - 1
        const absS = Math.abs(s)
        const taper = Math.sqrt(Math.max(0, 1 - absS * absS))

        const cupidsBow = isUpper
          ? (gaussian(s, -0.24, 0.2) +
              gaussian(s, 0.24, 0.2) -
              gaussian(s, 0, 0.14) * 0.44) *
            0.0018
          : 0
        const cornerDroop = absS * absS * 0.0034
        const heightSpan = isUpper
          ? (0.0036 * taper + cupidsBow) * v
          : -(0.004 * taper) * v

        const archZ = absS * absS * 0.0092
        const seamTuck = (1 - smoothstep(0.0, 0.34, v)) * 0.0035
        const outerTuck = smoothstep(0.7, 1.0, v) * 0.0034
        const ridgeZ =
          Math.sin(smoothstep(0.1, 0.9, v) * Math.PI) *
          taper *
          (isUpper ? 0.0036 : 0.004)

        const px = s * lipWidth
        const py = mouthLineY + partGap * taper + heightSpan - cornerDroop
        const pz = mouthLineZ + archZ - ridgeZ + seamTuck + outerTuck

        const idx = r * cols + c
        positions[idx * 3] = px
        positions[idx * 3 + 1] = py
        positions[idx * 3 + 2] = pz
        uvs[idx * 2] = u
        uvs[idx * 2 + 1] = v

        const cornerAO = 1 - smoothstep(0.48, 1.0, absS) * 0.38
        const seamAO = lerp(0.32, 0.78, smoothstep(0.0, 0.48, v))
        const ao = clamp(cornerAO * seamAO, 0.28, 0.82)
        colors[idx * 3] = ao * 0.78
        colors[idx * 3 + 1] = ao * 0.84
        colors[idx * 3 + 2] = ao * 0.94
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

  const oralCavity = transformGeo(new THREE.SphereGeometry(0.016, 10, 8), {
    x: 0,
    y: mouthLineY - 0.001,
    z: mouthLineZ + 0.007,
    sx: 1.25,
    sy: 0.34,
    sz: 0.45,
    ao: 0.14,
    tintR: 0.65,
    tintG: 0.72,
    tintB: 0.85,
  })

  return [buildLipHalf(true), buildLipHalf(false), oralCavity]
}

/**
 * Gaunt, emaciated torso with exposed rib arches, protruding clavicles,
 * sunken sternum hollow, and thoracic vertebral column relative to `upperBodyPivot` (y = 1.02m).
 */
export function buildWraithTorsoGeometry() {
  const torso = buildLoftedPartGeometry(
    [
      { y: -0.02, z: 0.01, rx: 0.088, rz: 0.06, ao: 0.38 },
      { y: 0.1, z: 0.008, rx: 0.095, rz: 0.064, sternalHollow: 0.008, spineGroove: 0.014, ao: 0.58 },
      { y: 0.24, z: 0.004, rx: 0.106, rz: 0.072, sternalHollow: 0.012, spineGroove: 0.016, ao: 0.72 },
      {
        y: 0.38,
        z: 0.0,
        rx: 0.144,
        rz: 0.092,
        frontScale: 1.02,
        backScale: 0.94,
        sternalHollow: 0.02,
        spineGroove: 0.018,
        ao: 0.86,
      },
      {
        y: 0.52,
        z: -0.004,
        rx: 0.168,
        rz: 0.098,
        frontScale: 1.04,
        backScale: 0.96,
        sternalHollow: 0.022,
        spineGroove: 0.018,
        ao: 0.95,
      },
      {
        y: 0.64,
        z: -0.006,
        rx: 0.194,
        rz: 0.088,
        frontScale: 1.0,
        backScale: 0.95,
        sternalHollow: 0.018,
        spineGroove: 0.016,
        ao: 0.96,
      },
      {
        y: 0.7,
        z: -0.012,
        rx: 0.118,
        rz: 0.068,
        ao: 0.86,
      },
      { y: 0.74, z: -0.016, rx: 0.048, rz: 0.046, ao: 0.76 },
    ],
    {
      radialSegments: 22,
      capBottom: true,
      capTop: false,
      capBottomDome: 0.015,
    }
  )

  const parts = [torso]

  // Sharp gaunt clavicles & suprasternal notch contour
  for (const sign of [-1, 1]) {
    parts.push(
      buildSplineLoft(
        [
          [sign * 0.018, 0.688, -0.058],
          [sign * 0.085, 0.696, -0.064],
          [sign * 0.155, 0.692, -0.042],
          [sign * 0.212, 0.678, -0.012],
        ],
        {
          tubularSegments: 8,
          radialSegments: 7,
          radiusX: 0.012,
          radiusY: 0.009,
          taperStart: 0.95,
          taperMid: 0.72,
          taperEnd: 1.15,
          aoStart: 0.92,
          aoEnd: 0.86,
        }
      )
    )

    // Exposed anterior rib contours curving out from sunken sternum
    const ribYs = [0.58, 0.505, 0.43, 0.355]
    for (let r = 0; r < ribYs.length; r += 1) {
      const ry = ribYs[r]
      const widthScale = 1 - r * 0.075
      parts.push(
        buildSplineLoft(
          [
            [sign * 0.02, ry + 0.018, -0.086 * widthScale],
            [sign * 0.075 * widthScale, ry + 0.006, -0.095 * widthScale],
            [sign * 0.138 * widthScale, ry - 0.012, -0.062 * widthScale],
            [sign * 0.158 * widthScale, ry - 0.022, 0.008],
          ],
          {
            tubularSegments: 7,
            radialSegments: 6,
            radiusX: 0.0095,
            radiusY: 0.0075,
            taperStart: 0.82,
            taperMid: 1.05,
            taperEnd: 0.55,
            aoStart: 0.88,
            aoEnd: 0.74,
          }
        )
      )
    }

    // Protruding gaunt scapula ridge on upper back
    parts.push(
      buildSplineLoft(
        [
          [sign * 0.062, 0.635, 0.074],
          [sign * 0.118, 0.59, 0.084],
          [sign * 0.095, 0.48, 0.078],
        ],
        {
          tubularSegments: 6,
          radialSegments: 6,
          radiusX: 0.015,
          radiusY: 0.008,
          taperStart: 0.95,
          taperMid: 1.05,
          taperEnd: 0.5,
          aoStart: 0.84,
          aoEnd: 0.68,
          upHint: [0, 0, 1],
        }
      )
    )
  }

  return mergeAndDispose(parts)
}

/**
 * Slightly elongated, sinewy human neck with sternocleidomastoid tendons,
 * tracheal throat prominence, and cervical vertebrae ridges relative to `neckPivot`.
 */
export function buildWraithNeckGeometry() {
  const neckCore = buildLoftedPartGeometry(
    [
      { y: -0.025, z: 0.008, rx: 0.048, rz: 0.046, ao: 0.72 },
      { y: 0.02, z: 0.004, rx: 0.041, rz: 0.042, ao: 0.8 },
      { y: 0.085, z: -0.003, rx: 0.036, rz: 0.038, sternalHollow: 0.005, spineGroove: 0.006, ao: 0.88 },
      { y: 0.148, z: -0.01, rx: 0.035, rz: 0.039, sternalHollow: 0.004, spineGroove: 0.006, ao: 0.9 },
      { y: 0.212, z: -0.015, rx: 0.039, rz: 0.045, ao: 0.78 },
      { y: 0.258, z: -0.014, rx: 0.037, rz: 0.042, ao: 0.64 },
    ],
    { radialSegments: 14, capBottom: false, capTop: true }
  )

  const parts = [neckCore]
  for (const sign of [-1, 1]) {
    // Taut sternocleidomastoid tendon V-ing down to the sternal notch
    parts.push(
      buildSplineLoft(
        [
          [sign * 0.036, 0.242, -0.004],
          [sign * 0.032, 0.115, -0.024],
          [sign * 0.014, 0.005, -0.041],
        ],
        {
          tubularSegments: 8,
          radialSegments: 6,
          radiusX: 0.008,
          radiusY: 0.007,
          taperStart: 0.85,
          taperMid: 1.0,
          taperEnd: 0.7,
          aoStart: 0.84,
          aoEnd: 0.68,
        }
      )
    )
  }

  // Gaunt laryngeal cartilage (throat ridge)
  parts.push(
    transformGeo(new THREE.SphereGeometry(0.012, 8, 6), {
      x: 0,
      y: 0.125,
      z: -0.042,
      sx: 0.75,
      sy: 1.15,
      sz: 0.75,
      ao: 0.94,
    })
  )

  return mergeAndDispose(parts)
}

/**
 * Builds the detailed, unsettlingly elongated supernatural human head
 * (cranium, sunken temples, brow ridge, deeply recessed hollow eye sockets,
 * protruding cheekbones, sunken cheeks, nose, parted gaunt lips, ears,
 * eyelids) AND separate recessed supernatural eyes mesh geometry.
 */
export function buildWraithHeadAndEyesGeometries() {
  const headCenterY = 0.145
  const headCenterZ = -0.008

  const cranium = new THREE.SphereGeometry(1, 36, 26)
  const pos = cranium.attributes.position
  const colors = new Float32Array(pos.count * 3)

  for (let i = 0; i < pos.count; i += 1) {
    const ux = pos.getX(i)
    const uy = pos.getY(i)
    const uz = pos.getZ(i)

    // Unsettlingly narrow & elongated human head proportions
    let sx = ux * 0.068
    let sy = uy * 0.124
    let sz = uz * 0.096

    const isFront = uz < 0
    const frontMask = smoothstep(0.08, -0.35, uz)

    // Deep sunken temporal hollows
    const templePinch =
      gaussian(uy, 0.18, 0.25) *
      frontMask *
      smoothstep(0.38, 0.86, Math.abs(ux)) *
      0.18
    sx *= 1 - templePinch

    const parietalWidth = gaussian(uy, 0.46, 0.25) * smoothstep(-0.1, 0.45, uz) * 0.045
    sx *= 1 + parietalWidth
    if (uz > 0.15) {
      sz += gaussian(uy, 0.12, 0.46) * uz * 0.012
    }

    // Sharp gaunt jawline & narrow elongated chin
    const lowerFaceMask = smoothstep(-0.04, -0.88, uy)
    const gonialAngle =
      gaussian(uy, -0.48, 0.16) *
      smoothstep(0.3, 0.72, Math.abs(ux)) *
      smoothstep(0.25, -0.4, uz)
    sx *= 1 - lowerFaceMask * 0.42
    sx += Math.sign(ux) * gonialAngle * 0.0085

    if (isFront) {
      // Pointed gaunt chin
      const chinMask =
        gaussian(uy, -0.78, 0.14) *
        gaussian(ux, 0, 0.26) *
        smoothstep(-0.32, -0.88, uz)
      sz -= chinMask * 0.016
      sy -= chinMask * 0.008

      // Sharp protruding supraorbital brow ridge + glabella cleft
      const glabellaDip = gaussian(ux, 0, 0.11) * 0.34
      const browMask =
        gaussian(uy, 0.22, 0.09) *
        smoothstep(-0.18, -0.78, uz) *
        (1 - smoothstep(0.64, 0.92, Math.abs(ux))) *
        (1 - glabellaDip)
      sz -= browMask * 0.015

      // Deeply recessed hollow eye sockets
      const eyeDistL = Math.hypot((ux + 0.39) / 0.23, (uy - 0.04) / 0.16)
      const eyeDistR = Math.hypot((ux - 0.39) / 0.23, (uy - 0.04) / 0.16)
      const socketMask =
        (Math.exp(-(eyeDistL * eyeDistL)) + Math.exp(-(eyeDistR * eyeDistR))) *
        smoothstep(-0.32, -0.84, uz)
      sz += socketMask * 0.026

      // High sharp zygomatic cheekbones
      const cheekL = Math.exp(
        -(Math.pow((ux + 0.56) / 0.2, 2) + Math.pow((uy + 0.14) / 0.14, 2))
      )
      const cheekR = Math.exp(
        -(Math.pow((ux - 0.56) / 0.2, 2) + Math.pow((uy + 0.14) / 0.14, 2))
      )
      const cheekMask = (cheekL + cheekR) * smoothstep(-0.22, -0.82, uz)
      sz -= cheekMask * 0.0125
      sx += Math.sign(ux) * cheekMask * 0.0055

      // Deep sunken buccal hollows beneath cheekbones
      const hollowL = Math.exp(
        -(Math.pow((ux + 0.5) / 0.2, 2) + Math.pow((uy + 0.38) / 0.17, 2))
      )
      const hollowR = Math.exp(
        -(Math.pow((ux - 0.5) / 0.2, 2) + Math.pow((uy + 0.38) / 0.17, 2))
      )
      const hollowMask = (hollowL + hollowR) * smoothstep(-0.2, -0.78, uz)
      sx -= Math.sign(ux) * hollowMask * 0.011
      sz += hollowMask * 0.009

      // Subtle dental arch support & philtrum
      const mouthSupport =
        gaussian(uy, -0.48, 0.14) *
        gaussian(ux, 0, 0.28) *
        smoothstep(-0.44, -0.92, uz)
      sz -= mouthSupport * 0.0075
      const philtrum =
        gaussian(uy, -0.34, 0.08) *
        gaussian(ux, 0, 0.08) *
        smoothstep(-0.6, -0.95, uz)
      sz += philtrum * 0.0032
    }

    // Crisp submental tuck beneath mandible
    if (uy < -0.72) {
      const underChin = smoothstep(-0.72, -0.98, uy)
      sx *= 1 - underChin * 0.36
      sz *= 1 - underChin * 0.28
      sz += underChin * 0.014
      sy += underChin * 0.01
    }

    pos.setXYZ(i, sx, sy + headCenterY, sz + headCenterZ)

    // Ghostly pale grey-blue skin shading with bruised deep socket/cheek AO
    let ao = 0.96
    let tintR = 0.94
    const tintG = 0.98
    let tintB = 1.04

    if (isFront) {
      const eL = Math.hypot((ux + 0.39) / 0.23, (uy - 0.04) / 0.16)
      const eR = Math.hypot((ux - 0.39) / 0.23, (uy - 0.04) / 0.16)
      const orbAO =
        (Math.exp(-(eL * eL)) + Math.exp(-(eR * eR))) *
        smoothstep(-0.32, -0.84, uz)
      ao -= orbAO * 0.62

      const cheekHollowAO =
        (Math.exp(-(Math.pow((ux + 0.5) / 0.21, 2) + Math.pow((uy + 0.38) / 0.17, 2))) +
          Math.exp(-(Math.pow((ux - 0.5) / 0.21, 2) + Math.pow((uy + 0.38) / 0.17, 2)))) *
        smoothstep(-0.22, -0.84, uz)
      ao -= cheekHollowAO * 0.26

      const templeAO =
        gaussian(uy, 0.18, 0.25) *
        frontMask *
        smoothstep(0.42, 0.88, Math.abs(ux))
      ao -= templeAO * 0.18

      // Subtle cool slate tint in hollows
      tintR -= orbAO * 0.12 + cheekHollowAO * 0.06
      tintB += orbAO * 0.04
    }
    if (uy < -0.66) {
      ao -= smoothstep(-0.66, -0.96, uy) * 0.34
    }

    ao = clamp(ao, 0.22, 1.0)
    colors[i * 3] = clamp(ao * tintR, 0.18, 1.0)
    colors[i * 3 + 1] = clamp(ao * tintG, 0.2, 1.0)
    colors[i * 3 + 2] = clamp(ao * tintB, 0.24, 1.0)
  }
  pos.needsUpdate = true
  cranium.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  recomputeNormalsSafe(cranium, headCenterY, headCenterZ)

  const nose = buildWraithNose(headCenterY, headCenterZ)
  const mouthParts = buildWraithLipsAndMouth(headCenterY, headCenterZ)
  const skinParts = [cranium, nose, ...mouthParts]

  // Recessed orbital eyelid margins + gaunt human ears
  const eyeY = headCenterY + 0.004
  const eyeZ = headCenterZ - 0.0715
  const eyeXAbs = 0.0285

  for (const sign of [-1, 1]) {
    const eyeX = sign * eyeXAbs
    skinParts.push(
      buildWraithEyelid({ eyeX, eyeY, eyeZ, eyeRadius: 0.0102, isUpper: true, sign }),
      buildWraithEyelid({ eyeX, eyeY, eyeZ, eyeRadius: 0.0102, isUpper: false, sign })
    )

    // Gaunt human ear (helix + antihelix + concha)
    skinParts.push(
      buildSplineLoft(
        [
          [sign * 0.065, headCenterY + 0.012, headCenterZ + 0.002],
          [sign * 0.072, headCenterY + 0.026, headCenterZ + 0.011],
          [sign * 0.073, headCenterY + 0.006, headCenterZ + 0.02],
          [sign * 0.07, headCenterY - 0.016, headCenterZ + 0.016],
          [sign * 0.064, headCenterY - 0.024, headCenterZ + 0.006],
        ],
        {
          tubularSegments: 8,
          radialSegments: 6,
          radiusX: 0.0038,
          radiusY: 0.0046,
          taperStart: 0.65,
          taperMid: 1.0,
          taperEnd: 0.88,
          aoStart: 0.78,
          aoEnd: 0.86,
          upHint: [sign, 0, 0],
        }
      ),
      buildSplineLoft(
        [
          [sign * 0.067, headCenterY + 0.013, headCenterZ + 0.009],
          [sign * 0.069, headCenterY + 0.002, headCenterZ + 0.014],
          [sign * 0.067, headCenterY - 0.011, headCenterZ + 0.011],
        ],
        {
          tubularSegments: 4,
          radialSegments: 5,
          radiusX: 0.0024,
          radiusY: 0.003,
          taperStart: 0.75,
          taperMid: 1.0,
          taperEnd: 0.75,
          aoStart: 0.72,
          aoEnd: 0.8,
          upHint: [sign, 0, 0],
        }
      ),
      transformGeo(new THREE.SphereGeometry(0.0105, 8, 6), {
        x: sign * 0.065,
        y: headCenterY + 0.002,
        z: headCenterZ + 0.011,
        ry: sign * 0.25,
        sx: 0.3,
        sy: 1.15,
        sz: 0.78,
        ao: 0.6,
      })
    )
  }

  // Deeply recessed ghostly eyes (pinpoint glowing irises inside dark orbital sockets)
  const eyeParts = []
  for (const sign of [-1, 1]) {
    const eyeGeo = new THREE.SphereGeometry(0.0092, 12, 10)
    const ePos = eyeGeo.attributes.position
    const eCols = new Float32Array(ePos.count * 3)
    for (let i = 0; i < ePos.count; i += 1) {
      const ex = ePos.getX(i) / 0.0092
      const ey = ePos.getY(i) / 0.0092
      const ez = ePos.getZ(i) / 0.0092
      const radial = Math.hypot(ex, ey)
      let lum = 0.28
      if (ez < -0.2) {
        if (radial < 0.24) {
          // Piercing dark pinpoint pupil
          lum = 0.14
        } else if (radial < 0.62) {
          // Subtle luminous spectral iris
          lum = 1.0
        } else {
          // Sunken shaded sclera inside hollow socket
          lum = 0.32
        }
      }
      eCols[i * 3] = lum
      eCols[i * 3 + 1] = lum
      eCols[i * 3 + 2] = lum
    }
    eyeGeo.setAttribute('color', new THREE.BufferAttribute(eCols, 3))
    eyeParts.push(
      transformGeo(eyeGeo, {
        x: sign * eyeXAbs,
        y: eyeY,
        z: eyeZ,
        sz: 0.86,
      })
    )
  }

  return {
    headSkin: mergeAndDispose(skinParts),
    eyes: mergeAndDispose(eyeParts),
  }
}

/**
 * Unnaturally long, wasted gaunt upper arm from shoulder (y = 0) down to elbow (y = -0.42).
 */
export function buildWraithUpperArmGeometry(sign = -1) {
  const arm = buildLoftedPartGeometry(
    [
      { y: -0.435, x: sign * 0.008, rx: 0.025, rz: 0.023, ao: 0.72 },
      { y: -0.37, x: sign * 0.007, rx: 0.022, rz: 0.021, ao: 0.76 },
      { y: -0.22, x: sign * 0.004, rx: 0.024, rz: 0.025, foldAmp: 0.06, foldFreq: 3, ao: 0.88 },
      { y: -0.07, x: sign * 0.002, rx: 0.031, rz: 0.03, ao: 0.9 },
      { y: 0.015, x: -sign * 0.004, rx: 0.037, rz: 0.034, ao: 0.84 },
    ],
    {
      radialSegments: 12,
      capBottom: true,
      capTop: true,
      capBottomDome: 0.014,
      capTopDome: 0.018,
    }
  )

  // Bony olecranon tip at elbow
  const elbowKnob = transformGeo(new THREE.SphereGeometry(0.024, 8, 6), {
    x: sign * 0.008,
    y: -0.425,
    z: 0.01,
    sx: 0.85,
    sy: 1.05,
    sz: 0.9,
    ao: 0.8,
  })

  return mergeAndDispose([arm, elbowKnob])
}

/**
 * Long, thin skeletal forearm from elbow (y = 0) down to wrist (y = -0.44).
 */
export function buildWraithForearmGeometry(sign = -1) {
  const forearm = buildLoftedPartGeometry(
    [
      { y: -0.445, x: sign * 0.003, rx: 0.016, rz: 0.013, ao: 0.72 },
      { y: -0.35, x: sign * 0.004, rx: 0.017, rz: 0.014, foldAmp: 0.08, foldFreq: 2, ao: 0.82 },
      { y: -0.18, x: sign * 0.004, rx: 0.021, rz: 0.019, foldAmp: 0.07, foldFreq: 3, ao: 0.9 },
      { y: -0.04, x: sign * 0.002, rx: 0.025, rz: 0.023, ao: 0.88 },
      { y: 0.015, x: 0, rx: 0.024, rz: 0.022, ao: 0.8 },
    ],
    {
      radialSegments: 12,
      capBottom: true,
      capTop: true,
      capBottomDome: 0.01,
      capTopDome: 0.012,
    }
  )

  // Ulna wrist bone bump
  const wristBone = transformGeo(new THREE.SphereGeometry(0.014, 8, 6), {
    x: sign * 0.01,
    y: -0.435,
    z: 0.004,
    sx: 0.72,
    sy: 1.15,
    sz: 0.82,
    ao: 0.76,
  })

  return mergeAndDispose([forearm, wristBone])
}

/**
 * Elongated skeletal palm with 5 crooked, elongated claw-like fingers relative to `wristPivot`.
 */
export function buildWraithClawHandGeometry(sign = -1) {
  const palm = buildLoftedPartGeometry(
    [
      { y: -0.108, z: -0.006, rx: 0.026, rz: 0.009, foldAmp: 0.06, foldFreq: 4, ao: 0.82 },
      { y: -0.062, z: -0.003, rx: 0.025, rz: 0.01, foldAmp: 0.05, foldFreq: 4, ao: 0.88 },
      { y: -0.018, z: 0, rx: 0.02, rz: 0.012, ao: 0.84 },
      { y: 0.008, z: 0, rx: 0.016, rz: 0.012, ao: 0.76 },
    ],
    {
      radialSegments: 12,
      capBottom: true,
      capTop: true,
      capBottomDome: 0.008,
      capTopDome: 0.008,
    }
  )

  const parts = [palm]

  // 4 elongated crooked fingers (index, middle, ring, pinky) + opposable thumb
  const fingers = [
    // Pinky (outer)
    {
      x0: sign * 0.022,
      z0: 0.004,
      len: 0.118,
      splayX: sign * 0.016,
      curlZ: -0.044,
      r: 0.0052,
    },
    // Ring
    {
      x0: sign * 0.008,
      z0: -0.002,
      len: 0.146,
      splayX: sign * 0.008,
      curlZ: -0.054,
      r: 0.0058,
    },
    // Middle (longest talon)
    {
      x0: -sign * 0.007,
      z0: -0.006,
      len: 0.162,
      splayX: -sign * 0.002,
      curlZ: -0.06,
      r: 0.0062,
    },
    // Index (inner)
    {
      x0: -sign * 0.021,
      z0: -0.008,
      len: 0.144,
      splayX: -sign * 0.014,
      curlZ: -0.05,
      r: 0.0058,
    },
  ]

  for (let i = 0; i < fingers.length; i += 1) {
    const f = fingers[i]
    const baseY = -0.102
    parts.push(
      buildSplineLoft(
        [
          [f.x0, baseY + 0.01, f.z0],
          [f.x0 + f.splayX * 0.45, baseY - f.len * 0.36, f.z0 + f.curlZ * 0.22],
          [f.x0 + f.splayX * 0.85, baseY - f.len * 0.72, f.z0 + f.curlZ * 0.62],
          [f.x0 + f.splayX * 0.7, baseY - f.len, f.z0 + f.curlZ],
        ],
        {
          tubularSegments: 9,
          radialSegments: 6,
          radiusX: f.r,
          radiusY: f.r * 0.92,
          taperStart: 1.0,
          taperMid: 0.72,
          taperEnd: 0.12,
          aoStart: 0.88,
          aoEnd: 0.4,
          tintStart: [0.96, 0.98, 1.0],
          tintEnd: [0.64, 0.7, 0.78],
          profileFn: (t, base) => {
            // Subtle bony knuckle ridges along the phalanges
            const knuckle = gaussian(t, 0.34, 0.08) * 0.18 + gaussian(t, 0.68, 0.08) * 0.15
            return base * (1 + knuckle)
          },
        }
      )
    )
  }

  // Elongated crooked thumb
  parts.push(
    buildSplineLoft(
      [
        [-sign * 0.021, -0.036, -0.004],
        [-sign * 0.044, -0.072, -0.022],
        [-sign * 0.056, -0.112, -0.042],
        [-sign * 0.046, -0.145, -0.058],
      ],
      {
        tubularSegments: 8,
        radialSegments: 6,
        radiusX: 0.0064,
        radiusY: 0.0058,
        taperStart: 1.05,
        taperMid: 0.72,
        taperEnd: 0.12,
        aoStart: 0.86,
        aoEnd: 0.42,
        tintEnd: [0.64, 0.7, 0.78],
      }
    )
  )

  return mergeAndDispose(parts)
}

/**
 * Torn, flowing shadow-like robes (upper mantle/cowl + shredded lower robe shroud +
 * semi-transparent outer veil) AND lower-body supernatural mist dissolution (no feet).
 */
export function buildWraithRobeAndMistGeometries() {
  // 1. Upper shadow robe mantle & high tattered collar (leaves front clavicles/sternum & face open)
  const mantleRings = [
    { y: 0.08, z: 0.025, rx: 0.135, rz: 0.095, foldAmp: 0.11, foldFreq: 7, ao: 0.62 },
    { y: 0.34, z: 0.022, rx: 0.165, rz: 0.112, foldAmp: 0.09, foldFreq: 6, ao: 0.78 },
    { y: 0.56, z: 0.015, rx: 0.212, rz: 0.128, foldAmp: 0.07, foldFreq: 6, ao: 0.9 },
    { y: 0.69, z: 0.012, rx: 0.242, rz: 0.122, foldAmp: 0.06, foldFreq: 5, ao: 0.94 },
    { y: 0.77, z: 0.032, rx: 0.145, rz: 0.095, ao: 0.85 },
  ]
  const mantle = buildMantleOpenFront(mantleRings, {
    thetaStart: -Math.PI * 0.22,
    thetaEnd: Math.PI * 1.22,
    radialSegments: 20,
  })

  // Tattered high cowl rim framing back of neck without hiding ears or face
  const cowlRim = buildMantleOpenFront(
    [
      { y: 0.7, z: 0.034, rx: 0.115, rz: 0.098, ao: 0.8 },
      { y: 0.84, z: 0.042, rx: 0.096, rz: 0.088, foldAmp: 0.08, foldFreq: 4, ao: 0.9 },
      { y: 0.96, z: 0.048, rx: 0.082, rz: 0.078, ao: 0.72 },
    ],
    {
      thetaStart: Math.PI * 0.06,
      thetaEnd: Math.PI * 0.94,
      radialSegments: 14,
    }
  )

  // Hanging ragged sleeve/shoulder shreds + dorsal tattered strips
  const upperTatters = [mantle, cowlRim]
  for (const sign of [-1, 1]) {
    upperTatters.push(
      buildTatteredRibbon(
        [
          [sign * 0.235, 0.7, -0.01],
          [sign * 0.275, 0.52, 0.025],
          [sign * 0.265, 0.28, 0.065],
          [sign * 0.295, 0.06, 0.11],
        ],
        0.075,
        0.014,
        0.92,
        0.45
      )
    )
    // Cross-chest torn sash fold over upper ribcage edge
    upperTatters.push(
      buildSplineLoft(
        [
          [sign * 0.205, 0.68, -0.02],
          [sign * 0.135, 0.54, -0.082],
          [sign * 0.085, 0.34, -0.084],
          [sign * 0.105, 0.12, -0.064],
        ],
        {
          tubularSegments: 8,
          radialSegments: 6,
          radiusX: 0.026,
          radiusY: 0.012,
          taperStart: 0.95,
          taperMid: 1.0,
          taperEnd: 0.28,
          aoStart: 0.9,
          aoEnd: 0.58,
        }
      )
    )
  }
  // Long dorsal shredded cape tail
  for (const xOff of [-0.085, 0, 0.085]) {
    upperTatters.push(
      buildTatteredRibbon(
        [
          [xOff, 0.66, 0.105],
          [xOff * 1.15, 0.42, 0.138],
          [xOff * 1.3, 0.16, 0.165],
          [xOff * 1.45, -0.14, 0.205],
        ],
        0.062,
        0.01,
        0.88,
        0.42
      )
    )
  }

  // 2. Translucent outer torn shadow veil (draped over shoulders/back with ethereal transparency)
  const veilParts = []
  for (const sign of [-1, 1]) {
    veilParts.push(
      buildTatteredRibbon(
        [
          [sign * 0.18, 0.72, 0.03],
          [sign * 0.29, 0.48, 0.085],
          [sign * 0.31, 0.18, 0.145],
          [sign * 0.35, -0.22, 0.22],
        ],
        0.11,
        0.016,
        0.82,
        0.24
      ),
      buildTatteredRibbon(
        [
          [sign * 0.225, 0.64, -0.02],
          [sign * 0.26, 0.4, -0.015],
          [sign * 0.28, 0.14, 0.03],
        ],
        0.068,
        0.008,
        0.76,
        0.28
      )
    )
  }

  // 3. Shredded lower robe skirt (relative to lowerRobePivot at y = 1.12m -> clears floor cleanly)
  const skirtPanels = []
  const panelAngles = [
    { start: 0.18, end: 0.95, drop: -0.74, flare: 0.26 }, // back-right
    { start: 1.08, end: 2.06, drop: -0.79, flare: 0.3 }, // back center
    { start: 2.18, end: 2.96, drop: -0.72, flare: 0.26 }, // back-left
    { start: 3.16, end: 3.92, drop: -0.66, flare: 0.22 }, // front-left tatter
    { start: 5.5, end: 6.18, drop: -0.64, flare: 0.22 }, // front-right tatter
  ]
  for (let p = 0; p < panelAngles.length; p += 1) {
    const spec = panelAngles[p]
    skirtPanels.push(
      buildJaggedSkirtPanel(spec.start, spec.end, {
        topY: 0.04,
        bottomY: spec.drop,
        topRx: 0.118,
        topRz: 0.082,
        bottomRx: spec.flare,
        bottomRz: spec.flare * 0.92,
        seed: p * 1.73,
      })
    )
  }

  // 4. Lower-body supernatural dissolving mist veil + organic curling mist wisps (relative to lowerRobePivot)
  const mistParts = []
  // Inner rising/fading mist cone beneath shredded robes (raised so tips never clip y <= 0 during lean/hover)
  mistParts.push(
    buildDissolvingMistCurtain({
      topY: -0.16,
      bottomY: -0.82,
      topRadius: 0.135,
      bottomRadius: 0.26,
      radialSegments: 24,
      verticalRings: 8,
      phase: 0.4,
      amplitude: 0.036,
    }),
    buildDissolvingMistCurtain({
      topY: -0.28,
      bottomY: -0.84,
      topRadius: 0.18,
      bottomRadius: 0.33,
      radialSegments: 24,
      verticalRings: 8,
      phase: 2.1,
      amplitude: 0.046,
    })
  )

  // Floating ghostly mist tendrils curling organically up around the hem
  for (let m = 0; m < 8; m += 1) {
    const ang = (m / 8) * TWO_PI + 0.25
    const r0 = 0.16 + (m % 2) * 0.06
    const r1 = 0.24 + (m % 3) * 0.05
    mistParts.push(
      buildSplineLoft(
        [
          [Math.cos(ang) * r0, -0.26 - (m % 3) * 0.07, Math.sin(ang) * r0],
          [
            Math.cos(ang + 0.35) * lerp(r0, r1, 0.5),
            -0.54,
            Math.sin(ang + 0.35) * lerp(r0, r1, 0.5),
          ],
          [Math.cos(ang + 0.72) * r1, -0.82 + (m % 2) * 0.04, Math.sin(ang + 0.72) * r1],
        ],
        {
          tubularSegments: 8,
          radialSegments: 5,
          radiusX: 0.022,
          radiusY: 0.012,
          taperStart: 0.7,
          taperMid: 1.0,
          taperEnd: 0.14,
          aoStart: 0.45,
          aoEnd: 0.95,
          tintStart: [0.55, 0.72, 0.88],
          tintEnd: [0.85, 0.96, 1.0],
        }
      )
    )
  }

  // Organic swirling spectral wisps orbiting the dissolving lower body (replacing crystal octahedra)
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TWO_PI + 0.35
    const rBase = 0.22 + (i % 3) * 0.045
    const yStart = -0.76 + (i % 2) * 0.08
    const yMid = yStart + 0.18
    const yEnd = yStart + 0.36
    mistParts.push(
      buildSplineLoft(
        [
          [Math.cos(a) * (rBase * 0.92), yStart, Math.sin(a) * (rBase * 0.92)],
          [Math.cos(a + 0.48) * (rBase * 1.06), yMid, Math.sin(a + 0.48) * (rBase * 1.06)],
          [Math.cos(a + 0.95) * (rBase * 0.86), yEnd, Math.sin(a + 0.95) * (rBase * 0.86)],
        ],
        {
          tubularSegments: 7,
          radialSegments: 5,
          radiusX: 0.016,
          radiusY: 0.008,
          taperStart: 0.15,
          taperMid: 1.0,
          taperEnd: 0.12,
          aoStart: 0.6,
          aoEnd: 0.95,
          tintStart: [0.72, 0.88, 0.98],
          tintEnd: [0.82, 0.94, 1.0],
        }
      )
    )
  }

  // 5. Trailing mist tendril cluster (attached under upperBodyPivot via legPivots so it hovers with body)
  const tendrilParts = [
    buildSplineLoft(
      [
        [0, -0.04, 0],
        [0.018, -0.39, 0.032],
        [-0.016, -0.7, 0.078],
        [0.01, -1.0, 0.125],
      ],
      {
        tubularSegments: 10,
        radialSegments: 6,
        radiusX: 0.04,
        radiusY: 0.02,
        taperStart: 0.95,
        taperMid: 0.68,
        taperEnd: 0.1,
        aoStart: 0.42,
        aoEnd: 0.96,
        tintStart: [0.46, 0.62, 0.78],
        tintEnd: [0.82, 0.94, 1.0],
      }
    ),
    buildSplineLoft(
      [
        [0.022, -0.14, 0.02],
        [-0.02, -0.45, 0.055],
        [0.025, -0.72, 0.095],
        [-0.008, -0.98, 0.145],
      ],
      {
        tubularSegments: 9,
        radialSegments: 5,
        radiusX: 0.024,
        radiusY: 0.013,
        taperStart: 0.85,
        taperMid: 0.65,
        taperEnd: 0.1,
        aoStart: 0.48,
        aoEnd: 0.95,
        tintStart: [0.5, 0.68, 0.84],
        tintEnd: [0.86, 0.96, 1.0],
      }
    ),
  ]

  return {
    robeTorso: mergeAndDispose(upperTatters),
    robeVeilUpper: mergeAndDispose(veilParts),
    robeSkirt: mergeAndDispose(skirtPanels),
    mistVeil: mergeAndDispose(mistParts),
    mistTendril: mergeAndDispose(tendrilParts),
  }
}

function buildMantleOpenFront(rings, { thetaStart, thetaEnd, radialSegments = 16 }) {
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
      const fold = foldAmp !== 0 ? Math.sin(theta * foldFreq + rIdx * 0.5) * foldAmp : 0
      const px = Math.cos(theta) * rx * (1 + fold)
      const pz = cz + Math.sin(theta) * rz * (1 + fold)

      const idx = rIdx * cols + c
      positions[idx * 3] = px
      positions[idx * 3 + 1] = cy
      positions[idx * 3 + 2] = pz
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = v

      const edgeFade = smoothstep(0.0, 0.14, u) * smoothstep(1.0, 0.86, u)
      const shade = clamp(ao * (0.72 + edgeFade * 0.28 + fold * 1.1), 0.35, 1.0)
      colors[idx * 3] = shade
      colors[idx * 3 + 1] = shade
      colors[idx * 3 + 2] = shade
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

function buildTatteredRibbon(points, widthStart, widthEnd, aoStart, aoEnd) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  )
  const segsU = 3
  const segsV = 10
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

    // Jagged frayed ribbon edge taper near the torn bottom tip
    const tatterJag = 1 + Math.sin(v * 18.0) * 0.16 * smoothstep(0.4, 1.0, v)
    const halfW = lerp(widthStart, widthEnd, Math.pow(v, 0.85)) * tatterJag
    const ao = lerp(aoStart, aoEnd, v)

    for (let c = 0; c < cols; c += 1) {
      const u = c / segsU
      const s = u * 2 - 1
      const idx = r * cols + c
      const cupZ = (1 - s * s) * 0.012
      positions[idx * 3] = pt.x + side.x * s * halfW
      positions[idx * 3 + 1] = pt.y + side.y * s * halfW - (v > 0.85 ? Math.abs(s) * 0.025 : 0)
      positions[idx * 3 + 2] = pt.z + side.z * s * halfW + cupZ
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = v
      const edgeAO = 1 - Math.abs(s) * 0.2
      colors[idx * 3] = ao * edgeAO
      colors[idx * 3 + 1] = ao * edgeAO
      colors[idx * 3 + 2] = ao * edgeAO
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

function buildJaggedSkirtPanel(
  thetaStart,
  thetaEnd,
  { topY, bottomY, topRx, topRz, bottomRx, bottomRz, seed = 0 }
) {
  const cols = 9
  const rows = 9
  const totalVerts = cols * rows
  const positions = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const colors = new Float32Array(totalVerts * 3)
  const indices = []

  for (let r = 0; r < rows; r += 1) {
    const v = r / (rows - 1)
    for (let c = 0; c < cols; c += 1) {
      const u = c / (cols - 1)
      const theta = lerp(thetaStart, thetaEnd, u)

      // Jagged torn vertical edge & ragged uneven bottom hem teeth
      const edgeTaper = Math.sin(u * Math.PI)
      const hemTatter =
        (Math.sin(u * Math.PI * 5 + seed) * 0.085 +
          Math.cos(u * Math.PI * 9 - seed * 1.4) * 0.045) *
        smoothstep(0.35, 1.0, v)
      const y = lerp(topY, bottomY, v) + hemTatter + (1 - edgeTaper) * v * 0.14

      const pleat = Math.sin(u * Math.PI * 4 + seed) * 0.095 * smoothstep(0.15, 0.9, v)
      const rx = lerp(topRx, bottomRx, Math.pow(v, 0.78)) * (1 + pleat)
      const rz = lerp(topRz, bottomRz, Math.pow(v, 0.78)) * (1 + pleat)

      const idx = r * cols + c
      positions[idx * 3] = Math.cos(theta) * rx
      positions[idx * 3 + 1] = y
      positions[idx * 3 + 2] = Math.sin(theta) * rz + v * 0.045
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = 1 - v

      const shade = clamp(lerp(0.92, 0.42, v) * (0.8 + edgeTaper * 0.2 + pleat), 0.25, 1.0)
      colors[idx * 3] = shade
      colors[idx * 3 + 1] = shade
      colors[idx * 3 + 2] = shade
    }
  }

  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
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

function buildDissolvingMistCurtain({
  topY,
  bottomY,
  topRadius,
  bottomRadius,
  radialSegments = 24,
  verticalRings = 8,
  phase = 0,
  amplitude = 0.04,
}) {
  const cols = radialSegments + 1
  const totalVerts = cols * verticalRings
  const positions = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const colors = new Float32Array(totalVerts * 3)
  const indices = []

  for (let r = 0; r < verticalRings; r += 1) {
    const v = r / (verticalRings - 1)
    for (let c = 0; c <= radialSegments; c += 1) {
      const u = c / radialSegments
      const theta = u * TWO_PI
      const wave =
        Math.sin(theta * 5 + phase + v * 2.4) * amplitude * smoothstep(0.1, 1.0, v)
      const jagY =
        (Math.sin(theta * 7 - phase) * 0.055 + Math.cos(theta * 11 + phase) * 0.03) *
        smoothstep(0.45, 1.0, v)

      const rad = lerp(topRadius, bottomRadius, v) + wave
      const py = lerp(topY, bottomY, v) + jagY

      const idx = r * cols + c
      positions[idx * 3] = Math.cos(theta) * rad
      positions[idx * 3 + 1] = py
      positions[idx * 3 + 2] = Math.sin(theta) * rad * 0.88 + v * 0.075
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = 1 - v

      // Fade luminance subtly from shadow-cloth root into eerie pale mist body & wispy floor edge
      const lum = lerp(0.32, 0.88, Math.sin(v * Math.PI * 0.78))
      colors[idx * 3] = lum * 0.76
      colors[idx * 3 + 1] = lum * 0.9
      colors[idx * 3 + 2] = lum
    }
  }

  for (let r = 0; r < verticalRings - 1; r += 1) {
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
  weldSeamNormals(geo, verticalRings, radialSegments)
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}
