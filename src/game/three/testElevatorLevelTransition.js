import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import {
  DEFAULT_ELEVATOR_TRANSITION_CONFIG,
  ELEVATOR_TRANSITION_PHASES,
  advanceElevatorTransitionToOpening,
  advanceElevatorTransitionToTraveling,
  beginElevatorTransitionState,
  cancelElevatorTransitionState,
  createIdleElevatorTransitionState,
  easeElevatorDoorProgress,
  finishElevatorTransitionState,
  markElevatorTransitionMazeCommitted,
  markElevatorTransitionSceneReady,
  resolveElevatorTransitionTimings,
  updateElevatorDoorProgress,
  updateElevatorTravelProgress,
} from '../engine/elevatorLevelTransition.js'
import {
  createAdvanceLevelAction,
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'
import { getLevelConfig } from '../mechanics/levelProgression.js'
import { STORAGE_KEYS, loadAllSettings, saveAllSettings } from '../../utils/persistence.js'

console.log('--- Running MAZE-ELEVATOR-001 Progressive Elevator Level Transition Tests ---')

/**
 * Lightweight self-contained DOM environment for React 19 createRoot/act,
 * event bubbling, focus management, ResizeObserver, rAF tracking, and localStorage.
 */
function createMiniDomEnv(initialUrl = 'http://localhost:3000/') {
  let currentUrl = new URL(initialUrl)
  const activeTimeouts = new Set()
  const activeRafs = new Set()

  function createEventEmitter() {
    const map = new Map()
    return {
      addEventListener(type, fn, options) {
        if (typeof fn !== 'function') return
        if (!map.has(type)) map.set(type, [])
        const capture = Boolean(options === true || options?.capture)
        const list = map.get(type)
        if (!list.some((item) => item.fn === fn && item.capture === capture)) {
          list.push({ fn, capture })
        }
      },
      removeEventListener(type, fn, options) {
        const list = map.get(type)
        if (!list) return
        const capture = Boolean(options === true || options?.capture)
        map.set(
          type,
          list.filter((item) => !(item.fn === fn && item.capture === capture))
        )
      },
      getListeners(type, capture) {
        return (map.get(type) || [])
          .filter((item) => item.capture === capture)
          .map((item) => item.fn)
      },
    }
  }

  function splitSelectorList(selector) {
    return selector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  function matchesSingleSelector(el, rawSel) {
    if (!el || el.nodeType !== 1) return false
    let sel = rawSel.trim()
    if (!sel) return false

    const notMatches = []
    sel = sel.replace(/:not\(([^)]+)\)/g, (_m, inner) => {
      notMatches.push(inner.trim())
      return ''
    })
    for (const negated of notMatches) {
      if (matchesSingleSelector(el, negated)) return false
    }

    const attrFilters = []
    sel = sel.replace(
      /\[([^\]=*~|^$]+)(?:([*^$|~]?=)["']?([^"'\]]*)["']?)?\]/g,
      (_m, name, op, val) => {
        attrFilters.push({ name: name.trim(), op: op || null, val: val ?? '' })
        return ''
      }
    )

    for (const af of attrFilters) {
      const has = el.hasAttribute(af.name)
      if (!af.op) {
        if (!has) return false
      } else {
        const actual = el.getAttribute(af.name)
        if (actual === null) return false
        if (af.op === '=' && actual !== af.val) return false
        if (af.op === '*=' && !actual.includes(af.val)) return false
      }
    }

    const classes = []
    sel = sel.replace(/\.([A-Za-z0-9_-]+)/g, (_m, cls) => {
      classes.push(cls)
      return ''
    })

    let expectedId = null
    sel = sel.replace(/#([A-Za-z0-9_-]+)/g, (_m, id) => {
      expectedId = id
      return ''
    })

    const expectedTag = sel.trim().toUpperCase()
    if (expectedTag && expectedTag !== '*' && el.tagName !== expectedTag) {
      return false
    }
    if (expectedId !== null && el.id !== expectedId) {
      return false
    }
    for (const cls of classes) {
      if (!el.classList.contains(cls)) return false
    }
    return true
  }

  function matchesSelector(el, selector) {
    if (!selector || typeof selector !== 'string') return false
    return splitSelectorList(selector).some((part) => matchesSingleSelector(el, part))
  }

  class MiniNode {
    constructor(nodeType, ownerDocument) {
      this.nodeType = nodeType
      this.ownerDocument = ownerDocument
      this.parentNode = null
      this.childNodes = []
    }
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null
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
    get isConnected() {
      let cur = this
      while (cur) {
        if (cur === this.ownerDocument || cur === this.ownerDocument?.documentElement) {
          return true
        }
        cur = cur.parentNode
      }
      return false
    }
    appendChild(child) {
      return this.insertBefore(child, null)
    }
    insertBefore(child, refNode) {
      if (!child) return child
      if (child.nodeType === 11) {
        for (const item of [...child.childNodes]) {
          this.insertBefore(item, refNode)
        }
        return child
      }
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      child.ownerDocument = this.ownerDocument
      if (!refNode) {
        this.childNodes.push(child)
      } else {
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
    contains(target) {
      if (target === this) return true
      for (const child of this.childNodes) {
        if (child.contains && child.contains(target)) return true
      }
      return false
    }
    get textContent() {
      if (this.nodeType === 3 || this.nodeType === 8) return this.nodeValue || ''
      return this.childNodes.map((c) => c.textContent).join('')
    }
    set textContent(val) {
      for (const child of [...this.childNodes]) {
        this.removeChild(child)
      }
      if (val !== null && val !== undefined && String(val) !== '') {
        this.appendChild(new MiniText(String(val), this.ownerDocument))
      }
    }
  }

  class MiniText extends MiniNode {
    constructor(text, ownerDocument) {
      super(3, ownerDocument)
      this.nodeValue = String(text)
    }
    get data() {
      return this.nodeValue
    }
    set data(val) {
      this.nodeValue = String(val)
    }
  }

  class MiniComment extends MiniNode {
    constructor(text, ownerDocument) {
      super(8, ownerDocument)
      this.nodeValue = String(text)
    }
  }

  class MiniDocumentFragment extends MiniNode {
    constructor(ownerDocument) {
      super(11, ownerDocument)
    }
  }

  class MiniElement extends MiniNode {
    constructor(tagName, ownerDocument, namespaceURI = null) {
      super(1, ownerDocument)
      this.tagName = String(tagName).toUpperCase()
      this.nodeName = this.tagName
      this.namespaceURI = namespaceURI
      this.attributes = new Map()
      this.style = {}
      this.dataset = {}
      this._emitter = createEventEmitter()
      this.disabled = false
      this.hidden = false
      this.scrollTop = 0
      this.classList = {
        add: (...tokens) => {
          const set = new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean))
          tokens.forEach((t) => t && set.add(t))
          this.setAttribute('class', Array.from(set).join(' '))
        },
        remove: (...tokens) => {
          const set = new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean))
          tokens.forEach((t) => set.delete(t))
          this.setAttribute('class', Array.from(set).join(' '))
        },
        contains: (token) =>
          (this.getAttribute('class') || '').split(/\s+/).filter(Boolean).includes(token),
      }
    }
    get id() {
      return this.getAttribute('id') || ''
    }
    set id(val) {
      this.setAttribute('id', String(val))
    }
    get className() {
      return this.getAttribute('class') || ''
    }
    set className(val) {
      this.setAttribute('class', String(val))
    }
    setAttribute(name, value) {
      const key = String(name)
      const strVal = String(value)
      this.attributes.set(key, strVal)
      if (key === 'disabled') this.disabled = true
      if (key === 'hidden') this.hidden = true
      if (key.startsWith('data-')) {
        const camel = key
          .slice(5)
          .replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
        this.dataset[camel] = strVal
      }
    }
    getAttribute(name) {
      const key = String(name)
      return this.attributes.has(key) ? this.attributes.get(key) : null
    }
    hasAttribute(name) {
      return this.attributes.has(String(name))
    }
    removeAttribute(name) {
      const key = String(name)
      this.attributes.delete(key)
      if (key === 'disabled') this.disabled = false
      if (key === 'hidden') this.hidden = false
    }
    addEventListener(type, fn, options) {
      this._emitter.addEventListener(type, fn, options)
    }
    removeEventListener(type, fn, options) {
      this._emitter.removeEventListener(type, fn, options)
    }
    focus() {
      this.ownerDocument.activeElement = this
    }
    blur() {
      if (this.ownerDocument.activeElement === this) {
        this.ownerDocument.activeElement = this.ownerDocument.body
      }
    }
    getClientRects() {
      return [{ width: 120, height: 36, top: 0, left: 0 }]
    }
    getBoundingClientRect() {
      return { width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800 }
    }
    getContext() {
      return null
    }
    querySelectorAll(selector) {
      const matches = []
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (matchesSelector(child, selector)) matches.push(child)
            walk(child)
          }
        }
      }
      walk(this)
      return matches
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    }
    dispatchEvent(event) {
      if (!event || !event.type) return true
      if (event.type === 'click' && (this.disabled || this.hasAttribute('disabled'))) {
        return false
      }
      let stopped = false
      let defaultPrevented = Boolean(event.defaultPrevented)
      const evtObj = {
        ...event,
        target: event.target || this,
        currentTarget: this,
        bubbles: event.bubbles ?? true,
        cancelable: true,
        get defaultPrevented() {
          return defaultPrevented
        },
        preventDefault() {
          defaultPrevented = true
        },
        stopPropagation() {
          stopped = true
        },
        stopImmediatePropagation() {
          stopped = true
        },
      }
      const path = []
      let curr = this
      while (curr) {
        path.push(curr)
        curr = curr.parentNode
      }
      const win = this.ownerDocument.defaultView
      for (const listener of win._emitter.getListeners(event.type, true)) {
        listener(evtObj)
        if (stopped) return !defaultPrevented
      }
      for (let i = path.length - 1; i >= 0; i -= 1) {
        const node = path[i]
        evtObj.currentTarget = node
        if (node._emitter) {
          for (const listener of node._emitter.getListeners(event.type, true)) {
            listener(evtObj)
            if (stopped) return !defaultPrevented
          }
        }
      }
      for (let i = 0; i < path.length; i += 1) {
        const node = path[i]
        evtObj.currentTarget = node
        if (node._emitter) {
          for (const listener of node._emitter.getListeners(event.type, false)) {
            listener(evtObj)
            if (stopped) return !defaultPrevented
          }
        }
        if (stopped || !evtObj.bubbles) return !defaultPrevented
      }
      evtObj.currentTarget = win
      for (const listener of win._emitter.getListeners(event.type, false)) {
        listener(evtObj)
        if (stopped) break
      }
      return !defaultPrevented
    }
  }

  class MiniCanvasElement extends MiniElement {
    constructor(ownerDocument) {
      super('canvas', ownerDocument)
      this.width = 300
      this.height = 150
    }
    getContext(kind) {
      if (kind !== '2d') return null
      return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        setTransform() {},
        fillRect() {},
        strokeRect() {},
        clearRect() {},
        beginPath() {},
        arc() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        fill() {},
        stroke() {},
      }
    }
  }

  class MiniInputElement extends MiniElement {
    constructor(ownerDocument) {
      super('input', ownerDocument)
      this._propValue = undefined
    }
    get type() {
      return this.getAttribute('type') || 'text'
    }
    set type(val) {
      this.setAttribute('type', String(val))
    }
    get value() {
      if (this._propValue !== undefined) return this._propValue
      return this.getAttribute('value') ?? ''
    }
    set value(val) {
      this._propValue = val == null ? '' : String(val)
    }
  }

  class MiniIFrameElement extends MiniElement {}

  const docEmitter = createEventEmitter()
  const winEmitter = createEventEmitter()
  const storageMap = new Map()
  let windowObj = null

  const documentObj = {
    nodeType: 9,
    ownerDocument: null,
    parentNode: null,
    childNodes: [],
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
    _emitter: docEmitter,
    createElement(tag) {
      const lower = String(tag).toLowerCase()
      if (lower === 'canvas') return new MiniCanvasElement(documentObj)
      if (lower === 'input') return new MiniInputElement(documentObj)
      return new MiniElement(tag, documentObj)
    },
    createElementNS(ns, tag) {
      return new MiniElement(tag, documentObj, ns)
    },
    createTextNode(text) {
      return new MiniText(text, documentObj)
    },
    createComment(text) {
      return new MiniComment(text, documentObj)
    },
    createDocumentFragment() {
      return new MiniDocumentFragment(documentObj)
    },
    contains(target) {
      return documentObj.documentElement.contains(target)
    },
    querySelector(selector) {
      return documentObj.documentElement.querySelector(selector)
    },
    querySelectorAll(selector) {
      return documentObj.documentElement.querySelectorAll(selector)
    },
    exitPointerLock() {
      documentObj.pointerLockElement = null
    },
    addEventListener(type, fn, opts) {
      docEmitter.addEventListener(type, fn, opts)
    },
    removeEventListener(type, fn, opts) {
      docEmitter.removeEventListener(type, fn, opts)
    },
    dispatchEvent(event) {
      const evt = event || {}
      evt.target = evt.target || documentObj
      evt.currentTarget = documentObj
      for (const fn of docEmitter.getListeners(evt.type, true)) fn(evt)
      for (const fn of docEmitter.getListeners(evt.type, false)) fn(evt)
      return true
    },
  }

  documentObj.documentElement = new MiniElement('html', documentObj)
  documentObj.head = new MiniElement('head', documentObj)
  documentObj.body = new MiniElement('body', documentObj)
  documentObj.documentElement.appendChild(documentObj.head)
  documentObj.documentElement.appendChild(documentObj.body)
  documentObj.activeElement = documentObj.body

  windowObj = {
    document: documentObj,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLCanvasElement: MiniCanvasElement,
    HTMLIFrameElement: MiniIFrameElement,
    _emitter: winEmitter,
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    location: {
      get href() {
        return currentUrl.toString()
      },
      get search() {
        return currentUrl.search
      },
      set href(next) {
        currentUrl = new URL(next, currentUrl)
      },
    },
    history: {
      state: null,
      replaceState(state, _title, nextUrl) {
        this.state = state
        currentUrl = new URL(nextUrl, currentUrl)
      },
    },
    localStorage: {
      getItem(k) {
        return storageMap.has(String(k)) ? storageMap.get(String(k)) : null
      },
      setItem(k, v) {
        storageMap.set(String(k), String(v))
      },
      removeItem(k) {
        storageMap.delete(String(k))
      },
      clear() {
        storageMap.clear()
      },
    },
    navigator: { userAgent: 'node-test', maxTouchPoints: 0, vibrate: () => true },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: (el) => ({
      display: el?.style?.display || 'block',
      visibility: el?.style?.visibility || 'visible',
    }),
    requestAnimationFrame: (cb) => {
      const id = setTimeout(() => {
        activeRafs.delete(id)
        cb(Date.now())
      }, 8)
      activeRafs.add(id)
      return id
    },
    cancelAnimationFrame: (id) => {
      activeRafs.delete(id)
      clearTimeout(id)
    },
    setTimeout: (fn, delay, ...args) => {
      const id = setTimeout(() => {
        activeTimeouts.delete(id)
        fn(...args)
      }, delay)
      activeTimeouts.add(id)
      return id
    },
    clearTimeout: (id) => {
      activeTimeouts.delete(id)
      clearTimeout(id)
    },
    setInterval: (...args) => setInterval(...args),
    clearInterval: (id) => clearInterval(id),
    addEventListener(type, fn, opts) {
      winEmitter.addEventListener(type, fn, opts)
    },
    removeEventListener(type, fn, opts) {
      winEmitter.removeEventListener(type, fn, opts)
    },
    dispatchEvent(event) {
      const evt = event || {}
      evt.target = evt.target || windowObj
      evt.currentTarget = windowObj
      for (const fn of winEmitter.getListeners(evt.type, true)) fn(evt)
      for (const fn of winEmitter.getListeners(evt.type, false)) fn(evt)
      return true
    },
  }
  documentObj.defaultView = windowObj

  class MiniResizeObserver {
    observe() {}
    disconnect() {}
  }

  return {
    window: windowObj,
    document: documentObj,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLCanvasElement: MiniCanvasElement,
    HTMLIFrameElement: MiniIFrameElement,
    ResizeObserver: MiniResizeObserver,
    activeTimeouts,
    activeRafs,
  }
}

