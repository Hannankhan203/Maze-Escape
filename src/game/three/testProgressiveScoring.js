/**
 * MAZE-SCORING-001 — Progressive Cumulative Scoring, Par Time & Star Rating
 * Comprehensive Integration & Behavioral Verification Suite
 *
 * Covers all 22 scenarios required by MAZE-SCORING-001:
 *  1. Progressive level score calculation
 *  2. Par-time calculation scaling with maze dimensions and path length
 *  3. Par-time scaling with enemy count, AI difficulty, hazard count, and keycards
 *  4. Time bonus calculation for under-par completion
 *  5. Time bonus calculation for near-par completion
 *  6. Time bonus calculation for over-par completion
 *  7. Time bonus cap preventing runaway score exploits
 *  8. Soul Shard score contribution
 *  9. Other collectible score contribution
 * 10. Keycard/objective score contribution
 * 11. Survival/health/no-damage bonus and tracked damage penalty
 * 12. 3-star rating threshold
 * 13. 2-star rating threshold
 * 14. 1-star rating threshold
 * 15. 0-star rating threshold
 * 16. Cumulative score progression across Level 1 -> Level 2 -> Level 3
 * 17. Replay behavior ensuring replaying the same level cannot farm infinite cumulative score
 * 18. Restart behavior after death or from pause
 * 19. New game reset behavior
 * 20. VictoryModal rendering of level score, cumulative score, stars, par time, and completion time
 * 21. HUD score display and synchronization with authoritative state
 * 22. High-level progression (Level 5000 -> Level 5001) with safe integer score and par-time calculation
 */

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

import {
  MAX_SAFE_SCORE,
  PROGRESSIVE_SCORE_CONFIG,
  STAR_THRESHOLDS,
  calculateLiveLevelScore,
  calculateParTimeMs,
  calculateRunScore,
  calculateStarRating,
  clampSafeScore,
  getCollectibleBonusValue,
  getKeycardBonusValue,
  getLevelScoreMultiplier,
  getLevelTimeBonusMultiplier,
  getShardBonusValue,
  resolveAuthoritativeHudScore,
  resolveVictorySummary,
} from '../mechanics/scoring.js'
import { getLevelConfig } from '../mechanics/levelProgression.js'
import {
  createAdvanceLevelAction,
  createInitialGameState,
  createNewGameAction,
  createReplayLevelAction,
  gameReducer,
} from '../engine/gameReducer.js'
import { resolveVictoryModalViewModel } from '../../components/game/victoryModalState.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let passed = 0
let failed = 0
const failures = []

function assert(condition, label, detail = '') {
  if (condition) {
    passed += 1
  } else {
    failed += 1
    const msg = detail ? `${label} — ${detail}` : label
    failures.push(msg)
    console.error(`  ✗ FAIL: ${msg}`)
  }
}

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

  globalThis.window = windowObj
  globalThis.document = doc
  globalThis.localStorage = localStorage
  Object.defineProperty(globalThis, 'navigator', {
    value: windowObj.navigator,
    configurable: true,
    writable: true,
  })
  globalThis.HTMLElement = windowObj.HTMLElement
  globalThis.HTMLIFrameElement = windowObj.HTMLIFrameElement
  globalThis.Element = windowObj.Element
  globalThis.Node = windowObj.Node
  globalThis.Text = windowObj.Text
  globalThis.DocumentFragment = windowObj.DocumentFragment
  globalThis.requestAnimationFrame = windowObj.requestAnimationFrame.bind(windowObj)
  globalThis.cancelAnimationFrame = windowObj.cancelAnimationFrame.bind(windowObj)

  return {
    window: windowObj,
    document: doc,
    localStorage,
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

/**
 * Helper to collect all keycards in a state so exit unlocks, then complete extraction.
 */
function completeLevelWithStats(
  initialState,
  {
    collectShardsCount = 0,
    collectNonShardCount = 0,
    damageInstances = [],
    completionTimeMs = 15000,
  } = {}
) {
  let s = initialState

  // Collect required keycards
  const keycards = Array.isArray(s.keycards) ? [...s.keycards] : []
  for (const keycard of keycards) {
    s = gameReducer(s, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: keycard.row, col: keycard.col },
    })
  }

  // Collect requested number of Soul Shards
  const shardItems = (s.items || []).filter((item) => item.type === 'soul_shards')
  for (let i = 0; i < Math.min(collectShardsCount, shardItems.length); i += 1) {
    s = gameReducer(s, {
      type: 'COLLECT_ITEM',
      position: { row: shardItems[i].row, col: shardItems[i].col },
    })
  }

  // Collect requested number of non-shard collectibles
  const nonShardItems = (s.items || []).filter((item) => item.type !== 'soul_shards')
  for (let i = 0; i < Math.min(collectNonShardCount, nonShardItems.length); i += 1) {
    s = gameReducer(s, {
      type: 'COLLECT_ITEM',
      position: { row: nonShardItems[i].row, col: nonShardItems[i].col },
    })
  }

  // Apply damage instances
  for (const dmg of damageInstances) {
    s = gameReducer(s, {
      type: 'DAMAGE_PLAYER',
      damage: dmg,
    })
  }

  // Complete exit extraction with deterministic completionTimeMs
  s = gameReducer(s, {
    type: 'COMPLETE_EXIT_EXTRACTION',
    completionTimeMs,
  })
  s = gameReducer(s, {
    type: 'FINALIZE_LEVEL_SCORE',
    runId: s.runId,
    completionTimeMs,
  })

  return s
}

