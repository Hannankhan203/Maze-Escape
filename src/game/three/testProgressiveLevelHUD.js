import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

import {
  formatHudLevelAriaLabel,
  formatHudLevelDisplay,
  formatHudLevelNumber,
  resolveAuthoritativeHudLevel,
} from '../../components/game/levelHudFormat.js'
import {
  createAdvanceLevelAction,
  createInitialGameState,
  createNewGameAction,
  createReplayLevelAction,
  createSetLevelAction,
  gameReducer,
} from '../engine/gameReducer.js'
import { ELEVATOR_TRANSITION_PHASES } from '../engine/elevatorLevelTransition.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MAZE_CSS_PATH = path.resolve(__dirname, '../../styles/maze.css')

function createMockWebGLRenderer() {
  const domElement =
    typeof document !== 'undefined' && document.createElement
      ? document.createElement('canvas')
      : { style: {}, addEventListener() {}, removeEventListener() {} }
  return {
    domElement,
    shadowMap: { enabled: false, type: null },
    setSize() {},
    setPixelRatio() {},
    setClearColor() {},
    render() {},
    dispose() {},
    info: { memory: { geometries: 0, textures: 0 }, render: { calls: 0 } },
  }
}

function createMiniDomEnv() {
  const listeners = new Map()
  const activeTimeouts = new Map()
  const activeIntervals = new Map()
  const activeRafs = new Map()
  let nextTimerId = 1

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
        const fragChildren = [...child.childNodes]
        child.childNodes.length = 0
        for (const c of fragChildren) {
          this.appendChild(c)
        }
        return child
      }
      if (child.parentNode) {
        child.parentNode.removeChild(child)
      }
      child.parentNode = this
      this.childNodes.push(child)
      return child
    }
    insertBefore(newNode, referenceNode) {
      if (!referenceNode) return this.appendChild(newNode)
      if (newNode.nodeType === 11) {
        const fragChildren = [...newNode.childNodes]
        newNode.childNodes.length = 0
        for (const c of fragChildren) {
          this.insertBefore(c, referenceNode)
        }
        return newNode
      }
      if (newNode.parentNode) {
        newNode.parentNode.removeChild(newNode)
      }
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
      if (this.parentNode) {
        this.parentNode.removeChild(this)
      }
    }
    contains(other) {
      if (!other) return false
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
      this.textMutationCount = 0
    }
    get nodeValue() {
      return this._data
    }
    set nodeValue(val) {
      const next = String(val ?? '')
      if (next !== this._data) {
        this.textMutationCount += 1
      }
      this._data = next
    }
    get data() {
      return this._data
    }
    set data(val) {
      this.nodeValue = val
    }
    get textContent() {
      return this._data
    }
    set textContent(val) {
      this.nodeValue = val
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
    constructor(element) {
      this._el = element
    }
    _tokens() {
      const raw = this._el.getAttribute('class') || ''
      return raw.split(/\s+/).filter(Boolean)
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
      const self = this
      this.dataset = new Proxy(
        {},
        {
          get(_, prop) {
            const attr =
              'data-' +
              String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
            return self.getAttribute(attr) ?? undefined
          },
          set(_, prop, val) {
            const attr =
              'data-' +
              String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
            self.setAttribute(attr, String(val))
            return true
          },
        }
      )
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
      if (key === 'disabled') {
        this.disabled = strVal !== 'false'
      }
      if (key === 'style') {
        for (const part of strVal.split(';')) {
          const [k, v] = part.split(':')
          if (k && v) {
            const camel = k
              .trim()
              .replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
            this.style[camel] = v.trim()
          }
        }
      }
    }
    getAttribute(name) {
      const key = String(name)
      if (key === 'disabled' && this.disabled) {
        return this.attributes.get('disabled') ?? ''
      }
      return this.attributes.has(key) ? this.attributes.get(key) : null
    }
    hasAttribute(name) {
      if (name === 'disabled') return Boolean(this.disabled)
      return this.attributes.has(String(name))
    }
    removeAttribute(name) {
      const key = String(name)
      this.attributes.delete(key)
      if (key === 'disabled') this.disabled = false
    }
    get textContent() {
      let out = ''
      for (const child of this.childNodes) {
        if (child.nodeType === 3 || child.nodeType === 1) {
          out += child.textContent
        }
      }
      return out
    }
    set textContent(val) {
      this.childNodes.length = 0
      if (val !== null && val !== undefined && val !== '') {
        this.appendChild(new MiniTextNode(String(val)))
      }
    }
    get innerHTML() {
      return this.textContent
    }
    set innerHTML(val) {
      this.childNodes.length = 0
      if (val) {
        this.appendChild(new MiniTextNode(String(val)))
      }
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
        target: event.target || this,
        currentTarget: this,
        preventDefault() {
          this.defaultPrevented = true
        },
        stopPropagation() {
          this._stopped = true
        },
        ...event,
      }
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
      return !evt.defaultPrevented
    }
    focus() {
      if (this.ownerDocument) {
        this.ownerDocument.activeElement = this
      }
    }
    blur() {
      if (this.ownerDocument && this.ownerDocument.activeElement === this) {
        this.ownerDocument.activeElement = this.ownerDocument.body
      }
    }
    getBoundingClientRect() {
      return {
        top: 0,
        left: 0,
        right: 1280,
        bottom: 720,
        width: 1280,
        height: 720,
        x: 0,
        y: 0,
      }
    }
    getContext(type) {
      if (type === '2d') {
        return {
          canvas: this,
          save() {},
          restore() {},
          clearRect() {},
          fillRect() {},
          strokeRect() {},
          beginPath() {},
          closePath() {},
          moveTo() {},
          lineTo() {},
          arc() {},
          fill() {},
          stroke() {},
          clip() {},
          translate() {},
          rotate() {},
          scale() {},
          setTransform() {},
          fillText() {},
          measureText: () => ({ width: 10 }),
          createRadialGradient: () => ({ addColorStop() {} }),
          createLinearGradient: () => ({ addColorStop() {} }),
        }
      }
      return null
    }
    matches(selector) {
      return matchesSimpleSelector(this, selector)
    }
    closest(selector) {
      let cur = this
      while (cur && cur.nodeType === 1) {
        if (matchesSimpleSelector(cur, selector)) return cur
        cur = cur.parentNode
      }
      return null
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    }
    querySelectorAll(selector) {
      const results = []
      const groups = String(selector)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const visit = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (groups.some((g) => matchesCompoundSelector(child, g))) {
              results.push(child)
            }
            visit(child)
          }
        }
      }
      visit(this)
      return results
    }
  }

  class MiniIFrameElement extends MiniElement {
    constructor() {
      super('IFRAME')
    }
  }

  function matchesSingleSelector(el, sel) {
    if (!el || el.nodeType !== 1 || !sel) return false
    let rest = sel.trim()
    const attrRegex = /\[([a-zA-Z0-9_-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/g
    let match
    while ((match = attrRegex.exec(sel)) !== null) {
      const attrName = match[1]
      const expected = match[2]
      const actual = el.getAttribute(attrName)
      if (actual === null) return false
      if (expected !== undefined && actual !== expected) return false
    }
    rest = rest.replace(attrRegex, '')
    const classes = [...rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1])
    for (const cls of classes) {
      if (!el.classList.contains(cls)) return false
    }
    rest = rest.replace(/\.[a-zA-Z0-9_-]+/g, '')
    const idMatch = rest.match(/#([a-zA-Z0-9_-]+)/)
    if (idMatch && el.id !== idMatch[1]) return false
    rest = rest.replace(/#[a-zA-Z0-9_-]+/g, '')
    const tag = rest.trim()
    if (tag && tag !== '*' && el.tagName !== tag.toUpperCase()) return false
    return true
  }

  function matchesCompoundSelector(el, selector) {
    const parts = selector.trim().split(/\s+/)
    if (!matchesSingleSelector(el, parts[parts.length - 1])) return false
    let cur = el.parentNode
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      while (cur && cur.nodeType === 1 && !matchesSingleSelector(cur, parts[i])) {
        cur = cur.parentNode
      }
      if (!cur || cur.nodeType !== 1) return false
      cur = cur.parentNode
    }
    return true
  }

  function matchesSimpleSelector(el, selector) {
    return String(selector)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .some((g) => matchesCompoundSelector(el, g))
  }

  class MiniDocument extends MiniNode {
    constructor() {
      super(9, '#document')
      this.documentElement = new MiniElement('html')
      this.documentElement.ownerDocument = this
      this.head = new MiniElement('head')
      this.head.ownerDocument = this
      this.body = new MiniElement('body')
      this.body.ownerDocument = this
      this.documentElement.appendChild(this.head)
      this.documentElement.appendChild(this.body)
      this.appendChild(this.documentElement)
      this.activeElement = this.body
      this.hidden = false
      this.visibilityState = 'visible'
      this.pointerLockElement = null
      this.fullscreenElement = null
    }
    createElement(tag) {
      if (String(tag).toLowerCase() === 'iframe') {
        const iframe = new MiniIFrameElement()
        iframe.ownerDocument = this
        return iframe
      }
      const el = new MiniElement(tag)
      el.ownerDocument = this
      return el
    }
    createElementNS(ns, tag) {
      const el = new MiniElement(tag, ns)
      el.ownerDocument = this
      return el
    }
    createTextNode(text) {
      const node = new MiniTextNode(text)
      node.ownerDocument = this
      return node
    }
    createComment(text) {
      const node = new MiniCommentNode(text)
      node.ownerDocument = this
      return node
    }
    createDocumentFragment() {
      const frag = new MiniDocumentFragment()
      frag.ownerDocument = this
      return frag
    }
    getElementById(id) {
      return this.body.querySelector(`#${id}`)
    }
    querySelector(sel) {
      return this.documentElement.querySelector(sel)
    }
    querySelectorAll(sel) {
      return this.documentElement.querySelectorAll(sel)
    }
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    }
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    }
    dispatchEvent(event) {
      const set = listeners.get(event.type)
      if (set) {
        for (const fn of [...set]) {
          fn.call(this, event)
        }
      }
      return true
    }
    exitPointerLock() {
      this.pointerLockElement = null
    }
  }

  const doc = new MiniDocument()
  const storageMap = new Map()
  const localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear(),
  }

  const winListeners = new Map()
  const windowObj = {
    document: doc,
    localStorage,
    location: { search: '', href: 'http://localhost:3000/' },
    navigator: { userAgent: 'node-test', maxTouchPoints: 0 },
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    performance,
    HTMLElement: MiniElement,
    HTMLIFrameElement: MiniIFrameElement,
    Element: MiniElement,
    Node: MiniNode,
    Text: MiniTextNode,
    DocumentFragment: MiniDocumentFragment,
    getComputedStyle: (el) => el?.style || {},
    matchMedia: (query) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set())
      winListeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn)
    },
    dispatchEvent(event) {
      const evt = {
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true
        },
        stopPropagation() {},
        ...event,
      }
      const set = winListeners.get(evt.type)
      if (set) {
        for (const fn of [...set]) {
          fn.call(windowObj, evt)
        }
      }
      return !evt.defaultPrevented
    },
    setTimeout(fn, ms = 0) {
      const id = nextTimerId++
      const handle = setTimeout(() => {
        activeTimeouts.delete(id)
        fn()
      }, Math.max(0, Number(ms) || 0))
      activeTimeouts.set(id, handle)
      return id
    },
    clearTimeout(id) {
      const handle = activeTimeouts.get(id)
      if (handle) {
        clearTimeout(handle)
        activeTimeouts.delete(id)
      }
    },
    setInterval(fn, ms = 0) {
      const id = nextTimerId++
      const handle = setInterval(fn, Math.max(1, Number(ms) || 1))
      activeIntervals.set(id, handle)
      return id
    },
    clearInterval(id) {
      const handle = activeIntervals.get(id)
      if (handle) {
        clearInterval(handle)
        activeIntervals.delete(id)
      }
    },
    requestAnimationFrame(fn) {
      const id = nextTimerId++
      const handle = setTimeout(() => {
        activeRafs.delete(id)
        fn(performance.now())
      }, 8)
      activeRafs.set(id, handle)
      return id
    },
    cancelAnimationFrame(id) {
      const handle = activeRafs.get(id)
      if (handle) {
        clearTimeout(handle)
        activeRafs.delete(id)
      }
    },
  }
  doc.defaultView = windowObj

  return {
    window: windowObj,
    document: doc,
    localStorage,
    activeTimeouts,
    activeIntervals,
    activeRafs,
    cleanupAllTimers() {
      for (const h of activeTimeouts.values()) clearTimeout(h)
      for (const h of activeIntervals.values()) clearInterval(h)
      for (const h of activeRafs.values()) clearTimeout(h)
      activeTimeouts.clear()
      activeIntervals.clear()
      activeRafs.clear()
    },
  }
}

