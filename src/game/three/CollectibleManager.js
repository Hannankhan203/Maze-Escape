import * as THREE from 'three'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import {
  buildCollectionBurst,
  buildEchoMarkerMesh,
  buildCollectibleItemMesh,
  buildKeycardMesh,
  disposeObject3D,
  resetCollectionBurst,
  updateCollectionBurst,
} from './buildCollectibles.js'

const MAX_ACTIVE_BURSTS = 24

function resolveItemId(item) {
  return item?.id || `item-${item?.type || 'item'}-${item?.row ?? 0}-${item?.col ?? 0}`
}

function resolveKeycardId(keycard) {
  return (
    keycard?.id || `keycard-${keycard?.row ?? 0}-${keycard?.col ?? 0}`
  )
}

function resolveCellKey(cell) {
  return `${cell?.row ?? 0},${cell?.col ?? 0}`
}

/**
 * Manages 3D procedural visuals, stable-ID reconciliation, animations,
 * Echo Reveal breadcrumbs, and temporary collection bursts for Maze Escape collectibles.
 */
export class CollectibleManager {
  constructor(scene = null) {
    this.scene = scene
    this.isDisposed = false
    this._currentMaze = null
    this._elapsedSec = 0

    this.rootGroup = new THREE.Group()
    this.rootGroup.name = 'maze-collectibles-root'
    if (this.scene && typeof this.scene.add === 'function') {
      this.scene.add(this.rootGroup)
    }

    this.items = new Map()
    this.keycards = new Map()
    this.echoMarkers = new Map()
    this._echoMarkerPool = {
      step: [],
      goal: [],
    }
    this.bursts = []
    this._burstPool = []
    this.echoPulses = []
    this._echoPulsePool = []
    this.disposedMeshCount = 0
    this.echoMeshCreatedCount = 0
    this.echoMeshReusedCount = 0
    this.burstCreatedCount = 0
    this.burstReusedCount = 0
    this.echoPulseCreatedCount = 0
    this.echoPulseReusedCount = 0
  }

  setMaze(maze) {
    if (this.isDisposed) return
    if (maze === this._currentMaze) return
    this.clear({ disposeBursts: true })
    this._currentMaze = maze || null
  }

  _disposeEntry(entry) {
    if (!entry?.mesh) return
    disposeObject3D(entry.mesh)
    this.disposedMeshCount += 1
  }

  _parkEchoMarkerToPool(entry) {
    const mesh = entry?.mesh
    if (!mesh) return
    mesh.visible = false
    if (mesh.userData?.highContrastOutline) {
      mesh.userData.highContrastOutline.visible = false
    }
    if (this.rootGroup && mesh.parent === this.rootGroup) {
      this.rootGroup.remove(mesh)
    }
    const bucket = entry.isGoal
      ? this._echoMarkerPool.goal
      : this._echoMarkerPool.step
    bucket.push(mesh)
  }

  _acquireEchoMarkerMesh(cell, index, total, isGoal, worldPos) {
    const bucket = isGoal
      ? this._echoMarkerPool.goal
      : this._echoMarkerPool.step
    let mesh = bucket.pop() || null

    if (mesh) {
      this.echoMeshReusedCount += 1
      const row = cell.row ?? 0
      const col = cell.col ?? 0
      mesh.name = `echo-marker-${row}-${col}`
      mesh.visible = true
      const data = mesh.userData
      if (data) {
        data.row = row
        data.col = col
        data.index = index
        data.isGoal = isGoal
        data.phaseOffset = index * 0.45
        if (data.moteMesh) {
          data.moteMesh.rotation.y = 0
          data.moteMesh.position.y =
            data.moteBaseY ?? (isGoal ? 0.42 : 0.28)
        }
        if (data.ringMesh) {
          data.ringMesh.scale.setScalar(1)
        }
        if (data.ringMat) {
          data.ringMat.opacity = 0.85
        }
        if (data.highContrastOutline) {
          data.highContrastOutline.visible = false
        }
      }
    } else {
      this.echoMeshCreatedCount += 1
      mesh = buildEchoMarkerMesh(cell, index, total)
    }

    mesh.position.x = worldPos.x
    mesh.position.z = worldPos.z
    if (this.rootGroup && mesh.parent !== this.rootGroup) {
      this.rootGroup.add(mesh)
    }
    return mesh
  }

