import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import { resolveElevatorLayout } from './buildElevators.js'
import { getGalvanizedMetalTextureSet } from './buildCeilingVents.js'
import {
  FACE_BOT,
  FACE_NEG_X,
  FACE_NEG_Z,
  FACE_POS_X,
  FACE_POS_Z,
  FACE_TOP,
  buildMergedBoxesWithCulling,
} from './geometryOptimization.js'
import { getMazeSurfaceTextureSet } from './mazeSurfaceTextures.js'
import { markSharedResource } from './sharedResources.js'

export const ELEVATOR_SHAFT_CONFIG = {
  cutoutHalfSpan: 1.54, // 3.08m x 3.08m opening cleanly inside +/-1.61m coffer bay
  soffitY: 3.6,
  slabTopY: 4.42,
  startShaftTopY: 22.8, // ~19.2m vertical interior above ceiling soffit
  exitShaftTopY: 25.4, // ~21.8m vertical interior above ceiling soffit
  wallOuterHalfSpan: 1.78, // sits strictly above 3.60m soffit, never encroaching corridors
  depthFadeStartY: 4.15,
  depthFadeEndStartY: 16.8,
  depthFadeEndExitY: 22.2,
}

export const ELEVATOR_SHAFT_PALETTE = {
  startConcrete: 0x171f2b,
  startRustedSteel: 0x4f2e21,
  startDarkIron: 0x181e27,
  startCable: 0x222730,
  startRebar: 0x5f3828,
  exitConcrete: 0x223044,
  exitSteel: 0x3b4d63,
  exitDarkTrim: 0x1a2433,
  exitCable: 0x303a47,
  exitConduit: 0x45586e,
  darkCrown: 0x030508,
}