function buildWonLevelState(level = 1, baseSeed = 424242) {
  let state = createInitialGameState({
    level,
    baseSeed,
    objectivesEnabled: true,
  })
  for (const kc of state.keycards) {
    state = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: kc.row, col: kc.col },
    })
  }
  state = gameReducer(state, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: state.maze.exit.row, col: state.maze.exit.col },
  })
  state = gameReducer(state, { type: 'COMPLETE_EXIT_EXTRACTION' })
  assert.equal(state.hasWon, true)
  assert.equal(state.currentLevel, level)
  assert.equal(state.completedLevel, level)
  return state
}

async function waitForCondition(predicate, timeoutMs = 2500, stepMs = 15) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let result = false
    await act(async () => {
      await new Promise((r) => setTimeout(r, stepMs))
      result = Boolean(predicate())
    })
    if (result) return true
  }
  return Boolean(predicate())
}

async function mountApp(AppComponent, props = {}) {
  const env = createMiniDomEnv()
  globalThis.window = env.window
  globalThis.document = env.document
  globalThis.localStorage = env.localStorage
  globalThis.HTMLElement = env.window.HTMLElement
  globalThis.HTMLIFrameElement = env.window.HTMLIFrameElement
  globalThis.Element = env.window.Element
  globalThis.Node = env.window.Node
  globalThis.Text = env.window.Text
  globalThis.DocumentFragment = env.window.DocumentFragment
  globalThis.requestAnimationFrame = env.window.requestAnimationFrame
  globalThis.cancelAnimationFrame = env.window.cancelAnimationFrame
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const container = env.document.createElement('div')
  env.document.body.appendChild(container)
  const root = createRoot(container)
  let latestViewportCtx = null
  const transitionLog = []
  const arrivalLog = []

  const {
    viewportEngineConfig: customEngineConfig,
    levelTransitionConfig: customTransitionConfig,
    arrivalConfig: customArrivalConfig,
    onViewportReady: customOnViewportReady,
    onLevelTransitionChange: customOnLevelTransitionChange,
    onArrivalStateChange: customOnArrivalStateChange,
    ...restProps
  } = props

  await act(async () => {
    root.render(
      createElement(AppComponent, {
        initialPlaying: false,
        ...restProps,
        viewportEngineConfig: {
          createRenderer: () => createMockWebGLRenderer(),
          ...(customEngineConfig || {}),
        },
        levelTransitionConfig: {
          doorsCloseDurationMs: 45,
          travelMinDurationMs: 55,
          doorsOpenDurationMs: 45,
          maxTimeoutMs: 1200,
          ...(customTransitionConfig || {}),
        },
        arrivalConfig: {
          startOverlayMinMs: 45,
          maxArrivalTimeoutMs: 1500,
          ...(customArrivalConfig || {}),
        },
        onViewportReady: (ctx) => {
          latestViewportCtx = ctx
          customOnViewportReady?.(ctx)
        },
        onLevelTransitionChange: (state) => {
          transitionLog.push({ ...state })
          customOnLevelTransitionChange?.(state)
        },
        onArrivalStateChange: (state) => {
          arrivalLog.push({ ...state })
          customOnArrivalStateChange?.(state)
        },
      })
    )
  })

  return {
    env,
    container,
    root,
    transitionLog,
    arrivalLog,
    getViewportCtx: () => latestViewportCtx,
    async cleanup() {
      await act(async () => {
        root.unmount()
      })
      env.cleanupAllTimers()
    },
  }
}

