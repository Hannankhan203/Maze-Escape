import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import {
  LEVEL_TRANSITION_ACTIONS,
  createAdvanceLevelAction,
  createInitialGameState,
  createNewGameAction,
  createReplayLevelAction,
  gameReducer,
} from '../engine/gameReducer.js'
import { getLevelConfig } from '../mechanics/levelProgression.js'
import { STORAGE_KEYS, loadAllSettings, saveAllSettings } from '../../utils/persistence.js'

console.log('--- Running MAZE-VICTORY-001 Progressive Level Completion & Next-Level Flow Tests ---')

/**
 * Lightweight self-contained DOM environment for React 19 createRoot/act,
 * event bubbling, focus management, ResizeObserver, and localStorage.
 */
function createMiniDomEnv(initialUrl = 'http://localhost:3000/') {
  let currentUrl = new URL(initialUrl)

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
      this.oninput = null
      this.onchange = null
      this.onclick = null
      this.disabled = false
      this.hidden = false
      this._value = ''
      this._checked = false
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
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 8),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (id) => clearTimeout(id),
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

function collectAllKeycardsInState(state) {
  let next = state
  for (const kc of [...next.keycards]) {
    next = gameReducer(next, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: kc.row, col: kc.col },
    })
  }
  return next
}

// ============================================================================
// PART A: Pure Reducer, Progression & View-Model Verification
// ============================================================================
console.log('Part A: Reducer, Objective Gating, Advance/Replay/Menu & Level 5000->5001')

