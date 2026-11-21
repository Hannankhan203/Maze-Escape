import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { createServer } from 'vite'
import {
  createInitialGameState,
  gameReducer,
  resolveEchoRevealPath,
} from '../engine/gameReducer.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { POWERUP_TYPES } from '../mechanics/powerups.js'
import { CollectibleManager } from './CollectibleManager.js'
import { disposeCollectiblePools } from './buildCollectibles.js'
import { disposeAllSharedPools, getActiveSharedPoolOwnerCount } from './sharedResources.js'

console.log('--- Running Phase 3 React / Echo Reveal Update Cascade Tests ---')

// ============================================================================
// Part 1: gameReducer Echo Reveal Path Reuse & BFS Fallback Verification
// ============================================================================
{
  console.log('Test 1: gameReducer Echo Reveal valid-path trimming, reuse & BFS fallback')

  const hardcoreMaze = generateMaze({ difficulty: 'hardcore', seed: 9901 })
  const fullPathResult = findShortestPath(
    hardcoreMaze.grid,
    hardcoreMaze.start,
    hardcoreMaze.exit
  )
  assert.equal(fullPathResult.found, true, 'Hardcore maze has valid start-to-exit path')
  assert.ok(fullPathResult.path.length >= 15, 'Hardcore Echo path has substantial length')

  const activeEffects = {
    wallPassArmed: false,
    echoRevealRemainingMs: 7000,
    magnetRemainingMs: 0,
  }

  let bfsCalls = 0
  let totalVisitedBfsNodes = 0
  const spyPathFinder = (grid, start, exit) => {
    bfsCalls += 1
    const res = findShortestPath(grid, start, exit)
    totalVisitedBfsNodes += res.visitedCount
    return res
  }

  // Initial activation (no cached path) falls back to BFS once
  let cachedPath = resolveEchoRevealPath(
    hardcoreMaze,
    hardcoreMaze.start,
    activeEffects,
    false,
    null,
    { pathFinder: spyPathFinder }
  )
  assert.equal(bfsCalls, 1, 'Initial activation runs BFS once')
  assert.equal(cachedPath.length, fullPathResult.path.length)
  const initialVisitedNodes = totalVisitedBfsNodes

  // Same-cell check returns exact same array reference with 0 BFS calls
  const sameCellPath = resolveEchoRevealPath(
    hardcoreMaze,
    hardcoreMaze.start,
    activeEffects,
    false,
    cachedPath,
    { pathFinder: spyPathFinder }
  )
  assert.equal(sameCellPath, cachedPath, 'Standing at head cell preserves exact array reference')
  assert.equal(bfsCalls, 1, 'Same-cell resolution invokes 0 extra BFS calls')

  // Walk 12 steps along valid Echo Reveal path -> 0 extra BFS calls!
  const walkSteps = Math.min(12, cachedPath.length - 2)
  for (let step = 1; step <= walkSteps; step += 1) {
    const prevLength = cachedPath.length
    cachedPath = resolveEchoRevealPath(
      hardcoreMaze,
      cachedPath[1],
      activeEffects,
      false,
      cachedPath,
      { pathFinder: spyPathFinder }
    )
    assert.equal(cachedPath.length, prevLength - 1, `Step ${step} trims echoPath by 1`)
  }
  assert.equal(
    bfsCalls,
    1,
    `Walking ${walkSteps} steps along valid Echo path triggered 0 additional BFS runs`
  )
  assert.equal(
    totalVisitedBfsNodes,
    initialVisitedNodes,
    'Visited BFS node count stayed constant while trimming cached path'
  )

  // Invalid cached paths MUST fall back to BFS safely:
  // (a) Player steps off-path to a walkable neighbor not in cachedPath
  const head = cachedPath[0]
  const cachedSet = new Set(cachedPath.map((c) => `${c.row},${c.col}`))
  let offPathCell = null
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const r = head.row + dr
    const c = head.col + dc
    if (
      r >= 0 &&
      r < hardcoreMaze.rows &&
      c >= 0 &&
      c < hardcoreMaze.cols &&
      hardcoreMaze.grid[r][c] === 0 &&
      !cachedSet.has(`${r},${c}`)
    ) {
      offPathCell = { row: r, col: c }
      break
    }
  }
  if (!offPathCell) {
    // Pick any walkable maze cell not on cachedPath
    for (let r = 1; r < hardcoreMaze.rows - 1 && !offPathCell; r += 1) {
      for (let c = 1; c < hardcoreMaze.cols - 1 && !offPathCell; c += 1) {
        if (hardcoreMaze.grid[r][c] === 0 && !cachedSet.has(`${r},${c}`)) {
          offPathCell = { row: r, col: c }
        }
      }
    }
  }
  assert.ok(offPathCell, 'Found an off-path walkable cell for BFS fallback test')

  const offPathResult = resolveEchoRevealPath(
    hardcoreMaze,
    offPathCell,
    activeEffects,
    false,
    cachedPath,
    { pathFinder: spyPathFinder }
  )
  assert.equal(bfsCalls, 2, 'Stepping off cached Echo path triggers BFS fallback')
  assert.equal(
    offPathResult[0].row,
    offPathCell.row,
    'Fallback BFS path starts at off-path cell'
  )

  // (b) Corrupted discontinuity (skip a step) triggers BFS fallback
  const brokenPath = [cachedPath[0], ...cachedPath.slice(2)]
  const brokenFallback = resolveEchoRevealPath(
    hardcoreMaze,
    cachedPath[0],
    activeEffects,
    false,
    brokenPath,
    { pathFinder: spyPathFinder }
  )
  assert.equal(bfsCalls, 3, 'Discontiguous cached path triggers BFS fallback')
  assert.equal(brokenFallback.length, cachedPath.length)

  // (c) Wrong exit / stale maze triggers BFS fallback
  const wrongExitPath = cachedPath.slice(0, -1)
  resolveEchoRevealPath(
    hardcoreMaze,
    cachedPath[0],
    activeEffects,
    false,
    wrongExitPath,
    { pathFinder: spyPathFinder }
  )
  assert.equal(bfsCalls, 4, 'Cached path not ending at maze.exit triggers BFS fallback')

  // (d) Blocked intermediate wall in grid triggers BFS fallback
  const clonedGrid = hardcoreMaze.grid.map((row) => [...row])
  const midCell = cachedPath[1]
  clonedGrid[midCell.row][midCell.col] = 1
  const blockedMaze = { ...hardcoreMaze, grid: clonedGrid }
  resolveEchoRevealPath(
    blockedMaze,
    cachedPath[0],
    activeEffects,
    false,
    cachedPath,
    { pathFinder: spyPathFinder }
  )
  assert.equal(bfsCalls, 5, 'Cached path passing through a blocked cell triggers BFS fallback')

  // End-to-end gameReducer state verification:
  let state = createInitialGameState('small', 4402, { objectivesEnabled: false })
  const emptyEchoRef = state.echoPath
  assert.equal(emptyEchoRef.length, 0)

  // Ordinary move with Echo Reveal OFF keeps exact empty echoPath array reference
  const step0 = findShortestPath(state.maze.grid, state.playerPos, state.maze.exit).path[1]
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', position: step0 })
  assert.equal(
    state.echoPath,
    emptyEchoRef,
    'Inactive Echo Reveal preserves identical empty echoPath reference across moves'
  )

  // Activate Echo Reveal -> walk 2 valid steps -> expire timer
  state = {
    ...state,
    inventory: { ...state.inventory, [POWERUP_TYPES.ECHO_REVEAL]: 1 },
  }
  state = gameReducer(state, {
    type: 'ACTIVATE_ABILITY',
    abilityType: POWERUP_TYPES.ECHO_REVEAL,
  })
  const activatedLen = state.echoPath.length
  assert.ok(activatedLen >= 3, 'Echo Reveal generated active path in gameReducer')

  const nextCellA = state.echoPath[1]
  const nextCellB = state.echoPath[2]
  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', position: nextCellA })
  assert.equal(state.echoPath.length, activatedLen - 1, 'Reducer trims Echo path by 1 on step A')
  assert.deepEqual(state.echoPath[0], nextCellA)

  state = gameReducer(state, { type: 'SYNC_PLAYER_CELL', position: nextCellB })
  assert.equal(state.echoPath.length, activatedLen - 2, 'Reducer trims Echo path by 1 on step B')
  assert.deepEqual(state.echoPath[0], nextCellB)

  state = gameReducer(state, { type: 'TICK_ABILITIES', deltaMs: 12000 })
  assert.equal(state.echoPath.length, 0, 'Reducer clears echoPath on timer expiry')

  console.log('✓ gameReducer Echo Reveal path reuse, trimming, empty-ref stability & BFS fallback passed')
}

