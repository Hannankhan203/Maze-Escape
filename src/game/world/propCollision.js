import { PROP_COLLIDER_SPECS } from '../generation/environmentalPropPlacement.js'
import { CELL_SIZE, gridToWorld } from './worldCoords.js'

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

/**
 * Builds a static, cell-indexed 2D X/Z collision lookup structure for all solid
 * environmental props in `maze`. Designed to be constructed once per `setMaze`
 * and queried with zero per-frame allocations inside `gridCollision.js`.
 */
export function buildPropCollisionIndex(maze, placedProps = null) {
  const grid = maze?.grid
  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(placedProps) || placedProps.length === 0) {
    return null
  }

  const rows = grid.length
  const cols = Array.isArray(grid[0]) ? grid[0].length : 0
  if (cols === 0) {
    return null
  }

  const originX = -(cols * CELL_SIZE) / 2
  const originZ = -(rows * CELL_SIZE) / 2
  const colliders = []

  for (let i = 0; i < placedProps.length; i += 1) {
    const desc = placedProps[i]
    if (!desc) continue

    const propType = desc.propType || desc.type
    const shapes = PROP_COLLIDER_SPECS[propType]
    if (!Array.isArray(shapes) || shapes.length === 0) {
      continue
    }

    let px
    let pz
    if (Array.isArray(desc.position) && desc.position.length >= 3) {
      px = Number(desc.position[0])
      pz = Number(desc.position[2])
    } else {
      const cellWorld = gridToWorld(desc.row, desc.col, maze)
      if (!cellWorld) continue
      px = cellWorld.x + (Number(desc.offsetX) || 0)
      pz = cellWorld.z + (Number(desc.offsetZ) || 0)
    }

    if (!Number.isFinite(px) || !Number.isFinite(pz)) continue

    const yaw = Number.isFinite(desc.rotationYaw) ? desc.rotationYaw : 0
    const scale = Number.isFinite(desc.scale) && desc.scale > 0 ? desc.scale : 1
    const cosYaw = Math.cos(yaw)
    const sinYaw = Math.sin(yaw)
    const propId = desc.propId || desc.id || null

    for (let s = 0; s < shapes.length; s += 1) {
      const shape = shapes[s]
      const lx = Number(shape.x) || 0
      const lz = Number(shape.z) || 0
      // Three.js Ry(yaw): x' = x*cos + z*sin, z' = -x*sin + z*cos
      const cx = px + (lx * cosYaw + lz * sinYaw) * scale
      const cz = pz + (-lx * sinYaw + lz * cosYaw) * scale

      if (shape.kind === 'circle') {
        const radius = Math.max(0.01, (Number(shape.radius) || 0) * scale)
        colliders.push({
          kind: 2,
          propId,
          propType,
          row: desc.row,
          col: desc.col,
          cx,
          cz,
          ux: 1,
          uz: 0,
          vx: 0,
          vz: 1,
          halfW: radius,
          halfD: radius,
          radius,
          minX: cx - radius,
          maxX: cx + radius,
          minZ: cz - radius,
          maxZ: cz + radius,
        })
      } else {
        const totalYaw = yaw + (Number(shape.yaw) || 0)
        const ux = Math.cos(totalYaw)
        const uz = -Math.sin(totalYaw)
        const vx = Math.sin(totalYaw)
        const vz = Math.cos(totalYaw)
        const halfW = Math.max(0.01, (Number(shape.halfW) || 0) * scale)
        const halfD = Math.max(0.01, (Number(shape.halfD) || 0) * scale)
        const envX = Math.abs(ux) * halfW + Math.abs(vx) * halfD
        const envZ = Math.abs(uz) * halfW + Math.abs(vz) * halfD

        colliders.push({
          kind: 1,
          propId,
          propType,
          row: desc.row,
          col: desc.col,
          cx,
          cz,
          ux,
          uz,
          vx,
          vz,
          halfW,
          halfD,
          radius: 0,
          minX: cx - envX,
          maxX: cx + envX,
          minZ: cz - envZ,
          maxZ: cz + envZ,
        })
      }
    }
  }

  if (colliders.length === 0) {
    return null
  }

  const cellBuckets = new Array(rows * cols).fill(null)
  for (let i = 0; i < colliders.length; i += 1) {
    const col = colliders[i]
    const minCol = clamp(Math.floor((col.minX - originX) / CELL_SIZE), 0, cols - 1)
    const maxCol = clamp(Math.floor((col.maxX - originX) / CELL_SIZE), 0, cols - 1)
    const minRow = clamp(Math.floor((col.minZ - originZ) / CELL_SIZE), 0, rows - 1)
    const maxRow = clamp(Math.floor((col.maxZ - originZ) / CELL_SIZE), 0, rows - 1)

    for (let r = minRow; r <= maxRow; r += 1) {
      const rowOffset = r * cols
      for (let c = minCol; c <= maxCol; c += 1) {
        const bucketIdx = rowOffset + c
        let bucket = cellBuckets[bucketIdx]
        if (!bucket) {
          bucket = [i]
          cellBuckets[bucketIdx] = bucket
        } else {
          bucket.push(i)
        }
      }
    }
  }

  return {
    rows,
    cols,
    originX,
    originZ,
    colliders,
    cellBuckets,
  }
}
