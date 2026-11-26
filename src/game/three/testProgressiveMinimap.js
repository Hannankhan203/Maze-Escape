import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

import { generateMaze } from '../generation/mazeGenerator.js'
import { findShortestPath } from '../generation/pathfinder.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { CELL_SIZE, gridToWorld } from '../world/worldCoords.js'
import { COLLECTIBLE_TYPES } from '../mechanics/collectiblesConfig.js'
import {
  MINIMAP_LOGICAL_SIZE,
  SPECTRAL_COMPASS_REVEAL_RADIUS_TILES,
  SPIRIT_LANTERN_REVEAL_RADIUS_TILES,
  applyMinimapRevealEffects,
  buildMinimapSnapshot,
  createExplorationState,
  hasCorridorLineOfSight,
  isCellDiscovered,
  renderMinimapCanvas,
  revealAroundCell,
  revealEchoPath,
  revealNearbyObjectivesInRadius,
  revealPathsInRadius,
  resolveVisibleMinimapEnemies,
  resolveVisibleMinimapHazards,
  syncMinimapCanvasResolution,
} from '../mechanics/minimap.js'
import {
  computeRelativeDirection,
  computeWayfinderHint,
  resolveWayfinderObjectiveTarget,
} from '../mechanics/wayfinder.js'
import {
  createAdvanceLevelAction,
  createInitialGameState,
  createNewGameAction,
  createReplayLevelAction,
  gameReducer,
} from '../engine/gameReducer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MAZE_CSS_PATH = path.resolve(__dirname, '../../styles/maze.css')

function createSpyCanvas(width = MINIMAP_LOGICAL_SIZE, height = MINIMAP_LOGICAL_SIZE) {
  const fillRects = []
  const strokeRects = []
  const arcs = []
  const moveTos = []
  const paths = []
  let currentPath = []

  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    setTransform() {},
    fillRect(x, y, w, h) {
      fillRects.push({
        x,
        y,
        w,
        h,
        fillStyle: String(ctx.fillStyle).toLowerCase(),
      })
    },
    strokeRect(x, y, w, h) {
      strokeRects.push({
        x,
        y,
        w,
        h,
        strokeStyle: String(ctx.strokeStyle).toLowerCase(),
      })
    },
    beginPath() {
      currentPath = []
    },
    arc(x, y, r) {
      arcs.push({
        x,
        y,
        r,
        fillStyle: String(ctx.fillStyle).toLowerCase(),
        strokeStyle: String(ctx.strokeStyle).toLowerCase(),
      })
    },
    moveTo(x, y) {
      const pt = { x, y }
      moveTos.push(pt)
      currentPath.push(pt)
    },
    lineTo(x, y) {
      currentPath.push({ x, y })
    },
    closePath() {
      paths.push({
        points: [...currentPath],
        fillStyle: String(ctx.fillStyle).toLowerCase(),
        strokeStyle: String(ctx.strokeStyle).toLowerCase(),
      })
    },
    fill() {},
    stroke() {},
  }

  return {
    width,
    height,
    getContext: (type) => (type === '2d' ? ctx : null),
    fillRects,
    strokeRects,
    arcs,
    moveTos,
    paths,
    resetSpy() {
      fillRects.length = 0
      strokeRects.length = 0
      arcs.length = 0
      moveTos.length = 0
      paths.length = 0
      currentPath = []
    },
  }
}

