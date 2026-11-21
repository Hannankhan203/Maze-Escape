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
  ensureVertexColors(geometry, ao, ao, ao)
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

/**
 * Builds a smooth parametric lofted anatomical/garment tube across ordered
 * cross-section rings `{ y, x?, z?, rx, rz, superExp?, frontScale?, backScale?, ao? }`.
 * Avoids degenerate zero-area pole triangles by capping ends around explicit center vertices.
 */
export function buildLoftedPartGeometry(
  rings,
  {
    radialSegments = 16,
    uRepeat = 1,
    vRepeat = 1,
    capBottom = true,
    capTop = true,
    tiltX = 0,
  } = {}
) {
  const ringCount = rings.length
  const cols = radialSegments + 1
  const wallVertCount = ringCount * cols
  const capVertCount = (capBottom ? 1 + radialSegments : 0) + (capTop ? 1 + radialSegments : 0)
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
    const rx = Math.max(0.002, ring.rx)
    const rz = Math.max(0.002, ring.rz)
    const exp = ring.superExp ?? 2.0
    const frontScale = ring.frontScale ?? 1.0
    const backScale = ring.backScale ?? 1.0
    const ao = ring.ao ?? 1.0
    const vCoord = ((cy - minY) / spanY) * vRepeat

    for (let s = 0; s <= radialSegments; s += 1) {
      const frac = s / radialSegments
      const theta = frac * TWO_PI
      const rawCos = Math.cos(theta)
      const rawSin = Math.sin(theta)
      const px =
        Math.sign(rawCos) * Math.pow(Math.abs(rawCos), 2 / exp) * rx
      let pz =
        Math.sign(rawSin) * Math.pow(Math.abs(rawSin), 2 / exp) * rz
      pz *= pz < 0 ? frontScale : backScale

      const p = vCursor * 3
      const up = vCursor * 2
      positions[p] = cx + px
      positions[p + 1] = cy + pz * tiltX
      positions[p + 2] = cz + pz

      uvs[up] = frac * uRepeat
      uvs[up + 1] = vCoord

      colors[p] = ao
      colors[p + 1] = ao
      colors[p + 2] = ao
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

  const addCap = (ringIdx, isTop) => {
    const ring = rings[ringIdx]
    const cx = ring.x ?? 0
    const cy = ring.y
    const cz = ring.z ?? 0
    const ao = (ring.ao ?? 1.0) * 0.9
    const centerIdx = vCursor

    positions[centerIdx * 3] = cx
    positions[centerIdx * 3 + 1] = cy
    positions[centerIdx * 3 + 2] = cz
    uvs[centerIdx * 2] = 0.5
    uvs[centerIdx * 2 + 1] = isTop ? vRepeat : 0
    colors[centerIdx * 3] = ao
    colors[centerIdx * 3 + 1] = ao
    colors[centerIdx * 3 + 2] = ao
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
      colors[vCursor * 3] = ao
      colors[vCursor * 3 + 1] = ao
      colors[vCursor * 3 + 2] = ao
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

  if (capBottom) addCap(0, false)
  if (capTop) addCap(ringCount - 1, true)

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
      const corner = Math.max(0, (nx * nx + ny * ny + nz * nz - 1.5) * 0.08)
      const scale = 1 - corner
      pos.setXYZ(i, vx * scale, vy * scale, vz * scale)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
  }
  return ensureVertexColors(geo, ao, ao, ao)
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

/**
 * Builds sculpted head, uncovered human face (brow, recessed eye sockets,
 * cheekbones, squared jaw/chin, nose, eyelids, lips, ears) and layered hair
 * with fringe locks and eyebrows, relative to `headPivot` (world y = 1.51m).
 * Eyes sit at local y = +0.14m (world 1.65m); hair crown tops at +0.29m (world 1.80m).
 */
export function buildHeadSegmentGeometries() {
  const headCenterY = 0.13
  const headCenterZ = -0.01

  // 1. Sculpted cranial vault & facial anatomy
  const cranium = new THREE.SphereGeometry(1, 36, 28)
  const pos = cranium.attributes.position
  const craniumColors = new Float32Array(pos.count * 3)

  for (let i = 0; i < pos.count; i += 1) {
    const ux = pos.getX(i)
    const uy = pos.getY(i)
    const uz = pos.getZ(i)

    let sx = ux * 0.086
    let sy = uy * 0.124
    let sz = uz * 0.102

    const isFront = uz < 0
    const frontMask = smoothstep(0.05, -0.35, uz)

    // Narrow temples slightly; broaden parietal/occipital cranium
    const templePinch = gaussian(uy, 0.18, 0.24) * frontMask * 0.08
    sx *= 1 - templePinch
    if (uz > 0.15) {
      sz += gaussian(uy, 0.1, 0.45) * uz * 0.012
    }

    // Taper lower face into jaw & distinct chin
    const lowerFaceMask = smoothstep(-0.08, -0.78, uy)
    const jawCorner = gaussian(uy, -0.46, 0.2) * smoothstep(0.25, 0.65, Math.abs(ux)) * smoothstep(0.15, -0.55, uz)
    sx *= 1 - lowerFaceMask * 0.34
    sx += Math.sign(ux) * jawCorner * 0.008

    if (isFront) {
      // Chin forward projection & slight squareness
      const chinMask = gaussian(uy, -0.76, 0.18) * gaussian(ux, 0, 0.34) * smoothstep(-0.35, -0.85, uz)
      sz -= chinMask * 0.014
      sy -= chinMask * 0.005

      // Brow ridge above eye sockets
      const browMask = gaussian(uy, 0.22, 0.12) * smoothstep(-0.2, -0.75, uz) * (1 - smoothstep(0.65, 0.95, Math.abs(ux)))
      sz -= browMask * 0.011

      // Recessed orbital eye sockets (left & right)
      const eyeDistL = Math.hypot((ux + 0.34) / 0.21, (uy - 0.08) / 0.14)
      const eyeDistR = Math.hypot((ux - 0.34) / 0.21, (uy - 0.08) / 0.14)
      const socketMask = (Math.exp(-(eyeDistL * eyeDistL)) + Math.exp(-(eyeDistR * eyeDistR))) * smoothstep(-0.4, -0.82, uz)
      sz += socketMask * 0.015

      // Zygomatic cheekbones
      const cheekL = Math.exp(-(Math.pow((ux + 0.56) / 0.22, 2) + Math.pow((uy + 0.12) / 0.18, 2)))
      const cheekR = Math.exp(-(Math.pow((ux - 0.56) / 0.22, 2) + Math.pow((uy + 0.12) / 0.18, 2)))
      const cheekMask = (cheekL + cheekR) * smoothstep(-0.25, -0.78, uz)
      sz -= cheekMask * 0.009
      sx += Math.sign(ux) * cheekMask * 0.004

      // Subtle mouth/dental arch support
      const mouthSupport = gaussian(uy, -0.45, 0.15) * gaussian(ux, 0, 0.34) * smoothstep(-0.45, -0.9, uz)
      sz -= mouthSupport * 0.007
    }

    // Pull under-chin neck junction slightly inward
    if (uy < -0.78) {
      const underChin = smoothstep(-0.78, -0.98, uy)
      sx *= 1 - underChin * 0.28
      sz *= 1 - underChin * 0.22
    }

    pos.setXYZ(i, sx, sy + headCenterY, sz + headCenterZ)

    // Baked facial ambient occlusion (eye sockets, under-chin, temples)
    let ao = 1.0
    if (isFront) {
      const eL = Math.hypot((ux + 0.34) / 0.22, (uy - 0.08) / 0.15)
      const eR = Math.hypot((ux - 0.34) / 0.22, (uy - 0.08) / 0.15)
      const orbAO = (Math.exp(-(eL * eL)) + Math.exp(-(eR * eR))) * smoothstep(-0.4, -0.85, uz)
      ao -= orbAO * 0.26
      // Subtle cheek blush/shade under zygomatic bone
      const hollowL = Math.exp(-(Math.pow((ux + 0.46) / 0.24, 2) + Math.pow((uy + 0.32) / 0.22, 2)))
      const hollowR = Math.exp(-(Math.pow((ux - 0.46) / 0.24, 2) + Math.pow((uy + 0.32) / 0.22, 2)))
      ao -= (hollowL + hollowR) * smoothstep(-0.3, -0.85, uz) * 0.08
    }
    if (uy < -0.68) {
      ao -= smoothstep(-0.68, -0.98, uy) * 0.24
    }
    ao = clamp(ao, 0.65, 1.0)
    craniumColors[i * 3] = ao
    craniumColors[i * 3 + 1] = ao * 0.99
    craniumColors[i * 3 + 2] = ao * 0.98
  }
  pos.needsUpdate = true
  cranium.setAttribute('color', new THREE.BufferAttribute(craniumColors, 3))
  recomputeNormalsSafe(cranium, headCenterY, headCenterZ)

  // 2. Sculpted Nose (bridge, tip, nostril alae)
  const noseBridge = buildLoftedPartGeometry(
    [
      { y: -0.025, z: -0.002, rx: 0.011, rz: 0.012, frontScale: 1.1, ao: 0.82 },
      { y: -0.016, z: -0.014, rx: 0.013, rz: 0.015, frontScale: 1.25, ao: 0.96 },
      { y: -0.002, z: -0.011, rx: 0.01, rz: 0.012, frontScale: 1.15, ao: 0.98 },
      { y: 0.018, z: -0.005, rx: 0.0085, rz: 0.01, frontScale: 1.1, ao: 0.94 },
      { y: 0.032, z: 0.0, rx: 0.009, rz: 0.008, ao: 0.88 },
    ],
    { radialSegments: 12 }
  )
  transformGeo(noseBridge, { y: headCenterY + 0.002, z: headCenterZ - 0.092 })

  const nostrilLeft = transformGeo(new THREE.SphereGeometry(0.0075, 10, 8), {
    x: -0.0095,
    y: headCenterY - 0.021,
    z: headCenterZ - 0.098,
    sx: 0.95,
    sy: 0.78,
    sz: 1.15,
    ao: 0.88,
  })
  const nostrilRight = transformGeo(new THREE.SphereGeometry(0.0075, 10, 8), {
    x: 0.0095,
    y: headCenterY - 0.021,
    z: headCenterZ - 0.098,
    sx: 0.95,
    sy: 0.78,
    sz: 1.15,
    ao: 0.88,
  })

  // 3. Sculpted Eyelids framing orbital sockets
  const skinParts = [cranium, noseBridge, nostrilLeft, nostrilRight]
  for (const sign of [-1, 1]) {
    const eyeX = sign * 0.03
    const eyeY = headCenterY + 0.01
    const eyeZ = headCenterZ - 0.083

    const upperLid = transformGeo(
      new THREE.TorusGeometry(0.0128, 0.0032, 8, 14, Math.PI * 0.92),
      {
        x: eyeX,
        y: eyeY + 0.0025,
        z: eyeZ - 0.003,
        rx: 0.35,
        ry: sign * -0.15,
        rz: 0.06,
        ao: 0.84,
      }
    )
    const lowerLid = transformGeo(
      new THREE.TorusGeometry(0.0124, 0.0024, 8, 12, Math.PI * 0.82),
      {
        x: eyeX,
        y: eyeY - 0.003,
        z: eyeZ - 0.002,
        rx: -0.35,
        ry: sign * -0.15,
        rz: Math.PI + 0.15,
        ao: 0.88,
      }
    )
    skinParts.push(upperLid, lowerLid)

    // 4. Sculpted Ear (outer C-pinna + inner lobe)
    const earOuter = transformGeo(
      new THREE.TorusGeometry(0.017, 0.0055, 8, 14, Math.PI * 1.45),
      {
        x: sign * 0.082,
        y: headCenterY + 0.002,
        z: headCenterZ + 0.008,
        ry: sign * (Math.PI * 0.5 - 0.25),
        rz: -Math.PI * 0.36,
        sx: 0.72,
        sy: 1.24,
        sz: 0.85,
        ao: 0.86,
      }
    )
    const earBowl = transformGeo(new THREE.SphereGeometry(0.013, 10, 8), {
      x: sign * 0.079,
      y: headCenterY - 0.001,
      z: headCenterZ + 0.008,
      sx: 0.35,
      sy: 1.12,
      sz: 0.82,
      ao: 0.72,
    })
    skinParts.push(earOuter, earBowl)
  }

  // 5. Eyes (sclera + iris/pupil)
  const scleraParts = []
  const irisParts = []
  for (const sign of [-1, 1]) {
    const eyeX = sign * 0.03
    const eyeY = headCenterY + 0.01
    const eyeZ = headCenterZ - 0.083

    scleraParts.push(
      transformGeo(new THREE.SphereGeometry(0.0118, 14, 12), {
        x: eyeX,
        y: eyeY,
        z: eyeZ,
        sz: 0.88,
        ao: 0.96,
      })
    )

    const irisGeo = new THREE.SphereGeometry(0.0062, 12, 10)
    const irisPos = irisGeo.attributes.position
    const irisColors = new Float32Array(irisPos.count * 3)
    for (let i = 0; i < irisPos.count; i += 1) {
      const ix = irisPos.getX(i)
      const iy = irisPos.getY(i)
      const iz = irisPos.getZ(i)
      const radial = Math.hypot(ix, iy) / 0.0062
      // Dark pupil core, richer iris ring around it
      const shade = iz < 0 && radial < 0.44 ? 0.14 : 0.95
      irisColors[i * 3] = shade
      irisColors[i * 3 + 1] = shade
      irisColors[i * 3 + 2] = shade
    }
    irisGeo.setAttribute('color', new THREE.BufferAttribute(irisColors, 3))
    irisParts.push(
      transformGeo(irisGeo, {
        x: eyeX,
        y: eyeY,
        z: eyeZ - 0.0074,
        sz: 0.56,
      })
    )
  }

  // 6. Sculpted Lips
  const upperLip = transformGeo(
    buildLoftedPartGeometry(
      [
        { y: -0.003, rx: 0.019, rz: 0.006, frontScale: 1.2, ao: 0.74 },
        { y: 0.0, rx: 0.018, rz: 0.007, frontScale: 1.25, ao: 0.95 },
        { y: 0.0035, rx: 0.012, rz: 0.005, frontScale: 1.15, ao: 0.9 },
      ],
      { radialSegments: 12 }
    ),
    {
      x: 0,
      y: headCenterY - 0.052,
      z: headCenterZ - 0.088,
      ao: 0.96,
    }
  )
  const lowerLip = transformGeo(
    buildLoftedPartGeometry(
      [
        { y: -0.004, rx: 0.014, rz: 0.0055, frontScale: 1.15, ao: 0.85 },
        { y: 0.0, rx: 0.017, rz: 0.0072, frontScale: 1.25, ao: 0.98 },
        { y: 0.003, rx: 0.016, rz: 0.0055, frontScale: 1.1, ao: 0.72 },
      ],
      { radialSegments: 12 }
    ),
    {
      x: 0,
      y: headCenterY - 0.059,
      z: headCenterZ - 0.087,
      ao: 0.96,
    }
  )

  // 7. Layered Hair Cap, Fringe Locks, Sideburns & Eyebrows
  const hairCap = new THREE.SphereGeometry(1, 32, 24)
  const hPos = hairCap.attributes.position
  const hairColors = new Float32Array(hPos.count * 3)

  for (let i = 0; i < hPos.count; i += 1) {
    const ux = hPos.getX(i)
    const uy = hPos.getY(i)
    const uz = hPos.getZ(i)

    // Hairline mask: leaves forehead/face uncovered while covering crown, temples & nape
    const widowPeak = gaussian(ux, 0, 0.24) * 0.1
    const frontHairlineY = 0.44 - widowPeak + smoothstep(0.35, 0.82, Math.abs(ux)) * -0.34
    const backNapeY = -0.58
    const hairlineThresholdY = lerp(frontHairlineY, backNapeY, smoothstep(-0.35, 0.45, uz))

    // Pull vertices below hairline cleanly tucked inside skull surface so they never protrude through face
    const insideHair = uy >= hairlineThresholdY
    const radialScale = insideHair
      ? 1.075 +
        gaussian(uy, 0.75, 0.45) * 0.06 +
        gaussian(uz, 0.45, 0.4) * 0.03
      : 0.84

    const sx = ux * 0.088 * radialScale
    const sy = uy * 0.128 * (insideHair ? radialScale : 0.86)
    const sz = uz * 0.105 * radialScale

    hPos.setXYZ(i, sx, sy + headCenterY + 0.006, sz + headCenterZ + 0.004)

    const crownHighlight = 0.88 + smoothstep(0.1, 0.9, uy) * 0.16
    const napeShade = uz > 0.2 && uy < -0.1 ? 0.82 : 1.0
    const shade = clamp(crownHighlight * napeShade, 0.72, 1.04)
    hairColors[i * 3] = shade
    hairColors[i * 3 + 1] = shade
    hairColors[i * 3 + 2] = shade
  }
  hPos.needsUpdate = true
  hairCap.setAttribute('color', new THREE.BufferAttribute(hairColors, 3))
  recomputeNormalsSafe(hairCap, headCenterY + 0.006, headCenterZ + 0.004)

  const hairParts = [hairCap]

  // Sculpted forehead fringe & crown locks to break up spherical silhouette
  const lockSpecs = [
    { x: -0.048, y: 0.088, z: -0.082, rx: 0.35, ry: 0.28, rz: 0.32, w: 0.022, h: 0.052 },
    { x: -0.022, y: 0.095, z: -0.091, rx: 0.42, ry: 0.15, rz: 0.18, w: 0.024, h: 0.056 },
    { x: 0.008, y: 0.098, z: -0.092, rx: 0.44, ry: -0.08, rz: -0.14, w: 0.026, h: 0.058 },
    { x: 0.036, y: 0.091, z: -0.085, rx: 0.38, ry: -0.24, rz: -0.28, w: 0.022, h: 0.052 },
    { x: -0.068, y: 0.048, z: -0.045, rx: 0.18, ry: 0.55, rz: 0.18, w: 0.018, h: 0.062 },
    { x: 0.068, y: 0.048, z: -0.045, rx: 0.18, ry: -0.55, rz: -0.18, w: 0.018, h: 0.062 },
    // Sideburns in front of ears
    { x: -0.074, y: 0.008, z: -0.022, rx: 0.06, ry: 0.1, rz: 0.06, w: 0.011, h: 0.046 },
    { x: 0.074, y: 0.008, z: -0.022, rx: 0.06, ry: -0.1, rz: -0.06, w: 0.011, h: 0.046 },
    // Crown volume locks
    { x: -0.025, y: 0.132, z: -0.012, rx: 1.25, ry: 0.12, rz: 0.2, w: 0.036, h: 0.082 },
    { x: 0.022, y: 0.133, z: -0.008, rx: 1.28, ry: -0.12, rz: -0.18, w: 0.036, h: 0.082 },
    { x: 0.0, y: 0.115, z: 0.048, rx: 1.85, ry: 0.0, rz: 0.0, w: 0.045, h: 0.078 },
  ]
  for (const l of lockSpecs) {
    const lock = buildLoftedPartGeometry(
      [
        { y: -l.h * 0.5, rx: l.w * 0.35, rz: 0.004, ao: 0.84 },
        { y: 0, rx: l.w * 0.88, rz: 0.01, ao: 0.98 },
        { y: l.h * 0.5, rx: l.w * 0.72, rz: 0.009, ao: 0.94 },
      ],
      { radialSegments: 8 }
    )
    transformGeo(lock, {
      x: l.x,
      y: headCenterY + l.y,
      z: headCenterZ + l.z,
      rx: l.rx,
      ry: l.ry,
      rz: l.rz,
    })
    hairParts.push(lock)
  }

  // Sculpted Eyebrows
  for (const sign of [-1, 1]) {
    const brow = buildLoftedPartGeometry(
      [
        { y: -0.004, rx: 0.015, rz: 0.0055, ao: 0.84 },
        { y: 0.0, rx: 0.017, rz: 0.006, ao: 0.98 },
        { y: 0.0035, rx: 0.013, rz: 0.005, ao: 0.92 },
      ],
      { radialSegments: 8 }
    )
    transformGeo(brow, {
      x: sign * 0.03,
      y: headCenterY + 0.029,
      z: headCenterZ - 0.091,
      ry: sign * -0.18,
      rz: sign * -0.09,
    })
    hairParts.push(brow)
  }

  return {
    skin: mergeAndDispose(skinParts),
    lips: mergeAndDispose([upperLip, lowerLip]),
    hair: mergeAndDispose(hairParts),
    eyesSclera: mergeAndDispose(scleraParts),
    eyesIris: mergeAndDispose(irisParts),
  }
}

/**
 * Builds sculpted neck geometry relative to `neckPivot` (world y = 1.42m).
 */
export function buildNeckGeometry() {
  const neck = buildLoftedPartGeometry(
    [
      { y: -0.025, z: 0.004, rx: 0.062, rz: 0.06, ao: 0.74 },
      { y: 0.02, z: 0.0, rx: 0.053, rz: 0.054, frontScale: 1.05, ao: 0.88 },
      { y: 0.07, z: -0.003, rx: 0.05, rz: 0.053, ao: 0.86 },
      { y: 0.115, z: -0.006, rx: 0.054, rz: 0.058, ao: 0.76 },
    ],
    { radialSegments: 14, uRepeat: 1, vRepeat: 1 }
  )
  return neck
}

/**
 * Builds pelvis trousers bridge, leather belt, and metallic buckle relative to
 * `pelvisPivot` (world y = 0.91m).
 */
export function buildPelvisGeometries() {
  const pelvis = buildLoftedPartGeometry(
    [
      { y: -0.065, z: 0.0, rx: 0.162, rz: 0.112, superExp: 2.3, ao: 0.82 },
      { y: 0.0, z: -0.002, rx: 0.172, rz: 0.118, superExp: 2.35, backScale: 1.08, ao: 0.94 },
      { y: 0.065, z: 0.0, rx: 0.164, rz: 0.112, superExp: 2.25, ao: 0.86 },
    ],
    { radialSegments: 18, uRepeat: 2, vRepeat: 0.6 }
  )

  const belt = buildLoftedPartGeometry(
    [
      { y: 0.032, rx: 0.169, rz: 0.117, superExp: 2.35, ao: 0.84 },
      { y: 0.072, rx: 0.169, rz: 0.117, superExp: 2.35, ao: 0.96 },
    ],
    { radialSegments: 18, uRepeat: 3, vRepeat: 0.3 }
  )

  const buckleFrame = transformGeo(buildRoundedBox(0.054, 0.046, 0.018, 2, 0.98), {
    x: 0,
    y: 0.052,
    z: -0.119,
  })
  const beltKeeper = transformGeo(buildRoundedBox(0.014, 0.048, 0.02, 1, 0.9), {
    x: -0.045,
    y: 0.052,
    z: -0.116,
  })

  return {
    trousers: pelvis,
    belt,
    hardware: mergeAndDispose([buckleFrame, beltKeeper]),
  }
}

/**
 * Builds sculpted jacket torso, collar, pockets, zipper/hardware, and explorer
 * backpack (body, top lid, bedroll, side pouches, front shoulder straps, buckles)
 * relative to `spinePivot` / `upperBodyPivot` (world y = 0.96m).
 * Front chest extends at most to z = -0.162m, preserving generous clearance for
 * the third-person flashlight at z = -0.45m.
 */
export function buildTorsoAndBackpackGeometries() {
  // Anatomical explorer jacket body (y = -0.10 .. +0.47 relative = 0.86 .. 1.43m world)
  const torso = buildLoftedPartGeometry(
    [
      { y: -0.105, z: 0.005, rx: 0.178, rz: 0.128, superExp: 2.35, ao: 0.78 }, // lower jacket hem
      { y: -0.03, z: 0.0, rx: 0.166, rz: 0.118, superExp: 2.3, ao: 0.92 }, // waist cinch
      { y: 0.08, z: -0.004, rx: 0.172, rz: 0.122, superExp: 2.3, ao: 0.98 }, // ribcage
      { y: 0.22, z: -0.008, rx: 0.19, rz: 0.132, superExp: 2.4, frontScale: 1.06, ao: 1.0 }, // chest
      { y: 0.36, z: -0.006, rx: 0.196, rz: 0.128, superExp: 2.45, frontScale: 1.04, ao: 0.98 }, // upper chest/lat
      { y: 0.44, z: 0.0, rx: 0.155, rz: 0.104, superExp: 2.2, ao: 0.92 }, // shoulder slope
      { y: 0.47, z: 0.002, rx: 0.088, rz: 0.078, ao: 0.82 }, // collar base
    ],
    { radialSegments: 20, uRepeat: 2.5, vRepeat: 2.0 }
  )

  // Folded stand collar leaving front throat open
  const collar = transformGeo(
    new THREE.CylinderGeometry(0.082, 0.095, 0.065, 16, 2, true, -Math.PI * 0.72, Math.PI * 1.44),
    { x: 0, y: 0.475, z: 0.004, ry: Math.PI, ao: 0.86 }
  )

  // Front storm placket over zipper
  const placket = transformGeo(buildRoundedBox(0.032, 0.46, 0.016, 2, 0.92), {
    x: -0.008,
    y: 0.175,
    z: -0.136,
    rx: -0.035,
  })

  const jacketParts = [torso, collar, placket]

  // Chest pockets with flaps + lower side pocket welts
  for (const sign of [-1, 1]) {
    const chestPocket = transformGeo(buildRoundedBox(0.074, 0.092, 0.018, 2, 0.94), {
      x: sign * 0.088,
      y: 0.245,
      z: -0.132,
      ry: sign * -0.16,
      rx: -0.03,
    })
    const chestFlap = transformGeo(buildRoundedBox(0.078, 0.026, 0.022, 2, 0.98), {
      x: sign * 0.088,
      y: 0.285,
      z: -0.134,
      ry: sign * -0.16,
      rx: 0.04,
    })
    const sidePocketWelt = transformGeo(buildRoundedBox(0.024, 0.09, 0.018, 1, 0.86), {
      x: sign * 0.122,
      y: 0.03,
      z: -0.105,
      ry: sign * -0.45,
      rz: sign * 0.22,
    })
    jacketParts.push(chestPocket, chestFlap, sidePocketWelt)
  }

  // Backpack assembly on +Z (z ~ +0.125 .. +0.305)
  const packMain = buildLoftedPartGeometry(
    [
      { y: 0.03, z: 0.215, rx: 0.138, rz: 0.078, superExp: 2.8, ao: 0.84 },
      { y: 0.16, z: 0.22, rx: 0.146, rz: 0.086, superExp: 2.8, ao: 0.98 },
      { y: 0.34, z: 0.212, rx: 0.138, rz: 0.08, superExp: 2.7, ao: 0.96 },
      { y: 0.41, z: 0.195, rx: 0.118, rz: 0.068, superExp: 2.5, ao: 0.9 },
    ],
    { radialSegments: 18, uRepeat: 2, vRepeat: 1.5 }
  )

  const packTopFlap = transformGeo(buildRoundedBox(0.26, 0.072, 0.155, 2, 0.96), {
    x: 0,
    y: 0.375,
    z: 0.215,
    rx: 0.18,
  })

  const packRearPocket = transformGeo(buildRoundedBox(0.19, 0.15, 0.045, 2, 0.92), {
    x: 0,
    y: 0.155,
    z: 0.295,
  })

  // Top rolled bedroll / mat
  const bedroll = transformGeo(
    buildLoftedPartGeometry(
      [
        { y: -0.145, rx: 0.048, rz: 0.048, ao: 0.86 },
        { y: 0.0, rx: 0.052, rz: 0.052, ao: 1.0 },
        { y: 0.145, rx: 0.048, rz: 0.048, ao: 0.86 },
      ],
      { radialSegments: 14, uRepeat: 1.5, vRepeat: 1.5 }
    ),
    { x: 0, y: 0.445, z: 0.205, rz: Math.PI / 2 }
  )

  const backpackParts = [packMain, packTopFlap, packRearPocket, bedroll]
  const hardwareParts = []

  // Side pouches, strap webbing over shoulders onto chest, and buckles
  for (const sign of [-1, 1]) {
    const sidePouch = transformGeo(buildRoundedBox(0.052, 0.14, 0.086, 2, 0.9), {
      x: sign * 0.156,
      y: 0.155,
      z: 0.205,
    })

    // Back strap webbing
    const packStrap = transformGeo(buildRoundedBox(0.026, 0.26, 0.016, 1, 0.85), {
      x: sign * 0.068,
      y: 0.23,
      z: 0.304,
    })

    // Over-shoulder contoured strap curving onto front chest
    const shoulderArch = transformGeo(
      new THREE.TorusGeometry(0.125, 0.018, 6, 12, Math.PI * 0.62),
      {
        x: sign * 0.108,
        y: 0.34,
        z: 0.005,
        ry: Math.PI / 2,
        rz: 0.18,
        sx: 1.0,
        sy: 1.0,
        sz: 1.4,
        ao: 0.9,
      }
    )
    const chestStrapDrop = transformGeo(buildRoundedBox(0.036, 0.24, 0.016, 2, 0.9), {
      x: sign * 0.105,
      y: 0.23,
      z: -0.132,
      ry: sign * -0.22,
      rx: -0.05,
    })
    backpackParts.push(sidePouch, packStrap, shoulderArch, chestStrapDrop)

    // Strap buckles (front chest & back pack)
    hardwareParts.push(
      transformGeo(buildRoundedBox(0.042, 0.026, 0.02, 1, 0.98), {
        x: sign * 0.105,
        y: 0.185,
        z: -0.136,
        ry: sign * -0.22,
      }),
      transformGeo(buildRoundedBox(0.034, 0.022, 0.022, 1, 0.98), {
        x: sign * 0.068,
        y: 0.28,
        z: 0.308,
      })
    )
  }

  // Sternum cross-strap & front zipper track + slider
  backpackParts.push(
    transformGeo(buildRoundedBox(0.19, 0.022, 0.016, 1, 0.88), {
      x: 0,
      y: 0.24,
      z: -0.139,
    })
  )
  hardwareParts.push(
    transformGeo(buildRoundedBox(0.012, 0.44, 0.012, 1, 0.92), {
      x: 0.006,
      y: 0.18,
      z: -0.141,
      rx: -0.035,
    }),
    transformGeo(buildRoundedBox(0.02, 0.024, 0.016, 1, 1.0), {
      x: 0.006,
      y: 0.385,
      z: -0.149,
    }),
    transformGeo(buildRoundedBox(0.028, 0.024, 0.02, 1, 0.98), {
      x: 0,
      y: 0.24,
      z: -0.143,
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
 * `forearm` relative to `elbowPivot`, and gloved `hand` with thumb relative to
 * `wristPivot`) for side `sign = -1` (left) or `+1` (right).
 */
export function buildArmSegmentGeometries(sign) {
  // Upper sleeve (shoulder cap -> bicep -> flared elbow cuff)
  const upperArm = buildLoftedPartGeometry(
    [
      { y: -0.295, rx: 0.052, rz: 0.054, ao: 0.82 }, // elbow overlap cuff
      { y: -0.22, rx: 0.053, rz: 0.055, ao: 0.94 },
      { y: -0.12, rx: 0.059, rz: 0.062, ao: 1.0 }, // bicep/tricep swell
      { y: -0.02, rx: 0.066, rz: 0.068, ao: 0.96 }, // deltoid
      { y: 0.032, x: -sign * 0.012, rx: 0.054, rz: 0.058, ao: 0.84 }, // shoulder ball cap
    ],
    { radialSegments: 14, uRepeat: 1.2, vRepeat: 1.2 }
  )

  // Forearm sleeve (elbow ball cap -> taper -> rolled wrist cuff)
  const forearm = buildLoftedPartGeometry(
    [
      { y: -0.245, rx: 0.044, rz: 0.046, ao: 0.88 }, // wrist cuff rim
      { y: -0.21, rx: 0.038, rz: 0.04, ao: 0.96 },
      { y: -0.1, rx: 0.048, rz: 0.05, ao: 1.0 }, // forearm muscle
      { y: -0.01, rx: 0.049, rz: 0.051, ao: 0.94 },
      { y: 0.028, rx: 0.042, rz: 0.044, ao: 0.8 }, // elbow overlap ball
    ],
    { radialSegments: 14, uRepeat: 1.1, vRepeat: 1.1 }
  )

  // Gloved hand (wrist gauntlet, sculpted palm, 4-finger cluster, angled thumb)
  const gauntlet = buildLoftedPartGeometry(
    [
      { y: -0.018, rx: 0.034, rz: 0.036, superExp: 2.3, ao: 0.92 },
      { y: 0.024, rx: 0.037, rz: 0.039, superExp: 2.2, ao: 0.78 }, // tucks into jacket cuff
    ],
    { radialSegments: 12 }
  )

  const palm = transformGeo(buildRoundedBox(0.028, 0.072, 0.062, 2, 0.98), {
    x: -sign * 0.003,
    y: -0.045,
    z: -0.004,
  })

  // 4 sculpted fingers subtly arched inward
  const fingerParts = []
  const fingerOffsetsZ = [-0.022, -0.007, 0.008, 0.022]
  const fingerLengths = [0.05, 0.056, 0.052, 0.042]
  for (let f = 0; f < 4; f += 1) {
    const len = fingerLengths[f]
    const finger = buildLoftedPartGeometry(
      [
        { y: -len, rx: 0.0068, rz: 0.0072, ao: 0.92 },
        { y: -len * 0.45, rx: 0.0078, rz: 0.008, ao: 1.0 },
        { y: 0, rx: 0.0084, rz: 0.0084, ao: 0.9 },
      ],
      { radialSegments: 8 }
    )
    transformGeo(finger, {
      x: -sign * 0.006,
      y: -0.078,
      z: fingerOffsetsZ[f] - 0.004,
      rz: sign * 0.16,
    })
    fingerParts.push(finger)
  }

  // Opposable thumb pointing forward/inward (-Z)
  const thumb = buildLoftedPartGeometry(
    [
      { y: -0.044, rx: 0.0075, rz: 0.008, ao: 0.94 },
      { y: -0.02, rx: 0.009, rz: 0.0095, ao: 1.0 },
      { y: 0, rx: 0.011, rz: 0.011, ao: 0.88 },
    ],
    { radialSegments: 8 }
  )
  transformGeo(thumb, {
    x: -sign * 0.012,
    y: -0.038,
    z: -0.032,
    rx: -0.58,
    rz: sign * 0.34,
  })

  return {
    upperArm,
    forearm,
    hand: mergeAndDispose([gauntlet, palm, ...fingerParts, thumb]),
  }
}

/**
 * Builds articulated leg segments (`thigh` relative to `hipPivot`, `shin` with
 * knee pad relative to `kneePivot`, and explorer `boot` + `hardware` eyelets
 * relative to `anklePivot`, outsole bottom at y = -0.10m = 0.00m world).
 */
export function buildLegSegmentGeometries(sign) {
  // Thigh + lateral cargo pocket
  const thighTube = buildLoftedPartGeometry(
    [
      { y: -0.435, rx: 0.064, rz: 0.068, superExp: 2.1, ao: 0.84 }, // knee overlap cuff
      { y: -0.34, rx: 0.068, rz: 0.072, superExp: 2.1, ao: 0.94 },
      { y: -0.18, rx: 0.082, rz: 0.089, superExp: 2.15, frontScale: 1.04, ao: 1.0 }, // thigh muscle
      { y: -0.03, rx: 0.089, rz: 0.095, superExp: 2.2, ao: 0.94 },
      { y: 0.042, rx: 0.074, rz: 0.08, ao: 0.8 }, // hip socket cap
    ],
    { radialSegments: 16, uRepeat: 1.4, vRepeat: 1.5 }
  )

  const cargoPocket = transformGeo(buildRoundedBox(0.026, 0.135, 0.095, 2, 0.94), {
    x: sign * 0.082,
    y: -0.21,
    z: 0.004,
    rz: sign * 0.06,
  })
  const cargoFlap = transformGeo(buildRoundedBox(0.03, 0.034, 0.099, 2, 0.98), {
    x: sign * 0.083,
    y: -0.15,
    z: 0.004,
    rz: sign * 0.06,
  })

  // Knee cap + reinforced pad + calf shin down to trouser ankle cuff
  const shinTube = buildLoftedPartGeometry(
    [
      { y: -0.405, rx: 0.056, rz: 0.06, superExp: 2.15, ao: 0.86 }, // ankle cuff overlapping boot
      { y: -0.33, rx: 0.05, rz: 0.054, ao: 0.94 },
      { y: -0.17, z: 0.008, rx: 0.064, rz: 0.072, backScale: 1.12, ao: 1.0 }, // calf swell
      { y: -0.03, z: 0.0, rx: 0.061, rz: 0.066, ao: 0.95 },
      { y: 0.035, z: 0.0, rx: 0.056, rz: 0.06, ao: 0.82 }, // knee joint cap
    ],
    { radialSegments: 16, uRepeat: 1.3, vRepeat: 1.5 }
  )

  const kneePad = transformGeo(buildRoundedBox(0.082, 0.098, 0.024, 2, 0.88), {
    x: 0,
    y: 0.0,
    z: -0.058,
  })

  // Explorer Boot (ankle shaft, heel counter, vamp, toe box, lugged sole at y = -0.10)
  const bootCollar = buildLoftedPartGeometry(
    [
      { y: -0.058, z: 0.006, rx: 0.05, rz: 0.056, superExp: 2.2, ao: 0.92 },
      { y: 0.0, z: 0.004, rx: 0.051, rz: 0.056, superExp: 2.2, ao: 0.96 },
      { y: 0.035, z: 0.002, rx: 0.049, rz: 0.054, ao: 0.8 }, // tucked inside trouser cuff
    ],
    { radialSegments: 14, uRepeat: 1.2, vRepeat: 0.8 }
  )

  const bootVamp = transformGeo(
    buildLoftedPartGeometry(
      [
        { y: -0.075, rx: 0.055, rz: 0.088, superExp: 2.5, frontScale: 1.15, backScale: 0.82, ao: 0.86 },
        { y: -0.032, rx: 0.052, rz: 0.08, superExp: 2.4, frontScale: 1.12, backScale: 0.82, ao: 0.98 },
        { y: 0.004, rx: 0.042, rz: 0.058, superExp: 2.2, frontScale: 1.0, backScale: 0.85, ao: 0.92 },
      ],
      { radialSegments: 16 }
    ),
    { x: 0, y: -0.015, z: -0.035 }
  )

  // Protective toe cap + thick lugged outsole (bottom strictly at y = -0.10m = 0.00m world)
  const toeCap = transformGeo(new THREE.SphereGeometry(0.05, 14, 10), {
    x: 0,
    y: -0.056,
    z: -0.106,
    sx: 1.02,
    sy: 0.62,
    sz: 1.04,
    ao: 0.94,
  })
  const outsole = transformGeo(
    buildLoftedPartGeometry(
      [
        { y: -0.1, rx: 0.057, rz: 0.114, superExp: 2.6, frontScale: 1.18, backScale: 0.82, ao: 0.66 },
        { y: -0.074, rx: 0.058, rz: 0.115, superExp: 2.6, frontScale: 1.18, backScale: 0.82, ao: 0.74 },
      ],
      { radialSegments: 16 }
    ),
    { x: 0, y: 0.0, z: -0.025 }
  )

  // Boot lace eyelets (hardware)
  const eyeletParts = []
  for (let e = 0; e < 3; e += 1) {
    for (const side of [-1, 1]) {
      eyeletParts.push(
        transformGeo(new THREE.CylinderGeometry(0.004, 0.004, 0.008, 6), {
          x: side * 0.026,
          y: -0.018 + e * 0.018,
          z: -0.052 + e * 0.005,
          rx: Math.PI / 2,
          ao: 0.96,
        })
      )
    }
  }

  return {
    thigh: mergeAndDispose([thighTube, cargoPocket, cargoFlap]),
    shin: applyColorGradientY(mergeAndDispose([shinTube, kneePad]), -0.405, 0.035, 0.9, 1.0),
    boot: mergeAndDispose([bootCollar, bootVamp, toeCap, outsole]),
    hardware: mergeAndDispose(eyeletParts),
  }
}