async function runTests() {
  console.log('=== MAZE-SCORING-001: Progressive Cumulative Scoring, Par Time & Star Rating ===\n')

  // ---------------------------------------------------------------------------
  // Scenario 1: Progressive level score calculation
  // ---------------------------------------------------------------------------
  console.log('1. Testing progressive level score calculation...')
  {
    const l1Mult = getLevelScoreMultiplier(1)
    const l2Mult = getLevelScoreMultiplier(2)
    const l5Mult = getLevelScoreMultiplier(5)
    const l20Mult = getLevelScoreMultiplier(20)
    const l100Mult = getLevelScoreMultiplier(100)

    assert(l1Mult === 1, 'Level 1 score multiplier is 1.0', `got ${l1Mult}`)
    assert(l2Mult > l1Mult, 'Level 2 score multiplier exceeds Level 1', `${l2Mult} > ${l1Mult}`)
    assert(l5Mult > l2Mult, 'Level 5 score multiplier exceeds Level 2', `${l5Mult} > ${l2Mult}`)
    assert(l20Mult > l5Mult, 'Level 20 score multiplier exceeds Level 5', `${l20Mult} > ${l5Mult}`)
    assert(l100Mult > l20Mult, 'Level 100 score multiplier exceeds Level 20', `${l100Mult} > ${l20Mult}`)

    const scoreL1 = calculateRunScore({
      level: 1,
      parMoves: 20,
      rows: 11,
      cols: 11,
      completionTimeMs: 12000,
      shardsCollected: 2,
      totalShards: 4,
      nonShardCollectiblesCollected: 1,
      totalNonShardCollectibles: 2,
      keysCollected: 1,
      totalKeys: 1,
      objectivesEnabled: true,
      health: 100,
      maxHealth: 100,
    })
    const scoreL10 = calculateRunScore({
      level: 10,
      parMoves: 20,
      rows: 11,
      cols: 11,
      completionTimeMs: 12000,
      shardsCollected: 2,
      totalShards: 4,
      nonShardCollectiblesCollected: 1,
      totalNonShardCollectibles: 2,
      keysCollected: 1,
      totalKeys: 1,
      objectivesEnabled: true,
      health: 100,
      maxHealth: 100,
    })

    assert(
      scoreL10.baseScore > scoreL1.baseScore,
      'Level 10 base completion score exceeds Level 1 base completion score',
      `${scoreL10.baseScore} > ${scoreL1.baseScore}`
    )
    assert(
      scoreL1.levelCompletionScore === scoreL1.baseScore,
      'levelCompletionScore aliases baseScore cleanly'
    )
    assert(
      scoreL1.score ===
        scoreL1.baseScore +
          scoreL1.timeBonus +
          scoreL1.healthBonus +
          scoreL1.keycardBonus +
          scoreL1.shardBonus +
          scoreL1.collectibleBonus -
          scoreL1.damagePenalty,
      'Total level score equals sum of itemized breakdown components minus damage penalty',
      `got ${scoreL1.score}`
    )
  }

  // ---------------------------------------------------------------------------
  // Scenario 2: Par-time calculation scaling with maze dimensions & path length
  // ---------------------------------------------------------------------------
  console.log('2. Testing par-time scaling with maze dimensions and path length...')
  {
    const smallShortPar = calculateParTimeMs({
      level: 1,
      rows: 11,
      cols: 11,
      parMoves: 18,
      enemyCount: 1,
      hazardCount: 4,
      totalKeys: 1,
      objectivesEnabled: true,
    })
    const largeShortPar = calculateParTimeMs({
      level: 1,
      rows: 31,
      cols: 31,
      parMoves: 18,
      enemyCount: 1,
      hazardCount: 4,
      totalKeys: 1,
      objectivesEnabled: true,
    })
    const largeLongPar = calculateParTimeMs({
      level: 1,
      rows: 31,
      cols: 31,
      parMoves: 95,
      enemyCount: 1,
      hazardCount: 4,
      totalKeys: 1,
      objectivesEnabled: true,
    })

    assert(
      largeShortPar > smallShortPar,
      'Larger maze dimensions (31x31 vs 11x11) increase par time',
      `${largeShortPar} > ${smallShortPar}`
    )
    assert(
      largeLongPar > largeShortPar,
      'Longer solution path (95 moves vs 18 moves) increases par time',
      `${largeLongPar} > ${largeShortPar}`
    )
  }

  // ---------------------------------------------------------------------------
  // Scenario 3: Par-time scaling with enemy count, AI difficulty, hazards, keycards
  // ---------------------------------------------------------------------------
  console.log('3. Testing par-time scaling with enemies, AI difficulty, hazards, and keycards...')
  {
    const basePar = calculateParTimeMs({
      level: 1,
      rows: 17,
      cols: 17,
      parMoves: 36,
      enemyCount: 1,
      aiDifficultyMultiplier: 1.0,
      hazardCount: 4,
      totalKeys: 1,
      objectivesEnabled: true,
    })
    const moreEnemiesPar = calculateParTimeMs({
      level: 1,
      rows: 17,
      cols: 17,
      parMoves: 36,
      enemyCount: 5,
      aiDifficultyMultiplier: 1.0,
      hazardCount: 4,
      totalKeys: 1,
      objectivesEnabled: true,
    })
    const harderAiPar = calculateParTimeMs({
      level: 1,
      rows: 17,
      cols: 17,
      parMoves: 36,
      enemyCount: 5,
      aiDifficultyMultiplier: 1.85,
      hazardCount: 4,
      totalKeys: 1,
      objectivesEnabled: true,
    })
    const moreHazardsPar = calculateParTimeMs({
      level: 1,
      rows: 17,
      cols: 17,
      parMoves: 36,
      enemyCount: 5,
      aiDifficultyMultiplier: 1.85,
      hazardCount: 18,
      totalKeys: 1,
      objectivesEnabled: true,
    })
    const moreKeycardsPar = calculateParTimeMs({
      level: 1,
      rows: 17,
      cols: 17,
      parMoves: 36,
      enemyCount: 5,
      aiDifficultyMultiplier: 1.85,
      hazardCount: 18,
      totalKeys: 5,
      objectivesEnabled: true,
    })

    assert(moreEnemiesPar > basePar, 'Higher enemy count increases par time', `${moreEnemiesPar} > ${basePar}`)
    assert(harderAiPar > moreEnemiesPar, 'Higher AI difficulty multiplier increases par time', `${harderAiPar} > ${moreEnemiesPar}`)
    assert(moreHazardsPar > harderAiPar, 'Higher hazard count increases par time', `${moreHazardsPar} > ${harderAiPar}`)
    assert(moreKeycardsPar > moreHazardsPar, 'Higher required keycard count increases par time', `${moreKeycardsPar} > ${moreHazardsPar}`)

    const l1Cfg = getLevelConfig(1)
    const l5Cfg = getLevelConfig(5)
    const l15Cfg = getLevelConfig(15)
    const l1Par = calculateParTimeMs({ level: 1, levelConfig: l1Cfg, parMoves: 24 })
    const l5Par = calculateParTimeMs({ level: 5, levelConfig: l5Cfg, parMoves: 48 })
    const l15Par = calculateParTimeMs({ level: 15, levelConfig: l15Cfg, parMoves: 84 })
    assert(l5Par > l1Par, 'Level 5 par time > Level 1 par time', `${l5Par} > ${l1Par}`)
    assert(l15Par > l5Par, 'Level 15 par time > Level 5 par time', `${l15Par} > ${l5Par}`)
  }

  // ---------------------------------------------------------------------------
  // Scenario 4, 5, 6, 7: Time bonus under par, near par, over par, and cap
  // ---------------------------------------------------------------------------
  console.log('4-7. Testing time bonus under-par, near-par, over-par, and cap...')
  {
    const parTimeMs = calculateParTimeMs({
      level: 3,
      rows: 15,
      cols: 15,
      parMoves: 32,
      totalKeys: 2,
      objectivesEnabled: true,
    })

    const underPar = calculateRunScore({
      level: 3,
      parTimeMs,
      completionTimeMs: Math.round(parTimeMs * 0.45),
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
    })
    const nearPar = calculateRunScore({
      level: 3,
      parTimeMs,
      completionTimeMs: Math.round(parTimeMs * 0.92),
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
    })
    const exactPar = calculateRunScore({
      level: 3,
      parTimeMs,
      completionTimeMs: parTimeMs,
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
    })
    const overPar = calculateRunScore({
      level: 3,
      parTimeMs,
      completionTimeMs: Math.round(parTimeMs * 1.45),
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
    })
    const heavyOverPar = calculateRunScore({
      level: 3,
      parTimeMs,
      completionTimeMs: Math.round(parTimeMs * 5.0),
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
    })
    const zeroTimeExploitCheck = calculateRunScore({
      level: 3,
      parTimeMs,
      completionTimeMs: 0,
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
    })

    assert(underPar.isUnderPar === true, 'Under-par run has isUnderPar === true')
    assert(underPar.timeBonus > nearPar.timeBonus, 'Faster under-par completion yields higher time bonus than near-par', `${underPar.timeBonus} > ${nearPar.timeBonus}`)
    assert(nearPar.timeBonus > exactPar.timeBonus && exactPar.timeBonus > 0, 'Near-par completion yields higher time bonus than exact par', `${nearPar.timeBonus} > ${exactPar.timeBonus}`)
    assert(exactPar.isUnderPar === true && exactPar.timeDeltaMs === 0, 'Exact par completion has isUnderPar === true and timeDeltaMs === 0')
    assert(
      overPar.timeBonus < exactPar.timeBonus &&
        overPar.isUnderPar === false &&
        overPar.timeDeltaMs < 0 &&
        heavyOverPar.timeBonus === 0 &&
        heavyOverPar.isUnderPar === false,
      'Over-par completion decays time bonus down to 0 on heavy overtime, with negative timeDeltaMs and isUnderPar === false'
    )

    const expectedCap = Math.round(
      PROGRESSIVE_SCORE_CONFIG.timeBonusMax * getLevelTimeBonusMultiplier(3)
    )
    assert(
      zeroTimeExploitCheck.timeBonus === expectedCap &&
        zeroTimeExploitCheck.timeBonus <= zeroTimeExploitCheck.timeBonusCap,
      'Zero-ms completion time bonus is strictly capped by timeBonusCap',
      `timeBonus=${zeroTimeExploitCheck.timeBonus}, cap=${expectedCap}`
    )
  }

  // ---------------------------------------------------------------------------
  // Scenario 8, 9, 10: Soul Shard, Other Collectible, and Keycard contributions
  // ---------------------------------------------------------------------------
  console.log('8-10. Testing Soul Shard, non-shard collectible, and keycard score contributions...')
  {
    assert(getShardBonusValue(0) === 0, '0 shards = 0 bonus')
    assert(getShardBonusValue(4) === 4 * PROGRESSIVE_SCORE_CONFIG.shardBonusEach, '4 shards = 500 bonus')
    assert(getCollectibleBonusValue(0) === 0, '0 non-shard collectibles = 0 bonus')
    assert(getCollectibleBonusValue(3) === 3 * PROGRESSIVE_SCORE_CONFIG.collectibleBonusEach, '3 non-shard collectibles = 300 bonus')
    assert(getKeycardBonusValue(2, true) === 2 * PROGRESSIVE_SCORE_CONFIG.keycardBonusEach, '2 keycards = 600 bonus')

    const baseline = calculateRunScore({
      level: 2,
      parTimeMs: 30000,
      completionTimeMs: 20000,
      shardsCollected: 0,
      totalShards: 5,
      nonShardCollectiblesCollected: 0,
      totalNonShardCollectibles: 4,
      keysCollected: 0,
      totalKeys: 2,
      objectivesEnabled: true,
      health: 100,
      maxHealth: 100,
    })
    const withShards = calculateRunScore({
      level: 2,
      parTimeMs: 30000,
      completionTimeMs: 20000,
      shardsCollected: 3,
      totalShards: 5,
      nonShardCollectiblesCollected: 0,
      totalNonShardCollectibles: 4,
      keysCollected: 0,
      totalKeys: 2,
      objectivesEnabled: true,
      health: 100,
      maxHealth: 100,
    })
    const withCollectibles = calculateRunScore({
      level: 2,
      parTimeMs: 30000,
      completionTimeMs: 20000,
      shardsCollected: 3,
      totalShards: 5,
      nonShardCollectiblesCollected: 2,
      totalNonShardCollectibles: 4,
      keysCollected: 0,
      totalKeys: 2,
      objectivesEnabled: true,
      health: 100,
      maxHealth: 100,
    })
    const withKeycards = calculateRunScore({
      level: 2,
      parTimeMs: 30000,
      completionTimeMs: 20000,
      shardsCollected: 3,
      totalShards: 5,
      nonShardCollectiblesCollected: 2,
      totalNonShardCollectibles: 4,
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
      health: 100,
      maxHealth: 100,
    })

    assert(withShards.shardBonus === 375 && withShards.score - baseline.score === 375, 'Collecting 3 Soul Shards adds +375 to level score')
    assert(withCollectibles.collectibleBonus === 200 && withCollectibles.score - withShards.score === 200, 'Collecting 2 non-shard collectibles adds +200 to level score')
    assert(withKeycards.keycardBonus === 600 && withKeycards.score - withCollectibles.score === 600, 'Collecting 2 keycards adds +600 to level score')
  }

  // ---------------------------------------------------------------------------
  // Scenario 11: Survival/health/no-damage bonus & tracked damage penalty
  // ---------------------------------------------------------------------------
  console.log('11. Testing survival/health/no-damage bonus and tracked damage penalty...')
  {
    const flawless = calculateRunScore({
      level: 2,
      parTimeMs: 30000,
      completionTimeMs: 20000,
      health: 100,
      maxHealth: 100,
      damageTaken: 0,
      hitsTaken: 0,
      keysCollected: 1,
      totalKeys: 1,
      objectivesEnabled: true,
    })
    const damagedThenHealed = calculateRunScore({
      level: 2,
      parTimeMs: 30000,
      completionTimeMs: 20000,
      health: 100,
      maxHealth: 100,
      damageTaken: 35,
      hitsTaken: 2,
      keysCollected: 1,
      totalKeys: 1,
      objectivesEnabled: true,
    })
    const lowHealthHeavyDamage = calculateRunScore({
      level: 2,
      parTimeMs: 30000,
      completionTimeMs: 20000,
      health: 15,
      maxHealth: 100,
      damageTaken: 5000,
      hitsTaken: 80,
      keysCollected: 1,
      totalKeys: 1,
      objectivesEnabled: true,
    })

    assert(flawless.flawlessSurvival === true && flawless.damagePenalty === 0, 'Flawless run has flawlessSurvival === true and 0 damage penalty')
    assert(damagedThenHealed.flawlessSurvival === false && damagedThenHealed.damagePenalty > 0, 'Taking damage then healing to 100 HP still marks flawlessSurvival === false and applies damagePenalty')
    assert(flawless.score > damagedThenHealed.score, 'Flawless run scores higher than damaged-then-healed run', `${flawless.score} > ${damagedThenHealed.score}`)
    assert(lowHealthHeavyDamage.score > 0, 'Damage penalty is capped so level score never becomes negative or zero on completion', `score=${lowHealthHeavyDamage.score}, penalty=${lowHealthHeavyDamage.damagePenalty}`)
  }

  // ---------------------------------------------------------------------------
  // Scenario 12, 13, 14, 15: 3-star, 2-star, 1-star, and 0-star rating thresholds
  // ---------------------------------------------------------------------------
  console.log('12-15. Testing 3-star, 2-star, 1-star, and 0-star rating thresholds...')
  {
    assert(calculateStarRating(STAR_THRESHOLDS.threeStar) === 3, 'Ratio at threeStar threshold (0.72) -> 3 stars')
    assert(calculateStarRating(0.95) === 3, 'Ratio 0.95 -> 3 stars')
    assert(calculateStarRating(STAR_THRESHOLDS.twoStar) === 2, 'Ratio at twoStar threshold (0.42) -> 2 stars')
    assert(calculateStarRating(0.65) === 2, 'Ratio 0.65 -> 2 stars')
    assert(calculateStarRating(0.25) === 1, 'Ratio 0.25 -> 1 star')
    assert(calculateStarRating(0) === 1, 'Legacy calculateStarRating(0) -> 1 star for backward compatibility')
    assert(calculateStarRating(-0.05) === 0, 'Negative performance ratio -> 0 stars')
    assert(calculateStarRating(0.8, { objectivesComplete: false }) === 0, 'Incomplete required objectives -> 0 stars')
    assert(calculateStarRating(0.1, { allowZeroStars: true }) === 0, 'Ratio below oneStar threshold with allowZeroStars -> 0 stars')

    const parTimeMs = 30000
    const threeStarRun = calculateRunScore({
      level: 3,
      parTimeMs,
      completionTimeMs: 12000,
      shardsCollected: 4,
      totalShards: 4,
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
      health: 100,
      maxHealth: 100,
      damageTaken: 0,
      hitsTaken: 0,
    })
    const twoStarRun = calculateRunScore({
      level: 3,
      parTimeMs,
      completionTimeMs: 42000,
      shardsCollected: 2,
      totalShards: 4,
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
      health: 65,
      maxHealth: 100,
      damageTaken: 35,
      hitsTaken: 1,
    })
    const oneStarRun = calculateRunScore({
      level: 3,
      parTimeMs,
      completionTimeMs: 52000,
      shardsCollected: 0,
      totalShards: 4,
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
      health: 45,
      maxHealth: 100,
      damageTaken: 55,
      hitsTaken: 2,
    })
    const zeroStarRun = calculateRunScore({
      level: 3,
      parTimeMs,
      completionTimeMs: 110000,
      shardsCollected: 0,
      totalShards: 4,
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
      health: 10,
      maxHealth: 100,
      damageTaken: 160,
      hitsTaken: 6,
    })

    assert(threeStarRun.stars === 3, 'Fast, full-shard, flawless completion earns 3 stars', `got ${threeStarRun.stars} (ratio=${threeStarRun.performanceRatio})`)
    assert(twoStarRun.stars === 2, 'Moderate completion earns 2 stars', `got ${twoStarRun.stars} (ratio=${twoStarRun.performanceRatio})`)
    assert(oneStarRun.stars === 1, 'Slow, no-shard, moderate-damage completion earns 1 star', `got ${oneStarRun.stars} (ratio=${oneStarRun.performanceRatio})`)
    assert(zeroStarRun.stars === 0, 'Very slow + heavy-damage completion earns 0 stars', `got ${zeroStarRun.stars} (ratio=${zeroStarRun.performanceRatio})`)
  }

  // ---------------------------------------------------------------------------
  // Scenario 16: Cumulative score progression across Level 1 -> Level 2 -> Level 3
  // ---------------------------------------------------------------------------
  console.log('16. Testing cumulative score progression across Level 1 -> Level 2 -> Level 3...')
  {
    let state = createInitialGameState({ seed: 'prog-score-seed' })
    assert(state.currentLevel === 1, 'Initial level is 1')
    assert(state.cumulativeScore === 0 && state.levelBaseCumulativeScore === 0, 'Initial cumulativeScore and levelBaseCumulativeScore are 0')

    state = completeLevelWithStats(state, {
      collectShardsCount: 2,
      collectNonShardCount: 1,
      completionTimeMs: 14000,
    })
    const level1Score = state.lastLevelScoreSummary?.score || 0
    assert(state.hasWon === true, 'Level 1 completed')
    assert(level1Score > 0, 'Level 1 score > 0', `got ${level1Score}`)
    assert(state.cumulativeScore === level1Score, 'After Level 1 completion, cumulativeScore === level1Score', `${state.cumulativeScore} === ${level1Score}`)
    assert(state.levelBaseCumulativeScore === 0, 'During Level 1 victory, levelBaseCumulativeScore remains 0')

    state = gameReducer(state, createAdvanceLevelAction(state))
    assert(state.currentLevel === 2, 'Advanced to Level 2')
    assert(state.cumulativeScore === level1Score, 'Entering Level 2 preserves cumulativeScore from Level 1')
    assert(state.levelBaseCumulativeScore === level1Score, 'Entering Level 2 locks levelBaseCumulativeScore = level1Score')

    state = completeLevelWithStats(state, {
      collectShardsCount: 3,
      collectNonShardCount: 2,
      completionTimeMs: 18000,
    })
    const level2Score = state.lastLevelScoreSummary?.score || 0
    assert(level2Score > 0, 'Level 2 score > 0', `got ${level2Score}`)
    assert(
      state.cumulativeScore === level1Score + level2Score,
      'After Level 2 completion, cumulativeScore === level1Score + level2Score',
      `${state.cumulativeScore} === ${level1Score} + ${level2Score}`
    )

    state = gameReducer(state, createAdvanceLevelAction(state))
    assert(state.currentLevel === 3, 'Advanced to Level 3')
    assert(
      state.levelBaseCumulativeScore === level1Score + level2Score,
      'Entering Level 3 locks levelBaseCumulativeScore = level1Score + level2Score'
    )

    state = completeLevelWithStats(state, {
      collectShardsCount: 2,
      collectNonShardCount: 1,
      completionTimeMs: 22000,
    })
    const level3Score = state.lastLevelScoreSummary?.score || 0
    assert(
      state.cumulativeScore === level1Score + level2Score + level3Score,
      'After Level 3 completion, cumulativeScore === level1Score + level2Score + level3Score',
      `${state.cumulativeScore} === ${level1Score + level2Score + level3Score}`
    )
    assert(
      state.completedLevelScores[1]?.score === level1Score &&
        state.completedLevelScores[2]?.score === level2Score &&
        state.completedLevelScores[3]?.score === level3Score,
      'completedLevelScores records per-level score summaries for Levels 1, 2, and 3'
    )
  }

  // ---------------------------------------------------------------------------
  // Scenario 17: Replay behavior ensuring replaying same level cannot farm infinite score
  // ---------------------------------------------------------------------------
  console.log('17. Testing replay non-exploitation policy (replaying a level cannot farm cumulative score)...')
  {
    let state = createInitialGameState({ seed: 'replay-policy-seed' })
    state = completeLevelWithStats(state, {
      collectShardsCount: 2,
      completionTimeMs: 15000,
    })
    const l1Score = state.lastLevelScoreSummary.score
    state = gameReducer(state, createAdvanceLevelAction(state))
    assert(state.currentLevel === 2 && state.levelBaseCumulativeScore === l1Score, 'On Level 2 with base score from Level 1')

    state = completeLevelWithStats(state, {
      collectShardsCount: 0,
      completionTimeMs: 45000,
    })
    const l2FirstAttemptScore = state.lastLevelScoreSummary.score
    const cumulativeAfterFirstAttempt = state.cumulativeScore
    assert(cumulativeAfterFirstAttempt === l1Score + l2FirstAttemptScore, 'Cumulative score after first Level 2 completion is L1 + L2_attempt1')

    state = gameReducer(state, createReplayLevelAction(state))
    assert(state.currentLevel === 2, 'Still on Level 2 after REPLAY_LEVEL')
    assert(state.hasWon === false, 'hasWon reset to false on replay')
    assert(
      state.cumulativeScore === l1Score && state.levelBaseCumulativeScore === l1Score,
      'Replaying Level 2 restores cumulativeScore back to Level 2 entry base (L1 score) — no double counting!',
      `cumulativeScore=${state.cumulativeScore}, expected=${l1Score}`
    )
    assert(
      state.shardsCollected === 0 &&
        state.nonShardCollectiblesCollected === 0 &&
        state.keysCollected === 0 &&
        state.damageTaken === 0,
      'Replaying Level 2 resets current-level shards, items, keycards, and damage'
    )

    state = completeLevelWithStats(state, {
      collectShardsCount: 3,
      collectNonShardCount: 2,
      completionTimeMs: 14000,
    })
    const l2SecondAttemptScore = state.lastLevelScoreSummary.score
    assert(
      state.cumulativeScore === l1Score + l2SecondAttemptScore,
      'After replaying and completing Level 2, cumulativeScore equals L1 + L2_attempt2 (attempt 1 was replaced, never stacked)',
      `cumulative=${state.cumulativeScore}, expected=${l1Score + l2SecondAttemptScore}`
    )
  }

  // ---------------------------------------------------------------------------
  // Scenario 18 & 19: Restart behavior after death/pause & New Game reset behavior
  // ---------------------------------------------------------------------------
  console.log('18-19. Testing restart after death/pause and New Game reset to 0...')
  {
    let state = createInitialGameState({ seed: 'restart-reset-seed' })
    state = completeLevelWithStats(state, {
      collectShardsCount: 2,
      completionTimeMs: 14000,
    })
    const l1Score = state.lastLevelScoreSummary.score
    state = gameReducer(state, createAdvanceLevelAction(state))

    const shard = (state.items || []).find((item) => item.type === 'soul_shards')
    if (shard) {
      state = gameReducer(state, {
        type: 'COLLECT_ITEM',
        position: { row: shard.row, col: shard.col },
      })
    }
    state = gameReducer(state, { type: 'DAMAGE_PLAYER', damage: 999 })
    assert(state.isGameOver === true, 'Player died on Level 2')

    state = gameReducer(state, createReplayLevelAction(state))
    assert(state.currentLevel === 2 && !state.isGameOver, 'Restarted Level 2 after Game Over')
    assert(
      state.cumulativeScore === l1Score && state.levelBaseCumulativeScore === l1Score,
      'Restarting Level 2 after death preserves Level 1 cumulativeScore and discards failed Level 2 items'
    )
    assert(state.shardsCollected === 0 && state.shardBonus === 0, 'Failed attempt shards cleared on restart')

    state = gameReducer(state, createNewGameAction(state))
    assert(state.currentLevel === 1, 'NEW_GAME resets to Level 1')
    assert(
      state.cumulativeScore === 0 &&
        state.levelBaseCumulativeScore === 0 &&
        Object.keys(state.completedLevelScores || {}).length === 0 &&
        state.lastLevelScoreSummary === null,
      'NEW_GAME resets cumulativeScore, levelBaseCumulativeScore, completedLevelScores, and lastLevelScoreSummary to 0 / empty'
    )
  }

  // ---------------------------------------------------------------------------
  // Scenario 20 & 21: VictoryModal & HUD Score DOM Rendering and Synchronization
  // ---------------------------------------------------------------------------
  console.log('20-21. Testing VictoryModal and HUD score DOM rendering & live synchronization...')
  const env = createMiniDomEnv()
  const viteServer = await createServer({
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
    logLevel: 'error',
  })

  try {
    const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')
    const { default: VictoryModal } = await viteServer.ssrLoadModule('/src/components/game/VictoryModal.jsx')

    const container = env.document.createElement('div')
    container.id = 'root'
    env.document.body.appendChild(container)
    const root = createRoot(container)

    const sampleSummary = calculateRunScore({
      level: 2,
      parTimeMs: 35000,
      completionTimeMs: 18500,
      shardsCollected: 3,
      totalShards: 4,
      nonShardCollectiblesCollected: 2,
      totalNonShardCollectibles: 3,
      keysCollected: 2,
      totalKeys: 2,
      objectivesEnabled: true,
      health: 85,
      maxHealth: 100,
      damageTaken: 15,
      hitsTaken: 1,
    })

    await act(async () => {
      root.render(
        React.createElement(VictoryModal, {
          isOpen: true,
          completedLevel: 2,
          nextLevel: 3,
          victorySummary: {
            ...sampleSummary,
            levelBaseCumulativeScore: 2400,
            cumulativeScore: 2400 + sampleSummary.score,
          },
          cumulativeScore: 2400 + sampleSummary.score,
          formattedTime: '00:18.5',
          shardsCollected: 3,
          totalShards: 4,
          onNextLevel: () => {},
          onReplayLevel: () => {},
          onMainMenu: () => {},
        })
      )
    })

    const levelScoreEl = env.document.querySelector('[data-testid="victory-level-score"]')
    const cumulativeScoreEl = env.document.querySelector('[data-testid="victory-cumulative-score"]')
    const completionTimeEl = env.document.querySelector('[data-testid="victory-completion-time"]')
    const parTimeEl = env.document.querySelector('[data-testid="victory-par-time"]')
    const shardsEl = env.document.querySelector('[data-testid="victory-soul-shards"]')
    const timeBonusEl = env.document.querySelector('[data-testid="victory-time-bonus"]')
    const breakdownEl = env.document.querySelector('[data-testid="victory-score-breakdown"]')
    const starRatingEl = env.document.querySelector('[data-testid="victory-star-rating"]')

    assert(Boolean(levelScoreEl), 'VictoryModal renders [data-testid="victory-level-score"]')
    assert(
      levelScoreEl?.textContent?.includes(String(sampleSummary.score)),
      'VictoryModal displays level score',
      `got ${levelScoreEl?.textContent}`
    )
    assert(Boolean(cumulativeScoreEl), 'VictoryModal renders [data-testid="victory-cumulative-score"]')
    assert(
      cumulativeScoreEl?.textContent?.includes(String(2400 + sampleSummary.score)),
      'VictoryModal displays cumulative run score',
      `got ${cumulativeScoreEl?.textContent}`
    )
    assert(
      completionTimeEl?.textContent?.trim() === '00:18.5',
      'VictoryModal displays completion time',
      `got ${completionTimeEl?.textContent}`
    )
    assert(
      parTimeEl?.textContent?.trim() === '00:35.0',
      'VictoryModal displays formatted par time',
      `got ${parTimeEl?.textContent}`
    )
    assert(
      shardsEl?.textContent?.includes('3 / 4'),
      'VictoryModal displays collected Soul Shards',
      `got ${shardsEl?.textContent}`
    )
    assert(
      timeBonusEl?.textContent?.includes(`+${sampleSummary.timeBonus}`),
      'VictoryModal displays time bonus',
      `got ${timeBonusEl?.textContent}`
    )
    assert(
      starRatingEl?.getAttribute('data-stars') === String(sampleSummary.stars),
      'VictoryModal StarRating carries matching data-stars attribute',
      `got ${starRatingEl?.getAttribute('data-stars')}`
    )
    assert(
      breakdownEl?.textContent?.includes('Base') &&
        breakdownEl?.textContent?.includes('Time') &&
        breakdownEl?.textContent?.includes('Survival') &&
        breakdownEl?.textContent?.includes('Keys') &&
        breakdownEl?.textContent?.includes('Shards') &&
        breakdownEl?.textContent?.includes('Items') &&
        breakdownEl?.textContent?.includes('Penalty'),
      'VictoryModal breakdown shows Base, Time, Survival, Keys, Shards, Items, and Penalty',
      `got ${breakdownEl?.textContent}`
    )

    // Now test full App HUD score display and synchronization
    const initialAppState = createInitialGameState({ seed: 'hud-sync-seed' })
    await act(async () => {
      root.render(
        React.createElement(App, {
          initialPlaying: true,
          initialGameState: initialAppState,
          viewportEngineConfig: {
            rendererFactory: createMockWebGLRenderer,
            skipSpawnSequence: true,
          },
          levelTransitionConfig: {
            doorsCloseDurationMs: 15,
            travelMinDurationMs: 20,
            doorsOpenDurationMs: 15,
            maxTravelTimeoutMs: 120,
          },
          arrivalConfig: {
            startOverlayMinMs: 10,
            maxArrivalTimeoutMs: 60,
          },
        })
      )
    })

    const hudScoreEl = env.document.querySelector('[data-testid="maze-score-hud"]')
    const hudScoreNumEl = env.document.querySelector('[data-testid="maze-score-hud-number"]')
    const hudLevelEl = env.document.querySelector('[data-testid="maze-level-hud"]')
    const vitalsItems = env.document.querySelectorAll('.maze-vitals-hud__item')

    assert(Boolean(hudScoreEl), 'Gameplay HUD renders [data-testid="maze-score-hud"]')
    assert(hudScoreEl?.getAttribute('data-score') === '0', 'Initial HUD score is 0 on fresh Level 1')
    assert(hudScoreNumEl?.textContent?.trim() === '0', 'Initial HUD score number text is "0"')
    assert(hudLevelEl?.textContent?.trim() === 'LEVEL 01', 'Level HUD indicator still displays "LEVEL 01" cleanly')
    assert(vitalsItems.length === 4, 'Vitals HUD still has exactly 4 .maze-vitals-hud__item elements', `got ${vitalsItems.length}`)

    let liveState = initialAppState
    const firstKey = liveState.keycards[0]
    if (firstKey) {
      liveState = gameReducer(liveState, {
        type: 'SYNC_PLAYER_CELL',
        position: { row: firstKey.row, col: firstKey.col },
      })
    }
    const liveScoreAfterKey = resolveAuthoritativeHudScore({ state: liveState })
    assert(
      liveScoreAfterKey === PROGRESSIVE_SCORE_CONFIG.keycardBonusEach,
      'Live HUD score immediately reflects collected keycard (+300)',
      `got ${liveScoreAfterKey}`
    )

    const firstShard = (liveState.items || []).find((i) => i.type === 'soul_shards')
    if (firstShard) {
      liveState = gameReducer(liveState, {
        type: 'COLLECT_ITEM',
        position: { row: firstShard.row, col: firstShard.col },
      })
      const liveScoreAfterShard = resolveAuthoritativeHudScore({ state: liveState })
      assert(
        liveScoreAfterShard ===
          PROGRESSIVE_SCORE_CONFIG.keycardBonusEach + PROGRESSIVE_SCORE_CONFIG.shardBonusEach,
        'Live HUD score immediately reflects collected Soul Shard (+125)',
        `got ${liveScoreAfterShard}`
      )
    }

    await act(async () => {
      root.unmount()
    })
  } finally {
    env.cleanupAllTimers()
    await viteServer.close()
  }

  // ---------------------------------------------------------------------------
  // Scenario 22: High-level progression (Level 5000 -> Level 5001) safe integer verification
  // ---------------------------------------------------------------------------
  console.log('22. Testing high-level progression (Level 5000 -> Level 5001) safe integer calculation...')
  {
    const l5000Config = getLevelConfig(5000)
    const l5001Config = getLevelConfig(5001)

    const par5000 = calculateParTimeMs({
      level: 5000,
      levelConfig: l5000Config,
      rows: l5000Config.rows,
      cols: l5000Config.cols,
      parMoves: 450,
    })
    const par5001 = calculateParTimeMs({
      level: 5001,
      levelConfig: l5001Config,
      rows: l5001Config.rows,
      cols: l5001Config.cols,
      parMoves: 452,
    })

    assert(Number.isSafeInteger(par5000) && par5000 > 0, 'Level 5000 par time is a positive safe integer', `got ${par5000}`)
    assert(Number.isSafeInteger(par5001) && par5001 > 0, 'Level 5001 par time is a positive safe integer', `got ${par5001}`)

    const score5000 = calculateRunScore({
      level: 5000,
      levelConfig: l5000Config,
      parTimeMs: par5000,
      completionTimeMs: Math.round(par5000 * 0.65),
      shardsCollected: 12,
      totalShards: 12,
      nonShardCollectiblesCollected: 10,
      totalNonShardCollectibles: 10,
      keysCollected: l5000Config.keycardCount,
      totalKeys: l5000Config.keycardCount,
      objectivesEnabled: true,
      health: 100,
      maxHealth: 100,
      damageTaken: 0,
      hitsTaken: 0,
    })
    const score5001 = calculateRunScore({
      level: 5001,
      levelConfig: l5001Config,
      parTimeMs: par5001,
      completionTimeMs: Math.round(par5001 * 0.65),
      shardsCollected: 12,
      totalShards: 12,
      nonShardCollectiblesCollected: 10,
      totalNonShardCollectibles: 10,
      keysCollected: l5001Config.keycardCount,
      totalKeys: l5001Config.keycardCount,
      objectivesEnabled: true,
      health: 100,
      maxHealth: 100,
      damageTaken: 0,
      hitsTaken: 0,
    })

    assert(
      Number.isSafeInteger(score5000.score) &&
        score5000.score > 0 &&
        score5000.score <= MAX_SAFE_SCORE,
      'Level 5000 total score is a positive safe integer',
      `got ${score5000.score}`
    )
    assert(
      Number.isSafeInteger(score5001.score) &&
        score5001.score > 0 &&
        score5001.score <= MAX_SAFE_SCORE,
      'Level 5001 total score is a positive safe integer',
      `got ${score5001.score}`
    )
    assert(
      score5000.stars >= 0 && score5000.stars <= 3 && score5001.stars >= 0 && score5001.stars <= 3,
      'Level 5000 and 5001 star ratings remain within 0..3',
      `L5000=${score5000.stars}, L5001=${score5001.stars}`
    )

    const highBaseCumulative = 25_000_000
    let state5000 = createInitialGameState({
      level: 5000,
      seed: 'level-5000-seed',
      levelBaseCumulativeScore: highBaseCumulative,
      cumulativeScore: highBaseCumulative,
    })
    state5000 = completeLevelWithStats(state5000, {
      collectShardsCount: 3,
      collectNonShardCount: 2,
      completionTimeMs: Math.round(par5000 * 0.75),
    })
    const l5000Earned = state5000.lastLevelScoreSummary.score
    assert(
      state5000.cumulativeScore === highBaseCumulative + l5000Earned &&
        Number.isSafeInteger(state5000.cumulativeScore),
      'Level 5000 completion updates cumulativeScore safely without overflow',
      `cumulative=${state5000.cumulativeScore}`
    )

    const state5001 = gameReducer(state5000, createAdvanceLevelAction(state5000))
    assert(
      state5001.currentLevel === 5001 &&
        state5001.levelBaseCumulativeScore === highBaseCumulative + l5000Earned &&
        state5001.cumulativeScore === highBaseCumulative + l5000Earned,
      'Advancing Level 5000 -> Level 5001 carries cumulativeScore forward cleanly'
    )

    const vm5000 = resolveVictoryModalViewModel({
      isPlaying: true,
      state: state5000,
      victorySummary: resolveVictorySummary(
        null,
        state5000.runId,
        state5000.hasWon,
        state5000.lastLevelScoreSummary
      ),
      formattedTime: '02:15',
      isLevelTransitioning: false,
    })
    assert(
      vm5000.completedLevel === 5000 &&
        vm5000.nextLevel === 5001 &&
        vm5000.levelScore === l5000Earned &&
        vm5000.cumulativeScore === highBaseCumulative + l5000Earned,
      'VictoryModal view model resolves Level 5000 -> 5001 scores accurately'
    )

    assert(clampSafeScore(NaN) === 0, 'clampSafeScore(NaN) === 0')
    assert(clampSafeScore(-500) === 0, 'clampSafeScore(-500) === 0')
    assert(clampSafeScore(Infinity) === MAX_SAFE_SCORE, 'clampSafeScore(Infinity) clamps to MAX_SAFE_SCORE')
    assert(
      Number.isSafeInteger(calculateLiveLevelScore(state5001)),
      'calculateLiveLevelScore returns a safe integer at Level 5001'
    )
  }

  console.log(`\n=== MAZE-SCORING-001 Test Summary: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    throw new Error(`MAZE-SCORING-001 test suite failed with ${failed} failure(s):\n${failures.join('\n')}`)
  }
}

await runTests()