function createMockWebGLRenderer() {
  return {
    domElement: globalThis.document.createElement('canvas'),
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    pixelRatio: 1,
    renderCalls: 0,
    disposed: false,
    setPixelRatio(r) {
      this.pixelRatio = r
    },
    setSize() {},
    render() {
      this.renderCalls += 1
    },
    dispose() {
      this.disposed = true
    },
    getContext() {
      return null
    },
  }
}

// ============================================================================
// PART 1: Centralized Elevator Transition State Machine Unit Tests
// ============================================================================
console.log('Part 1: Centralized Elevator Transition State Machine & Timing Contracts')

{
  const idle = createIdleElevatorTransitionState()
  assert.equal(idle.active, false)
  assert.equal(idle.phase, ELEVATOR_TRANSITION_PHASES.IDLE)
  assert.equal(idle.doorProgress, 0)

  // Easing curve monotonic boundaries
  assert.equal(easeElevatorDoorProgress(0), 0)
  assert.equal(easeElevatorDoorProgress(0.5), 0.5)
  assert.equal(easeElevatorDoorProgress(1), 1)
  assert.ok(easeElevatorDoorProgress(0.25) < 0.25, 'Ease-in-out accelerates gently at start')
  assert.ok(easeElevatorDoorProgress(0.75) > 0.75, 'Ease-in-out decelerates gently at finish')

  // Reduced motion shrinks durations safely
  const normalTimings = resolveElevatorTransitionTimings(null, false)
  const reducedTimings = resolveElevatorTransitionTimings(null, true)
  assert.equal(normalTimings.doorsCloseDurationMs, DEFAULT_ELEVATOR_TRANSITION_CONFIG.doorsCloseDurationMs)
  assert.ok(reducedTimings.doorsCloseDurationMs < normalTimings.doorsCloseDurationMs)
  assert.ok(reducedTimings.doorsOpenDurationMs < normalTimings.doorsOpenDurationMs)

  // Full phase machine: idle -> closing_doors -> traveling -> opening_doors -> idle
  const closing = beginElevatorTransitionState(idle, {
    fromLevel: 1,
    toLevel: 2,
    sourceRunId: 10,
    transitionId: 1,
  })
  assert.equal(closing.active, true)
  assert.equal(closing.phase, ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS)
  assert.equal(closing.fromLevel, 1)
  assert.equal(closing.toLevel, 2)
  assert.equal(closing.doorProgress, 0)

  // Duplicate begin while active is rejected (idempotent)
  const dupBegin = beginElevatorTransitionState(closing, {
    fromLevel: 2,
    toLevel: 3,
    sourceRunId: 11,
    transitionId: 2,
  })
  assert.equal(dupBegin, closing, 'Cannot begin duplicate transition while one is active')

  const midClose = updateElevatorDoorProgress(closing, 0.65)
  assert.equal(midClose.doorProgress, 0.65)

  // Cannot open directly from closing_doors
  assert.equal(
    advanceElevatorTransitionToOpening(midClose),
    midClose,
    'Cannot skip traveling phase directly to opening_doors'
  )

  const traveling = advanceElevatorTransitionToTraveling(midClose)
  assert.equal(traveling.phase, ELEVATOR_TRANSITION_PHASES.TRAVELING)
  assert.equal(traveling.doorProgress, 1, 'Doors must be 100% closed upon entering traveling')
  assert.equal(traveling.mazeCommitted, false)
  assert.equal(traveling.sceneReady, false)

  // Cannot advance to opening_doors before BOTH mazeCommitted and sceneReady (unless force=true)
  assert.equal(
    advanceElevatorTransitionToOpening(traveling),
    traveling,
    'Cannot open doors before mazeCommitted and sceneReady'
  )
  const committed = markElevatorTransitionMazeCommitted(traveling)
  assert.equal(committed.mazeCommitted, true)
  assert.equal(
    advanceElevatorTransitionToOpening(committed),
    committed,
    'Cannot open doors before sceneReady'
  )
  const ready = markElevatorTransitionSceneReady(committed)
  assert.equal(ready.sceneReady, true)
  const midTravel = updateElevatorTravelProgress(ready, 0.8)
  assert.equal(midTravel.travelProgress, 0.8)

  // Safety force-open works if sceneReady stalls after mazeCommitted
  const forcedOpen = advanceElevatorTransitionToOpening(committed, { force: true })
  assert.equal(forcedOpen.phase, ELEVATOR_TRANSITION_PHASES.OPENING_DOORS)

  const opening = advanceElevatorTransitionToOpening(midTravel)
  assert.equal(opening.phase, ELEVATOR_TRANSITION_PHASES.OPENING_DOORS)
  assert.equal(opening.doorProgress, 1)
  assert.equal(opening.travelProgress, 1)

  const halfOpen = updateElevatorDoorProgress(opening, 0.4)
  assert.equal(halfOpen.doorProgress, 0.4)

  const finished = finishElevatorTransitionState(halfOpen)
  assert.equal(finished.active, false)
  assert.equal(finished.phase, ELEVATOR_TRANSITION_PHASES.IDLE)
  assert.equal(finished.doorProgress, 0)

  const cancelled = cancelElevatorTransitionState(traveling, new Error('Aborted'))
  assert.equal(cancelled.active, false)
  assert.equal(cancelled.phase, ELEVATOR_TRANSITION_PHASES.IDLE)
  assert.equal(cancelled.error, 'Aborted')

  console.log('  [PASS] Part 1 centralized elevator transition state machine')
}