// ============================================================================
// Part 2: CollectibleManager Breadcrumb Mesh Reuse & Cleanup Verification
// ============================================================================
{
  console.log('Test 2: CollectibleManager Echo breadcrumb mesh identity reuse, pooling & disposal')
  disposeCollectiblePools()

  const openMaze = {
    id: 'echo-pool-test-maze',
    rows: 5,
    cols: 7,
    start: { row: 2, col: 1 },
    exit: { row: 2, col: 5 },
    grid: [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ],
  }

  const scene = new THREE.Scene()
  const manager = new CollectibleManager(scene)
  manager.setMaze(openMaze)

  const initialPath = [
    { row: 2, col: 1 },
    { row: 2, col: 2 },
    { row: 2, col: 3 },
    { row: 2, col: 4 },
    { row: 2, col: 5 },
  ]
  manager.syncEchoPath(initialPath, openMaze)
  assert.equal(manager.echoMarkers.size, 5)
  assert.equal(manager.echoMeshCreatedCount, 5)
  assert.equal(manager.disposedMeshCount, 0)

  const mesh22 = manager.echoMarkers.get('2,2').mesh
  const mesh23 = manager.echoMarkers.get('2,3').mesh
  const mesh24 = manager.echoMarkers.get('2,4').mesh
  const mesh25Goal = manager.echoMarkers.get('2,5').mesh
  const pooledStepMesh21 = manager.echoMarkers.get('2,1').mesh

  // Spy on ringMat.dispose across all 5 created meshes to verify zero premature disposals + full final disposal
  let ringMatDisposals = 0
  for (const entry of manager.echoMarkers.values()) {
    const orig = entry.mesh.userData.ringMat.dispose.bind(entry.mesh.userData.ringMat)
    entry.mesh.userData.ringMat.dispose = () => {
      ringMatDisposals += 1
      orig()
    }
  }

  // Advance step 1: [2,2 .. 2,5]
  manager.syncEchoPath(initialPath.slice(1), openMaze)
  assert.equal(manager.echoMarkers.size, 4)
  assert.equal(manager.echoMarkers.get('2,2').mesh, mesh22, 'Remaining step mesh 2,2 preserved by reference')
  assert.equal(manager.echoMarkers.get('2,3').mesh, mesh23, 'Remaining step mesh 2,3 preserved by reference')
  assert.equal(manager.echoMarkers.get('2,4').mesh, mesh24, 'Remaining step mesh 2,4 preserved by reference')
  assert.equal(manager.echoMarkers.get('2,5').mesh, mesh25Goal, 'Goal mesh 2,5 preserved by reference')
  assert.equal(manager.echoMeshCreatedCount, 5, 'Zero new echo meshes created on advance')
  assert.equal(ringMatDisposals, 0, 'Vacated step mesh material parked cleanly in pool instead of disposed')
  assert.equal(pooledStepMesh21.visible, false, 'Parked step mesh is hidden')
  assert.equal(manager.rootGroup.children.length, 4, 'Only active breadcrumb meshes stay attached to rootGroup')

  // Reroute / off-path change: e.g. player moves up to (1,2) -> [ (1,2), (1,3), (1,4), (1,5), (2,5) ]
  // Notice 1 new step needed? Actually 4 new step cells + 1 existing goal!
  // Before reroute, 3 active step meshes were removed (2,2; 2,3; 2,4) + 1 already parked (2,1) = 4 pooled step meshes!
  const reroutedPath = [
    { row: 1, col: 2 },
    { row: 1, col: 3 },
    { row: 1, col: 4 },
    { row: 1, col: 5 },
    { row: 2, col: 5 },
  ]
  manager.syncEchoPath(reroutedPath, openMaze)
  assert.equal(manager.echoMarkers.size, 5)
  assert.equal(
    manager.echoMeshCreatedCount,
    5,
    'Rerouted 5-cell path reused all 4 pooled step meshes + kept goal mesh with ZERO new allocations'
  )
  assert.equal(manager.echoMeshReusedCount, 4, 'Recorded 4 pooled echo mesh reuses')
  assert.equal(manager.echoMarkers.get('2,5').mesh, mesh25Goal, 'Shared exit goal marker stayed identical across reroute')
  assert.equal(ringMatDisposals, 0, 'Still zero material disposals during active reroute')
  assert.equal(manager.rootGroup.children.length, 5, 'All 5 rerouted markers re-attached cleanly')
  for (const entry of manager.echoMarkers.values()) {
    assert.equal(entry.mesh.visible, true, `Recycled mesh ${entry.key} is visible`)
  }

  // Expiry clears active + pooled meshes completely
  manager.syncEchoPath([], openMaze)
  assert.equal(manager.echoMarkers.size, 0, 'Expiry clears active echoMarkers')
  assert.equal(manager._echoMarkerPool.step.length, 0, 'Expiry drains step pool')
  assert.equal(manager._echoMarkerPool.goal.length, 0, 'Expiry drains goal pool')
  assert.equal(manager.rootGroup.children.length, 0, 'rootGroup empty after expiry')
  assert.equal(ringMatDisposals, 5, 'All 5 ringMat instances disposed cleanly on expiry')

  // Verify single-cell [exit] collapse (goal -> step) & highContrastOutline pool reset
  manager.syncEchoPath(initialPath, openMaze) // creates 5 more (6..10)
  // Attach mock outline visibility on a step marker and park it
  const parkedOutlineTarget = manager.echoMarkers.get('2,1').mesh
  parkedOutlineTarget.userData.highContrastOutline = { visible: true }
  manager.syncEchoPath(initialPath.slice(1), openMaze)
  assert.equal(
    parkedOutlineTarget.userData.highContrastOutline.visible,
    false,
    'Parking pooled echo marker resets highContrastOutline visibility'
  )
  // Collapse to single cell [{ row: 2, col: 5 }] (e.g. player on locked exit) -> transitions goal -> step
  manager.syncEchoPath([{ row: 2, col: 5 }], openMaze)
  assert.equal(manager.echoMarkers.size, 1)
  assert.equal(manager.echoMarkers.get('2,5').isGoal, false, 'Single-cell exit transitions cleanly to step marker')
  assert.equal(manager._echoMarkerPool.goal.length, 1, 'Previous goal marker parked cleanly in goal pool')

  manager.syncEchoPath(initialPath.slice(2), openMaze)
  assert.equal(manager._echoMarkerPool.step.length >= 2, true)
  manager.dispose()
  assert.equal(manager.isDisposed, true)
  assert.equal(manager.echoMarkers.size, 0)
  assert.equal(manager._echoMarkerPool.step.length, 0)
  assert.equal(manager._echoMarkerPool.goal.length, 0)
  assert.equal(
    manager.disposedMeshCount,
    10,
    `All active + pooled echo meshes disposed across expiry and dispose() (got ${manager.disposedMeshCount})`
  )

  disposeCollectiblePools()
  console.log('✓ CollectibleManager breadcrumb identity preservation, pooling & disposal passed')
}