function createRng(seedInput) {
  let state = 2166136261
  const str = String(seedInput ?? 'shaft')
  for (let i = 0; i < str.length; i += 1) {
    state ^= str.charCodeAt(i)
    state = Math.imul(state, 16777619)
  }
  state >>>= 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function smoothstepUnit(t) {
  const u = clamp(t, 0, 1)
  return u * u * (3 - 2 * u)
}

/**
 * Computes normalized vertical depth brightness factor [minVis .. 1.0] for shaft geometry.
 * Remains full brightness at & below soffit fade start so lower framing stays clearly lit,
 * then decays progressively into abyssal darkness near the upper shaft cap.
 */
export function computeShaftDepthVisibility(
  y,
  fadeStartY = ELEVATOR_SHAFT_CONFIG.depthFadeStartY,
  fadeEndY = ELEVATOR_SHAFT_CONFIG.depthFadeEndExitY,
  minVis = 0.015
) {
  const norm = clamp((y - fadeStartY) / Math.max(0.5, fadeEndY - fadeStartY), 0, 1)
  const falloff = Math.pow(1 - smoothstepUnit(norm), 1.65)
  return Math.max(minVis, falloff)
}

/**
 * Resolves exact world-space XZ cutout rects centered at `maze.start` and `maze.exit`
 * aligned to the elevator layout so ceiling slabs, girders, ducts, lights, conduits,
 * upper cavern vaults, and shaft interiors stay 100% consistent.
 */
export function resolveElevatorShaftCutouts(
  maze,
  halfSpan = ELEVATOR_SHAFT_CONFIG.cutoutHalfSpan
) {
  if (!maze?.grid || maze.grid.length === 0) return []
  const cutouts = []
  const entries = [
    ['start', maze.start],
    ['exit', maze.exit],
  ]

  for (let i = 0; i < entries.length; i += 1) {
    const [kind, cell] = entries[i]
    if (!cell || !Number.isFinite(cell.row) || !Number.isFinite(cell.col)) continue
    const world = gridToWorld(cell.row, cell.col, maze)
    if (!world) continue
    const layout = resolveElevatorLayout(maze, cell)
    cutouts.push({
      kind,
      row: cell.row,
      col: cell.col,
      cx: world.x,
      cz: world.z,
      halfSpan,
      minX: world.x - halfSpan,
      maxX: world.x + halfSpan,
      minZ: world.z - halfSpan,
      maxZ: world.z + halfSpan,
      yaw: layout.yaw,
      localSides: layout.localSides,
    })
  }

  return cutouts
}

/**
 * Splits any intersecting axis-aligned box in `{ cx, cy, cz, sx, sy, sz, cullFaces }`
 * format around one or more 2D XZ cutout rectangles, exposing cleanly cut interior faces
 * while preserving exterior cull flags and vertex shade metadata.
 */
export function subtractCutoutRectsFromBoxes(
  boxes,
  cutouts,
  { margin = 0, minSeg = 0.006 } = {}
) {
  if (!Array.isArray(boxes) || boxes.length === 0) return []
  if (!Array.isArray(cutouts) || cutouts.length === 0) return boxes.slice()

  let current = boxes.slice()

  for (let cIdx = 0; cIdx < cutouts.length; cIdx += 1) {
    const cut = cutouts[cIdx]
    const cx0 = cut.minX - margin
    const cx1 = cut.maxX + margin
    const cz0 = cut.minZ - margin
    const cz1 = cut.maxZ + margin
    const next = []

    for (let bIdx = 0; bIdx < current.length; bIdx += 1) {
      const box = current[bIdx]
      const bx0 = box.cx - box.sx * 0.5
      const bx1 = box.cx + box.sx * 0.5
      const bz0 = box.cz - box.sz * 0.5
      const bz1 = box.cz + box.sz * 0.5

      const ox0 = Math.max(bx0, cx0)
      const ox1 = Math.min(bx1, cx1)
      const oz0 = Math.max(bz0, cz0)
      const oz1 = Math.min(bz1, cz1)

      if (ox1 - ox0 <= 1e-4 || oz1 - oz0 <= 1e-4) {
        next.push(box)
        continue
      }

      const baseCull = box.cullFaces || 0
      const pushPiece = (x0, x1, z0, z1, clearFaceBits) => {
        const sx = x1 - x0
        const sz = z1 - z0
        if (sx <= minSeg || sz <= minSeg) return
        next.push({
          ...box,
          cx: (x0 + x1) * 0.5,
          cz: (z0 + z1) * 0.5,
          sx,
          sz,
          cullFaces: baseCull & ~clearFaceBits,
        })
      }

      // West strip (left of cutout) -> exposes +X interior cut face
      pushPiece(bx0, ox0, bz0, bz1, FACE_POS_X)
      // East strip (right of cutout) -> exposes -X interior cut face
      pushPiece(ox1, bx1, bz0, bz1, FACE_NEG_X)
      // North strip (above cutout between ox0..ox1) -> exposes +Z interior cut face
      pushPiece(ox0, ox1, bz0, oz0, FACE_POS_Z | FACE_POS_X | FACE_NEG_X)
      // South strip (below cutout between ox0..ox1) -> exposes -Z interior cut face
      pushPiece(ox0, ox1, oz1, bz1, FACE_NEG_Z | FACE_POS_X | FACE_NEG_X)
    }

    current = next
  }

  return current
}

const VERTEX_Y_HOOK = /* glsl */ `
#include <project_vertex>
vec4 shaftWorldPos = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  shaftWorldPos = batchingMatrix * shaftWorldPos;
#endif
#ifdef USE_INSTANCING
  shaftWorldPos = instanceMatrix * shaftWorldPos;
#endif
shaftWorldPos = modelMatrix * shaftWorldPos;
vShaftWorldY = shaftWorldPos.y;
`

/**
 * Applies GPU depth-based vertical darkening to any shaft MeshStandardMaterial so
 * all direct, ambient, hemisphere, directional, and specular contributions decay
 * monotonically into cavernous darkness near the top of the shaft.
 */
export function applyShaftDepthDarknessShader(
  material,
  {
    fadeStartY = ELEVATOR_SHAFT_CONFIG.depthFadeStartY,
    fadeEndY = ELEVATOR_SHAFT_CONFIG.depthFadeEndExitY,
    minVis = 0.01,
    tintHex = ELEVATOR_SHAFT_PALETTE.darkCrown,
    baseBrightness = 1.0,
    lowerGlowHex = 0x000000,
    lowerGlowStrength = 0.0,
  } = {}
) {
  if (!material) return material

  const darkTint = new THREE.Color(tintHex)
  const lowerGlow = new THREE.Color(lowerGlowHex)
  const uniforms = {
    uShaftFadeStartY: { value: fadeStartY },
    uShaftFadeEndY: { value: fadeEndY },
    uShaftMinVis: { value: minVis },
    uShaftDarkTint: { value: new THREE.Vector3(darkTint.r, darkTint.g, darkTint.b) },
    uShaftBaseBrightness: { value: baseBrightness },
    uShaftLowerGlowColor: { value: new THREE.Vector3(lowerGlow.r, lowerGlow.g, lowerGlow.b) },
    uShaftLowerGlowStrength: { value: lowerGlowStrength },
  }

  material.userData.shaftDepthUniforms = uniforms
  material.userData.shaftDepthConfig = {
    fadeStartY,
    fadeEndY,
    minVis,
    baseBrightness,
  }

  const prevCompile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prevCompile === 'function') {
      prevCompile(shader, renderer)
    }
    shader.uniforms.uShaftFadeStartY = uniforms.uShaftFadeStartY
    shader.uniforms.uShaftFadeEndY = uniforms.uShaftFadeEndY
    shader.uniforms.uShaftMinVis = uniforms.uShaftMinVis
    shader.uniforms.uShaftDarkTint = uniforms.uShaftDarkTint
    shader.uniforms.uShaftBaseBrightness = uniforms.uShaftBaseBrightness
    shader.uniforms.uShaftLowerGlowColor = uniforms.uShaftLowerGlowColor
    shader.uniforms.uShaftLowerGlowStrength = uniforms.uShaftLowerGlowStrength

    shader.vertexShader = `varying float vShaftWorldY;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      VERTEX_Y_HOOK
    )

    shader.fragmentShader =
      `varying float vShaftWorldY;
uniform float uShaftFadeStartY;
uniform float uShaftFadeEndY;
uniform float uShaftMinVis;
uniform vec3 uShaftDarkTint;
uniform float uShaftBaseBrightness;
uniform vec3 uShaftLowerGlowColor;
uniform float uShaftLowerGlowStrength;
` +
      shader.fragmentShader
        .replace(
          '#include <tonemapping_fragment>',
          /* glsl */ `
float shaftNorm = clamp((vShaftWorldY - uShaftFadeStartY) / max(0.5, uShaftFadeEndY - uShaftFadeStartY), 0.0, 1.0);
float shaftSmooth = shaftNorm * shaftNorm * (3.0 - 2.0 * shaftNorm);
float shaftVis = max(uShaftMinVis, pow(max(0.0, 1.0 - shaftSmooth), 1.75));
float lowerGlowWeight = smoothstep(10.8, 3.3, vShaftWorldY) * uShaftLowerGlowStrength;
vec3 shaftBaseLit = gl_FragColor.rgb * uShaftBaseBrightness + uShaftLowerGlowColor * lowerGlowWeight * (0.35 + 0.65 * shaftVis);
gl_FragColor.rgb = mix(uShaftDarkTint, shaftBaseLit, shaftVis);
#include <tonemapping_fragment>
`
        )
        .replace(
          '#include <fog_fragment>',
          /* glsl */ `
#include <fog_fragment>
float shaftUpperSuppress = smoothstep(0.55, 0.96, shaftNorm);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uShaftDarkTint, shaftUpperSuppress * 0.9);
`
        )
  }

  material.customProgramCacheKey = () => 'elevator-shaft-depth-v2'
  material.needsUpdate = true
  return material
}

/**
 * Stamps vertical RGB vertex-color attenuation onto an arbitrary BufferGeometry
 * (tubes, cylinders, fractured rubble) matching the shaft depth fade curve.
 */
function applyVerticalVertexColorAttenuation(
  geometry,
  fadeStartY,
  fadeEndY,
  baseColorRgb = [1, 1, 1],
  minShade = 0.06
) {
  if (!geometry?.attributes?.position) return geometry
  const pos = geometry.attributes.position
  const count = pos.count
  const colors = new Float32Array(count * 3)
  const existing = geometry.attributes.color

  for (let i = 0; i < count; i += 1) {
    const vy = pos.getY(i)
    const vis = computeShaftDepthVisibility(vy, fadeStartY, fadeEndY, minShade)
    // Gentle linear vertex shading so lower geometry keeps crisp texture detail while upper recedes cleanly
    const shade = minShade + (1 - minShade) * (0.25 + 0.75 * vis)
    const br = existing ? existing.getX(i) : baseColorRgb[0]
    const bg = existing ? existing.getY(i) : baseColorRgb[1]
    const bb = existing ? existing.getZ(i) : baseColorRgb[2]
    colors[i * 3] = br * shade
    colors[i * 3 + 1] = bg * shade
    colors[i * 3 + 2] = bb * shade
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function mergePreparedGeometries(geos) {
  if (!geos || geos.length === 0) return null
  const prepared = []
  for (let i = 0; i < geos.length; i += 1) {
    const g = geos[i]
    if (!g) continue
    const idx = g.index ? g : g.toNonIndexed()
    if (!idx.attributes.uv) {
      const count = idx.attributes.position.count
      idx.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
    }
    if (!idx.attributes.normal) {
      idx.computeVertexNormals()
    }
    prepared.push(idx)
  }
  if (prepared.length === 0) return null
  const merged = mergeGeometries(prepared, false)
  for (let i = 0; i < geos.length; i += 1) {
    geos[i]?.dispose?.()
  }
  return merged
}

/**
 * Adds a vertical T-section elevator guide rail + rail foot flange + wall tie brackets
 * divided into vertical segments for crisp vertex-color & bounding-box granularity.
 */
function appendGuideRail({
  boxes,
  x,
  z,
  wallX,
  yMin,
  yMax,
  bracketStep = 2.6,
  inwardDirX,
  fadeStartY,
  fadeEndY,
  skipBracketIndices = null,
  brokenBracketShift = 0,
  tintRail = [0.92, 0.94, 0.96],
  tintBracket = [0.8, 0.82, 0.85],
}) {
  const segLen = 2.4
  for (let y0 = yMin; y0 < yMax - 0.05; y0 += segLen) {
    const y1 = Math.min(yMax, y0 + segLen)
    const segH = y1 - y0
    const cy = (y0 + y1) * 0.5
    const vis = computeShaftDepthVisibility(cy, fadeStartY, fadeEndY, 0.06)
    const s = 0.25 + 0.75 * vis

    // Rail backing base plate
    boxes.push({
      cx: x - inwardDirX * 0.03,
      cy,
      cz: z,
      sx: 0.045,
      sy: segH,
      sz: 0.14,
      r: tintRail[0] * s,
      g: tintRail[1] * s,
      b: tintRail[2] * s,
      cullFaces: FACE_TOP | FACE_BOT,
    })

    // T-section machined guide blade extending inward toward elevator frame
    boxes.push({
      cx: x + inwardDirX * 0.032,
      cy,
      cz: z,
      sx: 0.085,
      sy: segH,
      sz: 0.042,
      r: tintRail[0] * 1.04 * s,
      g: tintRail[1] * 1.04 * s,
      b: tintRail[2] * 1.05 * s,
      cullFaces: FACE_TOP | FACE_BOT,
    })
  }

  let bIdx = 0
  for (let by = yMin + 1.15; by < yMax - 0.5; by += bracketStep) {
    bIdx += 1
    if (skipBracketIndices && skipBracketIndices.has(bIdx)) continue
    const vis = computeShaftDepthVisibility(by, fadeStartY, fadeEndY, 0.06)
    const s = 0.28 + 0.72 * vis
    const bridgeW = Math.max(0.06, Math.abs(wallX - x))
    const bridgeCx = (wallX + x) * 0.5
    const rzTilt = brokenBracketShift && bIdx % 2 === 1 ? brokenBracketShift : 0

    boxes.push({
      cx: bridgeCx,
      cy: by,
      cz: z,
      sx: bridgeW,
      sy: 0.09,
      sz: 0.2,
      rz: rzTilt,
      r: tintBracket[0] * s,
      g: tintBracket[1] * s,
      b: tintBracket[2] * s,
    })
    // Wall anchor gusset plate
    boxes.push({
      cx: wallX - inwardDirX * 0.015,
      cy: by,
      cz: z,
      sx: 0.04,
      sy: 0.24,
      sz: 0.28,
      r: tintBracket[0] * 0.9 * s,
      g: tintBracket[1] * 0.9 * s,
      b: tintBracket[2] * 0.9 * s,
    })
  }
}

/**
 * Adds enclosed perimeter concrete shaft walls rising cleanly above the ceiling slab
 * (`y = slabTopY .. topY`) + top blackout seal cap (`cullFaces` removes unseen exterior).
 */
function appendShaftEnclosureWalls({
  wallBoxes,
  crownBoxes,
  innerHalf = 1.54,
  wallThick = 0.24,
  yBottom = 4.42,
  yTop = 22.8,
  fadeStartY,
  fadeEndY,
  rng,
}) {
  const tierHeight = 3.2
  const spanOuter = innerHalf * 2 + wallThick * 2
  const wallOffset = innerHalf + wallThick * 0.5

  for (let y0 = yBottom; y0 < yTop - 0.05; y0 += tierHeight) {
    const y1 = Math.min(yTop, y0 + tierHeight)
    const sy = y1 - y0
    const cy = (y0 + y1) * 0.5
    const vis = computeShaftDepthVisibility(cy, fadeStartY, fadeEndY, 0.05)
    const baseShade = (0.3 + 0.7 * vis) * (0.94 + rng() * 0.1)

    // North & South concrete shaft walls (render inward-facing interior faces only + top/bot joints culled)
    wallBoxes.push(
      {
        cx: 0,
        cy,
        cz: -wallOffset,
        sx: spanOuter,
        sy,
        sz: wallThick,
        shade: baseShade,
        cullFaces: FACE_TOP | FACE_BOT | FACE_NEG_Z | FACE_POS_X | FACE_NEG_X,
      },
      {
        cx: 0,
        cy,
        cz: wallOffset,
        sx: spanOuter,
        sy,
        sz: wallThick,
        shade: baseShade * 0.97,
        cullFaces: FACE_TOP | FACE_BOT | FACE_POS_Z | FACE_POS_X | FACE_NEG_X,
      },
      // West & East shaft walls
      {
        cx: -wallOffset,
        cy,
        cz: 0,
        sx: wallThick,
        sy,
        sz: innerHalf * 2,
        shade: baseShade * 0.95,
        cullFaces: FACE_TOP | FACE_BOT | FACE_NEG_X | FACE_POS_Z | FACE_NEG_Z,
      },
      {
        cx: wallOffset,
        cy,
        cz: 0,
        sx: wallThick,
        sy,
        sz: innerHalf * 2,
        shade: baseShade * 0.95,
        cullFaces: FACE_TOP | FACE_BOT | FACE_POS_X | FACE_POS_Z | FACE_NEG_Z,
      }
    )
  }

  // Deep pitch-dark top seal slab capping the shaft at yTop
  crownBoxes.push({
    cx: 0,
    cy: yTop - 0.16,
    cz: 0,
    sx: innerHalf * 2 + wallThick * 2,
    sy: 0.34,
    sz: innerHalf * 2 + wallThick * 2,
    r: 0.1,
    g: 0.1,
    b: 0.12,
    cullFaces: FACE_TOP | FACE_POS_X | FACE_NEG_X | FACE_POS_Z | FACE_NEG_Z,
  })
}

const _spanUpAxis = new THREE.Vector3(0, 1, 0)
const _spanDir = new THREE.Vector3()
const _spanQuat = new THREE.Quaternion()
const _spanEuler = new THREE.Euler(0, 0, 0, 'XYZ')

/**
 * Helper: pushes a 3D strut/brace box rotated smoothly from point A to point B.
 */
function pushSpanBeamBox(boxes, p0, p1, thicknessX, thicknessZ, shadeRgb, extra = {}) {
  const dx = p1[0] - p0[0]
  const dy = p1[1] - p0[1]
  const dz = p1[2] - p0[2]
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-4) return

  _spanDir.set(dx / len, dy / len, dz / len)
  _spanQuat.setFromUnitVectors(_spanUpAxis, _spanDir)
  _spanEuler.setFromQuaternion(_spanQuat, 'XYZ')

  boxes.push({
    cx: (p0[0] + p1[0]) * 0.5,
    cy: (p0[1] + p1[1]) * 0.5,
    cz: (p0[2] + p1[2]) * 0.5,
    sx: thicknessX,
    sy: len,
    sz: thicknessZ,
    rx: _spanEuler.x,
    ry: _spanEuler.y,
    rz: _spanEuler.z,
    r: shadeRgb[0],
    g: shadeRgb[1],
    b: shadeRgb[2],
    ...extra,
  })
}

// ---------------------------------------------------------------------------
// 1. DAMAGED STARTING ELEVATOR SHAFT
// ---------------------------------------------------------------------------
function buildStartElevatorShaft(cutout, surfaceSet, galvanizedSet, options = {}) {
  const cfg = ELEVATOR_SHAFT_CONFIG
  const topY = cfg.startShaftTopY
  const fadeStartY = 3.55
  const fadeEndY = cfg.depthFadeEndStartY
  const rng = createRng(`start-shaft-${cutout.row}-${cutout.col}-${options.worldSeed ?? 0}`)

  const group = new THREE.Group()
  group.name = 'maze-start-elevator-shaft'
  group.position.set(cutout.cx, 0, cutout.cz)
  group.rotation.y = cutout.yaw

  const concreteBoxes = []
  const concreteEdgeBoxes = [] // rotated concrete chunks/debris
  const steelBoxes = []
  const ironBoxes = []
  const crownBoxes = []
  const tubeParts = []
  const rebarParts = []

  // A. Corroded Concrete Enclosure Walls & Interior Ledge Tiers
  appendShaftEnclosureWalls({
    wallBoxes: concreteBoxes,
    crownBoxes,
    innerHalf: cutout.halfSpan,
    wallThick: 0.24,
    yBottom: cfg.slabTopY - 0.02,
    yTop: topY,
    fadeStartY,
    fadeEndY,
    rng,
  })

  // Recessed horizontal concrete shaft collar ledges at varied heights for depth cues
  const ledgeHeights = [7.6, 11.9, 16.4]
  for (let i = 0; i < ledgeHeights.length; i += 1) {
    const ly = ledgeHeights[i]
    const vis = computeShaftDepthVisibility(ly, fadeStartY, fadeEndY, 0.05)
    const shade = 0.28 + 0.72 * vis
    concreteBoxes.push(
      { cx: 0, cy: ly, cz: -1.5, sx: 3.04, sy: 0.28, sz: 0.1, shade, cullFaces: FACE_NEG_Z },
      { cx: 0, cy: ly, cz: 1.5, sx: 3.04, sy: 0.28, sz: 0.1, shade, cullFaces: FACE_POS_Z },
      { cx: -1.5, cy: ly, cz: 0, sx: 0.1, sy: 0.28, sz: 2.94, shade, cullFaces: FACE_NEG_X },
      { cx: 1.5, cy: ly, cz: 0, sx: 0.1, sy: 0.28, sz: 2.94, shade, cullFaces: FACE_POS_X }
    )
  }

  // B. Irregular Damaged Ceiling Cutout Rim, Fractured Concrete Chunks, Hanging Debris & Exposed Rebar
  const fracturedSegments = [
    // North edge broken slabs (irregular inward overhang 0.06..0.24m)
    { cx: -1.04, cy: 3.74, cz: -1.49, sx: 0.88, sy: 0.34, sz: 0.22, rx: 0.08, rz: -0.09 },
    { cx: -0.18, cy: 3.82, cz: -1.51, sx: 0.72, sy: 0.42, sz: 0.18, rx: 0.05, ry: 0.06 },
    { cx: 0.88, cy: 3.68, cz: -1.46, sx: 0.96, sy: 0.28, sz: 0.28, rx: 0.12, rz: 0.08 },
    // South edge broken chunks & sagging corner lip
    { cx: -0.92, cy: 3.66, cz: 1.46, sx: 0.92, sy: 0.29, sz: 0.28, rx: -0.11, rz: 0.06 },
    { cx: 0.14, cy: 3.79, cz: 1.51, sx: 0.84, sy: 0.36, sz: 0.16, rx: -0.04, ry: -0.05 },
    { cx: 1.06, cy: 3.62, cz: 1.45, sx: 0.76, sy: 0.26, sz: 0.3, rx: -0.15, rz: -0.11 },
    // West edge jagged overhang
    { cx: -1.47, cy: 3.72, cz: -0.78, sx: 0.26, sy: 0.34, sz: 0.92, rz: -0.09, rx: 0.06 },
    { cx: -1.49, cy: 3.64, cz: 0.58, sx: 0.24, sy: 0.26, sz: 1.08, rz: -0.14, ry: 0.04 },
    // East edge jagged overhang
    { cx: 1.46, cy: 3.69, cz: -0.52, sx: 0.28, sy: 0.3, sz: 1.12, rz: 0.11, rx: -0.05 },
    { cx: 1.49, cy: 3.81, cz: 0.78, sx: 0.22, sy: 0.38, sz: 0.88, rz: 0.08, ry: -0.06 },
    // Hanging dangling concrete slab chunk tethered at rear-left corner
    { cx: -1.32, cy: 3.45, cz: 1.32, sx: 0.44, sy: 0.18, sz: 0.38, rx: -0.44, rz: 0.32 },
    { cx: 1.34, cy: 3.49, cz: -1.34, sx: 0.36, sy: 0.16, sz: 0.34, rx: 0.36, rz: -0.38 },
  ]
  for (let i = 0; i < fracturedSegments.length; i += 1) {
    const f = fracturedSegments[i]
    concreteEdgeBoxes.push({
      ...f,
      r: 0.82 + rng() * 0.14,
      g: 0.82 + rng() * 0.12,
      b: 0.8 + rng() * 0.12,
    })
  }

  // Bent steel angle-trim collars ripped away from concrete slab rim
  steelBoxes.push(
    { cx: -1.52, cy: 3.56, cz: -0.42, sx: 0.1, sy: 0.12, sz: 2.08, rx: 0.04, rz: -0.18, r: 0.88, g: 0.72, b: 0.65 },
    { cx: 1.52, cy: 3.52, cz: 0.24, sx: 0.1, sy: 0.12, sz: 2.32, rx: -0.07, rz: 0.24, r: 0.86, g: 0.7, b: 0.62 },
    { cx: -0.35, cy: 3.55, cz: -1.52, sx: 2.25, sy: 0.11, sz: 0.1, rx: 0.22, ry: 0.04, r: 0.85, g: 0.68, b: 0.6 },
    // Partially detached sagging steel flashing flap hanging downward into perimeter
    { cx: 0.96, cy: 3.42, cz: 1.44, sx: 0.92, sy: 0.06, sz: 0.18, rx: -0.62, rz: -0.14, r: 0.84, g: 0.68, b: 0.6 }
  )

  // Exposed protruding bent reinforcement rebar bars jutting out from broken concrete perimeter
  const rebarSpecs = [
    [-1.56, 3.68, -1.12, -1.16, 3.54, -1.04],
    [-1.56, 3.75, -0.82, -1.24, 3.49, -0.78],
    [-1.56, 3.72, -0.14, -1.28, 3.64, -0.06],
    [-1.56, 3.82, 0.42, -1.18, 3.52, 0.56],
    [-1.56, 3.7, 1.08, -1.21, 3.48, 0.96],
    [1.56, 3.66, -1.02, 1.21, 3.48, -0.94],
    [1.56, 3.74, -0.38, 1.26, 3.56, -0.44],
    [1.56, 3.78, 0.28, 1.18, 3.49, 0.38],
    [1.56, 3.69, 0.96, 1.24, 3.54, 0.88],
    [-1.08, 3.72, -1.56, -1.02, 3.47, -1.22],
    [-0.42, 3.79, -1.56, -0.36, 3.58, -1.26],
    [0.34, 3.71, -1.56, 0.44, 3.48, -1.2],
    [0.98, 3.76, -1.56, 0.92, 3.53, -1.25],
    [-0.94, 3.74, 1.56, -0.88, 3.46, 1.2],
    [-0.18, 3.7, 1.56, -0.26, 3.52, 1.24],
    [0.52, 3.78, 1.56, 0.46, 3.48, 1.21],
    [1.12, 3.68, 1.56, 1.04, 3.44, 1.22],
  ]
  for (let i = 0; i < rebarSpecs.length; i += 1) {
    const [x0, y0, z0, x1, y1, z1] = rebarSpecs[i]
    const midX = (x0 + x1) * 0.5 + (rng() - 0.5) * 0.06
    const midY = (y0 + y1) * 0.5 + 0.05
    const midZ = (z0 + z1) * 0.5 + (rng() - 0.5) * 0.06
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x0, y0, z0),
      new THREE.Vector3(midX, midY, midZ),
      new THREE.Vector3(x1, y1 - 0.05, z1),
    ])
    rebarParts.push(new THREE.TubeGeometry(curve, 6, 0.013, 5, false))
  }

  // C. Vertical Elevator Guide Rails, Rusted Support Beams, Warped Cross-Bracing & Damaged Mechanism
  appendGuideRail({
    boxes: steelBoxes,
    x: -1.42,
    z: 0,
    wallX: -1.54,
    yMin: 2.98,
    yMax: topY - 1.0,
    bracketStep: 2.75,
    inwardDirX: 1,
    fadeStartY,
    fadeEndY,
    skipBracketIndices: new Set([2, 5]),
    brokenBracketShift: 0.08,
    tintRail: [0.85, 0.72, 0.65],
    tintBracket: [0.78, 0.64, 0.56],
  })
  appendGuideRail({
    boxes: steelBoxes,
    x: 1.42,
    z: 0,
    wallX: 1.54,
    yMin: 2.98,
    yMax: topY - 1.0,
    bracketStep: 2.75,
    inwardDirX: -1,
    fadeStartY,
    fadeEndY,
    skipBracketIndices: new Set([3]),
    brokenBracketShift: -0.09,
    tintRail: [0.85, 0.72, 0.65],
    tintBracket: [0.78, 0.64, 0.56],
  })

  // Rear counterweight guide rails & jammed, tilted counterweight assembly mid-shaft (y = 8.4m)
  for (const wx of [-0.34, 0.34]) {
    const cVis = computeShaftDepthVisibility(12.5, fadeStartY, fadeEndY, 0.06)
    steelBoxes.push({
      cx: wx,
      cy: 12.6,
      cz: 1.46,
      sx: 0.055,
      sy: 17.6,
      sz: 0.055,
      r: 0.8 * (0.3 + 0.7 * cVis),
      g: 0.66 * (0.3 + 0.7 * cVis),
      b: 0.58 * (0.3 + 0.7 * cVis),
      cullFaces: FACE_TOP | FACE_BOT,
    })
  }
  const cwVis = computeShaftDepthVisibility(8.4, fadeStartY, fadeEndY, 0.06)
  steelBoxes.push({
    cx: 0.02,
    cy: 8.45,
    cz: 1.38,
    sx: 0.72,
    sy: 1.38,
    sz: 0.14,
    rz: 0.11,
    r: 0.76 * (0.3 + 0.7 * cwVis),
    g: 0.62 * (0.3 + 0.7 * cwVis),
    b: 0.54 * (0.3 + 0.7 * cwVis),
  })

  // Perimeter rusted I-beams at staggered tiers + buckled diagonal cross-bracing
  const beamHeights = [5.5, 8.9, 12.4, 15.9, 19.3]
  for (let i = 0; i < beamHeights.length; i += 1) {
    const by = beamHeights[i]
    const vis = computeShaftDepthVisibility(by, fadeStartY, fadeEndY, 0.05)
    const s = 0.25 + 0.75 * vis
    const tiltZ = i === 1 ? 0.055 : i === 3 ? -0.04 : 0
    // North & South perimeter wall tie beams (keep center sightline wide open!)
    steelBoxes.push(
      { cx: 0, cy: by, cz: -1.46, sx: 2.98, sy: 0.18, sz: 0.14, rz: tiltZ, r: 0.82 * s, g: 0.68 * s, b: 0.6 * s },
      { cx: 0, cy: by, cz: 1.46, sx: 2.98, sy: 0.18, sz: 0.14, rz: -tiltZ * 0.5, r: 0.82 * s, g: 0.68 * s, b: 0.6 * s },
      { cx: -1.46, cy: by, cz: 0, sx: 0.14, sy: 0.18, sz: 2.76, r: 0.8 * s, g: 0.66 * s, b: 0.58 * s },
      { cx: 1.46, cy: by, cz: 0, sx: 0.14, sy: 0.18, sz: 2.76, r: 0.8 * s, g: 0.66 * s, b: 0.58 * s }
    )
    // Structural bridge cross-beam spanning at higher tiers (z = 0.52m off-center so direct upward cone stays dramatic)
    if (i >= 1) {
      ironBoxes.push({
        cx: 0,
        cy: by + 0.22,
        cz: i % 2 === 0 ? -0.68 : 0.68,
        sx: 2.96,
        sy: 0.2,
        sz: 0.22,
        rz: i === 1 ? -0.09 : 0,
        r: 0.85 * s,
        g: 0.8 * s,
        b: 0.76 * s,
      })
    }
  }

  // Diagonal bracing struts along side & rear walls (plus one bent dangling brace at y = 6.2m)
  const braceTiers = [
    [-1.46, 5.5, -1.35, -1.46, 8.9, 1.35],
    [1.46, 8.9, -1.35, 1.46, 12.4, 1.35],
    [-1.35, 12.4, 1.46, 1.35, 15.9, 1.46],
    [-1.46, 5.6, 1.25, -1.28, 7.25, 0.22], // snapped bent cross-strut hanging diagonally inward
  ]
  for (let i = 0; i < braceTiers.length; i += 1) {
    const [x0, y0, z0, x1, y1, z1] = braceTiers[i]
    const vis = computeShaftDepthVisibility((y0 + y1) * 0.5, fadeStartY, fadeEndY, 0.06)
    const s = 0.25 + 0.75 * vis
    pushSpanBeamBox(steelBoxes, [x0, y0, z0], [x1, y1, z1], 0.08, 0.08, [0.8 * s, 0.67 * s, 0.6 * s])
  }

  // D. Damaged Overhead Pulley Sheave Brackets, Severed Conduit & Varied-Height Hanging Broken Cables
  // Skewed mid-shaft deflector sheave assembly at y = 9.3m
  const pulleyMidY = 9.35
  const pmVis = computeShaftDepthVisibility(pulleyMidY, fadeStartY, fadeEndY, 0.05)
  ironBoxes.push(
    { cx: 0.24, cy: pulleyMidY, cz: 0.64, sx: 0.42, sy: 0.34, sz: 0.36, rz: 0.14, r: 0.8 * pmVis, g: 0.76 * pmVis, b: 0.72 * pmVis }
  )
  const startSheaveLower = new THREE.CylinderGeometry(0.32, 0.32, 0.11, 14)
  startSheaveLower.rotateZ(Math.PI / 2 + 0.14)
  startSheaveLower.translate(0.24, pulleyMidY - 0.06, 0.64)
  tubeParts.push(applyVerticalVertexColorAttenuation(startSheaveLower, fadeStartY, fadeEndY, [0.85, 0.72, 0.66]))

  // Upper hoist motor frame & twin pulleys at y = 14.9m
  const upperHoistY = 14.9
  const uhVis = computeShaftDepthVisibility(upperHoistY, fadeStartY, fadeEndY, 0.05)
  ironBoxes.push(
    { cx: 0, cy: upperHoistY, cz: -0.18, sx: 2.94, sy: 0.28, sz: 0.46, r: 0.78 * uhVis, g: 0.75 * uhVis, b: 0.74 * uhVis },
    { cx: -0.28, cy: upperHoistY + 0.32, cz: -0.18, sx: 0.64, sy: 0.42, sz: 0.56, r: 0.72 * uhVis, g: 0.72 * uhVis, b: 0.74 * uhVis }
  )
  for (const sx of [-0.36, 0.36]) {
    const upperSheave = new THREE.CylinderGeometry(0.36, 0.36, 0.12, 14)
    upperSheave.rotateZ(Math.PI / 2)
    upperSheave.translate(sx, upperHoistY - 0.14, -0.18)
    tubeParts.push(applyVerticalVertexColorAttenuation(upperSheave, fadeStartY, fadeEndY, [0.8, 0.76, 0.74]))
  }

  // Severed wall electrical junction box + dangling broken conduit at y = 4.6..8.2m
  ironBoxes.push(
    { cx: -1.48, cy: 4.85, cz: -0.92, sx: 0.12, sy: 0.34, sz: 0.26, rz: -0.06, r: 0.85, g: 0.76, b: 0.7 },
    { cx: 1.48, cy: 7.15, cz: 0.88, sx: 0.12, sy: 0.36, sz: 0.28, rz: 0.08, r: 0.76, g: 0.72, b: 0.68 }
  )

  // Broken hoist cables & severed feeder cables hanging down to staggered heights
  const brokenCablePaths = [
    // Low hanging snapped hoist cable tail reaching y = 4.35m (clearly visible looking up from cab)
    [[0.22, 14.8, -0.18], [0.28, 10.6, 0.12], [0.36, 7.1, 0.34], [0.24, 4.35, 0.42]],
    // Mid-low snapped cable hanging down to y = 5.45m
    [[-0.36, 14.8, -0.18], [-0.46, 11.4, -0.28], [-0.38, 7.8, -0.44], [-0.52, 5.45, -0.32]],
    // Mid snapped cable draped over guide bracket down to y = 6.9m
    [[0.18, 9.3, 0.64], [0.58, 8.2, 0.88], [0.76, 6.9, 1.02]],
    // Deep upper snapped hoist cable hanging down to y = 10.4m
    [[0.4, 18.6, 0.16], [0.54, 15.2, 0.26], [0.44, 10.4, 0.18]],
    // Counterweight severed slack cable hanging down to y = 6.1m
    [[-0.24, 16.2, 1.36], [-0.14, 11.4, 1.32], [-0.3, 6.1, 1.24]],
    // Hanging severed conduit/wire loop along west wall down to y = 3.85m
    [[-1.44, 4.85, -0.92], [-1.32, 4.32, -0.84], [-1.38, 3.85, -0.72]],
  ]
  for (let i = 0; i < brokenCablePaths.length; i += 1) {
    const pts = brokenCablePaths[i].map((p) => new THREE.Vector3(p[0], p[1], p[2]))
    const curve = new THREE.CatmullRomCurve3(pts)
    const radius = i < 4 ? 0.022 : 0.016
    const geo = new THREE.TubeGeometry(curve, i < 4 ? 14 : 10, radius, 6, false)
    tubeParts.push(applyVerticalVertexColorAttenuation(geo, fadeStartY, fadeEndY, [0.92, 0.92, 0.94]))
  }

  // Create Materials with shared pooled textures + GPU vertical depth darkening (visibly darker/gloomier than extraction shaft)
  const startShaderOpts = {
    fadeStartY,
    fadeEndY,
    minVis: 0.004,
    baseBrightness: 0.66,
  }
  const concreteMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_SHAFT_PALETTE.startConcrete,
      map: surfaceSet.wall.map,
      roughnessMap: surfaceSet.wall.roughnessMap,
      bumpMap: surfaceSet.wall.bumpMap,
      bumpScale: 0.048,
      roughness: 0.97,
      metalness: 0.02,
      envMapIntensity: 0.16,
      vertexColors: true,
    }),
    startShaderOpts
  )

  const rustedSteelMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_SHAFT_PALETTE.startRustedSteel,
      map: galvanizedSet.map,
      roughnessMap: galvanizedSet.roughnessMap,
      bumpMap: galvanizedSet.bumpMap,
      bumpScale: 0.035,
      roughness: 0.9,
      metalness: 0.38,
      envMapIntensity: 0.18,
      vertexColors: true,
    }),
    startShaderOpts
  )

  const darkIronMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_SHAFT_PALETTE.startDarkIron,
      map: galvanizedSet.map,
      roughnessMap: galvanizedSet.roughnessMap,
      roughness: 0.82,
      metalness: 0.52,
      envMapIntensity: 0.18,
      vertexColors: true,
    }),
    startShaderOpts
  )

  const rebarMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_SHAFT_PALETTE.startRebar,
      roughness: 0.88,
      metalness: 0.44,
      envMapIntensity: 0.18,
      vertexColors: true,
    }),
    startShaderOpts
  )

  const cableMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_SHAFT_PALETTE.startCable,
      roughness: 0.8,
      metalness: 0.44,
      envMapIntensity: 0.16,
      vertexColors: true,
    }),
    startShaderOpts
  )

  const crownMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_SHAFT_PALETTE.darkCrown,
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0.0,
  })

  const addMeshLayer = (name, geo, mat) => {
    if (!geo) return null
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }

  const wallConcreteGeo = buildMergedBoxesWithCulling(concreteBoxes, {
    tileUnits: CELL_SIZE * 2,
    worldTileUVs: true,
    storeBoxBounds: false,
  })
  const debrisConcreteGeo = buildMergedBoxesWithCulling(concreteEdgeBoxes, {
    tileUnits: 1.8,
    worldTileUVs: false,
    storeBoxBounds: false,
  })
  const combinedConcreteGeo = mergePreparedGeometries([wallConcreteGeo, debrisConcreteGeo])
  addMeshLayer('start-shaft-concrete-walls', combinedConcreteGeo, concreteMat)

  addMeshLayer(
    'start-shaft-rusted-steel',
    buildMergedBoxesWithCulling(steelBoxes, { tileUnits: 2.0, worldTileUVs: false, storeBoxBounds: false }),
    rustedSteelMat
  )
  addMeshLayer(
    'start-shaft-damaged-mechanism',
    buildMergedBoxesWithCulling(ironBoxes, { tileUnits: 1.8, worldTileUVs: false, storeBoxBounds: false }),
    darkIronMat
  )

  const rebarGeo = mergePreparedGeometries(
    rebarParts.map((g) => applyVerticalVertexColorAttenuation(g, fadeStartY, fadeEndY, [0.95, 0.86, 0.82]))
  )
  addMeshLayer('start-shaft-exposed-rebar', rebarGeo, rebarMat)

  addMeshLayer('start-shaft-broken-cables', mergePreparedGeometries(tubeParts), cableMat)

  const crownGeo = buildMergedBoxesWithCulling(crownBoxes, {
    tileUnits: 2.0,
    worldTileUVs: false,
    storeBoxBounds: false,
    includeVertexColors: false,
  })
  const crownMesh = addMeshLayer('start-shaft-dark-crown', crownGeo, crownMat)
  if (crownMesh) crownMesh.receiveShadow = false

  group.userData = {
    isStartElevatorShaft: true,
    cutout,
    topY,
    railCount: 4,
    beamCount: beamHeights.length,
    brokenCableCount: brokenCablePaths.length,
    rebarCount: rebarSpecs.length,
    fadeStartY,
    fadeEndY,
    materials: [concreteMat, rustedSteelMat, darkIronMat, rebarMat, cableMat],
  }

  return group
}

// ---------------------------------------------------------------------------
// 2. EXTRACTION ELEVATOR INDUSTRIAL SHAFT
// ---------------------------------------------------------------------------
function buildExitElevatorShaft(cutout, surfaceSet, galvanizedSet, options = {}) {
  const cfg = ELEVATOR_SHAFT_CONFIG
  const topY = cfg.exitShaftTopY
  const fadeStartY = cfg.depthFadeStartY
  const fadeEndY = cfg.depthFadeEndExitY
  const rng = createRng(`exit-shaft-${cutout.row}-${cutout.col}-${options.worldSeed ?? 0}`)

  const group = new THREE.Group()
  group.name = 'maze-exit-elevator-shaft'
  group.position.set(cutout.cx, 0, cutout.cz)
  group.rotation.y = cutout.yaw

  const concreteBoxes = []
  const steelBoxes = []
  const darkTrimBoxes = []
  const conduitBoxes = []
  const crownBoxes = []
  const cableParts = []
  const cwDynamicBoxes = []

  // A. Enclosed Industrial Concrete Shaft Walls & Top Blackout Crown Seal
  appendShaftEnclosureWalls({
    wallBoxes: concreteBoxes,
    crownBoxes,
    innerHalf: cutout.halfSpan,
    wallThick: 0.24,
    yBottom: cfg.slabTopY - 0.02,
    yTop: topY,
    fadeStartY,
    fadeEndY,
    rng,
  })

  // Periodic concrete structural stiffening bands every 3.4m up the shaft
  const collarLedgeHeights = [6.0, 9.4, 12.8, 16.2, 19.6]
  for (let i = 0; i < collarLedgeHeights.length; i += 1) {
    const ly = collarLedgeHeights[i]
    const vis = computeShaftDepthVisibility(ly, fadeStartY, fadeEndY, 0.05)
    const shade = 0.28 + 0.72 * vis
    concreteBoxes.push(
      { cx: 0, cy: ly, cz: -1.5, sx: 3.04, sy: 0.26, sz: 0.09, shade, cullFaces: FACE_NEG_Z },
      { cx: 0, cy: ly, cz: 1.5, sx: 3.04, sy: 0.26, sz: 0.09, shade, cullFaces: FACE_POS_Z },
      { cx: -1.5, cy: ly, cz: 0, sx: 0.09, sy: 0.26, sz: 2.94, shade, cullFaces: FACE_NEG_X },
      { cx: 1.5, cy: ly, cz: 0, sx: 0.09, sy: 0.26, sz: 2.94, shade, cullFaces: FACE_POS_X }
    )
  }

  // B. Reinforced Steel Ceiling Opening Curb Frame, Corner Gussets & Anchor Collars (y = 3.46..4.44m)
  const collarHeight = cfg.slabTopY - 3.46
  const collarCy = 3.46 + collarHeight * 0.5
  darkTrimBoxes.push(
    { cx: 0, cy: collarCy, cz: -1.52, sx: 3.12, sy: collarHeight, sz: 0.08, r: 0.92, g: 0.94, b: 0.98 },
    { cx: 0, cy: collarCy, cz: 1.52, sx: 3.12, sy: collarHeight, sz: 0.08, r: 0.92, g: 0.94, b: 0.98 },
    { cx: -1.52, cy: collarCy, cz: 0, sx: 0.08, sy: collarHeight, sz: 2.96, r: 0.92, g: 0.94, b: 0.98 },
    { cx: 1.52, cy: collarCy, cz: 0, sx: 0.08, sy: collarHeight, sz: 2.96, r: 0.92, g: 0.94, b: 0.98 },
    // Lower rolled soffit flange lip framing the ceiling cutout cleanly
    { cx: 0, cy: 3.49, cz: -1.46, sx: 3.08, sy: 0.08, sz: 0.16, r: 0.95, g: 0.96, b: 1.0 },
    { cx: 0, cy: 3.49, cz: 1.46, sx: 3.08, sy: 0.08, sz: 0.16, r: 0.95, g: 0.96, b: 1.0 },
    { cx: -1.46, cy: 3.49, cz: 0, sx: 0.16, sy: 0.08, sz: 2.76, r: 0.95, g: 0.96, b: 1.0 },
    { cx: 1.46, cy: 3.49, cz: 0, sx: 0.16, sy: 0.08, sz: 2.76, r: 0.95, g: 0.96, b: 1.0 }
  )
  // Corner bolted structural gussets tying opening collar to corner stanchions
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      steelBoxes.push({
        cx: sx * 1.4,
        cy: 3.55,
        cz: sz * 1.4,
        sx: 0.24,
        sy: 0.14,
        sz: 0.24,
        r: 0.94,
        g: 0.95,
        b: 0.98,
      })
    }
  }

  // Four full-height vertical steel corner stanchions (divided into 3m tiers for clean depth attenuation)
  const stanSeg = 3.0
  for (const sx of [-1.48, 1.48]) {
    for (const sz of [-1.48, 1.48]) {
      for (let y0 = 3.52; y0 < topY - 0.8; y0 += stanSeg) {
        const y1 = Math.min(topY - 0.8, y0 + stanSeg)
        const sy = y1 - y0
        const cy = (y0 + y1) * 0.5
        const vis = computeShaftDepthVisibility(cy, fadeStartY, fadeEndY, 0.06)
        const s = 0.26 + 0.74 * vis
        darkTrimBoxes.push({
          cx: sx,
          cy,
          cz: sz,
          sx: 0.13,
          sy,
          sz: 0.13,
          r: 0.92 * s,
          g: 0.94 * s,
          b: 0.96 * s,
          cullFaces: FACE_TOP | FACE_BOT,
        })
      }
    }
  }

  // C. Precision Twin Elevator Guide Rails & Counterweight Tracks
  appendGuideRail({
    boxes: steelBoxes,
    x: -1.42,
    z: 0,
    wallX: -1.54,
    yMin: 2.94,
    yMax: topY - 0.8,
    bracketStep: 2.4,
    inwardDirX: 1,
    fadeStartY,
    fadeEndY,
    tintRail: [0.96, 0.98, 1.0],
    tintBracket: [0.88, 0.9, 0.94],
  })
  appendGuideRail({
    boxes: steelBoxes,
    x: 1.42,
    z: 0,
    wallX: 1.54,
    yMin: 2.94,
    yMax: topY - 0.8,
    bracketStep: 2.4,
    inwardDirX: -1,
    fadeStartY,
    fadeEndY,
    tintRail: [0.96, 0.98, 1.0],
    tintBracket: [0.88, 0.9, 0.94],
  })

  // Rear counterweight T-guide rails (y = 3.55 .. topY - 0.8) + counterweight assembly
  for (const wx of [-0.36, 0.36]) {
    for (let y0 = 3.55; y0 < topY - 0.8; y0 += 2.6) {
      const y1 = Math.min(topY - 0.8, y0 + 2.6)
      const sy = y1 - y0
      const cy = (y0 + y1) * 0.5
      const vis = computeShaftDepthVisibility(cy, fadeStartY, fadeEndY, 0.06)
      const s = 0.28 + 0.72 * vis
      steelBoxes.push({
        cx: wx,
        cy,
        cz: 1.45,
        sx: 0.052,
        sy,
        sz: 0.055,
        r: 0.92 * s,
        g: 0.94 * s,
        b: 0.96 * s,
        cullFaces: FACE_TOP | FACE_BOT,
      })
    }
  }

  // Dynamic counterweight car (starts at y = 10.9m, lowers smoothly during extraction departure!)
  const cwBaseY = 10.9
  cwDynamicBoxes.push(
    { cx: 0, cy: 0, cz: 1.37, sx: 0.68, sy: 1.44, sz: 0.14, r: 0.9, g: 0.92, b: 0.95 },
    { cx: 0, cy: 0.76, cz: 1.37, sx: 0.74, sy: 0.1, sz: 0.18, r: 0.96, g: 0.96, b: 0.98 },
    { cx: 0, cy: -0.76, cz: 1.37, sx: 0.74, sy: 0.1, sz: 0.18, r: 0.96, g: 0.96, b: 0.98 }
  )
  for (let w = -2; w <= 2; w += 1) {
    cwDynamicBoxes.push({
      cx: 0,
      cy: w * 0.24,
      cz: 1.37,
      sx: 0.58,
      sy: 0.15,
      sz: 0.17,
      r: 0.8,
      g: 0.82,
      b: 0.86,
    })
  }

  // D. Multi-Tier Horizontal Steel Ring Beams & Diagonal Structural Cross-Bracing
  const beamTiers = [5.8, 9.2, 12.6, 16.0, 19.6, 22.8]
  for (let i = 0; i < beamTiers.length; i += 1) {
    const by = beamTiers[i]
    const vis = computeShaftDepthVisibility(by, fadeStartY, fadeEndY, 0.05)
    const s = 0.25 + 0.75 * vis
    steelBoxes.push(
      { cx: 0, cy: by, cz: -1.45, sx: 2.94, sy: 0.18, sz: 0.14, r: 0.9 * s, g: 0.92 * s, b: 0.96 * s },
      { cx: 0, cy: by, cz: 1.45, sx: 2.94, sy: 0.18, sz: 0.14, r: 0.9 * s, g: 0.92 * s, b: 0.96 * s },
      { cx: -1.45, cy: by, cz: 0, sx: 0.14, sy: 0.18, sz: 2.74, r: 0.9 * s, g: 0.92 * s, b: 0.96 * s },
      { cx: 1.45, cy: by, cz: 0, sx: 0.14, sy: 0.18, sz: 2.74, r: 0.9 * s, g: 0.92 * s, b: 0.96 * s }
    )
    // Secondary rear/front offset cross-joists framing shaft aperture without blocking central sightline
    darkTrimBoxes.push(
      { cx: 0, cy: by + 0.08, cz: -1.16, sx: 2.86, sy: 0.12, sz: 0.14, r: 0.92 * s, g: 0.94 * s, b: 0.96 * s },
      { cx: 0, cy: by + 0.08, cz: 1.16, sx: 2.86, sy: 0.12, sz: 0.14, r: 0.92 * s, g: 0.94 * s, b: 0.96 * s }
    )
  }

  // Diagonal X-bracing across alternating wall bays up the vertical shaft
  const xBracePairs = [
    // West wall X-bracing bay 1 & 3
    [-1.46, 5.8, -1.36, -1.46, 9.2, 1.36],
    [-1.46, 5.8, 1.36, -1.46, 9.2, -1.36],
    [-1.46, 12.6, -1.36, -1.46, 16.0, 1.36],
    [-1.46, 12.6, 1.36, -1.46, 16.0, -1.36],
    // East wall X-bracing bay 2 & 4
    [1.46, 9.2, -1.36, 1.46, 12.6, 1.36],
    [1.46, 9.2, 1.36, 1.46, 12.6, -1.36],
    [1.46, 16.0, -1.36, 1.46, 19.6, 1.36],
    [1.46, 16.0, 1.36, 1.46, 19.6, -1.36],
    // Rear wall K-braces framing counterweight channel
    [-1.36, 5.8, 1.46, -0.44, 9.2, 1.46],
    [1.36, 5.8, 1.46, 0.44, 9.2, 1.46],
    [-1.36, 12.6, 1.46, -0.44, 16.0, 1.46],
    [1.36, 12.6, 1.46, 0.44, 16.0, 1.46],
  ]
  for (let i = 0; i < xBracePairs.length; i += 1) {
    const [x0, y0, z0, x1, y1, z1] = xBracePairs[i]
    const vis = computeShaftDepthVisibility((y0 + y1) * 0.5, fadeStartY, fadeEndY, 0.06)
    const s = 0.25 + 0.75 * vis
    pushSpanBeamBox(steelBoxes, [x0, y0, z0], [x1, y1, z1], 0.07, 0.07, [0.88 * s, 0.9 * s, 0.95 * s])
  }

  // E. Hoist Sheave Assemblies, Traction Machine Beams, Tensioned Ropes & Industrial Wiring
  // Mid deflector beam & guide rollers at y = 11.4m (offset z = 0.74m so direct center climb stays crisp)
  const midDefVis = computeShaftDepthVisibility(11.4, fadeStartY, fadeEndY, 0.05)
  darkTrimBoxes.push({
    cx: 0,
    cy: 11.4,
    cz: 0.74,
    sx: 2.94,
    sy: 0.22,
    sz: 0.26,
    r: 0.9 * midDefVis,
    g: 0.92 * midDefVis,
    b: 0.96 * midDefVis,
  })
  for (const sx of [-0.34, 0.34]) {
    const roller = new THREE.CylinderGeometry(0.18, 0.18, 0.08, 12)
    roller.rotateZ(Math.PI / 2)
    roller.translate(sx, 11.4, 0.62)
    cableParts.push(applyVerticalVertexColorAttenuation(roller, fadeStartY, fadeEndY, [0.92, 0.94, 0.96]))
  }

  // Main upper traction machine bedplate + twin drive sheaves at y = 17.8m
  const headY = 17.8
  const headVis = computeShaftDepthVisibility(headY, fadeStartY, fadeEndY, 0.05)
  darkTrimBoxes.push(
    { cx: 0, cy: headY, cz: 0.04, sx: 2.96, sy: 0.3, sz: 0.56, r: 0.88 * headVis, g: 0.9 * headVis, b: 0.94 * headVis },
    { cx: -0.68, cy: headY + 0.38, cz: 0.04, sx: 0.74, sy: 0.44, sz: 0.54, r: 0.82 * headVis, g: 0.85 * headVis, b: 0.9 * headVis }
  )
  for (const sx of [-0.34, 0.34]) {
    const driveSheave = new THREE.CylinderGeometry(0.42, 0.42, 0.12, 16)
    driveSheave.rotateZ(Math.PI / 2)
    driveSheave.translate(sx, headY - 0.14, 0.04)
    cableParts.push(applyVerticalVertexColorAttenuation(driveSheave, fadeStartY, fadeEndY, [0.9, 0.92, 0.96]))
  }

  // Continuous tensioned steel hoist ropes rising cleanly from above cab sheaves (y = 2.74m) up to drive sheaves (y = 17.8m)
  // and dropping to rear counterweight track
  for (const hx of [-0.34, 0.34]) {
    for (const subOff of [-0.045, 0.045]) {
      const ropeLen = headY - 2.74
      const rope = new THREE.CylinderGeometry(0.015, 0.015, ropeLen, 6)
      rope.translate(hx + subOff, 2.74 + ropeLen * 0.5, 0.04)
      cableParts.push(applyVerticalVertexColorAttenuation(rope, fadeStartY, fadeEndY, [0.94, 0.95, 0.98]))

      // Counterweight drop ropes running down to counterweight beam
      const cwLen = headY - cwBaseY
      const cwRope = new THREE.CylinderGeometry(0.014, 0.014, cwLen, 6)
      cwRope.translate(hx + subOff * 0.8, cwBaseY + cwLen * 0.5, 1.37)
      cableParts.push(applyVerticalVertexColorAttenuation(cwRope, fadeStartY, fadeEndY, [0.9, 0.92, 0.95]))
    }
  }

  // Vertical industrial electrical conduit risers, cable ladder tray, clamped brackets & traveler power drop
  const conduitXs = [-1.47, -1.47]
  const conduitZs = [-0.96, -0.78]
  for (let i = 0; i < conduitXs.length; i += 1) {
    const riserLen = 17.2
    const pipe = new THREE.CylinderGeometry(0.028, 0.028, riserLen, 8)
    pipe.translate(conduitXs[i], 3.55 + riserLen * 0.5, conduitZs[i])
    cableParts.push(applyVerticalVertexColorAttenuation(pipe, fadeStartY, fadeEndY, [0.85, 0.9, 0.95]))
  }
  for (let cy = 4.4; cy < 19.6; cy += 2.2) {
    const vis = computeShaftDepthVisibility(cy, fadeStartY, fadeEndY, 0.05)
    const s = 0.26 + 0.74 * vis
    conduitBoxes.push(
      { cx: -1.49, cy, cz: -0.87, sx: 0.08, sy: 0.08, sz: 0.34, r: 0.92 * s, g: 0.94 * s, b: 0.96 * s },
      { cx: 1.48, cy, cz: 0.92, sx: 0.06, sy: 0.07, sz: 0.32, r: 0.9 * s, g: 0.92 * s, b: 0.96 * s }
    )
    if (Math.round(cy * 10) % 44 === 0) {
      // Wall-mounted industrial shaft limit switch & junction box
      conduitBoxes.push({
        cx: -1.46,
        cy: cy + 0.35,
        cz: -1.16,
        sx: 0.11,
        sy: 0.28,
        sz: 0.22,
        r: 0.88 * s,
        g: 0.92 * s,
        b: 0.95 * s,
      })
    }
  }
  // Vertical cable tray spine along East shaft wall
  for (let y0 = 3.55; y0 < 19.8; y0 += 2.8) {
    const y1 = Math.min(19.8, y0 + 2.8)
    const cy = (y0 + y1) * 0.5
    const vis = computeShaftDepthVisibility(cy, fadeStartY, fadeEndY, 0.06)
    const s = 0.25 + 0.75 * vis
    conduitBoxes.push({
      cx: 1.48,
      cy,
      cz: 0.92,
      sx: 0.045,
      sy: y1 - y0,
      sz: 0.24,
      r: 0.9 * s,
      g: 0.92 * s,
      b: 0.95 * s,
      cullFaces: FACE_TOP | FACE_BOT,
    })
  }

  // Heavy armored traveler cable running smoothly from upper junction down along rear-right corner toward cab loop
  const travelerCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.42, 16.5, 0.92),
    new THREE.Vector3(1.4, 10.8, 1.12),
    new THREE.Vector3(1.44, 6.2, 1.28),
    new THREE.Vector3(1.48, 3.05, 1.38),
  ])
  const travelerGeo = new THREE.TubeGeometry(travelerCurve, 18, 0.024, 6, false)
  cableParts.push(applyVerticalVertexColorAttenuation(travelerGeo, fadeStartY, fadeEndY, [0.92, 0.94, 0.96]))

  // Subtle lower shaft emergency status strip along front & rear curb collar (syncs lock/unlock/extract glow)
  const collarStripGeo = buildMergedBoxesWithCulling(
    [
      { cx: 0, cy: 3.56, cz: -1.47, sx: 1.92, sy: 0.036, sz: 0.028 },
      { cx: 0, cy: 3.56, cz: 1.47, sx: 1.92, sy: 0.036, sz: 0.028 },
    ],
    { tileUnits: 1.0, worldTileUVs: false, storeBoxBounds: false, includeVertexColors: false }
  )
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xff8c5a,
    emissive: 0xef4444,
    emissiveIntensity: 0.52,
    roughness: 0.35,
    metalness: 0.15,
  })

  // Shared-texture depth-shaded materials with subtle lower emergency illumination bounce
  const exitShaderOpts = {
    fadeStartY,
    fadeEndY,
    minVis: 0.008,
    baseBrightness: 1.0,
    lowerGlowHex: 0xef4444,
    lowerGlowStrength: 0.08,
  }
  const concreteMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_SHAFT_PALETTE.exitConcrete,
      map: surfaceSet.wall.map,
      roughnessMap: surfaceSet.wall.roughnessMap,
      bumpMap: surfaceSet.wall.bumpMap,
      bumpScale: 0.044,
      roughness: 0.95,
      metalness: 0.03,
      envMapIntensity: 0.34,
      vertexColors: true,
    }),
    exitShaderOpts
  )

  const steelMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_SHAFT_PALETTE.exitSteel,
      map: galvanizedSet.map,
      roughnessMap: galvanizedSet.roughnessMap,
      bumpMap: galvanizedSet.bumpMap,
      bumpScale: 0.028,
      roughness: 0.7,
      metalness: 0.56,
      envMapIntensity: 0.4,
      vertexColors: true,
    }),
    exitShaderOpts
  )

  const darkTrimMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_SHAFT_PALETTE.exitDarkTrim,
      map: galvanizedSet.map,
      roughnessMap: galvanizedSet.roughnessMap,
      roughness: 0.72,
      metalness: 0.58,
      envMapIntensity: 0.34,
      vertexColors: true,
    }),
    exitShaderOpts
  )

  const conduitMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_SHAFT_PALETTE.exitConduit,
      map: galvanizedSet.map,
      roughnessMap: galvanizedSet.roughnessMap,
      roughness: 0.74,
      metalness: 0.52,
      envMapIntensity: 0.36,
      vertexColors: true,
    }),
    exitShaderOpts
  )

  const cableMat = applyShaftDepthDarknessShader(
    new THREE.MeshStandardMaterial({
      color: ELEVATOR_SHAFT_PALETTE.exitCable,
      roughness: 0.68,
      metalness: 0.54,
      envMapIntensity: 0.34,
      vertexColors: true,
    }),
    exitShaderOpts
  )

  const crownMat = new THREE.MeshStandardMaterial({
    color: ELEVATOR_SHAFT_PALETTE.darkCrown,
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0.0,
  })

  const addMeshLayer = (name, geo, mat) => {
    if (!geo) return null
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }

  addMeshLayer(
    'exit-shaft-concrete-walls',
    buildMergedBoxesWithCulling(concreteBoxes, { tileUnits: CELL_SIZE * 2, worldTileUVs: true, storeBoxBounds: false }),
    concreteMat
  )
  addMeshLayer(
    'exit-shaft-structural-steel',
    buildMergedBoxesWithCulling(steelBoxes, { tileUnits: 2.0, worldTileUVs: false, storeBoxBounds: false }),
    steelMat
  )
  addMeshLayer(
    'exit-shaft-collar-and-beams',
    buildMergedBoxesWithCulling(darkTrimBoxes, { tileUnits: 2.0, worldTileUVs: false, storeBoxBounds: false }),
    darkTrimMat
  )
  addMeshLayer(
    'exit-shaft-electrical-conduits',
    buildMergedBoxesWithCulling(conduitBoxes, { tileUnits: 1.6, worldTileUVs: false, storeBoxBounds: false }),
    conduitMat
  )
  addMeshLayer('exit-shaft-hoist-cables', mergePreparedGeometries(cableParts), cableMat)

  const cwMesh = addMeshLayer(
    'exit-shaft-counterweight',
    buildMergedBoxesWithCulling(cwDynamicBoxes, { tileUnits: 1.6, worldTileUVs: false, storeBoxBounds: false }),
    darkTrimMat
  )
  if (cwMesh) {
    cwMesh.position.y = cwBaseY
  }

  if (collarStripGeo) {
    const stripMesh = addMeshLayer('exit-shaft-status-strips', collarStripGeo, beaconMat)
    if (stripMesh) stripMesh.receiveShadow = false
  }

  const crownGeo = buildMergedBoxesWithCulling(crownBoxes, {
    tileUnits: 2.0,
    worldTileUVs: false,
    storeBoxBounds: false,
    includeVertexColors: false,
  })
  const crownMesh = addMeshLayer('exit-shaft-dark-crown', crownGeo, crownMat)
  if (crownMesh) crownMesh.receiveShadow = false

  group.userData = {
    isExitElevatorShaft: true,
    cutout,
    topY,
    railCount: 4,
    beamCount: beamTiers.length,
    cableCount: 8,
    fadeStartY,
    fadeEndY,
    beaconMat,
    counterweightMesh: cwMesh,
    counterweightBaseY: cwBaseY,
    materials: [concreteMat, steelMat, darkTrimMat, conduitMat, cableMat, beaconMat],
  }

  return group
}

/**
 * Builds both vertical elevator shaft openings & multi-tier shaft interiors above
 * `maze.start` (damaged/abandoned) and `maze.exit` (reinforced industrial extraction).
 */
export function buildElevatorShafts(
  maze,
  {
    surfaceSet = null,
    galvanizedSet = null,
    worldSeed = 0,
    qualityPreset = 'high',
  } = {}
) {
  const cutouts = resolveElevatorShaftCutouts(maze)
  if (cutouts.length === 0) return null

  const resolvedSurfaceSet = surfaceSet || getMazeSurfaceTextureSet({ qualityPreset })
  const resolvedGalvanizedSet = galvanizedSet || getGalvanizedMetalTextureSet({ qualityPreset })
  // Tag shared textures properly so maze disposal preserves pooled resources
  if (resolvedGalvanizedSet?.map) markSharedResource(resolvedGalvanizedSet.map)

  const root = new THREE.Group()
  root.name = 'maze-elevator-shafts-group'

  let startShaft = null
  let exitShaft = null

  for (let i = 0; i < cutouts.length; i += 1) {
    const cutout = cutouts[i]
    if (cutout.kind === 'start') {
      startShaft = buildStartElevatorShaft(cutout, resolvedSurfaceSet, resolvedGalvanizedSet, {
        worldSeed,
        qualityPreset,
      })
      root.add(startShaft)
    } else if (cutout.kind === 'exit') {
      exitShaft = buildExitElevatorShaft(cutout, resolvedSurfaceSet, resolvedGalvanizedSet, {
        worldSeed,
        qualityPreset,
      })
      root.add(exitShaft)
    }
  }

  root.userData = {
    isElevatorShaftsGroup: true,
    cutouts,
    startShaft,
    exitShaft,
    qualityPreset,
  }

  return root
}

/**
 * Updates live shaft texture references & subtle detail quality settings when graphics preset changes.
 */
export function syncElevatorShaftsQuality(shaftsGroup, qualityPreset = 'high') {
  if (!shaftsGroup?.userData?.isElevatorShaftsGroup) return false
  const surfaceSet = getMazeSurfaceTextureSet({ qualityPreset })
  const galvanizedSet = getGalvanizedMetalTextureSet({ qualityPreset })
  shaftsGroup.userData.qualityPreset = qualityPreset

  for (const shaft of [shaftsGroup.userData.startShaft, shaftsGroup.userData.exitShaft]) {
    if (!shaft) continue
    shaft.traverse((node) => {
      if (!node.isMesh || !node.material) return
      const mat = node.material
      if (node.name.includes('concrete-walls') && surfaceSet?.wall) {
        mat.map = surfaceSet.wall.map
        mat.roughnessMap = surfaceSet.wall.roughnessMap
        mat.bumpMap = surfaceSet.wall.bumpMap
        mat.needsUpdate = true
      } else if (
        (node.name.includes('steel') ||
          node.name.includes('beams') ||
          node.name.includes('mechanism') ||
          node.name.includes('conduits')) &&
        galvanizedSet
      ) {
        mat.map = galvanizedSet.map
        mat.roughnessMap = galvanizedSet.roughnessMap
        mat.bumpMap = galvanizedSet.bumpMap
        mat.needsUpdate = true
      }
    })
  }
  return true
}

/**
 * Syncs subtle lower extraction shaft status collar strips, subtle lower bounce illumination,
 * and counterweight travel with the extraction elevator's locked / unlocked / extracting state.
 */
export function syncExtractionShaftState(
  shaftsGroup,
  {
    isLocked = true,
    stage = 'idle',
    departureProgress = 0,
    reducedMotion = false,
    localizedLightsEnabled = true,
  } = {}
) {
  const exitShaft = shaftsGroup?.userData?.exitShaft
  if (!exitShaft?.userData) return false

  const ud = exitShaft.userData
  const beaconMat = ud.beaconMat
  let colorHex = isLocked ? 0xff8c5a : 0x6ee7b7
  let emissiveHex = isLocked ? 0xef4444 : 0x10b981
  let emissiveIntensity = isLocked ? 0.52 : 0.72
  let glowStrength = isLocked ? 0.08 : 0.13

  if (!isLocked && (stage === 'doors_closing' || (stage === 'departing' && departureProgress < 0.38))) {
    colorHex = 0xfde68a
    emissiveHex = 0xf59e0b
    emissiveIntensity = 0.85
    glowStrength = 0.16
  } else if (!isLocked && (stage === 'departing' || stage === 'completed')) {
    colorHex = 0xa7f3d0
    emissiveHex = 0x10b981
    emissiveIntensity = 0.96
    glowStrength = 0.19
  }
  const effectiveGlowStrength = localizedLightsEnabled ? glowStrength : 0.0

  if (
    ud._lastLocked !== isLocked ||
    ud._lastStage !== stage ||
    ud._lastLocalized !== localizedLightsEnabled ||
    Math.abs((ud._lastDeparture || 0) - departureProgress) > 0.05
  ) {
    if (beaconMat) {
      beaconMat.color.setHex(colorHex)
      beaconMat.emissive.setHex(emissiveHex)
      beaconMat.emissiveIntensity = emissiveIntensity
    }
    const glowColor = new THREE.Color(emissiveHex)
    const mats = Array.isArray(ud.materials) ? ud.materials : []
    for (let i = 0; i < mats.length; i += 1) {
      const uniforms = mats[i]?.userData?.shaftDepthUniforms
      if (uniforms?.uShaftLowerGlowColor && uniforms?.uShaftLowerGlowStrength) {
        uniforms.uShaftLowerGlowColor.value.set(glowColor.r, glowColor.g, glowColor.b)
        uniforms.uShaftLowerGlowStrength.value = effectiveGlowStrength
      }
    }
    ud._lastLocked = isLocked
    ud._lastStage = stage
    ud._lastDeparture = departureProgress
    ud._lastLocalized = localizedLightsEnabled
  }

  // Subtle counterweight descent opposing upward car extraction departure
  if (ud.counterweightMesh && Number.isFinite(ud.counterweightBaseY)) {
    const dep = clamp(departureProgress || 0, 0, 1)
    const offset = reducedMotion ? 0 : -(dep * dep * 1.45)
    ud.counterweightMesh.position.y = ud.counterweightBaseY + offset
  }

  return true
}