function createMiniDomEnv() {
  const windowListeners = new Map()
  const documentListeners = new Map()
  const activeTimeouts = new Set()

  class MiniNode {
    constructor(nodeType, nodeName) {
      this.nodeType = nodeType
      this.nodeName = nodeName
      this.parentNode = null
      this.childNodes = []
      this.ownerDocument = null
    }
    get firstChild() {
      return this.childNodes[0] || null
    }
    get lastChild() {
      return this.childNodes[this.childNodes.length - 1] || null
    }
    get nextSibling() {
      if (!this.parentNode) return null
      const idx = this.parentNode.childNodes.indexOf(this)
      return idx >= 0 ? this.parentNode.childNodes[idx + 1] || null : null
    }
    get previousSibling() {
      if (!this.parentNode) return null
      const idx = this.parentNode.childNodes.indexOf(this)
      return idx > 0 ? this.parentNode.childNodes[idx - 1] || null : null
    }
    appendChild(child) {
      if (!child) return child
      if (child.nodeType === 11) {
        const list = [...child.childNodes]
        child.childNodes.length = 0
        for (const c of list) this.appendChild(c)
        return child
      }
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      this.childNodes.push(child)
      return child
    }
    insertBefore(newNode, referenceNode) {
      if (!referenceNode) return this.appendChild(newNode)
      if (newNode.nodeType === 11) {
        const list = [...newNode.childNodes]
        newNode.childNodes.length = 0
        for (const c of list) this.insertBefore(c, referenceNode)
        return newNode
      }
      if (newNode.parentNode) newNode.parentNode.removeChild(newNode)
      const idx = this.childNodes.indexOf(referenceNode)
      if (idx === -1) return this.appendChild(newNode)
      newNode.parentNode = this
      this.childNodes.splice(idx, 0, newNode)
      return newNode
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child)
      if (idx !== -1) {
        this.childNodes.splice(idx, 1)
        child.parentNode = null
      }
      return child
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this)
    }
    contains(other) {
      let cur = other
      while (cur) {
        if (cur === this) return true
        cur = cur.parentNode
      }
      return false
    }
  }

  class MiniTextNode extends MiniNode {
    constructor(text) {
      super(3, '#text')
      this._data = String(text ?? '')
    }
    get nodeValue() {
      return this._data
    }
    set nodeValue(val) {
      this._data = String(val ?? '')
    }
    get data() {
      return this._data
    }
    set data(val) {
      this._data = String(val ?? '')
    }
    get textContent() {
      return this._data
    }
    set textContent(val) {
      this._data = String(val ?? '')
    }
  }

  class MiniCommentNode extends MiniNode {
    constructor(text) {
      super(8, '#comment')
      this.data = String(text ?? '')
    }
  }

  class MiniDocumentFragment extends MiniNode {
    constructor() {
      super(11, '#document-fragment')
    }
  }

  class MiniClassList {
    constructor(el) {
      this._el = el
    }
    _tokens() {
      return (this._el.getAttribute('class') || '').split(/\s+/).filter(Boolean)
    }
    add(...names) {
      const set = new Set(this._tokens())
      for (const n of names) if (n) set.add(n)
      this._el.setAttribute('class', [...set].join(' '))
    }
    remove(...names) {
      const set = new Set(this._tokens())
      for (const n of names) set.delete(n)
      this._el.setAttribute('class', [...set].join(' '))
    }
    contains(name) {
      return this._tokens().includes(name)
    }
  }

  class MiniElement extends MiniNode {
    constructor(tagName, namespaceURI = 'http://www.w3.org/1999/xhtml') {
      super(1, String(tagName).toUpperCase())
      this.tagName = String(tagName).toUpperCase()
      this.namespaceURI = namespaceURI
      this.attributes = new Map()
      this.listeners = new Map()
      this.style = {}
      this.classList = new MiniClassList(this)
      this.disabled = false
      this.value = ''
      this.checked = false
      this._canvasSpy =
        this.tagName === 'CANVAS' ? createSpyCanvas(MINIMAP_LOGICAL_SIZE, MINIMAP_LOGICAL_SIZE) : null
      const self = this
      this.dataset = new Proxy(
        {},
        {
          get(_, prop) {
            const attr = 'data-' + String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
            return self.getAttribute(attr) ?? undefined
          },
          set(_, prop, val) {
            const attr = 'data-' + String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
            self.setAttribute(attr, String(val))
            return true
          },
        }
      )
    }
    get width() {
      if (this._canvasSpy) return this._canvasSpy.width
      return Number(this.getAttribute('width')) || 0
    }
    set width(val) {
      const num = Number(val) || 0
      this.setAttribute('width', String(num))
      if (this._canvasSpy) this._canvasSpy.width = num
    }
    get height() {
      if (this._canvasSpy) return this._canvasSpy.height
      return Number(this.getAttribute('height')) || 0
    }
    set height(val) {
      const num = Number(val) || 0
      this.setAttribute('height', String(num))
      if (this._canvasSpy) this._canvasSpy.height = num
    }
    getContext(type) {
      return this._canvasSpy ? this._canvasSpy.getContext(type) : null
    }
    get className() {
      return this.getAttribute('class') || ''
    }
    set className(val) {
      this.setAttribute('class', String(val ?? ''))
    }
    get id() {
      return this.getAttribute('id') || ''
    }
    set id(val) {
      this.setAttribute('id', String(val ?? ''))
    }
    setAttribute(name, value) {
      const key = String(name)
      const strVal = String(value)
      this.attributes.set(key, strVal)
      if (key === 'disabled') this.disabled = true
    }
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null
    }
    hasAttribute(name) {
      return this.attributes.has(name)
    }
    removeAttribute(name) {
      this.attributes.delete(name)
      if (name === 'disabled') this.disabled = false
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(fn)
    }
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn)
    }
    dispatchEvent(event) {
      const evt = {
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        target: this,
        currentTarget: this,
        preventDefault() {
          this.defaultPrevented = true
        },
        stopPropagation() {
          this._stopped = true
        },
        ...(event && typeof event === 'object' ? event : { type: String(event) }),
      }
      if (!evt.target) evt.target = this
      let cur = this
      while (cur) {
        evt.currentTarget = cur
        const set = cur.listeners?.get(evt.type)
        if (set) {
          for (const fn of [...set]) {
            fn.call(cur, evt)
          }
        }
        if (evt.type === 'click' && typeof cur.onclick === 'function') {
          cur.onclick.call(cur, evt)
        }
        if (!evt.bubbles || evt._stopped) break
        cur = cur.parentNode
      }
      if (!evt._stopped && evt.bubbles && this.ownerDocument?.dispatchEvent) {
        evt.currentTarget = this.ownerDocument
        this.ownerDocument.dispatchEvent(evt)
      }
      return !evt.defaultPrevented
    }
    get textContent() {
      let out = ''
      for (const child of this.childNodes) out += child.textContent || ''
      return out
    }
    set textContent(val) {
      this.childNodes.length = 0
      if (val !== undefined && val !== null && val !== '') {
        this.appendChild(new MiniTextNode(val))
      }
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 120, height: 120, right: 120, bottom: 120 }
    }
    focus() {
      if (this.ownerDocument) this.ownerDocument.activeElement = this
    }
    blur() {}
    click() {
      if (this.disabled) return
      this.dispatchEvent({ type: 'click', button: 0, bubbles: true, cancelable: true })
    }
    matchesSelector(selector) {
      const parts = selector.trim().split(/(?=[.#[])/)
      for (const part of parts) {
        if (!part) continue
        if (part.startsWith('.')) {
          if (!this.classList.contains(part.slice(1))) return false
        } else if (part.startsWith('#')) {
          if (this.id !== part.slice(1)) return false
        } else if (part.startsWith('[')) {
          const m = part.match(/^\[([^=\]]+)(?:=['"]?([^'"\]]*)['"]?)?\]$/)
          if (!m) return false
          const attrVal = this.getAttribute(m[1])
          if (m[2] !== undefined) {
            if (attrVal !== m[2]) return false
          } else if (attrVal === null) {
            return false
          }
        } else if (this.tagName !== part.toUpperCase()) {
          return false
        }
      }
      return true
    }
    querySelectorAll(selector) {
      const out = []
      const walk = (node) => {
        for (const c of node.childNodes) {
          if (c.nodeType === 1) {
            if (c.matchesSelector(selector)) out.push(c)
            walk(c)
          }
        }
      }
      walk(this)
      return out
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    }
    closest(selector) {
      let cur = this
      while (cur && cur.nodeType === 1) {
        if (cur.matchesSelector(selector)) return cur
        cur = cur.parentNode
      }
      return null
    }
  }

  class MiniIFrameElement extends MiniElement {
    constructor() {
      super('iframe')
    }
  }

  const storageMap = new Map()
  const miniLocalStorage = {
    getItem: (k) => (storageMap.has(String(k)) ? storageMap.get(String(k)) : null),
    setItem: (k, v) => storageMap.set(String(k), String(v)),
    removeItem: (k) => storageMap.delete(String(k)),
    clear: () => storageMap.clear(),
  }

  const activeIntervals = new Set()
  const activeRafs = new Set()

  const miniDocument = {
    nodeType: 9,
    documentElement: new MiniElement('html'),
    head: new MiniElement('head'),
    body: new MiniElement('body'),
    activeElement: null,
    defaultView: null,
    visibilityState: 'visible',
    hidden: false,
    pointerLockElement: null,
    fullscreenElement: null,
    createElement(tag) {
      const el =
        String(tag).toLowerCase() === 'iframe' ? new MiniIFrameElement() : new MiniElement(tag)
      el.ownerDocument = miniDocument
      return el
    },
    createElementNS(ns, tag) {
      const el = new MiniElement(tag, ns)
      el.ownerDocument = miniDocument
      return el
    },
    createTextNode(text) {
      const node = new MiniTextNode(text)
      node.ownerDocument = miniDocument
      return node
    },
    createComment(text) {
      const node = new MiniCommentNode(text)
      node.ownerDocument = miniDocument
      return node
    },
    createDocumentFragment() {
      const frag = new MiniDocumentFragment()
      frag.ownerDocument = miniDocument
      return frag
    },
    addEventListener(type, fn) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set())
      documentListeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      documentListeners.get(type)?.delete(fn)
    },
    querySelector(sel) {
      return miniDocument.body.querySelector(sel)
    },
    querySelectorAll(sel) {
      return miniDocument.body.querySelectorAll(sel)
    },
    exitPointerLock() {
      miniDocument.pointerLockElement = null
    },
  }
  miniDocument.documentElement.ownerDocument = miniDocument
  miniDocument.head.ownerDocument = miniDocument
  miniDocument.body.ownerDocument = miniDocument
  miniDocument.activeElement = miniDocument.body
  miniDocument.documentElement.appendChild(miniDocument.head)
  miniDocument.documentElement.appendChild(miniDocument.body)

  const miniWindow = {
    document: miniDocument,
    localStorage: miniLocalStorage,
    location: { search: '', href: 'http://localhost:3000/' },
    devicePixelRatio: 2,
    innerWidth: 1280,
    innerHeight: 800,
    performance,
    HTMLElement: MiniElement,
    HTMLIFrameElement: MiniIFrameElement,
    Element: MiniElement,
    Node: MiniNode,
    Text: MiniTextNode,
    DocumentFragment: MiniDocumentFragment,
    getComputedStyle: (el) => el?.style || {},
    navigator: { userAgent: 'node-test', maxTouchPoints: 0 },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set())
      windowListeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      windowListeners.get(type)?.delete(fn)
    },
    dispatchEvent(event) {
      const evt = event && typeof event === 'object' ? event : { type: String(event) }
      if (typeof evt.preventDefault !== 'function') evt.preventDefault = () => {}
      if (typeof evt.stopPropagation !== 'function') evt.stopPropagation = () => {}
      for (const fn of [...(windowListeners.get(evt.type) || [])]) fn(evt)
      return true
    },
    setTimeout: (fn, ms, ...args) => {
      const id = globalThis.setTimeout(() => {
        activeTimeouts.delete(id)
        fn(...args)
      }, ms)
      activeTimeouts.add(id)
      return id
    },
    clearTimeout: (id) => {
      activeTimeouts.delete(id)
      globalThis.clearTimeout(id)
    },
    setInterval: (fn, ms, ...args) => {
      const id = globalThis.setInterval(() => fn(...args), Math.max(1, Number(ms) || 1))
      activeIntervals.add(id)
      return id
    },
    clearInterval: (id) => {
      activeIntervals.delete(id)
      globalThis.clearInterval(id)
    },
    requestAnimationFrame: (fn) => {
      const id = globalThis.setTimeout(() => {
        activeRafs.delete(id)
        fn(performance.now())
      }, 8)
      activeRafs.add(id)
      return id
    },
    cancelAnimationFrame: (id) => {
      activeRafs.delete(id)
      globalThis.clearTimeout(id)
    },
  }
  miniDocument.defaultView = miniWindow

  return {
    window: miniWindow,
    document: miniDocument,
    windowListeners,
    documentListeners,
    install() {
      const keys = [
        'window',
        'document',
        'navigator',
        'localStorage',
        'HTMLElement',
        'HTMLIFrameElement',
        'Element',
        'Node',
        'Text',
        'DocumentFragment',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'IS_REACT_ACT_ENVIRONMENT',
      ]
      const prevDescriptors = new Map()
      for (const key of keys) {
        prevDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
      }
      const setGlobalProp = (key, value) => {
        Object.defineProperty(globalThis, key, {
          value,
          configurable: true,
          writable: true,
          enumerable: true,
        })
      }
      setGlobalProp('window', miniWindow)
      setGlobalProp('document', miniDocument)
      setGlobalProp('navigator', miniWindow.navigator)
      setGlobalProp('localStorage', miniLocalStorage)
      setGlobalProp('HTMLElement', MiniElement)
      setGlobalProp('HTMLIFrameElement', MiniIFrameElement)
      setGlobalProp('Element', MiniElement)
      setGlobalProp('Node', MiniNode)
      setGlobalProp('Text', MiniTextNode)
      setGlobalProp('DocumentFragment', MiniDocumentFragment)
      setGlobalProp('requestAnimationFrame', miniWindow.requestAnimationFrame)
      setGlobalProp('cancelAnimationFrame', miniWindow.cancelAnimationFrame)
      setGlobalProp('IS_REACT_ACT_ENVIRONMENT', true)
      return () => {
        for (const id of activeTimeouts) globalThis.clearTimeout(id)
        for (const id of activeIntervals) globalThis.clearInterval(id)
        for (const id of activeRafs) globalThis.clearTimeout(id)
        activeTimeouts.clear()
        activeIntervals.clear()
        activeRafs.clear()
        for (const key of keys) {
          const desc = prevDescriptors.get(key)
          if (desc) {
            Object.defineProperty(globalThis, key, desc)
          } else {
            delete globalThis[key]
          }
        }
      }
    },
  }
}