async function runProgressiveLevelHUDTests() {
  console.log('--- Running MAZE-HUD-001 Progressive Level HUD Indicator Tests ---')
  const viteServer = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
  })

  try {
    const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')
    const { default: MazeViewport3D } = await viteServer.ssrLoadModule(
      '/src/components/game/MazeViewport3D.jsx'
    )

  // ==========================================================================
  // 1. Unit Tests: Authoritative Level Resolution, Zero-Padding & Large Values
  // ==========================================================================
  {
    assert.equal(resolveAuthoritativeHudLevel({}), 1, 'Defaults to Level 1')
    assert.equal(
      resolveAuthoritativeHudLevel({ currentLevel: 1, maze: { level: 1 } }),
      1
    )
    assert.equal(
      resolveAuthoritativeHudLevel({ currentLevel: 7, maze: { level: 2 } }),
      7,
      'Authoritative currentLevel prop takes precedence'
    )
    assert.equal(
      resolveAuthoritativeHudLevel({ currentLevel: undefined, maze: { level: 14 } }),
      14,
      'Falls back cleanly to maze.level when currentLevel prop is omitted'
    )

    // Early levels (1..9) use 2-digit zero-padding
    for (let lvl = 1; lvl <= 9; lvl += 1) {
      assert.equal(formatHudLevelNumber(lvl), `0${lvl}`)
      assert.equal(formatHudLevelDisplay(lvl), `LEVEL 0${lvl}`)
      assert.equal(formatHudLevelAriaLabel(lvl), `Current level: Level ${lvl}`)
    }

    // Two-digit and high levels (10, 99, 100, 5000, 5001, 999999) display full untruncated number
    for (const lvl of [10, 12, 99, 100, 999, 5000, 5001, 100000, 999999]) {
      assert.equal(formatHudLevelNumber(lvl), String(lvl))
      assert.equal(formatHudLevelDisplay(lvl), `LEVEL ${lvl}`)
      assert.equal(formatHudLevelAriaLabel(lvl), `Current level: Level ${lvl}`)
    }
    console.log('✓ 1. Authoritative level resolution, zero-padding & high-level formatting passed')
  }

  // ==========================================================================
  // 2. Reducer & Action Synchronization Across All Level Transitions
  // ==========================================================================
  {
    let state = createInitialGameState({ level: 1, baseSeed: 314159 })
    assert.equal(resolveAuthoritativeHudLevel(state), 1)
    assert.equal(formatHudLevelDisplay(state.currentLevel), 'LEVEL 01')

    // Multiple consecutive level advances: 1 -> 2 -> 3 -> 4 -> 5
    for (let target = 2; target <= 5; target += 1) {
      const wonState = buildWonLevelState(state.currentLevel, state.baseSeed)
      state = gameReducer(wonState, createAdvanceLevelAction(wonState))
      assert.equal(state.currentLevel, target)
      assert.equal(state.maze.level, target)
      assert.equal(resolveAuthoritativeHudLevel(state), target)
      assert.equal(formatHudLevelDisplay(state.currentLevel), `LEVEL 0${target}`)
    }

    // Replay preserves current level (Level 5)
    const beforeReplaySeed = state.seed
    state = gameReducer(state, createReplayLevelAction(state))
    assert.equal(state.currentLevel, 5, 'Replay preserves Level 5')
    assert.equal(state.seed, beforeReplaySeed, 'Replay preserves level seed')
    assert.equal(formatHudLevelDisplay(state.currentLevel), 'LEVEL 05')

    // SET_LEVEL to Level 5000 and advance to 5001
    state = gameReducer(state, createSetLevelAction(state, 5000))
    assert.equal(state.currentLevel, 5000)
    assert.equal(formatHudLevelDisplay(state.currentLevel), 'LEVEL 5000')
    const won5000 = buildWonLevelState(5000, state.baseSeed)
    state = gameReducer(won5000, createAdvanceLevelAction(won5000))
    assert.equal(state.currentLevel, 5001)
    assert.equal(state.maze.level, 5001)
    assert.equal(formatHudLevelDisplay(state.currentLevel), 'LEVEL 5001')

    // Main Menu -> New Game resets to Level 1
    state = gameReducer(state, createNewGameAction(state))
    assert.equal(state.currentLevel, 1)
    assert.equal(state.maze.level, 1)
    assert.equal(formatHudLevelDisplay(state.currentLevel), 'LEVEL 01')

    console.log('✓ 2. Reducer & action synchronization across advance, replay, set-level & new-game passed')
  }

  // ==========================================================================
  // 3. Startup Visibility, Fresh Game Arrival & Live Screen-Reader Stability
  // ==========================================================================
  {
    const session = await mountApp(App, { initialPlaying: false })
    try {
      // On StartScreen: gameplay HUD must not be rendered
      assert.ok(session.container.querySelector('.lv-start-screen'))
      assert.equal(
        session.container.querySelector('[data-testid="maze-level-hud"]'),
        null,
        'Level HUD is not rendered while on Start Screen'
      )

      // Click Start Game -> StartTransitionOverlay opens
      const startBtn = session.container
        .querySelectorAll('button')
        .find((b) => b.textContent.includes('Start Game'))
      assert.ok(startBtn)
      await act(async () => {
        startBtn.dispatchEvent({ type: 'click', bubbles: true })
      })

      assert.ok(
        session.container.querySelector('[data-testid="start-transition-overlay"]'),
        'StartTransitionOverlay is open during startup'
      )
      assert.equal(
        session.container.querySelector('[data-testid="maze-level-hud"]'),
        null,
        'Level HUD is hidden while StartTransitionOverlay is active (no startup HUD flash)'
      )

      // Wait for StartTransitionOverlay to finish -> Level 1 HUD appears
      const overlayDone = await waitForCondition(
        () => !session.container.querySelector('[data-testid="start-transition-overlay"]')
      )
      assert.equal(overlayDone, true)

      const levelHudEl = session.container.querySelector('[data-testid="maze-level-hud"]')
      assert.ok(levelHudEl, 'Level HUD indicator renders once gameplay stage reveals')
      assert.equal(levelHudEl.getAttribute('data-current-level'), '1')
      assert.equal(levelHudEl.getAttribute('data-level-code'), '01')
      assert.equal(levelHudEl.textContent.trim(), 'LEVEL 01')
      assert.equal(levelHudEl.getAttribute('aria-label'), 'Current level: Level 1')

      const viewportEl = session.container.querySelector('.maze-viewport-3d')
      assert.equal(viewportEl.getAttribute('data-current-level'), '1')

      // Verify existing HUD components remain intact alongside .maze-level-hud
      const vitalsHud = session.container.querySelector('.maze-vitals-hud')
      assert.ok(vitalsHud)
      const vitalsItems = vitalsHud.querySelectorAll('.maze-vitals-hud__item')
      assert.equal(
        vitalsItems.length,
        4,
        'All 4 existing vitals items (HP, Stamina, Battery, Keys) remain intact'
      )
      assert.ok(session.container.querySelector('.maze-manual-inventory'))
      assert.ok(session.container.querySelector('.maze-fullscreen-btn'))
      assert.ok(session.container.querySelector('.maze-minimap'))

      // Step 3D arrival to completion and verify non-level state updates (HP damage)
      // do NOT cause redundant DOM text mutations on the live screen-reader announcer
      const engine = session.getViewportCtx()?.engine
      assert.ok(engine)
      await act(async () => {
        for (let i = 0; i < 360 && engine.isSpawnSequenceActive(); i += 1) {
          engine.stepFrame(1 / 60)
        }
      })

      const liveEl = session.container.querySelector('[data-testid="maze-level-hud-live"]')
      assert.ok(liveEl, 'Accessible live region exists for level changes')
      assert.equal(liveEl.getAttribute('aria-live'), 'polite')
      assert.equal(liveEl.textContent, 'Current level: Level 1')
      const liveTextNode = liveEl.firstChild
      const mutationsBeforeDamage = liveTextNode?.textMutationCount || 0

      // Trigger non-level HUD re-render (player takes damage)
      await act(async () => {
        engine.applyDamage(15, { source: 'enemy' })
      })
      assert.equal(
        session.container.querySelector('.maze-vitals-hud__item--hp .maze-vitals-hud__numeric')
          ?.textContent,
        '85',
        'HP HUD updated to 85'
      )
      assert.equal(
        liveEl.firstChild?.textMutationCount || 0,
        mutationsBeforeDamage,
        'Live level announcer text node does not mutate or re-announce on unrelated HP renders'
      )
    } finally {
      await session.cleanup()
    }
    console.log('✓ 3. Startup visibility, Fresh Game LEVEL 01 HUD & screen-reader live stability passed')
  }

  // ==========================================================================
  // 4. Consecutive Level Advances (1 -> 2 -> 3), Elevator Sync, Replay, Restart & Main Menu
  // ==========================================================================
  {
    const wonLevel1 = buildWonLevelState(1, 777777)
    const session = await mountApp(App, {
      initialPlaying: true,
      initialGameState: wonLevel1,
    })

    try {
      const ready = await waitForCondition(() => Boolean(session.getViewportCtx()?.engine))
      assert.equal(ready, true)
      session.getViewportCtx().engine.cancelSpawnSequence()

      const getLevelHud = () =>
        session.container.querySelector('[data-testid="maze-level-hud"]')
      assert.equal(getLevelHud()?.textContent.trim(), 'LEVEL 01')
      assert.equal(getLevelHud()?.getAttribute('data-current-level'), '1')

      // Click NEXT LEVEL on VictoryModal (Level 1 -> Level 2)
      const nextBtn1 = session.container.querySelector('[data-testid="victory-next-level-btn"]')
      assert.ok(nextBtn1, 'VictoryModal Next Level button present at Level 1 victory')
      await act(async () => {
        nextBtn1.dispatchEvent({ type: 'click', bubbles: true })
      })

      // Wait for elevator transition to complete and arrival to unlock
      const arrivedLevel2 = await waitForCondition(
        () =>
          !session.container.querySelector('[data-testid="elevator-level-transition"]') &&
          session.container
            .querySelector('.maze-viewport-3d')
            ?.getAttribute('data-controls-enabled') === 'true'
      )
      assert.equal(arrivedLevel2, true, 'Arrived at Level 2 with gameplay controls restored')
      assert.equal(getLevelHud()?.textContent.trim(), 'LEVEL 02')
      assert.equal(getLevelHud()?.getAttribute('data-current-level'), '2')
      assert.equal(getLevelHud()?.getAttribute('aria-label'), 'Current level: Level 2')
      assert.equal(
        session.container
          .querySelector('[data-testid="maze-level-hud-live"]')
          ?.getAttribute('data-announced-level'),
        '2'
      )

      // Test Pause -> Restart on Level 2: must stay on Level 2 without incrementing
      await act(async () => {
        session.env.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
      })
      const pauseActions = session.container.querySelector('[data-testid="pause-actions"]')
      assert.ok(pauseActions, 'Pause screen opened on Level 2')
      const restartBtn = pauseActions
        .querySelectorAll('button')
        .find((b) => b.textContent.trim() === 'Restart')
      assert.ok(restartBtn, 'Restart button found in Pause menu')
      await act(async () => {
        restartBtn.dispatchEvent({ type: 'click', bubbles: true })
      })

      // Step replayed arrival on Level 2
      const engine = session.getViewportCtx().engine
      await act(async () => {
        for (let i = 0; i < 360 && engine.isSpawnSequenceActive(); i += 1) {
          engine.stepFrame(1 / 60)
        }
      })
      assert.equal(
        getLevelHud()?.textContent.trim(),
        'LEVEL 02',
        'Pause -> Restart preserves LEVEL 02 without incrementing'
      )
      assert.equal(getLevelHud()?.getAttribute('data-current-level'), '2')

      // Complete Level 2 and test REPLAY LEVEL from VictoryModal
      const propsLvl2 = session.getViewportCtx().getLatestProps()
      await act(async () => {
        for (const kc of propsLvl2.keycards) {
          propsLvl2.onPlayerCellChange({ row: kc.row, col: kc.col }, {})
        }
        propsLvl2.onPlayerCellChange(
          { row: propsLvl2.maze.exit.row, col: propsLvl2.maze.exit.col },
          {}
        )
        propsLvl2.onExtractionComplete()
      })

      const replayBtn = session.container.querySelector('[data-testid="victory-replay-level-btn"]')
      assert.ok(replayBtn, 'Replay Level button rendered in Level 2 VictoryModal')
      await act(async () => {
        replayBtn.dispatchEvent({ type: 'click', bubbles: true })
      })
      await act(async () => {
        for (let i = 0; i < 360 && engine.isSpawnSequenceActive(); i += 1) {
          engine.stepFrame(1 / 60)
        }
      })
      assert.equal(
        getLevelHud()?.textContent.trim(),
        'LEVEL 02',
        'VictoryModal -> Replay Level preserves LEVEL 02'
      )
      assert.equal(getLevelHud()?.getAttribute('data-current-level'), '2')

      // Complete Level 2 again and advance to Level 3 (consecutive advance 2 -> 3)
      const propsAfterReplay = session.getViewportCtx().getLatestProps()
      await act(async () => {
        for (const kc of propsAfterReplay.keycards) {
          propsAfterReplay.onPlayerCellChange({ row: kc.row, col: kc.col }, {})
        }
        propsAfterReplay.onPlayerCellChange(
          { row: propsAfterReplay.maze.exit.row, col: propsAfterReplay.maze.exit.col },
          {}
        )
        propsAfterReplay.onExtractionComplete()
      })

      const nextBtn2 = session.container.querySelector('[data-testid="victory-next-level-btn"]')
      assert.ok(nextBtn2, 'VictoryModal Next Level button present at Level 2 victory')
      await act(async () => {
        nextBtn2.dispatchEvent({ type: 'click', bubbles: true })
      })

      // Verify during elevator transition: once TRAVELING commits maze, HUD updates to LEVEL 03 before doors finish opening
      const arrivedLevel3 = await waitForCondition(
        () =>
          !session.container.querySelector('[data-testid="elevator-level-transition"]') &&
          session.container
            .querySelector('.maze-viewport-3d')
            ?.getAttribute('data-controls-enabled') === 'true'
      )
      assert.equal(arrivedLevel3, true, 'Arrived at Level 3')
      assert.equal(getLevelHud()?.textContent.trim(), 'LEVEL 03')
      assert.equal(getLevelHud()?.getAttribute('data-current-level'), '3')

      // Test Game-Over -> Try Again on Level 3 preserves Level 3 without incrementing
      await act(async () => {
        session.getViewportCtx().getLatestProps().onGameOver()
      })
      const tryAgainBtn = session.container
        .querySelectorAll('button')
        .find((b) => b.textContent.trim() === 'Try Again')
      assert.ok(tryAgainBtn, 'Game Over Try Again button rendered')
      await act(async () => {
        tryAgainBtn.dispatchEvent({ type: 'click', bubbles: true })
      })
      await act(async () => {
        for (let i = 0; i < 360 && engine.isSpawnSequenceActive(); i += 1) {
          engine.stepFrame(1 / 60)
        }
      })
      assert.equal(
        getLevelHud()?.textContent.trim(),
        'LEVEL 03',
        'Game Over -> Try Again restarts Level 3 without incrementing'
      )

      // Complete Level 3 -> Main Menu -> Start Game resets HUD to LEVEL 01
      const propsLvl3 = session.getViewportCtx().getLatestProps()
      await act(async () => {
        for (const kc of propsLvl3.keycards) {
          propsLvl3.onPlayerCellChange({ row: kc.row, col: kc.col }, {})
        }
        propsLvl3.onPlayerCellChange(
          { row: propsLvl3.maze.exit.row, col: propsLvl3.maze.exit.col },
          {}
        )
        propsLvl3.onExtractionComplete()
      })

      const mainMenuBtn = session.container.querySelector('[data-testid="victory-main-menu-btn"]')
      assert.ok(mainMenuBtn)
      await act(async () => {
        mainMenuBtn.dispatchEvent({ type: 'click', bubbles: true })
      })
      assert.ok(session.container.querySelector('.lv-start-screen'))
      assert.equal(getLevelHud(), null, 'HUD unmounted when returning to Main Menu')

      const newGameBtn = session.container
        .querySelectorAll('button')
        .find((b) => b.textContent.includes('Start Game'))
      assert.ok(newGameBtn)
      await act(async () => {
        newGameBtn.dispatchEvent({ type: 'click', bubbles: true })
      })
      const freshOverlayDone = await waitForCondition(
        () => !session.container.querySelector('[data-testid="start-transition-overlay"]')
      )
      assert.equal(freshOverlayDone, true)
      assert.equal(
        getLevelHud()?.textContent.trim(),
        'LEVEL 01',
        'Main Menu -> New Game resets HUD to LEVEL 01 (no stale Level 3)'
      )
      assert.equal(getLevelHud()?.getAttribute('data-current-level'), '1')
    } finally {
      await session.cleanup()
    }
    console.log('✓ 4. Consecutive advances (1->2->3), Replay, Pause/GameOver Restart & Main Menu reset passed')
  }

  // ==========================================================================
  // 5. High-Level Progression (Level 5000 -> 5001) & No Stale Level on Error
  // ==========================================================================
  {
    const won5000 = buildWonLevelState(5000, 424242)
    let shouldFailOnce = true
    const session = await mountApp(App, {
      initialPlaying: true,
      initialGameState: won5000,
      advanceLevelActionBuilder: (currentState) => {
        if (shouldFailOnce) {
          shouldFailOnce = false
          throw new Error('Simulated transient level generation failure')
        }
        return createAdvanceLevelAction(currentState)
      },
    })

    try {
      const ready = await waitForCondition(() => Boolean(session.getViewportCtx()?.engine))
      assert.equal(ready, true)
      session.getViewportCtx().engine.cancelSpawnSequence()

      const getLevelHud = () =>
        session.container.querySelector('[data-testid="maze-level-hud"]')
      assert.equal(getLevelHud()?.textContent.trim(), 'LEVEL 5000')
      assert.equal(getLevelHud()?.getAttribute('data-current-level'), '5000')
      assert.equal(getLevelHud()?.getAttribute('data-level-code'), '5000')
      assert.equal(
        getLevelHud()?.getAttribute('aria-label'),
        'Current level: Level 5000'
      )

      // Attempt 1 fails mid-transition -> recovers cleanly and stays on LEVEL 5000 (never stale 5001)
      const nextBtnAttempt1 = session.container.querySelector(
        '[data-testid="victory-next-level-btn"]'
      )
      assert.ok(nextBtnAttempt1)
      await act(async () => {
        nextBtnAttempt1.dispatchEvent({ type: 'click', bubbles: true })
      })
      const recovered = await waitForCondition(() =>
        Boolean(session.container.querySelector('[data-testid="victory-next-level-btn"]'))
      )
      assert.equal(recovered, true)
      assert.equal(
        getLevelHud()?.textContent.trim(),
        'LEVEL 5000',
        'Failed transition keeps HUD synchronized with authoritative LEVEL 5000'
      )

      // Attempt 2 succeeds -> transitions Level 5000 -> Level 5001
      const nextBtnAttempt2 = session.container.querySelector(
        '[data-testid="victory-next-level-btn"]'
      )
      await act(async () => {
        nextBtnAttempt2.dispatchEvent({ type: 'click', bubbles: true })
      })

      // Verify transition phases logged and final arrival at Level 5001
      const arrived5001 = await waitForCondition(
        () =>
          !session.container.querySelector('[data-testid="elevator-level-transition"]') &&
          session.container
            .querySelector('.maze-viewport-3d')
            ?.getAttribute('data-controls-enabled') === 'true'
      )
      assert.equal(arrived5001, true)
      assert.ok(
        session.transitionLog.some(
          (s) => s.phase === ELEVATOR_TRANSITION_PHASES.TRAVELING && s.toLevel === 5001
        )
      )
      assert.equal(getLevelHud()?.textContent.trim(), 'LEVEL 5001')
      assert.equal(getLevelHud()?.getAttribute('data-current-level'), '5001')
      assert.equal(getLevelHud()?.getAttribute('data-level-code'), '5001')
      assert.equal(
        getLevelHud()?.getAttribute('aria-label'),
        'Current level: Level 5001'
      )
    } finally {
      await session.cleanup()
    }
    console.log('✓ 5. High-level progression (Level 5000 -> 5001) & error recovery synchronization passed')
  }

  // ==========================================================================
  // 6. Extreme Large Level Values, Responsive Desktop/Mobile CSS & No-Overflow Checks
  // ==========================================================================
  {
    const env = createMiniDomEnv()
    globalThis.window = env.window
    globalThis.document = env.document
    globalThis.localStorage = env.localStorage
    globalThis.HTMLElement = env.window.HTMLElement
    globalThis.HTMLIFrameElement = env.window.HTMLIFrameElement
    globalThis.Element = env.window.Element
    globalThis.Node = env.window.Node
    globalThis.Text = env.window.Text
    globalThis.DocumentFragment = env.window.DocumentFragment
    globalThis.requestAnimationFrame = env.window.requestAnimationFrame
    globalThis.cancelAnimationFrame = env.window.cancelAnimationFrame
    globalThis.IS_REACT_ACT_ENVIRONMENT = true

    const container = env.document.createElement('div')
    env.document.body.appendChild(container)
    const root = createRoot(container)
    const baseState = createInitialGameState({ level: 1, baseSeed: 123456 })

    try {
      for (const extremeLevel of [1, 9, 10, 99, 100, 5000, 5001, 99999, 1234567]) {
        await act(async () => {
          root.render(
            createElement(MazeViewport3D, {
              maze: { ...baseState.maze, level: extremeLevel, currentLevel: extremeLevel },
              currentLevel: extremeLevel,
              runId: extremeLevel,
              playerCell: baseState.playerPos,
              items: baseState.items,
              keycards: baseState.keycards,
              keysCollected: 0,
              totalKeys: baseState.totalKeys,
              isExitLocked: true,
              objectivesEnabled: true,
              health: 100,
              maxHealth: 100,
              engineConfig: {
                createRenderer: () => createMockWebGLRenderer(),
                skipSpawnSequence: true,
              },
            })
          )
        })
        const hudEl = container.querySelector('[data-testid="maze-level-hud"]')
        const numEl = container.querySelector('[data-testid="maze-level-hud-number"]')
        assert.ok(hudEl && numEl)
        const expectedCode = extremeLevel < 10 ? `0${extremeLevel}` : String(extremeLevel)
        assert.equal(numEl.textContent, expectedCode)
        assert.equal(hudEl.textContent.trim(), `LEVEL ${expectedCode}`)
        assert.equal(hudEl.getAttribute('data-current-level'), String(extremeLevel))
      }
    } finally {
      await act(async () => {
        root.unmount()
      })
      env.cleanupAllTimers()
    }

    // Verify CSS contract in src/styles/maze.css across desktop, mobile portrait, mobile landscape, and high-contrast
    const css = fs.readFileSync(MAZE_CSS_PATH, 'utf8')
    assert.ok(css.includes('.maze-level-hud {'), '.maze-level-hud rule exists in maze.css')
    assert.ok(
      css.includes('grid-column: 1 / -1;') &&
        css.includes('white-space: nowrap;') &&
        css.includes('font-variant-numeric: tabular-nums;'),
      '.maze-level-hud spans full top row of .maze-vitals-hud with tabular numerals and nowrap to prevent truncation'
    )
    const levelHudBlock = css.slice(
      css.indexOf('.maze-level-hud {'),
      css.indexOf('}', css.indexOf('.maze-level-hud {')) + 1
    )
    assert.equal(
      /text-overflow\s*:\s*ellipsis/.test(levelHudBlock) ||
        /overflow\s*:\s*hidden/.test(levelHudBlock),
      false,
      '.maze-level-hud must never clip or ellipsis-truncate large level numbers'
    )
    assert.ok(
      css.includes('env(safe-area-inset-top') &&
        css.includes('env(safe-area-inset-left'),
      'HUD respects safe-area insets on desktop and mobile viewports'
    )
    assert.ok(
      css.includes('@media (max-width: 479px)') &&
        css.includes('@media (max-height: 540px) and (orientation: landscape)') &&
        css.includes("[data-high-contrast='true'] .maze-level-hud"),
      'Responsive mobile portrait, mobile landscape, and high-contrast rules are defined for .maze-level-hud'
    )
    console.log('✓ 6. Extreme large levels, no-overflow CSS contract & responsive desktop/mobile layout checks passed')
  }

  console.log('ALL MAZE-HUD-001 PROGRESSIVE LEVEL HUD INDICATOR TESTS PASSED!')
  } finally {
    await viteServer.close()
  }
}

await runProgressiveLevelHUDTests()