// ============================================================================
// Part 3: MazeViewport3D React Update Cascade Isolation (MiniDOM + Vite SSR)
// ============================================================================
{
  console.log('Test 3: MazeViewport3D isolates transient lastEvent moves from collectible sync')

  function createMiniDomEnv() {
    const makeEmitter = () => {
      const map = new Map()
      return {
        addEventListener(type, fn, opts) {
          if (typeof fn !== 'function') return
          if (!map.has(type)) map.set(type, [])
          map.get(type).push({ fn, capture: Boolean(opts === true || opts?.capture) })
        },
        removeEventListener(type, fn, opts) {
          const list = map.get(type)
          if (!list) return
          const capture = Boolean(opts === true || opts?.capture)
          map.set(type, list.filter((i) => !(i.fn === fn && i.capture === capture)))
        },
      }
    }
    class MiniNode {
      constructor(nodeType, ownerDocument) {
        this.nodeType = nodeType
        this.ownerDocument = ownerDocument
        this.parentNode = null
        this.childNodes = []
      }
      get parentElement() {
        return this.parentNode?.nodeType === 1 ? this.parentNode : null
      }
      appendChild(child) {
        return this.insertBefore(child, null)
      }
      insertBefore(child, refNode) {
        if (!child) return child
        if (child.parentNode) child.parentNode.removeChild(child)
        child.parentNode = this
        if (!refNode) this.childNodes.push(child)
        else {
          const idx = this.childNodes.indexOf(refNode)
          if (idx === -1) this.childNodes.push(child)
          else this.childNodes.splice(idx, 0, child)
        }
        return child
      }
      removeChild(child) {
        const idx = this.childNodes.indexOf(child)
        if (idx !== -1) {
          this.childNodes.splice(idx, 1)
          child.parentNode = null
        }
        return child
      }
      get textContent() {
        if (this.nodeType === 3 || this.nodeType === 8) return this.nodeValue || ''
        return this.childNodes.map((c) => c.textContent).join('')
      }
      set textContent(val) {
        while (this.childNodes.length) this.removeChild(this.childNodes[0])
        if (val) this.appendChild(this.ownerDocument.createTextNode(String(val)))
      }
    }
    class MiniText extends MiniNode {
      constructor(data, ownerDocument) {
        super(3, ownerDocument)
        this.nodeValue = String(data ?? '')
      }
    }
    class MiniElement extends MiniNode {
      constructor(tag, ownerDocument, ns = 'http://www.w3.org/1999/xhtml') {
        super(1, ownerDocument)
        this.tagName = String(tag).toUpperCase()
        this.nodeName = this.tagName
        this.namespaceURI = ns
        this._attrs = new Map()
        this._emitter = makeEmitter()
        this.clientWidth = 800
        this.clientHeight = 500
        this.style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }
        this.dataset = {}
      }
      setAttribute(n, v) {
        this._attrs.set(String(n), String(v))
      }
      setAttributeNS(_ns, n, v) {
        this.setAttribute(n, v)
      }
      getAttribute(n) {
        return this._attrs.has(String(n)) ? this._attrs.get(String(n)) : null
      }
      hasAttribute(n) {
        return this._attrs.has(String(n))
      }
      removeAttribute(n) {
        this._attrs.delete(String(n))
      }
      addEventListener(t, fn, o) {
        this._emitter.addEventListener(t, fn, o)
      }
      removeEventListener(t, fn, o) {
        this._emitter.removeEventListener(t, fn, o)
      }
      querySelectorAll(sel) {
        const results = []
        const m = /^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(sel.trim())
        const visit = (node) => {
          for (const child of node.childNodes) {
            if (child.nodeType === 1) {
              if (m) {
                const v = child.getAttribute(m[1])
                if (m[2] !== undefined ? v === m[2] : v !== null) results.push(child)
              }
              visit(child)
            }
          }
        }
        visit(this)
        return results
      }
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null
      }
    }
    class MiniCanvasElement extends MiniElement {
      constructor(doc) {
        super('canvas', doc)
      }
      getContext() {
        return null
      }
    }
    class MiniIFrameElement extends MiniElement {}
    const docEmitter = makeEmitter()
    const winEmitter = makeEmitter()
    const doc = {
      nodeType: 9,
      visibilityState: 'visible',
      hidden: false,
      pointerLockElement: null,
      fullscreenElement: null,
      fullscreenEnabled: false,
      activeElement: null,
      HTMLIFrameElement: MiniIFrameElement,
      HTMLElement: MiniElement,
      HTMLCanvasElement: MiniCanvasElement,
      Element: MiniElement,
      createElement(tag) {
        return String(tag).toLowerCase() === 'canvas'
          ? new MiniCanvasElement(doc)
          : new MiniElement(tag, doc)
      },
      createElementNS(ns, tag) {
        return new MiniElement(tag, doc, ns)
      },
      createTextNode(t) {
        return new MiniText(t, doc)
      },
      createComment(t) {
        const n = new MiniNode(8, doc)
        n.nodeValue = String(t ?? '')
        return n
      },
      contains(target) {
        return doc.documentElement.contains?.(target) ?? false
      },
      addEventListener: (t, fn, o) => docEmitter.addEventListener(t, fn, o),
      removeEventListener: (t, fn, o) => docEmitter.removeEventListener(t, fn, o),
      exitPointerLock() {},
    }
    doc.documentElement = new MiniElement('html', doc)
    doc.body = new MiniElement('body', doc)
    doc.documentElement.appendChild(doc.body)
    doc.activeElement = doc.body
    const win = {
      document: doc,
      Node: MiniNode,
      Element: MiniElement,
      HTMLElement: MiniElement,
      HTMLCanvasElement: MiniCanvasElement,
      HTMLIFrameElement: MiniIFrameElement,
      navigator: { userAgent: 'node-test', maxTouchPoints: 0 },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
      cancelAnimationFrame: (id) => clearTimeout(id),
      setTimeout: (...args) => setTimeout(...args),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: (...args) => setInterval(...args),
      clearInterval: (id) => clearInterval(id),
      addEventListener: (t, fn, o) => winEmitter.addEventListener(t, fn, o),
      removeEventListener: (t, fn, o) => winEmitter.removeEventListener(t, fn, o),
    }
    doc.defaultView = win
    return {
      window: win,
      document: doc,
      Node: MiniNode,
      Element: MiniElement,
      HTMLElement: MiniElement,
      HTMLCanvasElement: MiniCanvasElement,
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    }
  }

  function createMockRenderer() {
    return {
      domElement: globalThis.document.createElement('canvas'),
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 1,
      setPixelRatio() {},
      setSize() {},
      render() {},
      dispose() {},
      getContext() {
        return null
      },
    }
  }

  const domEnv = createMiniDomEnv()
  const prevGlobals = new Map()
  const installGlobal = (k, v) => {
    prevGlobals.set(k, Object.getOwnPropertyDescriptor(globalThis, k))
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  }
  installGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  installGlobal('window', domEnv.window)
  installGlobal('document', domEnv.document)
  installGlobal('Node', domEnv.Node)
  installGlobal('Element', domEnv.Element)
  installGlobal('HTMLElement', domEnv.HTMLElement)
  installGlobal('HTMLCanvasElement', domEnv.HTMLCanvasElement)
  installGlobal('ResizeObserver', domEnv.ResizeObserver)

  const viteServer = await createServer({
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })

  try {
    disposeAllSharedPools()
    const { default: MazeViewport3D } = await viteServer.ssrLoadModule(
      '/src/components/game/MazeViewport3D.jsx'
    )

    const maze = generateMaze({ difficulty: 'small', seed: 5150, includeObjectives: true })
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    let engine = null
    const counts = {
      syncCollectibles: 0,
      syncEchoPath: 0,
      setExitLocked: 0,
      handleGameEvent: [],
      lastSyncPayload: null,
      lastExitLockedOpts: null,
    }

    const baseProps = {
      maze,
      runId: 1,
      playerCell: maze.start,
      coins: maze.collectibles.coins,
      powerUps: maze.collectibles.powerUps,
      keycards: maze.keycards,
      keysCollected: 0,
      totalKeys: maze.keycards.length,
      isExitLocked: maze.keycards.length > 0,
      objectivesEnabled: true,
      echoPath: [],
      lastEvent: null,
      controlsEnabled: true,
      engineConfig: {
        createRenderer: createMockRenderer,
        isSoftwareGl: true,
        pointerLockEnabled: false,
      },
      onViewportReady: ({ engine: createdEngine }) => {
        engine = createdEngine
        const origSyncCollectibles = engine.syncCollectibles.bind(engine)
        const origSyncEchoPath = engine.syncEchoPath.bind(engine)
        const origSetExitLocked = engine.setExitLocked.bind(engine)
        const origHandleGameEvent = engine.handleGameEvent.bind(engine)

        engine.syncCollectibles = (payload) => {
          counts.syncCollectibles += 1
          counts.lastSyncPayload = payload
          return origSyncCollectibles(payload)
        }
        engine.syncEchoPath = (path) => {
          counts.syncEchoPath += 1
          return origSyncEchoPath(path)
        }
        engine.setExitLocked = (locked, opts) => {
          counts.setExitLocked += 1
          counts.lastExitLockedOpts = { locked, opts }
          return origSetExitLocked(locked, opts)
        }
        engine.handleGameEvent = (evt) => {
          counts.handleGameEvent.push(evt)
          return origHandleGameEvent(evt)
        }
      },
    }

    await act(async () => {
      root.render(createElement(MazeViewport3D, baseProps))
    })
    assert.ok(engine, 'MazeViewport3D initialized engine')
    // Reset counters after initial mount
    counts.syncCollectibles = 0
    counts.syncEchoPath = 0
    counts.setExitLocked = 0
    counts.handleGameEvent = []

    // 1. Simulate 10 ordinary player-cell move events with identical collectible arrays
    const pathToExit = findShortestPath(maze.grid, maze.start, maze.exit).path
    for (let i = 1; i <= 10; i += 1) {
      const cell = pathToExit[i % pathToExit.length]
      await act(async () => {
        root.render(
          createElement(MazeViewport3D, {
            ...baseProps,
            playerCell: { row: cell.row, col: cell.col },
            lastEvent: { id: i, type: 'move', coinsGained: 0 },
          })
        )
      })
    }

    assert.equal(
      counts.syncCollectibles,
      0,
      '10 ordinary move events trigger 0 syncCollectibles calls'
    )
    assert.equal(
      counts.syncEchoPath,
      0,
      '10 ordinary move events trigger 0 syncEchoPath calls'
    )
    assert.equal(
      counts.setExitLocked,
      0,
      '10 ordinary move events trigger 0 setExitLocked calls'
    )
    assert.equal(
      counts.handleGameEvent.length,
      10,
      'All 10 transient move events were still delivered to engine.handleGameEvent'
    )

    // 2. Transient locked_exit event still shows gate notice UI without re-syncing collectibles
    await act(async () => {
      root.render(
        createElement(MazeViewport3D, {
          ...baseProps,
          playerCell: maze.exit,
          lastEvent: {
            id: 11,
            type: 'locked_exit',
            message: 'Exit Gate Locked — Collect 1 more Resonance Keycard',
          },
        })
      )
    })
    assert.equal(counts.syncCollectibles, 0, 'locked_exit event alone does not sync collectibles')
    assert.equal(counts.handleGameEvent.at(-1)?.id, 11, 'locked_exit handled by handleGameEvent')
    assert.ok(
      container.querySelector('[data-gate-notice="locked_exit"]'),
      'Gate locked notice banner renders cleanly'
    )

    // 3. Echo Reveal activation & path trimming routes strictly to engine.syncEchoPath
    const echoStep1 = pathToExit.slice(1)
    const echoStep2 = pathToExit.slice(2)
    await act(async () => {
      root.render(
        createElement(MazeViewport3D, {
          ...baseProps,
          playerCell: echoStep1[0],
          echoPath: echoStep1,
          lastEvent: { id: 12, type: 'echo_reveal_activated' },
        })
      )
    })
    await act(async () => {
      root.render(
        createElement(MazeViewport3D, {
          ...baseProps,
          playerCell: echoStep2[0],
          echoPath: echoStep2,
          lastEvent: { id: 13, type: 'move' },
        })
      )
    })
    assert.equal(counts.syncEchoPath, 2, 'echoPath updates invoke engine.syncEchoPath directly')
    assert.equal(
      counts.syncCollectibles,
      0,
      'echoPath-only updates skip full syncCollectibles traversal'
    )
    assert.equal(counts.setExitLocked, 0, 'echoPath-only updates skip setExitLocked')

    // 4. Coin collection + keycard unlock sync collectibles & gate unlock cleanly with bursts/animation
    const remainingCoins = baseProps.coins.slice(1)
    await act(async () => {
      root.render(
        createElement(MazeViewport3D, {
          ...baseProps,
          playerCell: echoStep2[0],
          coins: remainingCoins,
          keycards: [],
          keysCollected: baseProps.totalKeys,
          isExitLocked: false,
          echoPath: echoStep2,
          lastEvent: {
            id: 14,
            type: 'gate_unlocked',
            gateUnlocked: true,
            message: 'Resonance Exit Gate Unlocked!',
          },
        })
      )
    })
    assert.equal(counts.syncCollectibles, 1, 'Coin & keycard update triggers syncCollectibles once')
    assert.equal(counts.lastSyncPayload.spawnBursts, true, 'In-run collection keeps spawnBursts: true')
    assert.equal(counts.lastSyncPayload.isReset, false, 'In-run collection keeps isReset: false')
    assert.equal(counts.setExitLocked, 1, 'isExitLocked change updates engine exit gate')
    assert.equal(counts.lastExitLockedOpts.locked, false)
    assert.equal(counts.lastExitLockedOpts.opts.animate, true)
    assert.ok(
      container.querySelector('[data-gate-notice="gate_unlocked"]'),
      'Gate unlocked notice banner renders cleanly'
    )

    // 5. Run reset (`runId` increments + `lastEvent: null`) triggers clean non-animated reset sync
    await act(async () => {
      root.render(
        createElement(MazeViewport3D, {
          ...baseProps,
          runId: 2,
          coins: [...maze.collectibles.coins],
          keycards: [...maze.keycards],
          isExitLocked: maze.keycards.length > 0,
          echoPath: [],
          lastEvent: null,
        })
      )
    })
    assert.equal(counts.syncCollectibles, 2)
    assert.equal(counts.lastSyncPayload.isReset, true, 'RESET_RUN marks isReset: true')
    assert.equal(counts.lastSyncPayload.spawnBursts, false, 'RESET_RUN disables spawnBursts')
    assert.equal(counts.lastExitLockedOpts.opts.animate, false, 'RESET_RUN disables gate unlock animation')

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
    assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Shared pools cleaned up after unmount')
    console.log('✓ MazeViewport3D update cascade isolation & event preservation passed')
  } finally {
    await viteServer.close()
    for (const [k, desc] of prevGlobals.entries()) {
      if (desc) Object.defineProperty(globalThis, k, desc)
      else delete globalThis[k]
    }
  }
}

console.log('=== ALL PHASE 3 CASCADE & ECHO REVEAL TESTS PASSED! ===')