{
  // Test A1: Exit cannot trigger victory while required keycards remain uncollected
  const state1 = createInitialGameState({ level: 1, baseSeed: 424242, objectivesEnabled: true })
  assert.equal(state1.currentLevel, 1)
  assert.ok(state1.totalKeys > 0, 'Level 1 requires Resonance Keycards')
  assert.equal(state1.isExitLocked, true, 'Exit is initially locked until keycards are collected')

  // Reaching exit cell via SYNC_PLAYER_CELL while locked must NOT win
  const atLockedExit = gameReducer(state1, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: state1.maze.exit.row, col: state1.maze.exit.col },
  })
  assert.equal(atLockedExit.hasWon, false, 'Locked exit must not set hasWon=true')
  assert.equal(atLockedExit.completedLevel, null, 'Locked exit must not set completedLevel')
  assert.equal(atLockedExit.levelsCompleted, 0, 'Locked exit must not increment levelsCompleted')
  assert.equal(atLockedExit.lastEvent?.type, 'locked_exit', 'Locked exit emits locked_exit event')

  // Attempting COMPLETE_EXIT_EXTRACTION while locked must be rejected
  const blockedExtraction = gameReducer(atLockedExit, { type: 'COMPLETE_EXIT_EXTRACTION' })
  assert.equal(blockedExtraction, atLockedExit, 'COMPLETE_EXIT_EXTRACTION rejected while exit is locked')

  // Even if isExitLocked were somehow desynchronized while keycards remain, COMPLETE_EXIT_EXTRACTION still rejects
  const desyncedState = { ...state1, isExitLocked: false }
  const blockedDesync = gameReducer(desyncedState, { type: 'COMPLETE_EXIT_EXTRACTION' })
  assert.equal(blockedDesync, desyncedState, 'COMPLETE_EXIT_EXTRACTION guards missing keycards even if isExitLocked=false')

  // Test A2: Collecting all keycards unlocks exit and completes Level 1 cleanly (with duplicate-completion protection)
  const unlocked = collectAllKeycardsInState(state1)
  assert.equal(unlocked.keysCollected, unlocked.totalKeys, 'All keycards collected')
  assert.equal(unlocked.isExitLocked, false, 'Exit gate unlocks once all keycards are collected')
  assert.equal(unlocked.hasWon, false, 'Unlocking gate alone does not complete the level')

  const won1 = gameReducer(unlocked, { type: 'COMPLETE_EXIT_EXTRACTION' })
  assert.equal(won1.hasWon, true, 'Extraction after unlocking sets hasWon=true')
  assert.equal(won1.completedLevel, 1, 'completedLevel records 1')
  assert.equal(won1.completedRunId, won1.runId, 'completedRunId records completed runId')
  assert.equal(won1.levelsCompleted, 1, 'levelsCompleted increments to 1')
  assert.equal(won1.lastEvent?.type, 'exit', 'Completion emits exit event')

  // Duplicate COMPLETE_EXIT_EXTRACTION and SYNC_PLAYER_CELL after victory are idempotent no-ops
  const dupExtraction = gameReducer(won1, { type: 'COMPLETE_EXIT_EXTRACTION' })
  assert.equal(dupExtraction, won1, 'Duplicate COMPLETE_EXIT_EXTRACTION is a no-op')
  const dupMove = gameReducer(won1, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: won1.maze.start.row, col: won1.maze.start.col },
  })
  assert.equal(dupMove, won1, 'SYNC_PLAYER_CELL after victory is a no-op')
  assert.equal(won1.levelsCompleted, 1, 'Duplicate triggers never double-increment levelsCompleted')

  // Test A3: ADVANCE_LEVEL advances exactly one level, generates a fresh Level 2 maze, resets transient state, preserves run progression
  const damagedWon1 = {
    ...won1,
    health: 40,
    battery: 25,
    itemsCollected: 3,
    shardsCollected: 2,
    shardBonus: 150,
    echoPath: [{ row: 1, col: 1 }],
  }
  const advanceAction = createAdvanceLevelAction(damagedWon1, {
    requireVictory: true,
    guardRunId: true,
  })
  assert.equal(advanceAction.type, LEVEL_TRANSITION_ACTIONS.ADVANCE_LEVEL)
  assert.equal(advanceAction.level, 2, 'Advance action targets Level 2')

  const level2 = gameReducer(damagedWon1, advanceAction)
  const expectedL2Config = getLevelConfig(2, state1.baseSeed)
  assert.equal(level2.currentLevel, 2, 'Level advances from 1 to 2')
  assert.equal(level2.maze.level, 2, 'Fresh maze level metadata matches Level 2')
  assert.equal(level2.maze.rows, expectedL2Config.rows, 'Level 2 maze rows match levelProgression')
  assert.equal(level2.maze.cols, expectedL2Config.cols, 'Level 2 maze cols match levelProgression')
  assert.notEqual(level2.seed, damagedWon1.seed, 'Level 2 uses a fresh level-derived seed')
  assert.notEqual(level2.maze, damagedWon1.maze, 'Level 2 generates a brand-new maze object')
  assert.equal(level2.baseSeed, damagedWon1.baseSeed, 'Run baseSeed is preserved across levels')
  assert.equal(level2.levelsCompleted, 1, 'Run levelsCompleted is preserved across advancement')
  assert.equal(level2.highestLevelReached, 2, 'highestLevelReached updates to 2')
  assert.equal(level2.hasWon, false, 'hasWon resets on Next Level')
  assert.equal(level2.completedLevel, null, 'completedLevel resets on Next Level')
  assert.equal(level2.completedRunId, null, 'completedRunId resets on Next Level')
  assert.equal(level2.health, level2.maxHealth, 'Health resets to maxHealth on Next Level')
  assert.equal(level2.battery, level2.maxBattery, 'Battery resets to maxBattery on Next Level')
  assert.equal(level2.keysCollected, 0, 'keysCollected resets on Next Level')
  assert.equal(level2.itemsCollected, 0, 'itemsCollected resets on Next Level')
  assert.equal(level2.shardsCollected, 0, 'shardsCollected resets on Next Level')
  assert.equal(level2.shardBonus, 0, 'shardBonus resets on Next Level')
  assert.deepEqual(level2.playerPos, level2.maze.start, 'Player resets to Level 2 start cell')
  assert.equal(level2.runId, damagedWon1.runId + 1, 'runId increments so timers reset cleanly')
  assert.ok(Array.isArray(level2.maze.hazards), 'Level 2 applies hazard configuration')
  assert.ok(Array.isArray(level2.maze.hidingSpots), 'Level 2 applies hiding-spot configuration')
  assert.ok(Array.isArray(level2.maze.collectibles?.items), 'Level 2 applies collectible configuration')
  assert.ok(Array.isArray(level2.maze.enemies), 'Level 2 applies enemy configuration')

  // Test A4: Rapid duplicate ADVANCE_LEVEL dispatches from the same victory state NEVER skip a level
  const duplicateAdvance = gameReducer(level2, advanceAction)
  assert.equal(duplicateAdvance, level2, 'Stale duplicate ADVANCE_LEVEL dispatch is ignored')
  assert.equal(duplicateAdvance.currentLevel, 2, 'Rapid duplicate advance never skips to Level 3')

  // Attempting ADVANCE_LEVEL with requireVictory=true before winning Level 2 is rejected
  const prematureAdvance = createAdvanceLevelAction(level2, { requireVictory: true, guardRunId: true })
  assert.equal(
    gameReducer(level2, prematureAdvance),
    level2,
    'ADVANCE_LEVEL with requireVictory=true rejected when hasWon is false'
  )

  // Test A5: REPLAY_LEVEL replays the exact same completed level without incrementing currentLevel
  const unlocked2 = collectAllKeycardsInState(level2)
  const won2 = gameReducer(unlocked2, { type: 'COMPLETE_EXIT_EXTRACTION' })
  assert.equal(won2.currentLevel, 2)
  assert.equal(won2.completedLevel, 2)
  assert.equal(won2.levelsCompleted, 2)

  const replayAction = createReplayLevelAction(won2, { guardRunId: true })
  const replayed2 = gameReducer(won2, replayAction)
  assert.equal(replayed2.currentLevel, 2, 'REPLAY_LEVEL does not increment level')
  assert.equal(replayed2.maze, won2.maze, 'REPLAY_LEVEL preserves the exact same maze')
  assert.equal(replayed2.seed, won2.seed, 'REPLAY_LEVEL preserves the exact same seed')
  assert.equal(replayed2.hasWon, false, 'REPLAY_LEVEL clears hasWon')
  assert.equal(replayed2.completedLevel, null, 'REPLAY_LEVEL clears completedLevel')
  assert.equal(replayed2.keysCollected, 0, 'REPLAY_LEVEL resets keycards')
  assert.equal(replayed2.isExitLocked, true, 'REPLAY_LEVEL re-locks exit gate')
  assert.deepEqual(replayed2.playerPos, replayed2.maze.start, 'REPLAY_LEVEL returns player to start')
  assert.equal(replayed2.runId, won2.runId + 1, 'REPLAY_LEVEL increments runId for timer reset')
  // Stale duplicate replay action is ignored
  assert.equal(gameReducer(replayed2, replayAction), replayed2, 'Stale duplicate REPLAY_LEVEL is ignored')

  // Test A6: NEW_GAME resets progression cleanly to Level 1
  const newRun = gameReducer(won2, createNewGameAction(won2))
  assert.equal(newRun.currentLevel, 1, 'NEW_GAME resets currentLevel to 1')
  assert.equal(newRun.levelsCompleted, 0, 'NEW_GAME resets levelsCompleted to 0')
  assert.equal(newRun.highestLevelReached, 1, 'NEW_GAME resets highestLevelReached to 1')
  assert.equal(newRun.hasWon, false, 'NEW_GAME resets hasWon to false')
  assert.equal(newRun.completedLevel, null, 'NEW_GAME clears completedLevel')

  // Test A7: Infinite level progression (Level 5000 -> Level 5001) with zero max-level cap
  const level5000 = createInitialGameState({ level: 5000, baseSeed: 777123, objectivesEnabled: true })
  assert.equal(level5000.currentLevel, 5000)
  const unlocked5000 = collectAllKeycardsInState(level5000)
  const won5000 = gameReducer(unlocked5000, { type: 'COMPLETE_EXIT_EXTRACTION' })
  assert.equal(won5000.hasWon, true)
  assert.equal(won5000.completedLevel, 5000)

  const level5001 = gameReducer(
    won5000,
    createAdvanceLevelAction(won5000, { requireVictory: true, guardRunId: true })
  )
  const expectedL5001Config = getLevelConfig(5001, level5000.baseSeed)
  assert.equal(level5001.currentLevel, 5001, 'Level 5000 advances cleanly to Level 5001')
  assert.equal(level5001.highestLevelReached, 5001)
  assert.equal(level5001.maze.level, 5001)
  assert.equal(level5001.maze.rows, expectedL5001Config.rows)
  assert.equal(level5001.maze.cols, expectedL5001Config.cols)
  assert.notEqual(level5001.seed, level5000.seed, 'Level 5001 gets a distinct seed from Level 5000')
  assert.ok(level5001.totalKeys > 0, 'Level 5001 maintains keycard objectives')
  assert.ok(level5001.maze.hazards.length > 0, 'Level 5001 places progressive hazards')
  assert.ok(level5001.maze.hidingSpots.length > 0, 'Level 5001 places progressive hiding spots')
  assert.ok(level5001.maze.enemies.length > 0, 'Level 5001 places progressive enemies')
  console.log('  [PASS] Part A pure reducer, objective gating, advance/replay/menu & Level 5000->5001 checks')
}