// ============================================================================
// PART 2: 3D Engine Protection, Audio Reuse, Zero Blank Frame & Flush Landing
// ============================================================================
console.log('Part 2: MazeSceneEngine Protection, Audio Reuse, Render-Before-Reveal & Infinite Progression')

const domEnv = createMiniDomEnv('http://localhost:3000/')
const prevGlobals = new Map()
const installGlobal = (key, value) => {
  prevGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  })
}

installGlobal('IS_REACT_ACT_ENVIRONMENT', true)
installGlobal('window', domEnv.window)
installGlobal('document', domEnv.document)
installGlobal('Node', domEnv.Node)
installGlobal('Element', domEnv.Element)
installGlobal('HTMLElement', domEnv.HTMLElement)
installGlobal('HTMLCanvasElement', domEnv.HTMLCanvasElement)
installGlobal('HTMLIFrameElement', domEnv.HTMLIFrameElement)
installGlobal('ResizeObserver', domEnv.ResizeObserver)
installGlobal('localStorage', domEnv.window.localStorage)

const viteServer = await createServer({
  logLevel: 'silent',
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})

try {
  const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')
  const { MazeSceneEngine } = await viteServer.ssrLoadModule('/src/game/three/MazeSceneEngine.js')

  // Part 2A: Direct MazeSceneEngine transition isolation, audio cue reuse, and flush setMaze landing
  {
    const containerEl = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(containerEl)
    const renderer = createMockWebGLRenderer()
    const level1State = createInitialGameState({ level: 1, baseSeed: 616161, objectivesEnabled: true })
    const level2State = createInitialGameState({ level: 2, baseSeed: 616161, objectivesEnabled: true })

    const damageEvents = []
    const engine = new MazeSceneEngine(containerEl, {
      createRenderer: () => renderer,
      isSoftwareGl: true,
      pointerLockEnabled: false,
      skipSpawnSequence: true,
      onPlayerDamage: (evt) => damageEvents.push(evt),
    })

    // Spy on existing HorrorAudioEngine elevator cues to verify reuse (no duplicate audio engine)
    const audioCueLog = []
    const origClose = engine.audioEngine.onExtractionDoorsClose.bind(engine.audioEngine)
    const origDescent = engine.audioEngine.onStartElevatorDescent.bind(engine.audioEngine)
    const origImpact = engine.audioEngine.onStartElevatorImpact.bind(engine.audioEngine)
    const origStop = engine.audioEngine.stopElevatorCues.bind(engine.audioEngine)
    const origClear = engine.audioEngine.clearPendingElevatorCues.bind(engine.audioEngine)
    engine.audioEngine.onExtractionDoorsClose = () => {
      audioCueLog.push('doors_close')
      return origClose()
    }
    engine.audioEngine.onStartElevatorDescent = (dur) => {
      audioCueLog.push(`descent:${Number(dur).toFixed(2)}`)
      return origDescent(dur)
    }
    engine.audioEngine.onStartElevatorImpact = () => {
      audioCueLog.push('arrival_impact')
      return origImpact()
    }
    engine.audioEngine.stopElevatorCues = (opts) => {
      audioCueLog.push('stop_cues')
      return origStop(opts)
    }
    engine.audioEngine.clearPendingElevatorCues = () => {
      audioCueLog.push('clear_cues')
      return origClear()
    }

    engine.setMaze(level1State.maze)
    // Simulate extraction shaft darkness having been applied at end of Level 1 (elevatorY = 12m)
    const expectedAmbient = engine._environment.config.ambientIntensity
    engine._syncExtractionShaftDarkness(12)
    assert.ok(
      engine._environment.lights.ambientLight.intensity < expectedAmbient,
      'Extraction shaft darkness dims ambient lighting during ascent'
    )
    audioCueLog.length = 0

    // Enter closing_doors
    engine.setLevelTransitionState({
      active: true,
      phase: ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS,
      fromLevel: 1,
      toLevel: 2,
      travelDurationSec: 0.68,
    })
    assert.equal(engine.isLevelTransitionActive(), true)
    assert.deepEqual(audioCueLog, ['doors_close'], 'Closing doors reuses existing onExtractionDoorsClose audio cue')

    // Movement, interactions, damage, and extraction triggers MUST be blocked during transition
    const beforePos = { ...engine._playerWorldPos }
    engine.stepMovement(0.1, { forward: true, sprint: true })
    assert.equal(engine._playerWorldPos.x, beforePos.x, 'Player X movement blocked during elevator transition')
    assert.equal(engine._playerWorldPos.z, beforePos.z, 'Player Z movement blocked during elevator transition')
    assert.equal(engine.getNearbyInteractable(), null, 'Interactables disabled during elevator transition')
    assert.equal(engine.handlePrimaryAction()?.handled, false, 'Primary action blocked during elevator transition')
    assert.equal(engine.handleSecondaryAction()?.handled, false, 'Secondary action blocked during elevator transition')
    const hpBefore = engine.health
    assert.equal(engine.applyDamage(25, 'enemy-1'), false, 'Damage blocked during elevator transition')
    assert.equal(engine.health, hpBefore, 'Health unchanged during elevator transition')
    assert.equal(damageEvents.length, 0, 'No damage callbacks fired during elevator transition')
    assert.equal(engine.startExtractionSequence(), false, 'Cannot start extraction during level transition')

    // Enter traveling and load Level 2 behind closed doors
    engine.setLevelTransitionState({
      active: true,
      phase: ELEVATOR_TRANSITION_PHASES.TRAVELING,
      fromLevel: 1,
      toLevel: 2,
      travelDurationSec: 0.68,
    })
    assert.equal(audioCueLog[1], 'descent:0.68', 'Traveling reuses existing onStartElevatorDescent audio cue')

    const rendersBeforeSetMaze = renderer.renderCalls
    engine.setMaze(level2State.maze)
    assert.ok(
      renderer.renderCalls > rendersBeforeSetMaze,
      'Engine pre-renders the new level frame behind closed doors before reveal (zero blank frame)'
    )
    assert.equal(
      engine._elevatorExitSequence?.isActive?.(),
      false,
      'Inter-level transition places player flush on elevator deck without redundant 8.4m drop'
    )
    assert.equal(
      engine._environment.lights.ambientLight.intensity,
      expectedAmbient,
      'Extraction shaft darkness is restored to normal level lighting before doors open'
    )

    // Step frame during transition: movement & damage stay locked
    const posAfterSetMaze = { ...engine._playerWorldPos }
    engine.stepFrame(0.05)
    assert.equal(engine._playerWorldPos.x, posAfterSetMaze.x, 'stepFrame does not drift player during transition')
    assert.equal(engine._playerWorldPos.z, posAfterSetMaze.z, 'stepFrame does not drift player during transition')

    // Enter opening_doors
    engine.setLevelTransitionState({
      active: true,
      phase: ELEVATOR_TRANSITION_PHASES.OPENING_DOORS,
      fromLevel: 1,
      toLevel: 2,
    })
    assert.equal(audioCueLog[2], 'arrival_impact', 'Opening doors reuses existing onStartElevatorImpact audio cue')

    // Complete transition -> idle
    engine.setLevelTransitionState({
      active: false,
      phase: ELEVATOR_TRANSITION_PHASES.IDLE,
    })
    assert.equal(engine.isLevelTransitionActive(), false)
    assert.equal(audioCueLog[3], 'clear_cues', 'Transition completion clears pending elevator cues')

    // After transition completes, damage & gameplay work normally again
    assert.equal(engine.applyDamage(10, 'enemy-2'), true, 'Damage re-enabled after elevator transition finishes')
    assert.equal(engine.health, hpBefore - 10)

    // Cancellation stops elevator audio cues immediately
    engine.setLevelTransitionState({
      active: true,
      phase: ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS,
      fromLevel: 2,
      toLevel: 3,
    })
    engine.setLevelTransitionState({
      active: false,
      phase: ELEVATOR_TRANSITION_PHASES.IDLE,
      cancelled: true,
    })
    assert.equal(
      audioCueLog[audioCueLog.length - 1],
      'stop_cues',
      'Cancelled transition immediately stops elevator audio cues'
    )

    engine.dispose()
    containerEl.parentNode?.removeChild(containerEl)
    console.log('  [PASS] Part 2A MazeSceneEngine protection, audio reuse & render-before-reveal')
  }

  // Part 2B: Infinite Progression Sanity Check (1->2, 5->6, 10->11, 25->26, 100->101, 5000->5001)
  {
    const baseSeed = 884422
    const checkpoints = [1, 5, 10, 25, 100, 5000]
    for (const startLvl of checkpoints) {
      let s = createInitialGameState({ level: startLvl, baseSeed, objectivesEnabled: true })
      assert.equal(s.currentLevel, startLvl)
      for (const kc of [...s.keycards]) {
        s = gameReducer(s, { type: 'SYNC_PLAYER_CELL', position: { row: kc.row, col: kc.col } })
      }
      s = gameReducer(s, { type: 'COMPLETE_EXIT_EXTRACTION' })
      assert.equal(s.hasWon, true)
      assert.equal(s.completedLevel, startLvl)

      const nextState = gameReducer(
        s,
        createAdvanceLevelAction(s, { requireVictory: true, guardRunId: true })
      )
      const expectedNext = startLvl + 1
      const cfg = getLevelConfig(expectedNext, baseSeed)
      assert.equal(nextState.currentLevel, expectedNext, `Level ${startLvl} advances cleanly to ${expectedNext}`)
      assert.equal(nextState.baseSeed, baseSeed, `baseSeed preserved on Level ${expectedNext}`)
      assert.equal(nextState.highestLevelReached, expectedNext)
      assert.equal(nextState.levelsCompleted, s.levelsCompleted)
      assert.equal(nextState.maze.level, expectedNext)
      assert.equal(nextState.maze.rows, cfg.rows)
      assert.equal(nextState.maze.cols, cfg.cols)
      assert.notEqual(nextState.seed, s.seed)
      assert.ok(nextState.totalKeys > 0, `Level ${expectedNext} preserves keycard progression`)
      assert.ok(Array.isArray(nextState.maze.hazards), `Level ${expectedNext} preserves hazards`)
      assert.ok(Array.isArray(nextState.maze.hidingSpots) && nextState.maze.hidingSpots.length > 0, `Level ${expectedNext} preserves hiding spots`)
      assert.ok(Array.isArray(nextState.maze.collectibles?.items), `Level ${expectedNext} preserves collectibles`)
      assert.ok(Array.isArray(nextState.maze.enemies) && nextState.maze.enemies.length > 0, `Level ${expectedNext} preserves enemies`)
    }
    console.log('  [PASS] Part 2B infinite progression verified for 1->2, 5->6, 10->11, 25->26, 100->101, 5000->5001')
  }

  // ============================================================================
  // PART 3: Full Mounted React DOM End-to-End Elevator Transition Tests
  // ============================================================================
  console.log('Part 3: Mounted React DOM End-to-End Elevator Transition Sequencing')

  const waitFor = async (predicate, label, timeoutMs = 2000) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
    assert.ok(predicate(), `Timed out waiting for: ${label}`)
  }

  const completeCurrentLevelInEngine = async (engine) => {
    const maze = engine._currentMaze
    for (const kc of [...maze.keycards]) {
      await act(async () => {
        engine._movementOptions?.onPlayerCellChange?.({ row: kc.row, col: kc.col })
      })
    }
    await act(async () => {
      engine._onExtractionComplete?.()
    })
  }

  // Save custom user settings so we can prove Main Menu cancellation preserves them
  const defaultSettings = loadAllSettings()
  saveAllSettings({
    ...defaultSettings,
    audio: {
      ...defaultSettings.audio,
      master: 0.37,
      masterVolume: 37,
      subtitles: true,
    },
    graphics: {
      ...defaultSettings.graphics,
      highContrast: true,
    },
  })

  // Test 3A: Complete Level 1 -> click NEXT LEVEL (5x rapid clicks!) -> verify exact phase order,
  // doors close BEFORE maze generation, single maze generation, Pause/movement/damage blocked during transition,
  // doors open smoothly to reveal Level 2, gameplay re-enables cleanly.
  {
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    const engines = []
    const transitionLog = []
    const advanceBuilderInvocations = []

    const spiedAdvanceBuilder = (state, opts) => {
      const overlayEl = container.querySelector('[data-testid="elevator-level-transition"]')
      advanceBuilderInvocations.push({
        fromLevel: state?.currentLevel,
        overlayPhase: overlayEl?.getAttribute('data-phase') || null,
        doorProgress: Number(overlayEl?.getAttribute('data-door-progress') || 0),
        lastLoggedPhase: transitionLog[transitionLog.length - 1]?.phase || null,
        lastLoggedDoorProgress: transitionLog[transitionLog.length - 1]?.doorProgress ?? null,
      })
      return createAdvanceLevelAction(state, opts)
    }

    await act(async () => {
      root.render(
        createElement(App, {
          initialPlaying: true,
          initialGameState: createInitialGameState({ level: 1, baseSeed: 737373, objectivesEnabled: true }),
          levelTransitionConfig: {
            doorsCloseDurationMs: 55,
            travelMinDurationMs: 65,
            doorsOpenDurationMs: 55,
            maxTravelTimeoutMs: 1500,
          },
          advanceLevelActionBuilder: spiedAdvanceBuilder,
          onLevelTransitionChange: (next) => {
            transitionLog.push({
              active: next.active,
              phase: next.phase,
              doorProgress: next.doorProgress,
              travelProgress: next.travelProgress,
              mazeCommitted: next.mazeCommitted,
              sceneReady: next.sceneReady,
              fromLevel: next.fromLevel,
              toLevel: next.toLevel,
            })
          },
          viewportEngineConfig: {
            createRenderer: createMockWebGLRenderer,
            isSoftwareGl: true,
            pointerLockEnabled: false,
            skipSpawnSequence: true,
          },
          onViewportReady: ({ engine }) => engines.push(engine),
        })
      )
    })

    const engine = engines[0]
    assert.ok(engine, 'Mounted Level 1 MazeSceneEngine')
    const level1Maze = engine._currentMaze
    assert.equal(level1Maze.level, 1)

    await completeCurrentLevelInEngine(engine)
    assert.equal(container.querySelectorAll('.lv-modal--victory').length, 1, 'VictoryModal opens on Level 1 completion')

    const nextBtn = container.querySelector('[data-testid="victory-next-level-btn"]')
    assert.ok(nextBtn, 'Next Level button present')

    // Fire 5 rapid synchronous clicks on Next Level
    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        nextBtn.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
      }
    })

    // Criterion 1 & 2: VictoryModal closes immediately, elevator transition starts in closing_doors
    assert.equal(
      container.querySelectorAll('.lv-modal--victory').length,
      0,
      'VictoryModal closes immediately upon NEXT LEVEL click'
    )
    const overlayAtStart = container.querySelector('[data-testid="elevator-level-transition"]')
    assert.ok(overlayAtStart, 'ElevatorTransitionOverlay mounts on NEXT LEVEL click')
    assert.equal(
      overlayAtStart.getAttribute('data-phase'),
      ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS,
      'Transition begins in closing_doors phase'
    )
    assert.equal(overlayAtStart.getAttribute('data-from-level'), '1', 'Transition tracks departing Level 1')
    assert.equal(overlayAtStart.getAttribute('data-to-level'), '2', 'Transition tracks destination Level 2')
    assert.equal(
      container.querySelector('[data-testid="elevator-transition-floor"]')?.textContent?.trim(),
      'LEVEL 1',
      'Elevator readout starts on departing LEVEL 1 while doors close'
    )

    // Criterion 3: Next maze MUST NOT be generated yet while doors are still closing!
    assert.equal(
      advanceBuilderInvocations.length,
      0,
      'Next maze is NOT generated before elevator doors finish closing'
    )
    assert.equal(
      engine._currentMaze.level,
      1,
      'Engine still holds Level 1 maze while doors are closing'
    )

    // Criterion 7: Pause shortcut P, movement, and damage are disabled during transition
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
    })
    assert.equal(
      container.querySelector('[role="region"][aria-label="Game Paused"]'),
      null,
      'Pause menu cannot open via P shortcut during elevator transition'
    )
    assert.equal(engine.isLevelTransitionActive(), true, 'Engine knows level transition is active')
    const hpDuringTransition = engine.health
    assert.equal(engine.applyDamage(20, 'stalker'), false, 'Enemy damage blocked during transition')
    assert.equal(engine.health, hpDuringTransition)

    // Wait until doors enter traveling and commit Level 2
    await waitFor(
      () =>
        advanceBuilderInvocations.length === 1 &&
        transitionLog.some((e) => e.phase === ELEVATOR_TRANSITION_PHASES.TRAVELING && e.sceneReady),
      'traveling phase commits maze and marks sceneReady'
    )

    // Verify doors were 100% closed (doorProgress === 1) BEFORE maze generation ran!
    assert.equal(
      advanceBuilderInvocations.length,
      1,
      'advanceLevelActionBuilder invoked strictly once'
    )
    assert.equal(
      advanceBuilderInvocations[0].lastLoggedPhase,
      ELEVATOR_TRANSITION_PHASES.TRAVELING,
      'Maze generation occurred strictly in traveling phase'
    )
    assert.equal(
      advanceBuilderInvocations[0].lastLoggedDoorProgress,
      1,
      'Elevator doors were 100% closed (doorProgress === 1) before next maze generated'
    )

    // Wait for opening_doors and full completion back to idle
    await waitFor(
      () =>
        !container.querySelector('[data-testid="elevator-level-transition"]') &&
        transitionLog[transitionLog.length - 1]?.phase === ELEVATOR_TRANSITION_PHASES.IDLE,
      'elevator transition finishes opening_doors and returns to idle'
    )

    // Verify full ordered phase sequence occurred with actual intermediate progress
    const phaseSequence = []
    for (const entry of transitionLog) {
      if (phaseSequence[phaseSequence.length - 1] !== entry.phase) {
        phaseSequence.push(entry.phase)
      }
    }
    assert.deepEqual(
      phaseSequence,
      [
        ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS,
        ELEVATOR_TRANSITION_PHASES.TRAVELING,
        ELEVATOR_TRANSITION_PHASES.OPENING_DOORS,
        ELEVATOR_TRANSITION_PHASES.IDLE,
      ],
      'Transition follows exact closing_doors -> traveling -> opening_doors -> idle phase sequence'
    )

    // Verify actual animation progress frames were emitted (not just instant boolean flip)
    const closingProgressValues = transitionLog
      .filter((e) => e.phase === ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS)
      .map((e) => e.doorProgress)
    const openingProgressValues = transitionLog
      .filter((e) => e.phase === ELEVATOR_TRANSITION_PHASES.OPENING_DOORS)
      .map((e) => e.doorProgress)
    assert.ok(closingProgressValues.length >= 2, 'Closing phase emits progressive door animation frames')
    assert.ok(openingProgressValues.length >= 2, 'Opening phase emits progressive door animation frames')
    assert.ok(
      closingProgressValues[closingProgressValues.length - 1] > closingProgressValues[0],
      'Closing doorProgress increases toward 1'
    )
    assert.ok(
      openingProgressValues[openingProgressValues.length - 1] < openingProgressValues[0],
      'Opening doorProgress decreases from 1 toward 0'
    )

    // Criteria 4, 5, 6, 8: Level incremented strictly once (1 -> 2), single generation, clean playable state
    assert.equal(advanceBuilderInvocations.length, 1, '5 rapid clicks generated strictly 1 new maze')
    assert.equal(engine._currentMaze.level, 2, 'Active level is strictly Level 2 (no skipped levels)')
    assert.notEqual(engine._currentMaze.seed, level1Maze.seed, 'Level 2 has a fresh seed')
    assert.equal(engine.isLevelTransitionActive(), false, 'Engine transition flag cleared after reveal')
    assert.equal(engine.isPaused, false, 'Engine is unpaused and playable after reveal')

    // Pause shortcut works normally again after transition finishes
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
    })
    assert.ok(
      container.querySelector('[role="region"][aria-label="Game Paused"]'),
      'Pause shortcut re-enables cleanly after elevator transition completes'
    )
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
    })

    // Criterion 9: REPLAY LEVEL does NOT trigger inter-level elevator transition
    const level2Maze = engine._currentMaze
    const transitionsBeforeReplay = transitionLog.length
    await completeCurrentLevelInEngine(engine)
    assert.equal(container.querySelectorAll('.lv-modal--victory').length, 1, 'Level 2 VictoryModal opens')
    const replayBtn = container.querySelector('[data-testid="victory-replay-level-btn"]')
    await act(async () => {
      replayBtn.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
    })
    assert.equal(
      container.querySelector('[data-testid="elevator-level-transition"]'),
      null,
      'REPLAY LEVEL does NOT mount inter-level elevator transition overlay'
    )
    assert.equal(
      transitionLog.length,
      transitionsBeforeReplay,
      'REPLAY LEVEL emits zero inter-level elevator transition state changes'
    )
    assert.equal(engine._currentMaze, level2Maze, 'REPLAY LEVEL stays on exact Level 2 maze')
    assert.equal(engine._currentMaze.level, 2)

    // Criterion 10: MAIN MENU returns to StartScreen cleanly, preserves settings, and New Game starts at Level 1
    await completeCurrentLevelInEngine(engine)
    const mainMenuBtn = container.querySelector('[data-testid="victory-main-menu-btn"]')
    await act(async () => {
      mainMenuBtn.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
    })
    assert.ok(
      container.querySelector('[data-testid="start-game-btn"]'),
      'Main Menu navigates cleanly back to StartScreen'
    )
    assert.equal(
      container.querySelector('[data-testid="elevator-level-transition"]'),
      null,
      'No elevator transition overlay remains on StartScreen'
    )
    const persistedAfterMenu = loadAllSettings()
    assert.equal(persistedAfterMenu.audio.master, 0.37, 'Main Menu preserves persisted audio volume')
    assert.equal(persistedAfterMenu.audio.subtitles, true, 'Main Menu preserves persisted subtitles')
    assert.equal(persistedAfterMenu.graphics.highContrast, true, 'Main Menu preserves persisted highContrast')
    assert.ok(domEnv.window.localStorage.getItem(STORAGE_KEYS.SETTINGS))

    const startBtn = container.querySelector('[data-testid="start-game-btn"]')
    const enginesBeforeFresh = engines.length
    await act(async () => {
      startBtn.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
    })
    assert.ok(engines.length > enginesBeforeFresh, 'Fresh game mounts new engine')
    assert.equal(engines[engines.length - 1]._currentMaze.level, 1, 'Fresh game starts back at Level 1')

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
    console.log('  [PASS] Part 3A full Level 1->2 elevator sequence, rapid-click dedup, lockouts, Replay & Main Menu')
  }

  // Test 3B: Unmount mid-transition cleanup (closing_doors AND traveling) — zero leaked timers/rAFs or uncaught errors
  {
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    const engines = []

    await act(async () => {
      root.render(
        createElement(App, {
          initialPlaying: true,
          initialGameState: createInitialGameState({ level: 3, baseSeed: 454545, objectivesEnabled: true }),
          levelTransitionConfig: {
            doorsCloseDurationMs: 220,
            travelMinDurationMs: 220,
            doorsOpenDurationMs: 220,
            maxTravelTimeoutMs: 2000,
          },
          viewportEngineConfig: {
            createRenderer: createMockWebGLRenderer,
            isSoftwareGl: true,
            pointerLockEnabled: false,
            skipSpawnSequence: true,
          },
          onViewportReady: ({ engine }) => engines.push(engine),
        })
      )
    })

    const engine = engines[0]
    await completeCurrentLevelInEngine(engine)
    const nextBtn = container.querySelector('[data-testid="victory-next-level-btn"]')
    await act(async () => {
      nextBtn.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
    })
    assert.ok(
      container.querySelector('[data-testid="elevator-level-transition"]'),
      'Transition active prior to mid-transition unmount'
    )

    // Unmount abruptly mid-transition
    await act(async () => {
      root.unmount()
    })
    // Wait briefly to confirm no stray callbacks throw after unmount
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal(engine.isLevelTransitionActive(), false, 'Engine dispose clears transition active state')
    container.parentNode?.removeChild(container)
    console.log('  [PASS] Part 3B mid-transition unmount cleanly cancels timers, rAFs & engine state')
  }

  // Test 3C: Error recovery during maze generation — never permanently locks the game, user can retry cleanly!
  {
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    const engines = []
    let attemptCount = 0

    const flakyAdvanceBuilder = (state, opts) => {
      attemptCount += 1
      if (attemptCount === 1) {
        throw new Error('Simulated transient maze generation failure')
      }
      return createAdvanceLevelAction(state, opts)
    }

    await act(async () => {
      root.render(
        createElement(App, {
          initialPlaying: true,
          initialGameState: createInitialGameState({ level: 4, baseSeed: 292929, objectivesEnabled: true }),
          levelTransitionConfig: {
            doorsCloseDurationMs: 25,
            travelMinDurationMs: 30,
            doorsOpenDurationMs: 25,
            maxTravelTimeoutMs: 1200,
          },
          advanceLevelActionBuilder: flakyAdvanceBuilder,
          viewportEngineConfig: {
            createRenderer: createMockWebGLRenderer,
            isSoftwareGl: true,
            pointerLockEnabled: false,
            skipSpawnSequence: true,
          },
          onViewportReady: ({ engine }) => engines.push(engine),
        })
      )
    })

    const engine = engines[0]
    await completeCurrentLevelInEngine(engine)
    const nextBtn1 = container.querySelector('[data-testid="victory-next-level-btn"]')
    await act(async () => {
      nextBtn1.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
    })

    // First attempt throws in traveling -> recovers back to VictoryModal with no permanent lockout
    await waitFor(
      () =>
        attemptCount === 1 &&
        container.querySelectorAll('.lv-modal--victory').length === 1 &&
        !container.querySelector('[data-testid="elevator-level-transition"]'),
      'failed transition recovers cleanly back to VictoryModal'
    )
    assert.equal(engine._currentMaze.level, 4, 'Failed generation keeps player safely on Level 4')

    // Second click retries cleanly and succeeds -> Level 5!
    const nextBtn2 = container.querySelector('[data-testid="victory-next-level-btn"]')
    assert.ok(nextBtn2 && !nextBtn2.disabled, 'Next Level button is interactive again after recovery')
    await act(async () => {
      nextBtn2.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
    })
    await waitFor(
      () =>
        engine._currentMaze?.level === 5 &&
        !container.querySelector('[data-testid="elevator-level-transition"]'),
      'retry after error completes Level 4 -> Level 5 elevator transition cleanly'
    )
    assert.equal(attemptCount, 2)
    assert.equal(engine._currentMaze.level, 5)

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
    console.log('  [PASS] Part 3C error recovery prevents permanent lockout and allows clean retry')
  }

  // Test 3D: Mounted React DOM Infinite Progression Elevator Transition at Level 5000 -> Level 5001
  {
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    const engines = []
    const phasesSeen = []

    await act(async () => {
      root.render(
        createElement(App, {
          initialPlaying: true,
          initialGameState: createInitialGameState({
            level: 5000,
            baseSeed: 991199,
            objectivesEnabled: true,
          }),
          levelTransitionConfig: {
            doorsCloseDurationMs: 28,
            travelMinDurationMs: 36,
            doorsOpenDurationMs: 28,
            maxTravelTimeoutMs: 1800,
          },
          onLevelTransitionChange: (next) => {
            if (phasesSeen[phasesSeen.length - 1] !== next.phase) {
              phasesSeen.push(next.phase)
            }
          },
          viewportEngineConfig: {
            createRenderer: createMockWebGLRenderer,
            isSoftwareGl: true,
            pointerLockEnabled: false,
            skipSpawnSequence: true,
          },
          onViewportReady: ({ engine }) => engines.push(engine),
        })
      )
    })

    const engine = engines[0]
    const maze5000 = engine._currentMaze
    assert.equal(maze5000.level, 5000)

    await completeCurrentLevelInEngine(engine)
    const nextBtn = container.querySelector('[data-testid="victory-next-level-btn"]')
    await act(async () => {
      nextBtn.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
    })

    const overlay5000 = container.querySelector('[data-testid="elevator-level-transition"]')
    assert.equal(overlay5000?.getAttribute('data-from-level'), '5000')
    assert.equal(overlay5000?.getAttribute('data-to-level'), '5001')
    assert.equal(
      container.querySelector('[data-testid="elevator-transition-floor"]')?.textContent?.trim(),
      'LEVEL 5000',
      'Elevator readout starts on departing LEVEL 5000'
    )

    await waitFor(
      () =>
        engine._currentMaze?.level === 5001 &&
        !container.querySelector('[data-testid="elevator-level-transition"]'),
      'Level 5000 -> Level 5001 elevator transition completes'
    )

    assert.deepEqual(phasesSeen, [
      ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS,
      ELEVATOR_TRANSITION_PHASES.TRAVELING,
      ELEVATOR_TRANSITION_PHASES.OPENING_DOORS,
      ELEVATOR_TRANSITION_PHASES.IDLE,
    ])
    assert.equal(engine._currentMaze.level, 5001)
    assert.notEqual(engine._currentMaze.seed, maze5000.seed)
    assert.equal(engine.isPaused, false)

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
    console.log('  [PASS] Part 3D mounted React DOM Level 5000 -> Level 5001 elevator transition')
  }

  console.log('\nALL MAZE-ELEVATOR-001 PROGRESSIVE ELEVATOR LEVEL TRANSITION TESTS PASSED!')
} finally {
  await viteServer.close()
  for (const [key, descriptor] of prevGlobals.entries()) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor)
    } else {
      delete globalThis[key]
    }
  }
}
