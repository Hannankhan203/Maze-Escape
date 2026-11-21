import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'
import {
  buildCoinMesh,
  buildCollectionBurst,
  buildEchoMarkerMesh,
  buildKeycardMesh,
  buildPowerUpMesh,
  disposeObject3D,
  resetCollectionBurst,
  updateCollectionBurst,
} from './buildCollectibles.js'

const MAX_ACTIVE_BURSTS = 24

function resolveCoinId(coin) {
  return coin?.id || `coin-${coin?.row ?? 0}-${coin?.col ?? 0}`
}

function resolvePowerUpId(powerUp) {
  return (
    powerUp?.id ||
    `pu-${powerUp?.type || 'wall_pass'}-${powerUp?.row ?? 0}-${powerUp?.col ?? 0}`
  )
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
 * Echo Reveal breadcrumbs, and temporary pickup bursts for Maze Escape collectibles.
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

    this.coins = new Map()
    this.powerUps = new Map()
    this.keycards = new Map()
    this.echoMarkers = new Map()
    this._echoMarkerPool = {
      step: [],
      goal: [],
    }
    this.bursts = []
    this._burstPool = []
    this.disposedMeshCount = 0
    this.echoMeshCreatedCount = 0
    this.echoMeshReusedCount = 0
    this.burstCreatedCount = 0
    this.burstReusedCount = 0
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
   * Reconciles active 3D coins against `coins` using stable IDs.
   * Removed coins trigger a subtle gold burst unless `spawnBursts` is false
   * or new coins are simultaneously being restored (e.g. RESET_RUN).
   */
  syncCoins(coins = [], maze = this._currentMaze, options = {}) {
    if (this.isDisposed) return

    const activeMaze = maze || this._currentMaze
    if (!activeMaze?.grid) {
      this.clearCoins()
      return
    }

    if (activeMaze !== this._currentMaze) {
      this.setMaze(activeMaze)
    }

    const list = Array.isArray(coins) ? coins : []
    const nextById = new Map()
    for (let i = 0; i < list.length; i += 1) {
      const coin = list[i]
      if (!coin || !Number.isInteger(coin.row) || !Number.isInteger(coin.col)) continue
      nextById.set(resolveCoinId(coin), coin)
    }

    // Detect re-population / reset so restoring coins never plays pickup bursts
    let hasAdditions = false
    for (const id of nextById.keys()) {
      if (!this.coins.has(id)) {
        hasAdditions = true
        break
      }
    }

    const hadExisting = this.coins.size > 0
    const allowBurst =
      options.spawnBursts !== false &&
      !options.isReset &&
      !(hadExisting && hasAdditions)

    for (const [id, existing] of this.coins.entries()) {
      if (nextById.has(id)) continue
      if (allowBurst && existing.worldPos) {
        this.spawnBurst('coin', existing.worldPos)
      }
      this._disposeEntry(existing)
      this.coins.delete(id)
    }

    for (const [id, coin] of nextById.entries()) {
      if (this.coins.has(id)) continue
      const worldPos = gridToWorld(coin.row, coin.col, activeMaze)
      if (!worldPos) continue

      const mesh = buildCoinMesh({ ...coin, id })
      mesh.position.x = worldPos.x
      mesh.position.z = worldPos.z
      this.rootGroup.add(mesh)

      this.coins.set(id, {
        id,
        row: coin.row,
        col: coin.col,
        worldPos: { x: worldPos.x, y: mesh.userData.baseY, z: worldPos.z },
        mesh,
      })
    }
  }

  /**
   * Reconciles active 3D power-ups against `powerUps` using stable IDs.
   */
  syncPowerUps(powerUps = [], maze = this._currentMaze, options = {}) {
    if (this.isDisposed) return

    const activeMaze = maze || this._currentMaze
    if (!activeMaze?.grid) {
      this.clearPowerUps()
      return
    }

    if (activeMaze !== this._currentMaze) {
      this.setMaze(activeMaze)
    }

    const list = Array.isArray(powerUps) ? powerUps : []
    const nextById = new Map()
    for (let i = 0; i < list.length; i += 1) {
      const pu = list[i]
      if (!pu || !Number.isInteger(pu.row) || !Number.isInteger(pu.col)) continue
      nextById.set(resolvePowerUpId(pu), pu)
    }

    let hasAdditions = false
    for (const id of nextById.keys()) {
      if (!this.powerUps.has(id)) {
        hasAdditions = true
        break
      }
    }

    const hadExisting = this.powerUps.size > 0
    const allowBurst =
      options.spawnBursts !== false &&
      !options.isReset &&
      !(hadExisting && hasAdditions)

    for (const [id, existing] of this.powerUps.entries()) {
      if (nextById.has(id)) continue
      if (allowBurst && existing.worldPos) {
        this.spawnBurst(existing.type, existing.worldPos)
      }
      this._disposeEntry(existing)
      this.powerUps.delete(id)
    }

    for (const [id, pu] of nextById.entries()) {
      if (this.powerUps.has(id)) continue
      const worldPos = gridToWorld(pu.row, pu.col, activeMaze)
      if (!worldPos) continue

      const mesh = buildPowerUpMesh({ ...pu, id })
      mesh.position.x = worldPos.x
      mesh.position.z = worldPos.z
      this.rootGroup.add(mesh)

      this.powerUps.set(id, {
        id,
        type: pu.type,
        row: pu.row,
        col: pu.col,
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

  /**
   * Convenience helper to synchronize maze, coins, powerUps, keycards, and echoPath together.
   */
  syncState({
    maze = this._currentMaze,
    coins = [],
    powerUps = [],
    keycards,
    echoPath = [],
    spawnBursts = true,
    isReset = false,
  } = {}) {
    if (this.isDisposed) return
    if (maze !== this._currentMaze) {
      this.setMaze(maze)
    }
    this.syncCoins(coins, maze, { spawnBursts, isReset })
    this.syncPowerUps(powerUps, maze, { spawnBursts, isReset })
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

  spawnBurst(kind = 'coin', worldPos = null) {
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

  update(delta = 0.016) {
    if (this.isDisposed || !Number.isFinite(delta) || delta <= 0) return

    this._elapsedSec += delta

    // Animate coins (smooth Y rotation + hover bob)
    for (const entry of this.coins.values()) {
      const { mesh } = entry
      const data = mesh.userData
      const t = this._elapsedSec + (data.phaseOffset || 0)
      mesh.rotation.y += (data.spinSpeed || 2.1) * delta
      mesh.position.y =
        (data.baseY || 0.82) + Math.sin(t * (data.bobFreq || 2.4)) * (data.bobAmp || 0.11)
    }

    // Animate power-ups + orbital rings
    for (const entry of this.powerUps.values()) {
      const { mesh } = entry
      const data = mesh.userData
      const t = this._elapsedSec + (data.phaseOffset || 0)
      mesh.rotation.y += (data.spinSpeed || 1.65) * delta
      mesh.position.y =
        (data.baseY || 0.96) + Math.sin(t * (data.bobFreq || 2.0)) * (data.bobAmp || 0.14)

      if (Array.isArray(data.orbitRings)) {
        for (let i = 0; i < data.orbitRings.length; i += 1) {
          const ring = data.orbitRings[i]
          ring.rotation.z += delta * (i % 2 === 0 ? 1.8 : -1.4)
        }
      }
    }

    // Animate Resonance Keycards + orbital halo
    for (const entry of this.keycards.values()) {
      const { mesh } = entry
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

    // Animate Echo Reveal breadcrumbs (traveling sonar pulse + mote float)
    for (const entry of this.echoMarkers.values()) {
      const { mesh } = entry
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

    // Advance & return finished collection bursts to pool
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
  }

  clearCoins() {
    for (const entry of this.coins.values()) {
      this._disposeEntry(entry)
    }
    this.coins.clear()
  }

  clearPowerUps() {
    for (const entry of this.powerUps.values()) {
      this._disposeEntry(entry)
    }
    this.powerUps.clear()
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

  clear(options = {}) {
    this.clearCoins()
    this.clearPowerUps()
    this.clearKeycards()
    this.clearEchoPath()
    if (options.disposeBursts !== false) {
      this.clearBursts()
    }
    if (options.clearMazeRef) {
      this._currentMaze = null
    }
  }

  getCoinIds() {
    return Array.from(this.coins.keys())
  }

  getPowerUpIds() {
    return Array.from(this.powerUps.keys())
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
      coins: this.coins.size,
      powerUps: this.powerUps.size,
      keycards: this.keycards.size,
      echoMarkers: this.echoMarkers.size,
      bursts: this.bursts.length,
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
