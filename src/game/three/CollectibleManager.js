import * as THREE from 'three'
import { gridToWorld } from '../world/worldCoords.js'
import {
  buildCoinMesh,
  buildCollectionBurst,
  buildEchoMarkerMesh,
  buildPowerUpMesh,
  disposeObject3D,
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
    this.echoMarkers = new Map()
    this.bursts = []
    this.disposedMeshCount = 0
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

    for (const [key, existing] of this.echoMarkers.entries()) {
      const next = nextByKey.get(key)
      if (!next || next.isGoal !== existing.isGoal) {
        this._disposeEntry(existing)
        this.echoMarkers.delete(key)
      }
    }

    for (const [key, entry] of nextByKey.entries()) {
      const existing = this.echoMarkers.get(key)
      if (existing) {
        existing.index = entry.index
        continue
      }

      const worldPos = gridToWorld(entry.cell.row, entry.cell.col, activeMaze)
      if (!worldPos) continue

      const mesh = buildEchoMarkerMesh(entry.cell, entry.index, total)
      mesh.position.x = worldPos.x
      mesh.position.z = worldPos.z
      this.rootGroup.add(mesh)

      this.echoMarkers.set(key, {
        key,
        row: entry.cell.row,
        col: entry.cell.col,
        index: entry.index,
        isGoal: entry.isGoal,
        mesh,
      })
    }
  }

  /**
   * Convenience helper to synchronize maze, coins, powerUps, and echoPath together.
   */
  syncState({
    maze = this._currentMaze,
    coins = [],
    powerUps = [],
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
    this.syncEchoPath(echoPath, maze)
  }

  spawnBurst(kind = 'coin', worldPos = null) {
    if (this.isDisposed || !worldPos) return null
    if (this.bursts.length >= MAX_ACTIVE_BURSTS) {
      const oldest = this.bursts.shift()
      if (oldest) {
        disposeObject3D(oldest)
        this.disposedMeshCount += 1
      }
    }

    const burst = buildCollectionBurst(kind, worldPos)
    this.rootGroup.add(burst)
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

    // Advance & dispose finished collection bursts cleanly
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i]
      burst.userData.elapsed += delta
      const progress =
        burst.userData.elapsed / Math.max(0.05, burst.userData.duration || 0.46)
      if (progress >= 1) {
        this.bursts.splice(i, 1)
        disposeObject3D(burst)
        this.disposedMeshCount += 1
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

  clearEchoPath() {
    for (const entry of this.echoMarkers.values()) {
      this._disposeEntry(entry)
    }
    this.echoMarkers.clear()
  }

  clearBursts() {
    for (let i = 0; i < this.bursts.length; i += 1) {
      disposeObject3D(this.bursts[i])
      this.disposedMeshCount += 1
    }
    this.bursts.length = 0
  }

  clear(options = {}) {
    this.clearCoins()
    this.clearPowerUps()
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