  _clearEchoPool() {
    for (const bucket of [
      this._echoMarkerPool.step,
      this._echoMarkerPool.goal,
    ]) {
      while (bucket.length > 0) {
        const mesh = bucket.pop()
        if (mesh) {
          disposeObject3D(mesh)
          this.disposedMeshCount += 1
        }
      }
    }
  }

  /**
   * Reconciles active 3D collectible items against `items` using stable IDs.
   */
  syncItems(items = [], maze = this._currentMaze, options = {}) {
    if (this.isDisposed) return

    const activeMaze = maze || this._currentMaze
    if (!activeMaze?.grid) {
      this.clearItems()
      return
    }

    if (activeMaze !== this._currentMaze) {
      this.setMaze(activeMaze)
    }

    const list = Array.isArray(items) ? items : []
    const nextById = new Map()
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i]
      if (!item || !Number.isInteger(item.row) || !Number.isInteger(item.col)) continue
      nextById.set(resolveItemId(item), item)
    }

    let hasAdditions = false
    for (const id of nextById.keys()) {
      if (!this.items.has(id)) {
        hasAdditions = true
        break
      }
    }

    const hadExisting = this.items.size > 0
    const allowBurst =
      options.spawnBursts !== false &&
      !options.isReset &&
      !(hadExisting && hasAdditions)

    for (const [id, existing] of this.items.entries()) {
      if (nextById.has(id)) continue
      if (allowBurst && existing.worldPos) {
        this.spawnBurst(existing.type, existing.worldPos)
      }
      this._disposeEntry(existing)
      this.items.delete(id)
    }

    for (const [id, item] of nextById.entries()) {
      if (this.items.has(id)) continue
      const worldPos = gridToWorld(item.row, item.col, activeMaze)
      if (!worldPos) continue

      const mesh = buildCollectibleItemMesh({ ...item, id })
      mesh.position.x = worldPos.x
      mesh.position.z = worldPos.z
      this.rootGroup.add(mesh)

      this.items.set(id, {
        id,
        type: item.type,
        row: item.row,
        col: item.col,
        worldPos: { x: worldPos.x, y: mesh.userData.baseY, z: worldPos.z },
        mesh,
      })
    }
  }

  /**
   * Reconciles Echo Reveal 3D breadcrumb markers along `echoPath`.
   */
  syncEchoPath(echoPath = [], maze = this._currentMaze) {
    if (this.isDisposed) return

    const activeMaze = maze || this._currentMaze
    if (!activeMaze?.grid || !Array.isArray(echoPath) || echoPath.length === 0) {
      this.clearEchoPath()
      return
    }

    const total = echoPath.length
    const nextByKey = new Map()
    for (let i = 0; i < total; i += 1) {
      const cell = echoPath[i]
      if (!cell || !Number.isInteger(cell.row) || !Number.isInteger(cell.col)) continue
      nextByKey.set(resolveCellKey(cell), {
        cell,
        index: i,
        isGoal: i === total - 1 && total > 1,
      })
    }

    if (nextByKey.size === 0) {
      this.clearEchoPath()
      return
    }

    for (const [key, existing] of this.echoMarkers.entries()) {
      const next = nextByKey.get(key)
      if (!next || next.isGoal !== existing.isGoal) {
        this._parkEchoMarkerToPool(existing)
        this.echoMarkers.delete(key)
      }
    }

    for (const [key, entry] of nextByKey.entries()) {
      const existing = this.echoMarkers.get(key)
      if (existing) {
        existing.index = entry.index
        if (existing.mesh?.userData) {
          existing.mesh.userData.index = entry.index
        }
        if (existing.maze !== activeMaze) {
          const worldPos = gridToWorld(
            entry.cell.row,
            entry.cell.col,
            activeMaze
          )
          if (worldPos && existing.mesh) {
            existing.mesh.position.x = worldPos.x
            existing.mesh.position.z = worldPos.z
            existing.maze = activeMaze
          }
        }
        continue
      }

      const worldPos = gridToWorld(entry.cell.row, entry.cell.col, activeMaze)
      if (!worldPos) continue

      const mesh = this._acquireEchoMarkerMesh(
        entry.cell,
        entry.index,
        total,
        entry.isGoal,
        worldPos
      )

      this.echoMarkers.set(key, {
        key,
        row: entry.cell.row,
        col: entry.cell.col,
        index: entry.index,
        isGoal: entry.isGoal,
        maze: activeMaze,
        mesh,
      })
    }
  }

  /**
   * Reconciles active 3D Resonance Keycards against `keycards` using stable IDs.
   */
  syncKeycards(keycards = [], maze = this._currentMaze, options = {}) {
    if (this.isDisposed) return

    const activeMaze = maze || this._currentMaze
    if (!activeMaze?.grid) {
      this.clearKeycards()
      return
    }

    if (activeMaze !== this._currentMaze) {
      this.setMaze(activeMaze)
    }

    const list = Array.isArray(keycards) ? keycards : []
    const nextById = new Map()
    for (let i = 0; i < list.length; i += 1) {
      const keycard = list[i]
      if (!keycard || !Number.isInteger(keycard.row) || !Number.isInteger(keycard.col)) {
        continue
      }
      nextById.set(resolveKeycardId(keycard), keycard)
    }

    let hasAdditions = false
    for (const id of nextById.keys()) {
      if (!this.keycards.has(id)) {
        hasAdditions = true
        break
      }
    }

    const hadExisting = this.keycards.size > 0
    const allowBurst =
      options.spawnBursts !== false &&
      !options.isReset &&
      !(hadExisting && hasAdditions)

    for (const [id, existing] of this.keycards.entries()) {
      if (nextById.has(id)) continue
      if (allowBurst && existing.worldPos) {
        this.spawnBurst('keycard', existing.worldPos)
      }
      this._disposeEntry(existing)
      this.keycards.delete(id)
    }

    for (const [id, keycard] of nextById.entries()) {
      if (this.keycards.has(id)) continue
      const worldPos = gridToWorld(keycard.row, keycard.col, activeMaze)
      if (!worldPos) continue

      const mesh = buildKeycardMesh({ ...keycard, id })
      mesh.position.x = worldPos.x
      mesh.position.z = worldPos.z
      this.rootGroup.add(mesh)

      this.keycards.set(id, {
        id,
        row: keycard.row,
        col: keycard.col,
        worldPos: { x: worldPos.x, y: mesh.userData.baseY, z: worldPos.z },
        mesh,
      })
    }
  }

  syncState({
    maze = this._currentMaze,
    items = [],
    keycards,
    echoPath = [],
    spawnBursts = true,
    isReset = false,
  } = {}) {
    if (this.isDisposed) return
    if (maze !== this._currentMaze) {
      this.setMaze(maze)
    }
    this.syncItems(items, maze, { spawnBursts, isReset })
    if (keycards !== undefined) {
      this.syncKeycards(keycards, maze, { spawnBursts, isReset })
    }
    this.syncEchoPath(echoPath, maze)
  }

  _parkBurstToPool(burst) {
    if (!burst) return
    burst.visible = false
    if (this.rootGroup && burst.parent === this.rootGroup) {
      this.rootGroup.remove(burst)
    }
    if (this._burstPool.length < MAX_ACTIVE_BURSTS) {
      this._burstPool.push(burst)
    } else {
      disposeObject3D(burst)
      this.disposedMeshCount += 1
    }
  }

  spawnBurst(kind = 'item', worldPos = null) {
    if (this.isDisposed || !worldPos) return null
    if (this.bursts.length >= MAX_ACTIVE_BURSTS) {
      const oldest = this.bursts.shift()
      if (oldest) {
        this._parkBurstToPool(oldest)
      }
    }

    let burst = this._burstPool.pop() || null
    if (burst) {
      this.burstReusedCount += 1
      resetCollectionBurst(burst, kind, worldPos)
    } else {
      this.burstCreatedCount += 1
      burst = buildCollectionBurst(kind, worldPos)
    }

    if (this.rootGroup && burst.parent !== this.rootGroup) {
      this.rootGroup.add(burst)
    }
    this.bursts.push(burst)
    return burst
  }

  spawnBurstAtCell(kind, row, col, maze = this._currentMaze) {
    if (this.isDisposed || !maze) return null
    const worldPos = gridToWorld(row, col, maze)
    if (!worldPos) return null
    return this.spawnBurst(kind, { x: worldPos.x, y: 0.9, z: worldPos.z })
  }

  _buildEchoPulseGroup() {
    const group = new THREE.Group()
    group.name = 'echo-pulse-wave'

    const outerGeo = new THREE.RingGeometry(0.84, 1.0, 48)
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const outerRing = new THREE.Mesh(outerGeo, outerMat)
    outerRing.rotation.x = -Math.PI / 2
    outerRing.name = 'echo-pulse-outer-ring'
    group.add(outerRing)

    const innerGeo = new THREE.RingGeometry(0.56, 0.66, 48)
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const innerRing = new THREE.Mesh(innerGeo, innerMat)
    innerRing.rotation.x = -Math.PI / 2
    innerRing.position.y = 0.04
    innerRing.name = 'echo-pulse-inner-ring'
    group.add(innerRing)

    group.userData = {
      outerRing,
      outerMat,
      innerRing,
      innerMat,
      elapsed: 0,
      duration: 0.9,
      maxRadius: 6 * CELL_SIZE,
    }
    return group
  }

  _parkEchoPulseToPool(pulse) {
    if (!pulse) return
    pulse.visible = false
    if (this.rootGroup && pulse.parent === this.rootGroup) {
      this.rootGroup.remove(pulse)
    }
    if (this._echoPulsePool.length < 6) {
      this._echoPulsePool.push(pulse)
    } else {
      disposeObject3D(pulse)
      this.disposedMeshCount += 1
    }
  }

  spawnEchoPulse(worldPos = null, options = {}) {
    if (this.isDisposed || !worldPos) return null
    if (this.echoPulses.length >= 6) {
      const oldest = this.echoPulses.shift()
      if (oldest) {
        this._parkEchoPulseToPool(oldest)
      }
    }

    let pulse = this._echoPulsePool.pop() || null
    if (pulse) {
      this.echoPulseReusedCount += 1
    } else {
      this.echoPulseCreatedCount += 1
      pulse = this._buildEchoPulseGroup()
    }

    const maxRadius =
      Number.isFinite(Number(options?.radiusWorld)) && Number(options.radiusWorld) > 0
        ? Number(options.radiusWorld)
        : Number.isFinite(Number(options?.radiusTiles)) && Number(options.radiusTiles) > 0
          ? Number(options.radiusTiles) * CELL_SIZE
          : 6 * CELL_SIZE
    const duration =
      Number.isFinite(Number(options?.durationSec)) && Number(options.durationSec) > 0
        ? Number(options.durationSec)
        : 0.9

    pulse.visible = true
    pulse.position.set(worldPos.x || 0, (Number.isFinite(worldPos.y) ? worldPos.y : 0) + 0.14, worldPos.z || 0)
    pulse.scale.set(0.45, 1, 0.45)

    const data = pulse.userData
    data.elapsed = 0
    data.duration = duration
    data.maxRadius = maxRadius
    if (data.outerMat) {
      data.outerMat.opacity = 0.88
    }
    if (data.innerMat) {
      data.innerMat.opacity = 0.62
    }
    if (data.innerRing) {
      data.innerRing.scale.setScalar(1)
    }

    if (this.rootGroup && pulse.parent !== this.rootGroup) {
      this.rootGroup.add(pulse)
    }
    this.echoPulses.push(pulse)
    return pulse
  }

  update(delta = 0.016, playerWorldPos = null, activeEffects = null, onCollectItem = null) {
    if (this.isDisposed || !Number.isFinite(delta) || delta <= 0) return

    this._elapsedSec += delta

    const compassActive = (activeEffects?.spectralCompassRemainingMs || 0) > 0

    const hasPlayerPos = Boolean(
      playerWorldPos &&
        Number.isFinite(playerWorldPos.x) &&
        Number.isFinite(playerWorldPos.z)
    )
    const px = hasPlayerPos ? playerWorldPos.x : 0
    const pz = hasPlayerPos ? playerWorldPos.z : 0
    const maxAnimDistSq = 36 * 36

    // Animate items
    for (const entry of this.items.values()) {
      const { mesh } = entry
      const data = mesh.userData
      const dx = hasPlayerPos ? px - mesh.position.x : 0
      const dz = hasPlayerPos ? pz - mesh.position.z : 0
      const distSq = hasPlayerPos ? dx * dx + dz * dz : 0

      if (compassActive && hasPlayerPos && data.type === 'soul_shards' && distSq <= 36.0) {
        const dist = Math.sqrt(distSq)
        if (dist < 0.85) {
          onCollectItem?.(entry)
        } else if (dist > 0.01) {
          const step = Math.min(dist, 6.5 * delta)
          mesh.position.x += (dx / dist) * step
          mesh.position.z += (dz / dist) * step
          entry.worldPos.x = mesh.position.x
          entry.worldPos.z = mesh.position.z
        }
      }

      if (hasPlayerPos && distSq > maxAnimDistSq) continue

      const t = this._elapsedSec + (data.phaseOffset || 0)
      mesh.rotation.y += (data.spinSpeed || 1.8) * delta
      mesh.position.y =
        (data.baseY || 0.9) + Math.sin(t * (data.bobFreq || 2.2)) * (data.bobAmp || 0.12)

      if (Array.isArray(data.orbitRings)) {
        for (let i = 0; i < data.orbitRings.length; i += 1) {
          const ring = data.orbitRings[i]
          ring.rotation.z += delta * (i % 2 === 0 ? 1.8 : -1.4)
        }
      }
      if (data.coreMat) {
        data.coreMat.emissiveIntensity = 0.72 + 0.35 * Math.sin(t * 3.4)
      }
    }

    // Animate Resonance Keycards
    for (const entry of this.keycards.values()) {
      const { mesh } = entry
      if (hasPlayerPos) {
        const dx = px - mesh.position.x
        const dz = pz - mesh.position.z
        if (dx * dx + dz * dz > maxAnimDistSq) continue
      }
      const data = mesh.userData
      const t = this._elapsedSec + (data.phaseOffset || 0)
      mesh.rotation.y += (data.spinSpeed || 1.5) * delta
      mesh.position.y =
        (data.baseY || 1.02) + Math.sin(t * (data.bobFreq || 2.2)) * (data.bobAmp || 0.15)

      if (Array.isArray(data.orbitRings)) {
        for (let i = 0; i < data.orbitRings.length; i += 1) {
          const ring = data.orbitRings[i]
          ring.rotation.z += delta * 2.0
        }
      }
      if (data.coreMat) {
        data.coreMat.emissiveIntensity = 0.8 + 0.35 * Math.sin(t * 3.5)
      }
    }

    // Animate Echo Reveal breadcrumbs
    for (const entry of this.echoMarkers.values()) {
      const { mesh } = entry
      if (hasPlayerPos) {
        const dx = px - mesh.position.x
        const dz = pz - mesh.position.z
        if (dx * dx + dz * dz > maxAnimDistSq) continue
      }
      const data = mesh.userData
      const t = this._elapsedSec * 3.4 - (data.phaseOffset || 0)
      const pulse = 0.5 + 0.5 * Math.sin(t)
      if (data.moteMesh) {
        data.moteMesh.rotation.y += 2.2 * delta
        data.moteMesh.position.y = (data.moteBaseY || 0.28) + pulse * 0.09
      }
      if (data.ringMesh) {
        const s = 0.92 + pulse * 0.16
        data.ringMesh.scale.setScalar(s)
      }
      if (data.ringMat) {
        data.ringMat.opacity = 0.55 + pulse * 0.35
      }
    }

    // Advance collection bursts
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i]
      burst.userData.elapsed += delta
      const progress =
        burst.userData.elapsed / Math.max(0.05, burst.userData.duration || 0.46)
      if (progress >= 1) {
        this.bursts.splice(i, 1)
        this._parkBurstToPool(burst)
      } else {
        updateCollectionBurst(burst, progress)
      }
    }

    // Advance Echo Pulse expanding wave rings
    for (let i = this.echoPulses.length - 1; i >= 0; i -= 1) {
      const pulse = this.echoPulses[i]
      const data = pulse.userData
      data.elapsed += delta
      const progress = data.elapsed / Math.max(0.1, data.duration || 0.9)
      if (progress >= 1) {
        this.echoPulses.splice(i, 1)
        this._parkEchoPulseToPool(pulse)
      } else {
        const eased = 1 - Math.pow(1 - progress, 2)
        const radius = 0.45 + (data.maxRadius - 0.45) * eased
        pulse.scale.set(radius, 1, radius)
        const fade = Math.max(0, 1 - progress)
        if (data.outerMat) {
          data.outerMat.opacity = 0.88 * fade
        }
        if (data.innerMat) {
          data.innerMat.opacity = 0.62 * Math.pow(fade, 1.35)
        }
        if (data.innerRing) {
          data.innerRing.scale.setScalar(0.85 + eased * 0.22)
        }
      }
    }
  }

  clearItems() {
    for (const entry of this.items.values()) {
      this._disposeEntry(entry)
    }
    this.items.clear()
  }

  clearKeycards() {
    for (const entry of this.keycards.values()) {
      this._disposeEntry(entry)
    }
    this.keycards.clear()
  }

  clearEchoPath() {
    for (const entry of this.echoMarkers.values()) {
      this._disposeEntry(entry)
    }
    this.echoMarkers.clear()
    this._clearEchoPool()
  }

  clearBursts() {
    for (let i = 0; i < this.bursts.length; i += 1) {
      disposeObject3D(this.bursts[i])
      this.disposedMeshCount += 1
    }
    this.bursts.length = 0
    for (let i = 0; i < this._burstPool.length; i += 1) {
      disposeObject3D(this._burstPool[i])
      this.disposedMeshCount += 1
    }
    this._burstPool.length = 0
  }

  clearEchoPulses() {
    for (let i = 0; i < this.echoPulses.length; i += 1) {
      disposeObject3D(this.echoPulses[i])
      this.disposedMeshCount += 1
    }
    this.echoPulses.length = 0
    for (let i = 0; i < this._echoPulsePool.length; i += 1) {
      disposeObject3D(this._echoPulsePool[i])
      this.disposedMeshCount += 1
    }
    this._echoPulsePool.length = 0
  }

  clear(options = {}) {
    this.clearItems()
    this.clearKeycards()
    this.clearEchoPath()
    if (options.disposeBursts !== false) {
      this.clearBursts()
    }
    if (options.disposePulses !== false) {
      this.clearEchoPulses()
    }
    if (options.clearMazeRef) {
      this._currentMaze = null
    }
  }

  getItemIds() {
    return Array.from(this.items.keys())
  }

  getKeycardIds() {
    return Array.from(this.keycards.keys())
  }

  getEchoCells() {
    return Array.from(this.echoMarkers.values()).map((entry) => ({
      row: entry.row,
      col: entry.col,
      index: entry.index,
      isGoal: entry.isGoal,
    }))
  }

  getCounts() {
    return {
      items: this.items.size,
      keycards: this.keycards.size,
      echoMarkers: this.echoMarkers.size,
      bursts: this.bursts.length,
      echoPulses: this.echoPulses.length,
    }
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this.clear({ disposeBursts: true, clearMazeRef: true })
    if (this.rootGroup) {
      disposeObject3D(this.rootGroup)
      this.rootGroup = null
    }
    this.scene = null
    return true
  }
}