// ============================================================================
// PART B: Live Mounted React DOM Integration (<VictoryModal /> & <App />)
// ============================================================================
console.log('Part B: Mounted React DOM VictoryModal & Full App Integration')

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
  const { resolveVictoryModalViewModel } = await viteServer.ssrLoadModule(
    '/src/components/game/victoryModalState.js'
  )

  const clickDomElement = async (el) => {
    assert.ok(el, 'Expected clickable DOM element to exist')
    await act(async () => {
      el.dispatchEvent({
        type: 'click',
        bubbles: true,
        detail: 1,
      })
    })
  }

  // Test B0: resolveVictoryModalViewModel pure guards
  {
    const baseState = createInitialGameState({ level: 3, baseSeed: 303030, objectivesEnabled: true })
    assert.equal(
      resolveVictoryModalViewModel({ isPlaying: true, state: baseState }).isOpen,
      false,
      'View model keeps modal closed during active play'
    )
    assert.equal(
      resolveVictoryModalViewModel({
        isPlaying: true,
        state: { ...baseState, hasWon: true, isExitLocked: true },
      }).isOpen,
      false,
      'View model refuses to open when exit is still locked'
    )
    const unlocked = collectAllKeycardsInState(baseState)
    const won3 = gameReducer(unlocked, { type: 'COMPLETE_EXIT_EXTRACTION' })
    const vm = resolveVictoryModalViewModel({ isPlaying: true, state: won3 })
    assert.equal(vm.isOpen, true, 'View model opens on valid completion')
    assert.equal(vm.completedLevel, 3)
    assert.equal(vm.nextLevel, 4)
    assert.equal(
      resolveVictoryModalViewModel({ isPlaying: false, state: won3 }).isOpen,
      false,
      'View model stays closed when on main menu (isPlaying=false)'
    )
  }

  // Persist a custom user setting BEFORE playing so we can confirm Main Menu preserves settings
  const initialLoaded = loadAllSettings()
  const customSettings = {
    ...initialLoaded,
    audio: {
      ...initialLoaded.audio,
      master: 0.42,
      masterVolume: 42,
      subtitles: true,
    },
    graphics: {
      ...initialLoaded.graphics,
      highContrast: true,
    },
  }
  saveAllSettings(customSettings)

  // Mount full <App /> starting in gameplay at Level 1
  const container = domEnv.document.createElement('div')
  domEnv.document.body.appendChild(container)
  const root = createRoot(container)
  const readyEngines = []
  const recordedEvents = []

  const fastLevelTransitionConfig = {
    doorsCloseDurationMs: 50,
    travelMinDurationMs: 60,
    doorsOpenDurationMs: 50,
    maxTravelTimeoutMs: 1500,
  }

  const waitForCondition = async (predicate, timeoutMs = 1500) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 12))
      })
    }
    assert.ok(predicate(), 'Timed out waiting for elevator transition condition')
  }

  const mountApp = async (props = {}) => {
    await act(async () => {
      root.render(
        createElement(App, {
          initialPlaying: true,
          levelTransitionConfig: fastLevelTransitionConfig,
          viewportEngineConfig: {
            createRenderer: createMockWebGLRenderer,
            isSoftwareGl: true,
            pointerLockEnabled: false,
            skipSpawnSequence: true,
          },
          onViewportReady: ({ engine }) => {
            readyEngines.push(engine)
          },
          onGameEvent: (evt) => {
            recordedEvents.push(evt)
          },
          ...props,
        })
      )
    })
  }

  await mountApp({
    initialGameState: createInitialGameState({ level: 1, baseSeed: 515151, objectivesEnabled: true }),
  })

  const engine = readyEngines[0]
  assert.ok(engine, 'App mounted MazeViewport3D engine cleanly')
  const level1Maze = engine._currentMaze
  assert.equal(level1Maze.level, 1, 'Initial gameplay starts at Level 1')
  assert.equal(
    container.querySelectorAll('.lv-modal--victory').length,
    0,
    'Victory modal is NOT open before completion'
  )

  // Test B1: Reaching exit without required keycards does NOT open VictoryModal
  await act(async () => {
    engine._movementOptions?.onPlayerCellChange?.({
      row: level1Maze.exit.row,
      col: level1Maze.exit.col,
    })
    engine._onExtractionComplete?.()
  })
  assert.equal(
    container.querySelectorAll('.lv-modal--victory').length,
    0,
    'Victory modal cannot appear when player reaches locked exit without keycards'
  )

  // Test B2: Pause near completion + collect all keycards + complete extraction
  // Verify Pause screen closes cleanly and exactly ONE VictoryModal renders
  await act(async () => {
    domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
  })
  assert.ok(
    container.querySelector('[role="region"][aria-label="Game Paused"]'),
    'Pause screen opens via P shortcut before completion'
  )

  // Simulate collecting all Level 1 keycards and extraction completing while pause flag was open
  for (const kc of [...level1Maze.keycards]) {
    await act(async () => {
      engine._movementOptions?.onPlayerCellChange?.({ row: kc.row, col: kc.col })
    })
  }
  await act(async () => {
    engine._onExtractionComplete?.()
  })
  // Trigger a second duplicate extraction callback to prove no duplicate modals/events
  await act(async () => {
    engine._onExtractionComplete?.()
  })

  assert.equal(
    container.querySelector('[role="region"][aria-label="Game Paused"]'),
    null,
    'Pause screen closes cleanly when level completion fires'
  )
  assert.equal(
    container.querySelectorAll('.lv-modal--victory').length,
    1,
    'Exactly one VictoryModal renders on level completion'
  )
  const victoryModalEl = container.querySelector('.lv-modal--victory')
  assert.equal(
    victoryModalEl?.querySelector('.lv-modal__title')?.textContent?.trim(),
    'Maze Escaped',
    'VictoryModal renders Maze Escaped heading'
  )
  assert.ok(
    container.querySelector('[data-testid="victory-completed-level"]')?.textContent?.includes('Level 1'),
    'VictoryModal displays completed Level 1 prominently'
  )
  assert.ok(
    container.querySelector('[data-testid="victory-next-level"]')?.textContent?.includes('Level 2'),
    'VictoryModal displays next Level 2 prominently'
  )

  const nextBtn = container.querySelector('[data-testid="victory-next-level-btn"]')
  const replayBtn = container.querySelector('[data-testid="victory-replay-level-btn"]')
  const mainMenuBtn = container.querySelector('[data-testid="victory-main-menu-btn"]')
  assert.ok(nextBtn && nextBtn.textContent.trim() === 'Next Level', 'Next Level button rendered')
  assert.ok(replayBtn && replayBtn.textContent.trim() === 'Replay Level', 'Replay Level button rendered')
  assert.ok(mainMenuBtn && mainMenuBtn.textContent.trim() === 'Main Menu', 'Main Menu button rendered')

  // Keyboard accessibility: primary Next Level button is auto-focused inside VictoryModal
  assert.equal(
    domEnv.document.activeElement,
    nextBtn,
    'Primary Next Level action receives initial keyboard focus'
  )

  // Pause shortcut P must NOT open Pause screen on top of VictoryModal
  await act(async () => {
    domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
  })
  assert.equal(
    container.querySelector('[role="region"][aria-label="Game Paused"]'),
    null,
    'Pause shortcut cannot open Pause screen over VictoryModal'
  )

  // Test B3: Rapidly clicking Next Level multiple times starts elevator transition and advances ONLY ONCE (Level 1 -> Level 2)
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      nextBtn.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
    }
  })

  assert.equal(
    container.querySelectorAll('.lv-modal--victory').length,
    0,
    'VictoryModal closes immediately after clicking Next Level'
  )
  assert.ok(
    container.querySelector('[data-testid="elevator-level-transition"]'),
    'Elevator level transition overlay mounts immediately after clicking Next Level'
  )

  await waitForCondition(
    () =>
      engine._currentMaze?.level === 2 &&
      !container.querySelector('[data-testid="elevator-level-transition"]')
  )

  const level2Maze = engine._currentMaze
  assert.equal(level2Maze.level, 2, 'Rapid multi-clicks advance ONLY to Level 2 (never skipping)')
  assert.notEqual(level2Maze.seed, level1Maze.seed, 'Level 2 generates a fresh maze seed')
  assert.notEqual(level2Maze, level1Maze, 'Level 2 does not replay Level 1 maze')
  assert.equal(engine.isPaused, false, '3D engine is unpaused and active on Level 2')

  // Test B4: Complete Level 2, then click REPLAY LEVEL -> stays on Level 2 with same maze
  for (const kc of [...level2Maze.keycards]) {
    await act(async () => {
      engine._movementOptions?.onPlayerCellChange?.({ row: kc.row, col: kc.col })
    })
  }
  await act(async () => {
    engine._onExtractionComplete?.()
  })

  assert.equal(container.querySelectorAll('.lv-modal--victory').length, 1, 'Level 2 VictoryModal opens')
  assert.ok(
    container.querySelector('[data-testid="victory-completed-level"]')?.textContent?.includes('Level 2'),
    'Level 2 VictoryModal shows Level 2 completed'
  )
  assert.ok(
    container.querySelector('[data-testid="victory-next-level"]')?.textContent?.includes('Level 3'),
    'Level 2 VictoryModal shows Level 3 next'
  )

  const replayBtnL2 = container.querySelector('[data-testid="victory-replay-level-btn"]')
  await clickDomElement(replayBtnL2)

  assert.equal(container.querySelectorAll('.lv-modal--victory').length, 0, 'Replay Level closes VictoryModal')
  assert.equal(engine._currentMaze.level, 2, 'Replay Level keeps currentLevel at 2')
  assert.equal(engine._currentMaze.seed, level2Maze.seed, 'Replay Level preserves Level 2 seed')
  assert.equal(engine._currentMaze, level2Maze, 'Replay Level replays the exact Level 2 maze')
  assert.equal(engine.isPaused, false, 'Engine resumes cleanly on replayed Level 2')

  // Test B5: Complete replayed Level 2, click MAIN MENU -> returns to StartScreen, preserves persisted settings, and starting a new game begins at Level 1
  for (const kc of [...level2Maze.keycards]) {
    await act(async () => {
      engine._movementOptions?.onPlayerCellChange?.({ row: kc.row, col: kc.col })
    })
  }
  await act(async () => {
    engine._onExtractionComplete?.()
  })
  assert.equal(container.querySelectorAll('.lv-modal--victory').length, 1, 'Replayed Level 2 completes cleanly')

  const mainMenuBtnL2 = container.querySelector('[data-testid="victory-main-menu-btn"]')
  await clickDomElement(mainMenuBtnL2)

  assert.equal(container.querySelectorAll('.lv-modal--victory').length, 0, 'Main Menu clears VictoryModal')
  assert.ok(
    container.querySelector('[data-testid="start-game-btn"]'),
    'Main Menu navigates back to StartScreen'
  )
  // Persisted settings MUST survive returning to Main Menu
  const reloadedSettings = loadAllSettings()
  assert.equal(
    reloadedSettings.audio.master,
    0.42,
    'Persisted audio master volume survives returning to Main Menu'
  )
  assert.equal(
    reloadedSettings.audio.subtitles,
    true,
    'Persisted subtitles setting survives returning to Main Menu'
  )
  assert.equal(
    reloadedSettings.graphics.highContrast,
    true,
    'Persisted highContrast setting survives returning to Main Menu'
  )
  assert.ok(
    domEnv.window.localStorage.getItem(STORAGE_KEYS.SETTINGS),
    'Settings remain stored in localStorage'
  )

  // Clicking Start Game from Main Menu starts a fresh game back at Level 1
  const startGameBtn = container.querySelector('[data-testid="start-game-btn"]')
  const enginesBeforeRestart = readyEngines.length
  await clickDomElement(startGameBtn)
  assert.ok(
    readyEngines.length > enginesBeforeRestart,
    'Starting a new game from Main Menu mounts a fresh MazeViewport3D engine'
  )
  const freshEngine = readyEngines[readyEngines.length - 1]
  assert.equal(
    freshEngine._currentMaze.level,
    1,
    'New game launched after Main Menu begins cleanly at Level 1'
  )

  await act(async () => {
    root.unmount()
  })

  // Test B6: Mounted App at Level 5000 -> VictoryModal shows Level 5000 -> Level 5001 -> clicking Next Level advances to Level 5001
  const container5000 = domEnv.document.createElement('div')
  domEnv.document.body.appendChild(container5000)
  const root5000 = createRoot(container5000)
  const engines5000 = []

  await act(async () => {
    root5000.render(
      createElement(App, {
        initialPlaying: true,
        levelTransitionConfig: fastLevelTransitionConfig,
        initialGameState: createInitialGameState({
          level: 5000,
          baseSeed: 909090,
          objectivesEnabled: true,
        }),
        viewportEngineConfig: {
          createRenderer: createMockWebGLRenderer,
          isSoftwareGl: true,
          pointerLockEnabled: false,
          skipSpawnSequence: true,
        },
        onViewportReady: ({ engine: eng }) => {
          engines5000.push(eng)
        },
      })
    )
  })

  const eng5000 = engines5000[0]
  assert.ok(eng5000, 'Level 5000 engine mounted')
  assert.equal(eng5000._currentMaze.level, 5000, 'Engine starts at Level 5000')

  for (const kc of [...eng5000._currentMaze.keycards]) {
    await act(async () => {
      eng5000._movementOptions?.onPlayerCellChange?.({ row: kc.row, col: kc.col })
    })
  }
  await act(async () => {
    eng5000._onExtractionComplete?.()
  })

  assert.equal(
    container5000.querySelectorAll('.lv-modal--victory').length,
    1,
    'VictoryModal opens on Level 5000 completion'
  )
  assert.ok(
    container5000.querySelector('[data-testid="victory-completed-level"]')?.textContent?.includes('Level 5000'),
    'VictoryModal displays Level 5000 completed'
  )
  assert.ok(
    container5000.querySelector('[data-testid="victory-next-level"]')?.textContent?.includes('Level 5001'),
    'VictoryModal displays Level 5001 next'
  )

  const prevMaze5000 = eng5000._currentMaze
  await clickDomElement(container5000.querySelector('[data-testid="victory-next-level-btn"]'))

  assert.equal(
    container5000.querySelectorAll('.lv-modal--victory').length,
    0,
    'Level 5000 VictoryModal closes after clicking Next Level'
  )
  await waitForCondition(
    () =>
      eng5000._currentMaze?.level === 5001 &&
      !container5000.querySelector('[data-testid="elevator-level-transition"]')
  )
  assert.equal(
    eng5000._currentMaze.level,
    5001,
    'Clicking Next Level on Level 5000 advances cleanly to Level 5001'
  )
  assert.notEqual(
    eng5000._currentMaze.seed,
    prevMaze5000.seed,
    'Level 5001 generates a fresh maze seed'
  )

  await act(async () => {
    root5000.unmount()
  })

  console.log('  [PASS] Part B mounted React DOM VictoryModal, Next Level, Replay Level, Main Menu, rapid-click, pause & Level 5000->5001 checks')
  console.log('\nALL MAZE-VICTORY-001 PROGRESSIVE LEVEL COMPLETION TESTS PASSED!')
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