let passedCount = 0
let failedCount = 0

async function runCase(number, label, fn) {
  try {
    await fn()
    passedCount += 1
    console.log(`✓ ${number}. ${label}`)
  } catch (err) {
    failedCount += 1
    console.error(`✗ ${number}. ${label} FAILED:`, err)
    throw err
  }
}

async function runTests() {
  console.log('=== MAZE-MAP-001: Progressive Minimap & Wayfinder Test Suite ===')

  // -------------------------------------------------------------------------
  // 1. Minimap accurately represents generated maze topology
  // -------------------------------------------------------------------------
  await runCase(
    1,
    'Minimap accurately represents generated maze topology',
    () => {
      const maze = generateMaze({ level: 3, seed: 842101, baseSeed: 400001 })
      const exploration = createExplorationState(maze)

      // Reveal entire grid artificially to verify 1:1 cell-type fidelity
      for (let r = 0; r < maze.rows; r += 1) {
        for (let c = 0; c < maze.cols; c += 1) {
          revealAroundCell(exploration, maze, { row: r, col: c }, { corridorRange: 1 })
        }
      }

      const snap = buildMinimapSnapshot({
        maze,
        exploration,
        playerCell: maze.start,
        items: maze.collectibles.items,
        keycards: maze.keycards,
        objectivesEnabled: true,
        isExitLocked: true,
      })

      assert.equal(snap.rows, maze.rows)
      assert.equal(snap.cols, maze.cols)
      assert.equal(snap.exploredCells.length, maze.rows * maze.cols)
      for (const cell of snap.exploredCells) {
        const expectedType =
          maze.grid[cell.row][cell.col] === CELL_TYPES.WALL ? 'wall' : 'path'
        assert.equal(cell.type, expectedType)
      }
      assert.deepEqual(snap.start, { row: maze.start.row, col: maze.start.col })
      assert.deepEqual(snap.exit, {
        row: maze.exit.row,
        col: maze.exit.col,
        locked: true,
      })
    }
  )

  // -------------------------------------------------------------------------
  // 2. Player marker updates with player movement (cell & worldPos)
  // -------------------------------------------------------------------------
  await runCase(
    2,
    'Player marker updates accurately with player movement (cell and continuous world position)',
    () => {
      const maze = generateMaze({ level: 2, seed: 551102, baseSeed: 551100 })
      const pathToExit = findShortestPath(maze.grid, maze.start, maze.exit).path
      assert.ok(pathToExit.length >= 4)

      const targetCell = pathToExit[3]
      const exploration = createExplorationState(maze)
      revealAroundCell(exploration, maze, targetCell)

      const worldPos = gridToWorld(targetCell.row, targetCell.col, maze)
      const movedWorld = {
        x: worldPos.x + CELL_SIZE * 0.25,
        y: 0,
        z: worldPos.z - CELL_SIZE * 0.2,
      }

      const snap = buildMinimapSnapshot({
        maze,
        exploration,
        playerCell: targetCell,
        playerWorldPos: movedWorld,
        yaw: 0,
      })

      assert.equal(snap.player.row, targetCell.row)
      assert.equal(snap.player.col, targetCell.col)
      assert.ok(Math.abs(snap.player.colFrac - (targetCell.col + 0.75)) < 1e-5)
      assert.ok(Math.abs(snap.player.rowFrac - (targetCell.row + 0.3)) < 1e-5)

      const canvasA = createSpyCanvas()
      const canvasB = createSpyCanvas()
      renderMinimapCanvas(canvasA, {
        maze,
        exploration,
        playerCell: maze.start,
        logicalSize: MINIMAP_LOGICAL_SIZE,
        dpr: 1,
      })
      renderMinimapCanvas(canvasB, {
        maze,
        exploration,
        playerCell: targetCell,
        playerWorldPos: movedWorld,
        logicalSize: MINIMAP_LOGICAL_SIZE,
        dpr: 1,
      })
      const tipA = canvasA.moveTos.at(-1)
      const tipB = canvasB.moveTos.at(-1)
      assert.ok(
        Math.hypot(tipB.x - tipA.x, tipB.y - tipA.y) > 1,
        'Canvas player arrow moves in world/cell space'
      )
    }
  )

  // -------------------------------------------------------------------------
  // 3. Player facing direction updates correctly
  // -------------------------------------------------------------------------
  await runCase(
    3,
    'Player facing direction & relative target bearings update accurately with yaw',
    () => {
      const maze = generateMaze({ level: 1, seed: 774411, baseSeed: 774410 })
      const exploration = createExplorationState(maze)

      const orientations = [
        { name: 'North', yaw: 0, hx: 0, hy: -1 },
        { name: 'East', yaw: -Math.PI / 2, hx: 1, hy: 0 },
        { name: 'South', yaw: Math.PI, hx: 0, hy: 1 },
        { name: 'West', yaw: Math.PI / 2, hx: -1, hy: 0 },
      ]

      for (const dir of orientations) {
        const snap = buildMinimapSnapshot({
          maze,
          exploration,
          playerCell: maze.start,
          yaw: dir.yaw,
        })
        assert.ok(Math.abs(snap.player.headingX - dir.hx) < 1e-5, `${dir.name} headingX`)
        assert.ok(Math.abs(snap.player.headingY - dir.hy) < 1e-5, `${dir.name} headingY`)
      }

      // Relative bearing verification: target directly East of player
      const from = { row: 5, col: 5 }
      const eastTarget = { row: 5, col: 10 }
      assert.equal(computeRelativeDirection(from, eastTarget, 0).relativeDirection, 'right')
      assert.equal(computeRelativeDirection(from, eastTarget, -Math.PI / 2).relativeDirection, 'ahead')
      assert.equal(computeRelativeDirection(from, eastTarget, Math.PI / 2).relativeDirection, 'behind')
      assert.equal(computeRelativeDirection(from, eastTarget, Math.PI).relativeDirection, 'left')
    }
  )

  // -------------------------------------------------------------------------
  // 4. Exit marker appears at correct location and reflects locked/unlocked state
  // -------------------------------------------------------------------------
  await runCase(
    4,
    'Exit marker appears at exact exit cell when discovered and reflects lock state visually',
    () => {
      const maze = generateMaze({ level: 2, seed: 123456, baseSeed: 123000 })
      const exploration = createExplorationState(maze)
      assert.equal(
        isCellDiscovered(exploration, maze.exit.row, maze.exit.col),
        false
      )

      revealAroundCell(exploration, maze, maze.exit)

      const lockedCanvas = createSpyCanvas()
      renderMinimapCanvas(lockedCanvas, {
        maze,
        exploration,
        playerCell: maze.exit,
        objectivesEnabled: true,
        isExitLocked: true,
        logicalSize: MINIMAP_LOGICAL_SIZE,
        dpr: 1,
      })
      assert.ok(
        lockedCanvas.fillRects.some((r) => r.fillStyle === '#ef4444'),
        'Locked exit renders red marker (#ef4444)'
      )

      const unlockedCanvas = createSpyCanvas()
      renderMinimapCanvas(unlockedCanvas, {
        maze,
        exploration,
        playerCell: maze.exit,
        objectivesEnabled: true,
        isExitLocked: false,
        logicalSize: MINIMAP_LOGICAL_SIZE,
        dpr: 1,
      })
      assert.ok(
        unlockedCanvas.fillRects.some((r) => r.fillStyle === '#10b981'),
        'Unlocked exit renders emerald marker (#10b981)'
      )
      assert.ok(
        unlockedCanvas.arcs.some((a) => a.strokeStyle === '#a7f3d0'),
        'Unlocked exit includes distinct inner portal circle symbol (not color-only)'
      )
    }
  )

  // -------------------------------------------------------------------------
  // 5. Keycard/objective markers are accurate
  // -------------------------------------------------------------------------
  await runCase(
    5,
    'Keycard/objective markers appear accurately when discovered and stay concealed beforehand',
    () => {
      const maze = generateMaze({ level: 3, seed: 998877, baseSeed: 998800, objectivesEnabled: true })
      assert.ok(maze.keycards.length >= 1)
      const exploration = createExplorationState(maze)

      const initialSnap = buildMinimapSnapshot({
        maze,
        exploration,
        playerCell: maze.start,
        keycards: maze.keycards,
        objectivesEnabled: true,
        isExitLocked: true,
      })
      const hiddenKeycard = maze.keycards.find(
        (k) => !isCellDiscovered(exploration, k.row, k.col)
      )
      assert.ok(hiddenKeycard)
      assert.equal(
        initialSnap.keycards.some((k) => k.id === hiddenKeycard.id),
        false
      )

      revealAroundCell(exploration, maze, hiddenKeycard)
      const revealedSnap = buildMinimapSnapshot({
        maze,
        exploration,
        playerCell: hiddenKeycard,
        keycards: maze.keycards,
        objectivesEnabled: true,
        isExitLocked: true,
      })
      const matched = revealedSnap.keycards.find((k) => k.id === hiddenKeycard.id)
      assert.deepEqual(matched, {
        id: hiddenKeycard.id,
        row: hiddenKeycard.row,
        col: hiddenKeycard.col,
      })

      const canvas = createSpyCanvas()
      renderMinimapCanvas(canvas, {
        maze,
        exploration,
        playerCell: hiddenKeycard,
        keycards: maze.keycards,
        objectivesEnabled: true,
        isExitLocked: true,
        logicalSize: MINIMAP_LOGICAL_SIZE,
        dpr: 1,
      })
      assert.ok(
        canvas.paths.some((p) => p.fillStyle === '#22d3ee' && p.points.length === 3),
        'Keycard renders as distinct cyan triangle path'
      )
    }
  )

  // -------------------------------------------------------------------------
  // 6. Objective markers disappear/update when collected
  // -------------------------------------------------------------------------
  await runCase(
    6,
    'Objective and collectible markers disappear immediately when collected',
    () => {
      let state = createInitialGameState(445566, { level: 3, objectivesEnabled: true })
      assert.ok(state.keycards.length >= 1)
      const targetKey = state.keycards[0]
      const targetItem = state.items.find((it) => it.type === COLLECTIBLE_TYPES.SOUL_SHARDS)
      assert.ok(targetItem)

      const exploration = createExplorationState(state.maze)
      revealAroundCell(exploration, state.maze, targetKey)
      revealAroundCell(exploration, state.maze, targetItem)

      const snapBefore = buildMinimapSnapshot({
        maze: state.maze,
        exploration,
        playerCell: targetKey,
        items: state.items,
        keycards: state.keycards,
        objectivesEnabled: state.objectivesEnabled,
        isExitLocked: state.isExitLocked,
      })
      assert.equal(snapBefore.keycards.some((k) => k.id === targetKey.id), true)
      assert.equal(snapBefore.items.some((i) => i.id === targetItem.id), true)

      state = gameReducer(state, {
        type: 'SYNC_PLAYER_CELL',
        row: targetKey.row,
        col: targetKey.col,
      })
      state = gameReducer(state, {
        type: 'SYNC_PLAYER_CELL',
        row: targetItem.row,
        col: targetItem.col,
      })

      const snapAfter = buildMinimapSnapshot({
        maze: state.maze,
        exploration,
        playerCell: targetItem,
        items: state.items,
        keycards: state.keycards,
        objectivesEnabled: state.objectivesEnabled,
        isExitLocked: state.isExitLocked,
      })
      assert.equal(snapAfter.keycards.some((k) => k.id === targetKey.id), false)
      assert.equal(snapAfter.items.some((i) => i.id === targetItem.id), false)
    }
  )

  // -------------------------------------------------------------------------
  // 7. Wayfinder target correctly prioritizes objectives
  // -------------------------------------------------------------------------
  await runCase(
    7,
    'Wayfinder correctly prioritizes nearest reachable keycard objective without leaking full route',
    () => {
      const maze = generateMaze({ level: 4, seed: 334499, baseSeed: 334400, objectivesEnabled: true })
      assert.ok(maze.keycards.length >= 2)

      let nearest = null
      let minDist = Infinity
      for (const kc of maze.keycards) {
        const res = findShortestPath(maze.grid, maze.start, kc)
        if (res.found && res.distance < minDist) {
          minDist = res.distance
          nearest = kc
        }
      }
      assert.ok(nearest)

      const targetInfo = resolveWayfinderObjectiveTarget({
        maze,
        playerCell: maze.start,
        keycards: maze.keycards,
        objectivesEnabled: true,
        isExitLocked: true,
      })
      assert.equal(targetInfo.found, true)
      assert.equal(targetInfo.targetType, 'keycard')
      assert.equal(targetInfo.targetId, nearest.id)
      assert.equal(targetInfo.distanceSteps, minDist)
      assert.equal(targetInfo.remainingObjectives, maze.keycards.length)

      const hint = computeWayfinderHint({
        maze,
        playerCell: maze.start,
        yaw: 0,
        keycards: maze.keycards,
        objectivesEnabled: true,
        isExitLocked: true,
      })
      assert.equal(hint.found, true)
      assert.equal(hint.targetType, 'keycard')
      assert.equal('path' in hint, false, 'Wayfinder must not leak full solution path')
      assert.ok(['north', 'south', 'east', 'west'].includes(hint.direction))
      assert.ok(['ahead', 'right', 'left', 'behind'].includes(hint.relativeDirection))
    }
  )

  // -------------------------------------------------------------------------
  // 8. Wayfinder switches to exit after objectives are completed
  // -------------------------------------------------------------------------
  await runCase(
    8,
    'Wayfinder updates when keycard collected, switches to exit when unlocked, and handles invalid targets gracefully',
    () => {
      let state = createInitialGameState(556677, { level: 3, objectivesEnabled: true })
      assert.ok(state.keycards.length >= 2)

      const firstKey = state.keycards[0]
      state = gameReducer(state, {
        type: 'SYNC_PLAYER_CELL',
        row: firstKey.row,
        col: firstKey.col,
      })
      assert.equal(state.isExitLocked, true)

      const midHint = computeWayfinderHint({
        maze: state.maze,
        playerCell: state.playerPos,
        keycards: state.keycards,
        objectivesEnabled: state.objectivesEnabled,
        isExitLocked: state.isExitLocked,
      })
      assert.equal(midHint.targetType, 'keycard')
      assert.notEqual(midHint.targetId, firstKey.id)

      for (const rem of [...state.keycards]) {
        state = gameReducer(state, {
          type: 'SYNC_PLAYER_CELL',
          row: rem.row,
          col: rem.col,
        })
      }
      assert.equal(state.isExitLocked, false)
      assert.equal(state.keycards.length, 0)

      const exitHint = computeWayfinderHint({
        maze: state.maze,
        playerCell: state.playerPos,
        keycards: state.keycards,
        objectivesEnabled: state.objectivesEnabled,
        isExitLocked: state.isExitLocked,
      })
      assert.equal(exitHint.found, true)
      assert.equal(exitHint.targetType, 'exit')
      assert.equal(exitHint.targetId, 'exit')

      // Unavailable / blocked target handling
      const unreachableHint = computeWayfinderHint({
        maze: {
          grid: [
            [1, 1, 1, 1, 1],
            [1, 0, 1, 0, 1],
            [1, 1, 1, 1, 1],
          ],
          start: { row: 1, col: 1 },
          exit: { row: 1, col: 3 },
        },
        playerCell: { row: 1, col: 1 },
        keycards: [{ id: 'bad', row: 1, col: 3 }],
        objectivesEnabled: true,
        isExitLocked: true,
      })
      assert.equal(unreachableHint.found, false)
      assert.equal(unreachableHint.label, 'No route signal detected')
    }
  )

  // -------------------------------------------------------------------------
  // 9. Explored/unexplored visibility rules work correctly
  // -------------------------------------------------------------------------
  await runCase(
    9,
    'Explored/unexplored fog-of-war prevents wallhacks behind walls',
    () => {
      // Construct a corridor separated by a solid wall at col=3
      const grid = [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 1, 0, 0, 1],
        [1, 0, 0, 1, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1],
      ]
      const customMaze = {
        id: 'fog-test',
        rows: 4,
        cols: 7,
        grid,
        start: { row: 1, col: 1 },
        exit: { row: 1, col: 5 },
      }
      const exploration = createExplorationState(customMaze, { corridorRange: 4 })
      // Wall at (1,3) is discovered as stopping surface, but corridor behind wall at (1,4),(1,5) must remain fogged
      assert.equal(isCellDiscovered(exploration, 1, 3), true)
      assert.equal(isCellDiscovered(exploration, 1, 4), false)
      assert.equal(isCellDiscovered(exploration, 1, 5), false)
      assert.equal(
        hasCorridorLineOfSight(customMaze, { row: 1, col: 1 }, { row: 1, col: 4 }, 10),
        false
      )
    }
  )

  // -------------------------------------------------------------------------
  // 10. Reveal abilities correctly update map visibility
  // -------------------------------------------------------------------------
  await runCase(
    10,
    'Spirit Lantern, Echo Reveal, Spectral Compass, and Watcher’s Eye integrate cleanly with minimap',
    () => {
      const maze = generateMaze({ level: 3, seed: 246810, baseSeed: 246800 })

      // A. Spirit Lantern (8-tile path reveal without exposing hidden enemies)
      const expLantern = createExplorationState(maze, { revealStart: false })
      const lanternRes = revealPathsInRadius(
        expLantern,
        maze,
        maze.start,
        SPIRIT_LANTERN_REVEAL_RADIUS_TILES
      )
      assert.equal(lanternRes.changed, true)
      assert.ok(lanternRes.newlyRevealed > 10)

      // B. Echo Reveal (shortest-path corridor cells revealed along echoPath)
      const expEcho = createExplorationState(maze)
      const echoPath = findShortestPath(maze.grid, maze.start, maze.exit).path
      const echoRes = revealEchoPath(expEcho, maze, echoPath)
      assert.equal(echoRes.changed, true)
      assert.equal(isCellDiscovered(expEcho, maze.exit.row, maze.exit.col), true)

      // C. Spectral Compass (nearby collectibles/keycards revealed within 6 tiles)
      const expCompass = createExplorationState(maze, { revealStart: false })
      const nearTarget = {
        id: 'near-item',
        row: Math.min(maze.rows - 2, maze.start.row + 2),
        col: maze.start.col,
      }
      const farTarget = {
        id: 'far-item',
        row: maze.exit.row,
        col: maze.exit.col,
      }
      revealNearbyObjectivesInRadius(expCompass, maze, maze.start, {
        items: [nearTarget],
        keycards: [farTarget],
        radiusTiles: SPECTRAL_COMPASS_REVEAL_RADIUS_TILES,
      })
      assert.equal(isCellDiscovered(expCompass, nearTarget.row, nearTarget.col), true)
      assert.equal(isCellDiscovered(expCompass, farTarget.row, farTarget.col), false)

      // D. Centralized applyMinimapRevealEffects combines active abilities
      const expCombined = createExplorationState(maze)
      const combinedRes = applyMinimapRevealEffects(expCombined, maze, {
        playerCell: maze.start,
        activeEffects: {
          spiritLanternRemainingMs: 5000,
          echoRevealRemainingMs: 3000,
          spectralCompassRemainingMs: 4000,
        },
        echoPath,
        items: [nearTarget],
        keycards: [farTarget],
      })
      assert.equal(combinedRes.changed, true)
      assert.equal(isCellDiscovered(expCombined, maze.exit.row, maze.exit.col), true)
    }
  )

  // -------------------------------------------------------------------------
  // 11. Hidden enemies/hazards are not unfairly revealed
  // -------------------------------------------------------------------------
  await runCase(
    11,
    'Hidden enemies and undiscovered hazards are concealed while visible/Watcher’s Eye threats render properly',
    () => {
      const grid = [
        [1, 1, 1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1, 0, 0, 0, 1],
        [1, 0, 1, 0, 1, 0, 1, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1],
      ]
      const maze = {
        id: 'threat-vis-maze',
        rows: 5,
        cols: 9,
        grid,
        start: { row: 1, col: 1 },
        exit: { row: 1, col: 7 },
      }
      const exploration = createExplorationState(maze)

      const hazards = [
        { id: 'haz-near', type: 'steam_pipe_burst', row: 1, col: 2, state: 'dormant' },
        { id: 'haz-hidden', type: 'wall_collapse', row: 1, col: 7, state: 'dormant' },
      ]
      const visibleHazards = resolveVisibleMinimapHazards({ maze, exploration, hazards })
      assert.equal(visibleHazards.some((h) => h.id === 'haz-near'), true)
      assert.equal(visibleHazards.some((h) => h.id === 'haz-hidden'), false)

      const enemies = [
        { id: 'enemy-los', type: 'stalker', row: 1, col: 3, state: 'patrol' },
        { id: 'enemy-wall', type: 'crawler', row: 1, col: 5, state: 'patrol' },
        { id: 'enemy-far', type: 'specter', row: 1, col: 7, state: 'patrol' },
      ]
      // Enemy behind wall (col=5) is within 4 Euclidean tiles, NOT visible without Watcher's Eye
      const losOnly = resolveVisibleMinimapEnemies({
        maze,
        exploration,
        enemies,
        playerCell: maze.start,
        watchersEyeActive: false,
      })
      assert.deepEqual(
        losOnly.map((e) => e.id),
        ['enemy-los']
      )

      // With Watcher's Eye active (10-tile radius), wall-occluded enemies within 10 tiles are revealed
      const eyeRevealed = resolveVisibleMinimapEnemies({
        maze,
        exploration,
        enemies,
        playerCell: maze.start,
        watchersEyeActive: true,
      })
      assert.equal(eyeRevealed.length, 3)
      assert.ok(eyeRevealed.every((e) => e.visibilityReason === 'watchers_eye'))

      // Verify buildMinimapSnapshot still forbids enemy leaks when includeThreatVisibility/watchersEye is false
      const defaultSnap = buildMinimapSnapshot({
        maze,
        exploration,
        playerCell: maze.start,
        enemies,
        hazards,
      })
      assert.equal('enemies' in defaultSnap, false)
      assert.equal(defaultSnap.hazards.length, 1)
    }
  )

  // -------------------------------------------------------------------------
  // 12–16. Progression Integration: Level 1, Next Level, Replay, Restart, Level 5000->5001
  // -------------------------------------------------------------------------
  await runCase(
    12,
    'Fresh Game -> Level 1 -> Level 2 -> Replay -> Restart -> New Game & Level 5000->5001 map transitions',
    () => {
      // 12. Fresh Game initializes Level 1
      let state = gameReducer(undefined, createNewGameAction({ baseSeed: 221100 }))
      assert.equal(state.currentLevel, 1)
      let exp = createExplorationState(state.maze)
      assert.equal(exp.level, 1)
      assert.equal(isCellDiscovered(exp, state.maze.start.row, state.maze.start.col), true)
      assert.equal(isCellDiscovered(exp, state.maze.exit.row, state.maze.exit.col), false)

      // Explore exit in Level 1
      revealAroundCell(exp, state.maze, state.maze.exit)
      assert.equal(isCellDiscovered(exp, state.maze.exit.row, state.maze.exit.col), true)

      // 13. Next Level resets map state for Level 2
      state = gameReducer(state, createAdvanceLevelAction(state))
      assert.equal(state.currentLevel, 2)
      const expL2 = createExplorationState(state.maze)
      assert.equal(expL2.level, 2)
      assert.notEqual(expL2.mazeId, exp.mazeId)
      assert.equal(isCellDiscovered(expL2, state.maze.exit.row, state.maze.exit.col), false)

      // 14. Replay Level restores identical maze topology & seed with clean exploration
      const l2MazeId = state.maze.id
      const l2Seed = state.maze.seed
      revealAroundCell(expL2, state.maze, state.maze.exit)
      state = gameReducer(state, createReplayLevelAction(state))
      assert.equal(state.currentLevel, 2)
      assert.equal(state.maze.id, l2MazeId)
      assert.equal(state.maze.seed, l2Seed)
      const expReplay = createExplorationState(state.maze)
      assert.equal(isCellDiscovered(expReplay, state.maze.exit.row, state.maze.exit.col), false)

      // 15. Restart / New Game resets back to Level 1 cleanly
      state = gameReducer(state, createNewGameAction({ previousBaseSeed: state.baseSeed }))
      assert.equal(state.currentLevel, 1)
      const expNewGame = createExplorationState(state.maze)
      assert.equal(expNewGame.level, 1)
      assert.equal(isCellDiscovered(expNewGame, state.maze.exit.row, state.maze.exit.col), false)

      // 16. Level 5000 -> 5001
      let highState = createInitialGameState(919191, { level: 5000, baseSeed: 919191 })
      assert.equal(highState.currentLevel, 5000)
      const exp5000 = createExplorationState(highState.maze)
      assert.equal(exp5000.level, 5000)
      const hint5000 = computeWayfinderHint({
        maze: highState.maze,
        playerCell: highState.playerPos,
        keycards: highState.keycards,
        objectivesEnabled: highState.objectivesEnabled,
        isExitLocked: highState.isExitLocked,
      })
      assert.equal(hint5000.found, true)

      highState = gameReducer(highState, createAdvanceLevelAction(highState))
      assert.equal(highState.currentLevel, 5001)
      const exp5001 = createExplorationState(highState.maze)
      assert.equal(exp5001.level, 5001)
      assert.equal(
        isCellDiscovered(exp5001, highState.maze.exit.row, highState.maze.exit.col),
        false
      )
    }
  )

  // -------------------------------------------------------------------------
  // 17. Large mazes render without excessive overhead or errors
  // -------------------------------------------------------------------------
  await runCase(
    17,
    'Large mazes (Level 5000+) render efficiently with bounded discovery scans',
    () => {
      const largeMaze = generateMaze({ level: 5000, seed: 808080, baseSeed: 808080 })
      const exploration = createExplorationState(largeMaze)
      const canvas = createSpyCanvas()
      syncMinimapCanvasResolution(canvas, MINIMAP_LOGICAL_SIZE, 2)

      const startMs = performance.now()
      for (let i = 0; i < 60; i += 1) {
        renderMinimapCanvas(canvas, {
          maze: largeMaze,
          exploration,
          playerCell: largeMaze.start,
          yaw: (i * 0.1) % (Math.PI * 2),
          items: largeMaze.collectibles.items,
          keycards: largeMaze.keycards,
          hazards: largeMaze.hazards,
          objectivesEnabled: true,
          isExitLocked: true,
          logicalSize: MINIMAP_LOGICAL_SIZE,
          dpr: 2,
        })
      }
      const elapsedMs = performance.now() - startMs
      assert.ok(
        elapsedMs < 500,
        `60 frames on Level 5000 (${largeMaze.rows}x${largeMaze.cols}) rendered in ${elapsedMs.toFixed(1)}ms`
      )
      assert.ok(exploration.maxRow >= exploration.minRow)
      assert.ok(exploration.maxCol >= exploration.minCol)
    }
  )

  // -------------------------------------------------------------------------
  // 18. Responsive desktop/mobile layout & safe area rules
  // -------------------------------------------------------------------------
  await runCase(
    18,
    'Responsive desktop/tablet/mobile portrait/landscape minimap & touch CSS rules verified',
    () => {
      const css = fs.readFileSync(MAZE_CSS_PATH, 'utf8')
      assert.ok(css.includes('.maze-minimap {'))
      assert.ok(css.includes('env(safe-area-inset-left, 0px)'))
      assert.ok(css.includes('env(safe-area-inset-bottom, 0px)'))
      assert.ok(css.includes('.maze-touch-btn--wayfinder'))
      assert.ok(css.includes('width: 160px;'))
      assert.ok(css.includes('width: 140px;'))
      assert.ok(css.includes('width: 120px;'))
      assert.ok(css.includes('width: 112px;'))
      assert.ok(css.includes('.maze-viewport-3d[data-touch-controls-visible=\'true\'] .maze-minimap'))
    }
  )

  // -------------------------------------------------------------------------
  // 19-22. Mounted React Integration: Minimap3D + MazeViewport3D + Controls + Cleanup
  // -------------------------------------------------------------------------
  await runCase(
    19,
    'Mounted React integration: Minimap3D, Wayfinder H/touch trigger, arrival lock, abilities, progression & leak-free unmount',
    async () => {
      const domEnv = createMiniDomEnv()
      const uninstallDom = domEnv.install()
      const viteServer = await createServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
        logLevel: 'silent',
      })

      try {
        const { default: Minimap3D } = await viteServer.ssrLoadModule(
          '/src/components/game/Minimap3D.jsx'
        )
        const { default: TouchControls3D } = await viteServer.ssrLoadModule(
          '/src/components/game/TouchControls3D.jsx'
        )
        const { default: MazeViewport3D } = await viteServer.ssrLoadModule(
          '/src/components/game/MazeViewport3D.jsx'
        )

        const host = domEnv.document.createElement('div')
        domEnv.document.body.appendChild(host)
        const root = createRoot(host)

        // Part A: Mount Minimap3D across Level 1 -> Movement -> Keycard Collection -> Unlocked Exit -> Replay -> Level 5000 -> Level 5001
        let state = createInitialGameState(101010, {
          level: 1,
          baseSeed: 101010,
          objectivesEnabled: true,
        })
        const minimapRef = { current: null }

        await act(async () => {
          root.render(
            createElement(Minimap3D, {
              ref: minimapRef,
              maze: state.maze,
              runId: state.runId,
              currentLevel: state.currentLevel,
              playerCell: state.playerPos,
              items: state.items,
              keycards: state.keycards,
              echoPath: state.echoPath,
              activeEffects: state.activeEffects,
              hazards: state.maze.hazards,
              objectivesEnabled: state.objectivesEnabled,
              isExitLocked: state.isExitLocked,
              controlsEnabled: true,
              wayfinderEnabled: true,
            })
          )
        })

        let minimapEl = host.querySelector('[data-testid="maze-minimap"]')
        assert.ok(minimapEl, 'Minimap3D mounted')
        assert.equal(minimapEl.getAttribute('data-minimap-level'), '1')
        assert.equal(minimapEl.getAttribute('role'), 'region')
        assert.equal(
          minimapEl.getAttribute('aria-label'),
          'Level 1 tactical minimap'
        )
        const canvasEl = minimapEl.querySelector('.maze-minimap__canvas')
        assert.equal(canvasEl.getAttribute('role'), 'img')
        assert.equal(canvasEl.width, MINIMAP_LOGICAL_SIZE * 2) // HiDPI DPR capped at 2

        const initialSnap = minimapRef.current.getSnapshot()
        assert.equal(initialSnap.start.row, state.maze.start.row)
        assert.equal(initialSnap.exit, null)

        // Trigger wayfinder hint via imperative ref & verify banner accessibility + target priority
        await act(async () => {
          minimapRef.current.triggerHint()
        })
        let banner = host.querySelector('.maze-minimap__hint-banner')
        assert.ok(banner, 'Wayfinder hint banner rendered')
        assert.equal(banner.getAttribute('role'), 'status')
        assert.equal(banner.getAttribute('aria-live'), 'polite')
        if (state.keycards.length > 0) {
          assert.equal(banner.getAttribute('data-wayfinder-target'), 'keycard')
        }

        // Sync frame movement & yaw rotation without triggering React rerenders
        const path = findShortestPath(
          state.maze.grid,
          state.maze.start,
          state.maze.exit
        ).path
        const movedCell = path[Math.min(3, path.length - 1)]
        const movedWorld = gridToWorld(movedCell.row, movedCell.col, state.maze)
        const prevChildren = host.childNodes.length

        await act(async () => {
          minimapRef.current.syncFrame({
            playerGridCell: movedCell,
            playerWorldPos: movedWorld,
            yaw: -Math.PI / 2,
          })
        })
        assert.equal(host.childNodes.length, prevChildren)
        const movedSnap = minimapRef.current.getSnapshot()
        assert.equal(movedSnap.player.row, movedCell.row)
        assert.equal(movedSnap.player.col, movedCell.col)
        assert.ok(Math.abs(movedSnap.player.headingX - 1) < 1e-5)

        // Collect all keycards -> Wayfinder target automatically switches to Exit
        for (const kc of [...state.keycards]) {
          state = gameReducer(state, {
            type: 'SYNC_PLAYER_CELL',
            row: kc.row,
            col: kc.col,
          })
        }
        await act(async () => {
          root.render(
            createElement(Minimap3D, {
              ref: minimapRef,
              maze: state.maze,
              runId: state.runId,
              currentLevel: state.currentLevel,
              playerCell: state.playerPos,
              items: state.items,
              keycards: state.keycards,
              echoPath: state.echoPath,
              activeEffects: state.activeEffects,
              hazards: state.maze.hazards,
              objectivesEnabled: state.objectivesEnabled,
              isExitLocked: state.isExitLocked,
              controlsEnabled: true,
              wayfinderEnabled: true,
            })
          )
        })
        minimapEl = host.querySelector('[data-testid="maze-minimap"]')
        assert.equal(minimapEl.getAttribute('data-wayfinder-target-type'), 'exit')

        // Echo Reveal active reveals shortest path to exit on minimap
        await act(async () => {
          root.render(
            createElement(Minimap3D, {
              ref: minimapRef,
              maze: state.maze,
              runId: state.runId,
              currentLevel: state.currentLevel,
              playerCell: state.playerPos,
              items: state.items,
              keycards: state.keycards,
              echoPath: path,
              activeEffects: {
                ...state.activeEffects,
                echoRevealRemainingMs: 4000,
              },
              echoRevealActive: true,
              hazards: state.maze.hazards,
              objectivesEnabled: state.objectivesEnabled,
              isExitLocked: state.isExitLocked,
              controlsEnabled: true,
              wayfinderEnabled: true,
            })
          )
        })
        const echoSnap = minimapRef.current.getSnapshot()
        assert.ok(echoSnap.exit, 'Echo Reveal exposes exit along echoPath on minimap')

        // Next Level (Level 1 -> Level 2) resets exploration cleanly
        const nextAction = createAdvanceLevelAction(state)
        state = gameReducer(state, nextAction)
        await act(async () => {
          root.render(
            createElement(Minimap3D, {
              ref: minimapRef,
              maze: state.maze,
              runId: state.runId,
              currentLevel: state.currentLevel,
              playerCell: state.playerPos,
              items: state.items,
              keycards: state.keycards,
              echoPath: state.echoPath,
              activeEffects: state.activeEffects,
              hazards: state.maze.hazards,
              objectivesEnabled: state.objectivesEnabled,
              isExitLocked: state.isExitLocked,
              controlsEnabled: true,
              wayfinderEnabled: true,
            })
          )
        })
        assert.equal(
          host.querySelector('[data-testid="maze-minimap"]').getAttribute('data-minimap-level'),
          '2'
        )
        assert.equal(
          minimapRef.current.getSnapshot().exit,
          null,
          'Advancing to Level 2 clears Level 1 exit discovery'
        )
        assert.equal(
          host.querySelector('.maze-minimap__hint-banner'),
          null,
          'Advancing level clears previous hint banner'
        )

        // Arrival lock blocks Wayfinder trigger in TouchControls3D
        let touchWayfinderCount = 0
        await act(async () => {
          root.render(
            createElement(TouchControls3D, {
              enabled: false,
              mode: 'always',
              wayfinderEnabled: true,
              onTriggerWayfinder: () => {
                touchWayfinderCount += 1
              },
            })
          )
        })
        const disabledGuideBtn = host.querySelector('[data-touch-action="wayfinder"]')
        assert.ok(disabledGuideBtn, 'Wayfinder touch button renders when enabled')
        assert.equal(disabledGuideBtn.disabled, true, 'Disabled when arrival-locked/paused')
        await act(async () => {
          disabledGuideBtn.click()
        })
        assert.equal(touchWayfinderCount, 0)

        await act(async () => {
          root.render(
            createElement(TouchControls3D, {
              enabled: true,
              mode: 'always',
              wayfinderEnabled: true,
              onTriggerWayfinder: () => {
                touchWayfinderCount += 1
              },
            })
          )
        })
        const activeGuideBtn = host.querySelector('[data-touch-action="wayfinder"]')
        assert.equal(activeGuideBtn.disabled, false)
        assert.equal(activeGuideBtn.getAttribute('aria-label'), 'Wayfinder Beacon (H)')
        await act(async () => {
          activeGuideBtn.click()
        })
        assert.equal(touchWayfinderCount, 1)

        // Part B: Mount full MazeViewport3D (checks arrival lock vs interactive H key, HUD preservation & clean unmount)
        const viewportState = createInitialGameState(303030, { level: 5000, baseSeed: 303030 })
        await act(async () => {
          root.render(
            createElement(MazeViewport3D, {
              maze: viewportState.maze,
              currentLevel: viewportState.currentLevel,
              score: 1250,
              cumulativeScore: 54000,
              runId: viewportState.runId,
              playerCell: viewportState.playerPos,
              items: viewportState.items,
              keycards: viewportState.keycards,
              keysCollected: viewportState.keysCollected,
              totalKeys: viewportState.totalKeys,
              isExitLocked: viewportState.isExitLocked,
              objectivesEnabled: viewportState.objectivesEnabled,
              echoPath: viewportState.echoPath,
              inventory: viewportState.inventory,
              activeEffects: viewportState.activeEffects,
              hasWon: false,
              controlsEnabled: true,
              isArrivalActive: true,
              arrivalPhase: 'elevator_arrival',
              health: 100,
              maxHealth: 100,
              isGameOver: false,
            })
          )
        })

        // Verify HUD elements remain intact and level 5000 minimap is synced
        assert.ok(host.querySelector('.maze-vitals-hud'))
        assert.ok(host.querySelector('[data-testid="maze-level-hud"]'))
        assert.ok(host.querySelector('[data-testid="maze-score-hud"]'))
        const vpMinimap = host.querySelector('[data-testid="maze-minimap"]')
        assert.ok(vpMinimap)
        assert.equal(vpMinimap.getAttribute('data-minimap-level'), '5000')

        // Pressing H during arrival lock must NOT trigger wayfinder banner
        await act(async () => {
          domEnv.window.dispatchEvent({ type: 'keydown', key: 'h', repeat: false })
        })
        assert.equal(host.querySelector('[data-wayfinder-hint]'), null)

        // Unlock arrival -> pressing H triggers wayfinder banner
        await act(async () => {
          root.render(
            createElement(MazeViewport3D, {
              maze: viewportState.maze,
              currentLevel: viewportState.currentLevel,
              score: 1250,
              cumulativeScore: 54000,
              runId: viewportState.runId,
              playerCell: viewportState.playerPos,
              items: viewportState.items,
              keycards: viewportState.keycards,
              keysCollected: viewportState.keysCollected,
              totalKeys: viewportState.totalKeys,
              isExitLocked: viewportState.isExitLocked,
              objectivesEnabled: viewportState.objectivesEnabled,
              echoPath: viewportState.echoPath,
              inventory: viewportState.inventory,
              activeEffects: viewportState.activeEffects,
              hasWon: false,
              controlsEnabled: true,
              isArrivalActive: false,
              health: 100,
              maxHealth: 100,
              isGameOver: false,
            })
          )
        })
        await act(async () => {
          domEnv.window.dispatchEvent({ type: 'keydown', key: 'h', repeat: false })
        })
        assert.ok(
          host.querySelector('[data-wayfinder-hint]'),
          'Pressing H when interactive triggers Wayfinder hint banner on Level 5000'
        )

        // Cleanup/Unmount verifies zero leaked window/document listeners
        await act(async () => {
          root.unmount()
        })
        assert.equal(host.childNodes.length, 0)
        const resizeListeners = domEnv.windowListeners.get('resize')?.size || 0
        const keydownListeners = domEnv.windowListeners.get('keydown')?.size || 0
        assert.equal(resizeListeners, 0, 'Resize listeners cleaned up on unmount')
        assert.equal(keydownListeners, 0, 'Keydown listeners cleaned up on unmount')
      } finally {
        await viteServer.close()
        uninstallDom()
      }
    }
  )

  console.log(`=== MAZE-MAP-001 Test Summary: ${passedCount} passed, ${failedCount} failed ===`)
}

runTests().catch((err) => {
  console.error(err)
  process.exit(1)
})
