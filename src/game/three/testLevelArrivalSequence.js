import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { createServer } from 'vite'
import {
  ARRIVAL_ENTRY_PATHS,
  ARRIVAL_SEQUENCE_PHASES,
  DEFAULT_ARRIVAL_CONFIG,
  beginArrivalSequenceState,
  cancelArrivalSequenceState,
  computeInterLevelArrivalCameraPose,
  createIdleArrivalState,
  finishArrivalSequenceState,
  resolveArrivalConfig,
  resolveInterLevelArrivalPhase,
  resolveSpawnSequenceArrivalPhase,
  updateArrivalPhaseState,
} from '../engine/levelArrivalSequence.js'
import { ELEVATOR_TRANSITION_PHASES } from '../engine/elevatorLevelTransition.js'
import {
  createInitialGameState,
  gameReducer,
} from '../engine/gameReducer.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { getLevelConfig } from '../mechanics/levelProgression.js'
import { CameraRig, CAMERA_MODES, THIRD_PERSON_CAMERA_MODES } from './CameraRig.js'
import { SPAWN_SEQUENCE_STAGES } from './ElevatorExitSequence.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import { ELEVATOR_DECK_TOP_Y } from './buildElevators.js'
import { gridToWorld } from '../world/worldCoords.js'
import { loadAllSettings, saveAllSettings } from '../../utils/persistence.js'

console.log('--- Running MAZE-ARRIVAL-001 Progressive Level Arrival Sequence Tests ---')

function createMiniDomEnv(initialUrl = 'http://localhost:3000/') {
  let currentUrl = new URL(initialUrl)
  const activeTimeouts = new Set()
  const activeIntervals = new Set()
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
      return idx > 0 ? this.parentNode.childNodes[idx - 1] : null
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      this.childNodes.push(child)
      return child
    }
    insertBefore(newNode, refNode) {
      if (!refNode) return this.appendChild(newNode)
      if (newNode.parentNode) newNode.parentNode.removeChild(newNode)
      const idx = this.childNodes.indexOf(refNode)
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
    contains(other) {
      let cur = other
      while (cur) {
        if (cur === this) return true
        cur = cur.parentNode
      }
      return false
    }
    get textContent() {
      if (this.nodeType === 3) return this._data
      return this.childNodes.map((c) => c.textContent).join('')
    }
    set textContent(val) {
      const text = val == null ? '' : String(val)
      if (this.nodeType === 3) {
        this._data = text
        return
      }
      for (const c of this.childNodes) c.parentNode = null
      this.childNodes = []
      if (text) this.appendChild(new MiniText(text, this.ownerDocument))
    }
  }

  class MiniText extends MiniNode {
    constructor(data, ownerDocument) {
      super(3, ownerDocument)
      this._data = String(data ?? '')
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
  }

  class MiniComment extends MiniNode {
    constructor(data, ownerDocument) {
      super(8, ownerDocument)
      this.data = String(data ?? '')
    }
  }

  class MiniClassList {
    constructor(el) {
      this._el = el
    }
    _tokens() {
      const raw = this._el.getAttribute('class') || ''
      return raw.split(/\s+/).filter(Boolean)
    }
    contains(tok) {
      return this._tokens().includes(tok)
    }
    add(...tokens) {
      const set = new Set(this._tokens())
      for (const t of tokens) if (t) set.add(t)
      this._el.setAttribute('class', Array.from(set).join(' '))
    }
    remove(...tokens) {
      const set = new Set(this._tokens())
      for (const t of tokens) set.delete(t)
      this._el.setAttribute('class', Array.from(set).join(' '))
    }
  }

  class MiniElement extends MiniNode {
    constructor(tagName, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
      super(1, ownerDocument)
      this.tagName = String(tagName).toUpperCase()
      this.nodeName = this.tagName
      this.namespaceURI = namespaceURI
      this._attrs = new Map()
      this._emitter = createEventEmitter()
      this.classList = new MiniClassList(this)
      this.clientWidth = 960
      this.clientHeight = 540
      this._styleMap = new Map()
      this.style = new Proxy(
        {
          setProperty: (k, v) => {
            this._styleMap.set(String(k), String(v))
          },
          removeProperty: (k) => {
            this._styleMap.delete(String(k))
          },
          getPropertyValue: (k) => this._styleMap.get(String(k)) || '',
        },
        {
          get: (target, prop) => {
            if (prop in target) return target[prop]
            return this._styleMap.get(String(prop)) || ''
          },
          set: (_target, prop, value) => {
            this._styleMap.set(String(prop), value == null ? '' : String(value))
            return true
          },
        }
      )
      this.dataset = new Proxy(
        {},
        {
          get: (_t, prop) => {
            const attr =
              'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
            const v = this.getAttribute(attr)
            return v === null ? undefined : v
          },
          set: (_t, prop, value) => {
            const attr =
              'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
            this.setAttribute(attr, String(value))
            return true
          },
        }
      )
      this._value = ''
      this._checked = false
      this._disabled = false
    }
    get children() {
      return this.childNodes.filter((c) => c.nodeType === 1)
    }
    get id() {
      return this.getAttribute('id') || ''
    }
    set id(v) {
      this.setAttribute('id', v)
    }
    get className() {
      return this.getAttribute('class') || ''
    }
    set className(v) {
      this.setAttribute('class', v)
    }
    get disabled() {
      return this._disabled || this.hasAttribute('disabled')
    }
    set disabled(v) {
      this._disabled = Boolean(v)
      if (this._disabled) this.setAttribute('disabled', '')
      else this.removeAttribute('disabled')
    }
    get value() {
      return this._value
    }
    set value(v) {
      this._value = String(v ?? '')
    }
    get checked() {
      return this._checked
    }
    set checked(v) {
      this._checked = Boolean(v)
    }
    get tabIndex() {
      const attr = this.getAttribute('tabindex')
      if (attr !== null) return Number(attr)
      return ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(this.tagName) ? 0 : -1
    }
    set tabIndex(v) {
      this.setAttribute('tabindex', String(v))
    }
    setAttribute(name, value) {
      const key = String(name).toLowerCase()
      this._attrs.set(key, String(value))
      if (key === 'disabled') this._disabled = true
    }
    getAttribute(name) {
      const key = String(name).toLowerCase()
      return this._attrs.has(key) ? this._attrs.get(key) : null
    }
    hasAttribute(name) {
      return this._attrs.has(String(name).toLowerCase())
    }
    removeAttribute(name) {
      const key = String(name).toLowerCase()
      this._attrs.delete(key)
      if (key === 'disabled') this._disabled = false
    }
    focus() {
      this.ownerDocument.activeElement = this
    }
    blur() {
      if (this.ownerDocument.activeElement === this) {
        this.ownerDocument.activeElement = this.ownerDocument.body
      }
    }
    setPointerCapture() {}
    releasePointerCapture() {}
    getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width: this.clientWidth,
        height: this.clientHeight,
        right: this.clientWidth,
        bottom: this.clientHeight,
      }
    }
    closest(selector) {
      let cur = this
      while (cur && cur.nodeType === 1) {
        if (matchesSelector(cur, selector)) return cur
        cur = cur.parentElement
      }
      return null
    }
    matches(selector) {
      return matchesSelector(this, selector)
    }
    querySelectorAll(selector) {
      const results = []
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (matchesSelector(child, selector)) results.push(child)
            walk(child)
          }
        }
      }
      walk(this)
      return results
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    }
    addEventListener(type, fn, options) {
      this._emitter.addEventListener(type, fn, options)
    }
    removeEventListener(type, fn, options) {
      this._emitter.removeEventListener(type, fn, options)
    }
    dispatchEvent(event) {
      const evt = event || {}
      evt.target = this
      evt.defaultPrevented = Boolean(evt.defaultPrevented)
      if (!evt.preventDefault) {
        evt.preventDefault = () => {
          evt.defaultPrevented = true
        }
      }
      let propagationStopped = false
      evt.stopPropagation = () => {
        propagationStopped = true
      }

      const path = []
      let cur = this
      while (cur) {
        path.push(cur)
        cur = cur.parentNode
      }
      path.push(this.ownerDocument)
      path.push(this.ownerDocument.defaultView)

      for (let i = path.length - 1; i >= 0; i -= 1) {
        if (propagationStopped) break
        const target = path[i]
        const listeners =
          target === this.ownerDocument
            ? this.ownerDocument._emitter.getListeners(evt.type, true)
            : target === this.ownerDocument.defaultView
              ? this.ownerDocument.defaultView._emitter.getListeners(evt.type, true)
              : target._emitter?.getListeners(evt.type, true) || []
        evt.currentTarget = target
        for (const fn of listeners) fn.call(target, evt)
      }

      const bubbles = evt.bubbles !== false
      for (let i = 0; i < path.length; i += 1) {
        if (propagationStopped) break
        if (i > 0 && !bubbles) break
        const target = path[i]
        const listeners =
          target === this.ownerDocument
            ? this.ownerDocument._emitter.getListeners(evt.type, false)
            : target === this.ownerDocument.defaultView
              ? this.ownerDocument.defaultView._emitter.getListeners(evt.type, false)
              : target._emitter?.getListeners(evt.type, false) || []
        evt.currentTarget = target
        for (const fn of listeners) fn.call(target, evt)
      }
      return !evt.defaultPrevented
    }
    click() {
      if (this.disabled) return
      this.dispatchEvent({ type: 'click', bubbles: true, cancelable: true })
    }
  }

  class MiniCanvasElement extends MiniElement {
    constructor(ownerDocument) {
      super('canvas', ownerDocument)
      this.width = 256
      this.height = 256
    }
    getContext(kind) {
      if (kind === '2d') {
        const stubGrad = { addColorStop() {} }
        return {
          fillStyle: '#000',
          strokeStyle: '#000',
          lineWidth: 1,
          globalAlpha: 1,
          font: '12px sans-serif',
          textAlign: 'left',
          textBaseline: 'alphabetic',
          shadowBlur: 0,
          shadowColor: 'transparent',
          save() {},
          restore() {},
          beginPath() {},
          closePath() {},
          moveTo() {},
          lineTo() {},
          arc() {},
          rect() {},
          fill() {},
          stroke() {},
          fillRect() {},
          strokeRect() {},
          clearRect() {},
          fillText() {},
          translate() {},
          rotate() {},
          scale() {},
          setTransform() {},
          createLinearGradient: () => stubGrad,
          createRadialGradient: () => stubGrad,
          createImageData: (w, h) => ({
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4),
          }),
          getImageData: (_x, _y, w, h) => ({
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4),
          }),
          putImageData() {},
        }
      }
      return null
    }
  }

  class MiniIFrameElement extends MiniElement {
    constructor(ownerDocument) {
      super('iframe', ownerDocument)
    }
  }

  const docEmitter = createEventEmitter()
  const winEmitter = createEventEmitter()
  const storageMap = new Map()

  const documentObj = {
    nodeType: 9,
    _emitter: docEmitter,
    visibilityState: 'visible',
    hidden: false,
    pointerLockElement: null,
    fullscreenElement: null,
    activeElement: null,
    exitPointerLock() {
      documentObj.pointerLockElement = null
    },
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') return new MiniCanvasElement(documentObj)
      return new MiniElement(tag, documentObj)
    },
    createElementNS(ns, tag) {
      return new MiniElement(tag, documentObj, ns)
    },
    createTextNode(text) {
      return new MiniText(text, documentObj)
    },
    createComment(data) {
      return new MiniComment(data, documentObj)
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
      return !evt.defaultPrevented
    },
    querySelector(sel) {
      return documentObj.documentElement.querySelector(sel)
    },
    querySelectorAll(sel) {
      return documentObj.documentElement.querySelectorAll(sel)
    },
  }

  documentObj.documentElement = new MiniElement('html', documentObj)
  documentObj.head = new MiniElement('head', documentObj)
  documentObj.body = new MiniElement('body', documentObj)
  documentObj.documentElement.appendChild(documentObj.head)
  documentObj.documentElement.appendChild(documentObj.body)
  documentObj.activeElement = documentObj.body

  const windowObj = {
    _emitter: winEmitter,
    document: documentObj,
    HTMLIFrameElement: MiniIFrameElement,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    location: {
      get href() {
        return currentUrl.href
      },
      get search() {
        return currentUrl.search
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
    setInterval: (fn, delay, ...args) => {
      const id = setInterval(fn, delay, ...args)
      activeIntervals.add(id)
      return id
    },
    clearInterval: (id) => {
      activeIntervals.delete(id)
      clearInterval(id)
    },
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
    activeIntervals,
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
      return {
        getParameter: () => 'Mock WebGL Renderer',
        getExtension: () => null,
      }
    },
    shadowMap: { enabled: false, type: 0 },
  }
}

function createHostStub() {
  return {
    clientWidth: 960,
    clientHeight: 540,
    appendChild() {},
    removeChild() {},
  }
}

function createAudioStub() {
  const calls = []
  return {
    calls,
    isDisposed: false,
    unlock() {
      return true
    },
    setMaze() {},
    setVolumes() {},
    setOptions() {},
    setPaused() {},
    update() {},
    onStartElevatorDescent(sec) {
      calls.push({ type: 'descent', sec })
    },
    onStartElevatorImpact() {
      calls.push({ type: 'impact' })
    },
    onExtractionDoorsClose() {
      calls.push({ type: 'doors_close' })
    },
    clearPendingElevatorCues() {
      calls.push({ type: 'clear_pending' })
    },
    stopElevatorCues() {
      calls.push({ type: 'stop_cues' })
    },
    onFlashlightToggle() {},
    onGameEvent() {},
    onHidingInteraction() {},
    onLockedExit() {},
    dispose() {
      this.isDisposed = true
    },
  }
}

function buildWonLevelState(level = 1, baseSeed = 202607) {
  let state = createInitialGameState({
    level,
    seed: baseSeed,
    baseSeed,
    levelsCompleted: Math.max(0, level - 1),
  })
  const keycards = (state.keycards || []).filter((k) => !k.collected)
  for (const kc of keycards) {
    state = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      position: { row: kc.row, col: kc.col },
    })
  }
  state = gameReducer(state, {
    type: 'SYNC_PLAYER_CELL',
    position: { row: state.maze.exit.row, col: state.maze.exit.col },
  })
  if (!state.hasWon) {
    state = gameReducer(state, { type: 'COMPLETE_EXIT_EXTRACTION' })
  }
  assert.equal(state.hasWon, true, `Level ${level} state must be won`)
  return state
}

async function waitForCondition(predicate, timeoutMs = 4000, stepMs = 12) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true
    await act(async () => {
      await new Promise((r) => setTimeout(r, stepMs))
    })
  }
  return Boolean(predicate())
}

// ============================================================================
// 1. Unit Tests: levelArrivalSequence state machine & camera pose computation
// ============================================================================
{
  const idle = createIdleArrivalState()
  assert.equal(idle.active, false)
  assert.equal(idle.phase, ARRIVAL_SEQUENCE_PHASES.IDLE)

  // Begin + duplicate trigger guard
  const started = beginArrivalSequenceState(idle, {
    entryPath: ARRIVAL_ENTRY_PATHS.FRESH_GAME,
    phase: ARRIVAL_SEQUENCE_PHASES.PREPARING,
    level: 1,
    runId: 1,
  })
  assert.equal(started.active, true)
  assert.equal(started.phase, ARRIVAL_SEQUENCE_PHASES.PREPARING)
  assert.equal(started.entryPath, ARRIVAL_ENTRY_PATHS.FRESH_GAME)

  const duplicate = beginArrivalSequenceState(started, {
    entryPath: ARRIVAL_ENTRY_PATHS.FRESH_GAME,
    phase: ARRIVAL_SEQUENCE_PHASES.ELEVATOR_ARRIVAL,
    level: 1,
    runId: 1,
  })
  assert.equal(duplicate, started, 'Duplicate arrival trigger for same run is ignored')

  // Phase updates
  const arriving = updateArrivalPhaseState(
    started,
    ARRIVAL_SEQUENCE_PHASES.ELEVATOR_ARRIVAL,
    { doorProgress: 0.5, cameraHandoffProgress: 0.25 }
  )
  assert.equal(arriving.phase, ARRIVAL_SEQUENCE_PHASES.ELEVATOR_ARRIVAL)
  assert.equal(arriving.doorProgress, 0.5)

  // Inter-level phase mapping
  assert.equal(
    resolveInterLevelArrivalPhase({
      active: true,
      phase: ELEVATOR_TRANSITION_PHASES.CLOSING_DOORS,
      doorProgress: 0.5,
    }),
    ARRIVAL_SEQUENCE_PHASES.PREPARING
  )
  assert.equal(
    resolveInterLevelArrivalPhase({
      active: true,
      phase: ELEVATOR_TRANSITION_PHASES.TRAVELING,
      doorProgress: 1,
    }),
    ARRIVAL_SEQUENCE_PHASES.PREPARING
  )
  assert.equal(
    resolveInterLevelArrivalPhase({
      active: true,
      phase: ELEVATOR_TRANSITION_PHASES.OPENING_DOORS,
      doorProgress: 0.8,
    }),
    ARRIVAL_SEQUENCE_PHASES.OPENING_DOORS
  )
  assert.equal(
    resolveInterLevelArrivalPhase({
      active: true,
      phase: ELEVATOR_TRANSITION_PHASES.OPENING_DOORS,
      doorProgress: 0.25,
    }),
    ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF
  )

  // Spawn stage mapping
  assert.equal(
    resolveSpawnSequenceArrivalPhase(SPAWN_SEQUENCE_STAGES.ELEVATOR_DESCEND),
    ARRIVAL_SEQUENCE_PHASES.ELEVATOR_ARRIVAL
  )
  assert.equal(
    resolveSpawnSequenceArrivalPhase(SPAWN_SEQUENCE_STAGES.SETTLE),
    ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF
  )
  assert.equal(
    resolveSpawnSequenceArrivalPhase(SPAWN_SEQUENCE_STAGES.IDLE),
    ARRIVAL_SEQUENCE_PHASES.IDLE
  )

  // Camera pose handoff interpolation + reducedMotion behavior
  const poseScratch = {}
  const travelingPose = computeInterLevelArrivalCameraPose({
    active: true,
    phase: ELEVATOR_TRANSITION_PHASES.TRAVELING,
    doorProgress: 1,
    reducedMotion: false,
    target: poseScratch,
  })
  assert.equal(travelingPose, poseScratch, 'Reuses target object with zero allocation')
  assert.equal(travelingPose.active, true)
  assert.ok(travelingPose.backOffset > 0.2, 'Starts framed slightly back inside elevator in 1P')
  assert.ok(travelingPose.followDistanceCap < 1.1, 'Tucks 3P camera inside elevator cabin')
  assert.equal(travelingPose.shoulderWeight, 0, 'Centers 3P camera inside cabin while doors sealed')

  const midOpenPose = computeInterLevelArrivalCameraPose({
    active: true,
    phase: ELEVATOR_TRANSITION_PHASES.OPENING_DOORS,
    doorProgress: 0.45,
    reducedMotion: false,
  })
  assert.equal(midOpenPose.active, true)
  assert.ok(midOpenPose.backOffset < travelingPose.backOffset, 'Back offset eases toward zero')
  assert.ok(
    midOpenPose.followDistanceCap > travelingPose.followDistanceCap,
    '3P follow distance releases smoothly as doors open'
  )

  const openDonePose = computeInterLevelArrivalCameraPose({
    active: true,
    phase: ELEVATOR_TRANSITION_PHASES.OPENING_DOORS,
    doorProgress: 0,
    reducedMotion: false,
  })
  assert.equal(openDonePose.active, false, 'Arrival camera offset clears cleanly at doorProgress=0')

  const reducedPose = computeInterLevelArrivalCameraPose({
    active: true,
    phase: ELEVATOR_TRANSITION_PHASES.TRAVELING,
    doorProgress: 1,
    reducedMotion: true,
  })
  assert.equal(reducedPose.backOffset, 0, 'Reduced motion eliminates 1P dolly motion')
  assert.equal(reducedPose.eyeOffsetY, 0, 'Reduced motion eliminates 1P vertical offset')
  assert.equal(reducedPose.pitchOffset, 0, 'Reduced motion eliminates 1P pitch offset')
  assert.ok(reducedPose.followDistanceCap < 1.1, '3P cabin safety cap still prevents clipping')

  const reducedCfg = resolveArrivalConfig(null, true)
  const normalCfg = resolveArrivalConfig(null, false)
  assert.ok(
    reducedCfg.startOverlayMinMs < normalCfg.startOverlayMinMs,
    'Reduced motion shortens start overlay wait cleanly'
  )
  assert.equal(normalCfg.maxArrivalTimeoutMs, DEFAULT_ARRIVAL_CONFIG.maxArrivalTimeoutMs)

  const finished = finishArrivalSequenceState(arriving)
  assert.equal(finished.active, false)
  assert.equal(finished.phase, ARRIVAL_SEQUENCE_PHASES.IDLE)

  const cancelled = cancelArrivalSequenceState(arriving, { timedOut: true, error: 'stalled' })
  assert.equal(cancelled.active, false)
  assert.equal(cancelled.timedOut, true)
  assert.equal(cancelled.error, 'stalled')

  console.log('✓ 1. levelArrivalSequence state machine & camera pose helpers passed')
}

// ============================================================================
// 2. CameraRig Arrival Framing & Smooth Handoff (1P, 3P Follow, 3P Free-Look)
// ============================================================================
{
  const maze = generateMaze({ level: 1, seed: 44101 })
  const startWorld = gridToWorld(maze.start.row, maze.start.col, maze)

  // First-Person camera handoff without clipping
  const fpCam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100)
  const fpRig = new CameraRig(fpCam, { mode: CAMERA_MODES.FIRST_PERSON })
  fpRig.setMaze(maze)
  fpRig.setPlayerPosition(startWorld.x, ELEVATOR_DECK_TOP_Y, startWorld.z)
  fpRig.setLookDirection(-Math.PI / 2, 0)
  fpRig.snap()
  const normalFpPos = fpCam.position.clone()

  fpRig.setArrivalCameraPose({
    active: true,
    backOffset: 0.26,
    eyeOffsetY: -0.05,
    pitchOffset: -0.032,
  })
  fpRig.snap()
  assert.ok(
    fpCam.position.y < normalFpPos.y - 0.03,
    '1P arrival pose lowers eye subtly inside cabin'
  )
  assert.ok(
    Number.isFinite(fpCam.position.x) &&
      Number.isFinite(fpCam.position.y) &&
      Number.isFinite(fpCam.position.z),
    '1P arrival camera coordinates remain finite'
  )

  fpRig.clearArrivalCameraPose()
  for (let i = 0; i < 40; i += 1) {
    fpRig.update(1 / 60)
  }
  assert.ok(
    fpCam.position.distanceTo(normalFpPos) < 0.01,
    '1P camera glides smoothly into exact normal gameplay pose after handoff'
  )
  fpRig.dispose()

  // Third-Person Character-Follow & Free-Look cabin framing
  for (const tpMode of [
    THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
    THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
  ]) {
    const tpCam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100)
    const tpRig = new CameraRig(tpCam, {
      mode: CAMERA_MODES.THIRD_PERSON,
      thirdPersonMode: tpMode,
      followDistance: 3.4,
    })
    tpRig.setMaze(maze)
    tpRig.setPlayerPosition(startWorld.x, ELEVATOR_DECK_TOP_Y, startWorld.z)
    tpRig.setLookDirection(-Math.PI / 2, 0)
    tpRig.setArrivalCameraPose({
      active: true,
      followDistanceCap: 0.9,
      shoulderWeight: 0,
    })
    tpRig.snap()
    const arrivalDist = Math.hypot(
      tpCam.position.x - startWorld.x,
      tpCam.position.z - startWorld.z
    )
    assert.ok(
      arrivalDist <= 0.95,
      `3P (${tpMode}) arrival camera stays safely tucked inside elevator cabin (${arrivalDist.toFixed(2)}m)`
    )

    tpRig.clearArrivalCameraPose()
    for (let i = 0; i < 60; i += 1) {
      tpRig.update(1 / 60)
    }
    assert.ok(
      Number.isFinite(tpCam.position.x) &&
        Number.isFinite(tpCam.position.y) &&
        Number.isFinite(tpCam.position.z),
      `3P (${tpMode}) camera remains finite after clearing arrival pose`
    )
    tpRig.dispose()
  }

  console.log('✓ 2. CameraRig 1P & 3P arrival framing & smooth handoff passed')
}

// ============================================================================
// 3. Headless MazeSceneEngine: Enemy Lockout, Look Lockout, Visibility & Recovery
// ============================================================================
{
  const env = createMiniDomEnv()
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  globalThis.window = env.window
  globalThis.document = env.document

  try {
    const maze = generateMaze({ level: 3, seed: 77812 })
    const audioStub = createAudioStub()
    const engine = new MazeSceneEngine(createHostStub(), {
      createRenderer: () => createMockWebGLRenderer(),
      audioEngine: audioStub,
      cameraMode: CAMERA_MODES.THIRD_PERSON,
      skipSpawnSequence: false,
    })
    engine.setMaze(maze)
    assert.equal(engine.isSpawnSequenceActive(), true, 'Fresh maze starts 3D arrival sequence')
    assert.equal(engine.isArrivalActive(), true, 'isArrivalActive() reports true during spawn sequence')

    // Lock look as MazeViewport3D does during scripted arrival
    engine.setArrivalState({
      active: true,
      phase: ARRIVAL_SEQUENCE_PHASES.ELEVATOR_ARRIVAL,
      entryPath: ARRIVAL_ENTRY_PATHS.FRESH_GAME,
      lockLook: true,
    })
    const yawBeforeLook = engine.cameraRig.getLookDirection().yaw
    const pitchBeforeLook = engine.cameraRig.getLookDirection().pitch
    assert.equal(
      engine.applyLookDelta(240, -120),
      false,
      'applyLookDelta is strictly blocked during scripted arrival'
    )
    assert.equal(engine.cameraRig.getLookDirection().yaw, yawBeforeLook)
    assert.equal(engine.cameraRig.getLookDirection().pitch, pitchBeforeLook)

    // Verify enemies exist and remain completely frozen during arrival
    const enemies = engine.getEnemies()
    assert.ok(enemies.length >= 1, 'Level 3 maze has enemies to verify lockout')
    const initialEnemyPositions = enemies.map((e) => ({
      id: e.id,
      x: e.worldPos.x,
      z: e.worldPos.z,
    }))

    // Verify direct damage & interactions are blocked during arrival
    assert.equal(engine.applyDamage(30), false, 'Damage blocked during arrival')
    assert.equal(engine.interact().handled, false, 'Interactions blocked during arrival')
    assert.equal(engine.getNearbyInteractable(), null, 'No nearby interactable prompt during arrival')

    // Step frames through part of arrival and confirm enemies did NOT move
    for (let i = 0; i < 60; i += 1) {
      engine.stepFrame(1 / 60)
    }
    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i]
      const init = initialEnemyPositions[i]
      assert.equal(e.worldPos.x, init.x, `Enemy ${e.id} X stays frozen during arrival`)
      assert.equal(e.worldPos.z, init.z, `Enemy ${e.id} Z stays frozen during arrival`)
    }

    // Complete spawn sequence and release arrival lock
    for (let i = 0; i < 360; i += 1) {
      engine.stepFrame(1 / 60)
      if (!engine.isSpawnSequenceActive()) break
    }
    assert.equal(engine.isSpawnSequenceActive(), false)
    engine.setArrivalState({ active: false, phase: 'idle', lockLook: false })
    assert.equal(engine.isArrivalActive(), false)

    // After arrival completes: look works, enemies resume moving, damage works
    assert.equal(engine.applyLookDelta(120, -25), true, 'applyLookDelta restored after arrival')
    assert.notEqual(engine.cameraRig.getLookDirection().yaw, yawBeforeLook)

    for (let i = 0; i < 240; i += 1) {
      engine.stepFrame(1 / 60)
    }
    const anyEnemyMoved = enemies.some((e, idx) => {
      const init = initialEnemyPositions[idx]
      return Math.hypot(e.worldPos.x - init.x, e.worldPos.z - init.z) > 0.02
    })
    assert.equal(anyEnemyMoved, true, 'Enemies resume moving once arrival completes')
    assert.equal(engine.applyDamage(15), true, 'Damage restored after arrival')

    // Verify inter-level traveling hides 3P player behind sealed doors and reveals on opening_doors
    engine.setLevelTransitionState({
      active: true,
      phase: ELEVATOR_TRANSITION_PHASES.TRAVELING,
      fromLevel: 3,
      toLevel: 4,
      doorProgress: 1,
    })
    const level4Maze = generateMaze({ level: 4, seed: 77812 })
    engine.setMaze(level4Maze)
    assert.equal(
      engine.isSpawnSequenceActive(),
      false,
      'Inter-level setMaze does NOT trigger overlapping 3D ElevatorExitSequence'
    )
    assert.equal(
      engine.getPlayer().visible,
      false,
      '3P player is not visible outside elevator while doors are sealed in traveling phase'
    )
    assert.ok(
      engine.cameraRig.getArrivalCameraPose()?.active === true,
      'Inter-level arrival camera pose is armed on first frame behind sealed doors'
    )

    engine.setLevelTransitionState({
      active: true,
      phase: ELEVATOR_TRANSITION_PHASES.OPENING_DOORS,
      fromLevel: 3,
      toLevel: 4,
      doorProgress: 0.6,
    })
    assert.equal(
      engine.getPlayer().visible,
      true,
      '3P player becomes visible inside elevator as doors open'
    )
    engine.setLevelTransitionState({
      active: false,
      phase: ELEVATOR_TRANSITION_PHASES.IDLE,
      doorProgress: 0,
    })
    assert.equal(
      engine.cameraRig.getArrivalCameraPose(),
      null,
      'Arrival camera pose clears cleanly once doors finish opening'
    )

    // Verify startSpawnSequence error recovery never permanently locks gameplay
    const origStart = engine._elevatorExitSequence.start
    engine._elevatorExitSequence.start = () => {
      throw new Error('Simulated elevator trajectory fault')
    }
    const startedAfterFault = engine.startSpawnSequence({ forceNotify: true })
    engine._elevatorExitSequence.start = origStart
    assert.equal(startedAfterFault, false, 'Faulty startSpawnSequence returns false safely')
    assert.equal(
      engine.isSpawnSequenceActive(),
      false,
      'Engine is never permanently locked if startSpawnSequence throws'
    )
    const start4World = gridToWorld(level4Maze.start.row, level4Maze.start.col, level4Maze)
    assert.ok(
      Math.hypot(
        engine.getPlayerWorldPosition().x - start4World.x,
        engine.getPlayerWorldPosition().z - start4World.z
      ) < 1e-4,
      'Fallback grounds player safely at maze start'
    )

    engine.dispose()
  } finally {
    globalThis.window = prevWindow
    globalThis.document = prevDocument
  }

  console.log('✓ 3. MazeSceneEngine arrival lockouts, camera handoff, visibility & recovery passed')
}

// ============================================================================
// 4. Full Mounted React <App /> Integration Tests (All Entry Paths)
// ============================================================================
const viteServer = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')

  const FAST_TRANSITION = {
    doorsCloseDurationMs: 45,
    travelMinDurationMs: 55,
    doorsOpenDurationMs: 55,
    maxTravelTimeoutMs: 1200,
    reducedMotionCloseMs: 24,
    reducedMotionTravelMs: 24,
    reducedMotionOpenMs: 24,
  }

  async function mountApp(props = {}, envOptions = {}) {
    const env = createMiniDomEnv()
    const prev = {
      window: globalThis.window,
      document: globalThis.document,
      Node: globalThis.Node,
      Element: globalThis.Element,
      HTMLElement: globalThis.HTMLElement,
      HTMLCanvasElement: globalThis.HTMLCanvasElement,
      HTMLIFrameElement: globalThis.HTMLIFrameElement,
      ResizeObserver: globalThis.ResizeObserver,
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
      localStorage: globalThis.localStorage,
      navigator: globalThis.navigator,
      IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    }
    globalThis.window = env.window
    globalThis.document = env.document
    globalThis.Node = env.Node
    globalThis.Element = env.Element
    globalThis.HTMLElement = env.HTMLElement
    globalThis.HTMLCanvasElement = env.HTMLCanvasElement
    globalThis.HTMLIFrameElement = env.HTMLIFrameElement
    globalThis.ResizeObserver = env.ResizeObserver
    globalThis.requestAnimationFrame = env.window.requestAnimationFrame
    globalThis.cancelAnimationFrame = env.window.cancelAnimationFrame
    globalThis.localStorage = env.window.localStorage
    globalThis.IS_REACT_ACT_ENVIRONMENT = true

    if (envOptions.reducedMotion) {
      const current = loadAllSettings()
      saveAllSettings({
        ...current,
        gameplay: { ...current.gameplay, reducedMotion: true },
      })
    }

    const container = env.document.createElement('div')
    env.document.body.appendChild(container)
    const root = createRoot(container)

    let viewportCtx = null
    const arrivalLog = []
    const transitionLog = []
    const audioStub = createAudioStub()

    const {
      viewportEngineConfig: customEngineConfig,
      arrivalConfig: customArrivalConfig,
      levelTransitionConfig: customTransitionConfig,
      onViewportReady: userOnReady,
      onArrivalStateChange: userOnArrival,
      onLevelTransitionChange: userOnTransition,
      ...restProps
    } = props

    await act(async () => {
      root.render(
        createElement(App, {
          ...restProps,
          levelTransitionConfig: {
            ...FAST_TRANSITION,
            ...(customTransitionConfig || {}),
          },
          arrivalConfig: {
            startOverlayMinMs: 45,
            reducedMotionStartOverlayMinMs: 20,
            maxArrivalTimeoutMs: 3000,
            ...(customArrivalConfig || {}),
          },
          viewportEngineConfig: {
            createRenderer: () => createMockWebGLRenderer(),
            audioEngine: audioStub,
            pointerLockEnabled: false,
            ...(customEngineConfig || {}),
          },
          onViewportReady: (ctx) => {
            viewportCtx = ctx
            userOnReady?.(ctx)
          },
          onArrivalStateChange: (st) => {
            arrivalLog.push({ ...st })
            userOnArrival?.(st)
          },
          onLevelTransitionChange: (st) => {
            transitionLog.push({ ...st })
            userOnTransition?.(st)
          },
        })
      )
    })

    const cleanup = async () => {
      await act(async () => {
        root.unmount()
      })
      for (const id of Array.from(env.activeTimeouts)) env.window.clearTimeout(id)
      for (const id of Array.from(env.activeIntervals)) env.window.clearInterval(id)
      for (const id of Array.from(env.activeRafs)) env.window.cancelAnimationFrame(id)
      globalThis.window = prev.window
      globalThis.document = prev.document
      globalThis.Node = prev.Node
      globalThis.Element = prev.Element
      globalThis.HTMLElement = prev.HTMLElement
      globalThis.HTMLCanvasElement = prev.HTMLCanvasElement
      globalThis.HTMLIFrameElement = prev.HTMLIFrameElement
      globalThis.ResizeObserver = prev.ResizeObserver
      globalThis.requestAnimationFrame = prev.requestAnimationFrame
      globalThis.cancelAnimationFrame = prev.cancelAnimationFrame
      globalThis.localStorage = prev.localStorage
      globalThis.IS_REACT_ACT_ENVIRONMENT = prev.IS_REACT_ACT_ENVIRONMENT
    }

    return {
      env,
      container,
      root,
      getViewportCtx: () => viewportCtx,
      arrivalLog,
      transitionLog,
      audioStub,
      cleanup,
    }
  }

  // --------------------------------------------------------------------------
  // 4A. Fresh Game from StartScreen -> StartTransitionOverlay -> 3D Arrival -> Playable
  // --------------------------------------------------------------------------
  {
    const session = await mountApp({ initialPlaying: false })
    try {
      const startBtn = Array.from(session.container.querySelectorAll('button')).find((b) =>
        /start\s*game/i.test(b.textContent)
      )
      assert.ok(startBtn, 'Start screen exposes Start Game button')

      await act(async () => {
        startBtn.click()
      })

      // StartTransitionOverlay opens and holds 3D engine paused at frame 0 (no overlap)
      const startOverlay = session.container.querySelector(
        '[data-testid="start-transition-overlay"]'
      )
      assert.ok(startOverlay, 'Fresh game opens StartTransitionOverlay')

      const engineReady = await waitForCondition(() => Boolean(session.getViewportCtx()?.engine))
      assert.equal(engineReady, true, 'MazeSceneEngine initializes behind StartTransitionOverlay')
      const engine = session.getViewportCtx().engine
      assert.equal(
        engine.isSpawnSequenceActive(),
        true,
        'Starting elevator arrival sequence is armed on fresh Level 1'
      )

      // Wait for StartTransitionOverlay to finish -> 3D ElevatorExitSequence runs (NOT paused!)
      const overlayClosed = await waitForCondition(
        () => !session.container.querySelector('[data-testid="start-transition-overlay"]'),
        2000
      )
      assert.equal(overlayClosed, true, 'StartTransitionOverlay completes cleanly')

      const vp = session.container.querySelector('.maze-viewport-3d')
      assert.equal(
        vp.getAttribute('data-arrival-active'),
        'true',
        '3D arrival sequence remains active after StartTransitionOverlay'
      )
      assert.equal(
        vp.getAttribute('data-controls-enabled'),
        'false',
        'Player controls stay locked during 3D arrival'
      )
      assert.equal(
        engine.isPaused,
        false,
        'Engine stays unpaused so 3D elevator arrival animates smoothly'
      )

      // Pause shortcut 'P' blocked during arrival
      await act(async () => {
        session.env.window.dispatchEvent({
          type: 'keydown',
          key: 'p',
          code: 'KeyP',
          preventDefault() {},
        })
      })
      assert.equal(
        session.container.querySelector('[data-testid="pause-actions"]'),
        null,
        'Pause screen cannot open during arrival'
      )

      // Look delta blocked during arrival
      const yawStart = engine.cameraRig.getLookDirection().yaw
      assert.equal(engine.applyLookDelta(180, -60), false, 'Look locked during fresh arrival')
      assert.equal(engine.cameraRig.getLookDirection().yaw, yawStart)

      // Step 3D ElevatorExitSequence into SETTLE (camera_handoff) and verify controls remain locked
      await act(async () => {
        for (let i = 0; i < 320; i += 1) {
          engine.stepFrame(1 / 60)
          if (engine.getSpawnSequenceState()?.stage === SPAWN_SEQUENCE_STAGES.SETTLE) break
        }
      })
      assert.equal(
        vp.getAttribute('data-arrival-phase'),
        ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF,
        'Spawn SETTLE stage exposes camera_handoff arrival phase'
      )
      assert.equal(
        vp.getAttribute('data-controls-enabled'),
        'false',
        'Controls remain locked during camera_handoff stage'
      )

      // Finish final frames to completion
      await act(async () => {
        for (let i = 0; i < 120; i += 1) {
          engine.stepFrame(1 / 60)
          if (!engine.isSpawnSequenceActive()) break
        }
      })

      const unlocked = await waitForCondition(
        () =>
          vp.getAttribute('data-arrival-active') === 'false' &&
          vp.getAttribute('data-controls-enabled') === 'true',
        1500
      )
      assert.equal(unlocked, true, 'Controls unlock cleanly once Level 1 arrival finishes')
      assert.equal(engine.applyLookDelta(100, -20), true, 'Look restored after arrival completes')

      // Pause shortcut works again after arrival
      await act(async () => {
        session.env.window.dispatchEvent({
          type: 'keydown',
          key: 'p',
          code: 'KeyP',
          preventDefault() {},
        })
      })
      assert.ok(
        session.container.querySelector('[data-testid="pause-actions"]'),
        'Pause screen opens cleanly after arrival completes'
      )

      // Verify phase history included preparing -> elevator_arrival -> camera_handoff -> idle
      const phases = session.arrivalLog.map((s) => s.phase)
      assert.ok(phases.includes(ARRIVAL_SEQUENCE_PHASES.PREPARING))
      assert.ok(phases.includes(ARRIVAL_SEQUENCE_PHASES.ELEVATOR_ARRIVAL))
      assert.ok(phases.includes(ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF))
      assert.equal(phases.at(-1), ARRIVAL_SEQUENCE_PHASES.IDLE)
    } finally {
      await session.cleanup()
    }
    console.log('✓ 4A. Fresh Game StartScreen -> Level 1 arrival & lockouts passed')
  }

  // --------------------------------------------------------------------------
  // 4B. NEXT LEVEL (Level 1 -> 2) integrated with MAZE-ELEVATOR-001 (No duplicate animation)
  // --------------------------------------------------------------------------
  {
    const wonLevel1 = buildWonLevelState(1, 90011)
    const session = await mountApp({
      initialPlaying: true,
      initialGameState: wonLevel1,
      viewportEngineConfig: { skipSpawnSequence: false },
    })
    try {
      const ready = await waitForCondition(() => Boolean(session.getViewportCtx()?.engine))
      assert.equal(ready, true)
      const engine = session.getViewportCtx().engine
      const initialMazeId = session.container
        .querySelector('.maze-viewport-3d')
        .getAttribute('data-maze-id')

      const nextBtn = session.container.querySelector('[data-testid="victory-next-level-btn"]')
      assert.ok(nextBtn, 'Victory modal shows NEXT LEVEL')

      let sawSpawnOverlap = false
      await act(async () => {
        nextBtn.click()
        nextBtn.click() // duplicate click must be ignored
      })

      const transitionDone = await waitForCondition(() => {
        if (engine.isSpawnSequenceActive()) sawSpawnOverlap = true
        return (
          !session.container.querySelector('[data-testid="elevator-level-transition"]') &&
          session.container
            .querySelector('.maze-viewport-3d')
            .getAttribute('data-arrival-active') === 'false'
        )
      }, 3000)

      assert.equal(transitionDone, true, 'Inter-level arrival completes cleanly')
      assert.equal(
        sawSpawnOverlap,
        false,
        'No duplicate ElevatorExitSequence plays during inter-level elevator transition'
      )

      const vp = session.container.querySelector('.maze-viewport-3d')
      assert.notEqual(
        vp.getAttribute('data-maze-id'),
        initialMazeId,
        'Level 2 generates a fresh maze'
      )
      assert.equal(
        vp.getAttribute('data-controls-enabled'),
        'true',
        'Controls unlock cleanly after inter-level arrival'
      )

      const arrivalPhases = session.arrivalLog.map((s) => s.phase)
      assert.ok(arrivalPhases.includes(ARRIVAL_SEQUENCE_PHASES.PREPARING))
      assert.ok(arrivalPhases.includes(ARRIVAL_SEQUENCE_PHASES.OPENING_DOORS))
      assert.ok(arrivalPhases.includes(ARRIVAL_SEQUENCE_PHASES.CAMERA_HANDOFF))
      assert.equal(arrivalPhases.at(-1), ARRIVAL_SEQUENCE_PHASES.IDLE)

      // Verify exactly 1 transition occurred (no double door-opening)
      const uniqueIds = new Set(
        session.transitionLog.filter((t) => t.active).map((t) => t.transitionId)
      )
      assert.equal(uniqueIds.size, 1, 'Duplicate NEXT LEVEL clicks produce only one transition')
    } finally {
      await session.cleanup()
    }
    console.log('✓ 4B. NEXT LEVEL inter-level arrival integration (no duplicate animation) passed')
  }

  // --------------------------------------------------------------------------
  // 4C. REPLAY LEVEL preserves exact level, maze & seed while running starting arrival
  // --------------------------------------------------------------------------
  {
    const wonLevel2 = buildWonLevelState(2, 55123)
    const session = await mountApp({
      initialPlaying: true,
      initialGameState: wonLevel2,
      viewportEngineConfig: { skipSpawnSequence: false },
    })
    try {
      const ready = await waitForCondition(() => Boolean(session.getViewportCtx()?.engine))
      assert.equal(ready, true)
      const engine = session.getViewportCtx().engine

      // Finish initial spawn sequence so VictoryModal displays
      await act(async () => {
        for (let i = 0; i < 360; i += 1) {
          engine.stepFrame(1 / 60)
          if (!engine.isSpawnSequenceActive()) break
        }
      })
      const modalVisible = await waitForCondition(() =>
        Boolean(session.container.querySelector('[data-testid="victory-replay-level-btn"]'))
      )
      assert.equal(modalVisible, true, 'Victory modal opens after initial arrival finishes')

      const vp = session.container.querySelector('.maze-viewport-3d')
      const mazeIdBefore = vp.getAttribute('data-maze-id')
      const replayBtn = session.container.querySelector('[data-testid="victory-replay-level-btn"]')

      await act(async () => {
        replayBtn.click()
      })

      assert.equal(
        session.container.querySelector('[data-testid="elevator-level-transition"]'),
        null,
        'REPLAY LEVEL does not trigger inter-level elevator transition overlay'
      )
      assert.equal(
        engine.isSpawnSequenceActive(),
        true,
        'REPLAY LEVEL restarts 3D starting elevator arrival sequence'
      )
      assert.equal(
        vp.getAttribute('data-maze-id'),
        mazeIdBefore,
        'REPLAY LEVEL preserves exact same maze & seed'
      )
      assert.equal(
        vp.getAttribute('data-arrival-active'),
        'true',
        'REPLAY LEVEL enforces arrival lockouts during replay arrival'
      )
      assert.equal(
        vp.getAttribute('data-controls-enabled'),
        'false',
        'Controls locked during replay arrival'
      )

      // Complete replay arrival
      await act(async () => {
        for (let i = 0; i < 360; i += 1) {
          engine.stepFrame(1 / 60)
          if (!engine.isSpawnSequenceActive()) break
        }
      })

      const replayUnlocked = await waitForCondition(
        () =>
          vp.getAttribute('data-arrival-active') === 'false' &&
          vp.getAttribute('data-controls-enabled') === 'true'
      )
      assert.equal(replayUnlocked, true, 'Controls restore cleanly after replay arrival')
      assert.equal(engine._currentMaze.level, 2, 'Level number stayed at 2 after replay')
      assert.equal(engine._currentMaze.seed, wonLevel2.maze.seed, 'Seed unchanged after replay')
    } finally {
      await session.cleanup()
    }
    console.log('✓ 4C. REPLAY LEVEL arrival sequence preserves level, maze & seed passed')
  }

  // --------------------------------------------------------------------------
  // 4D. Main Menu -> Fresh Game preserves settings & restarts Level 1 arrival cleanly
  // --------------------------------------------------------------------------
  {
    const wonLevel2 = buildWonLevelState(2, 61111)
    const session = await mountApp(
      {
        initialPlaying: true,
        initialGameState: wonLevel2,
        viewportEngineConfig: { skipSpawnSequence: true },
      },
      { reducedMotion: true }
    )
    try {
      const ready = await waitForCondition(() => Boolean(session.getViewportCtx()?.engine))
      assert.equal(ready, true)

      const menuBtn = session.container.querySelector('[data-testid="victory-main-menu-btn"]')
      assert.ok(menuBtn, 'Victory modal exposes MAIN MENU action')

      await act(async () => {
        menuBtn.click()
      })

      const startBtn = Array.from(session.container.querySelectorAll('button')).find((b) =>
        /start\s*game/i.test(b.textContent)
      )
      assert.ok(startBtn, 'Returned cleanly to Start Screen')
      assert.equal(
        loadAllSettings().gameplay.reducedMotion,
        true,
        'Persisted reducedMotion setting preserved across Main Menu return'
      )

      await act(async () => {
        startBtn.click()
      })
      const overlay = session.container.querySelector(
        '[data-testid="start-transition-overlay"]'
      )
      assert.ok(overlay, 'Fresh game from Main Menu starts arrival overlay')
      assert.equal(
        overlay.getAttribute('data-reduced-motion'),
        'true',
        'StartTransitionOverlay respects persisted reducedMotion setting'
      )

      const overlayDone = await waitForCondition(
        () => !session.container.querySelector('[data-testid="start-transition-overlay"]'),
        4000
      )
      assert.equal(overlayDone, true)
      assert.equal(
        session.getViewportCtx().engine._currentMaze.level,
        1,
        'Fresh game after Main Menu restarts cleanly at Level 1'
      )
    } finally {
      await session.cleanup()
    }
    console.log('✓ 4D. Main Menu -> Fresh Game & reduced-motion propagation passed')
  }

  // --------------------------------------------------------------------------
  // 4E. Mid-Arrival Unmount Cleanup & Stalled Arrival Safety Timeout Recovery
  // --------------------------------------------------------------------------
  {
    // Sub-test 1: Unmount mid-arrival leaves 0 timers/rAFs and no errors
    const session1 = await mountApp({ initialPlaying: false })
    const startBtn = Array.from(session1.container.querySelectorAll('button')).find((b) =>
      /start\s*game/i.test(b.textContent)
    )
    await act(async () => {
      startBtn.click()
    })
    assert.ok(
      session1.container.querySelector('[data-testid="start-transition-overlay"]'),
      'Mid-arrival overlay active before unmount'
    )
    await act(async () => {
      session1.root.unmount()
    })
    assert.equal(
      session1.env.activeTimeouts.size,
      0,
      'Unmounting mid-arrival clears all pending timeouts'
    )
    assert.equal(
      session1.env.activeIntervals.size,
      0,
      'Unmounting mid-arrival clears all pending intervals'
    )
    assert.equal(
      session1.env.activeRafs.size,
      0,
      'Unmounting mid-arrival cancels all pending rAF callbacks'
    )
    await session1.cleanup()

    // Sub-test 2: Safety timeout rescues a stalled 3D arrival sequence
    const session2 = await mountApp({
      initialPlaying: true,
      arrivalConfig: { maxArrivalTimeoutMs: 140 },
      viewportEngineConfig: { skipSpawnSequence: false },
    })
    try {
      const ready = await waitForCondition(() => Boolean(session2.getViewportCtx()?.engine))
      assert.equal(ready, true)
      const engine = session2.getViewportCtx().engine
      assert.equal(engine.isSpawnSequenceActive(), true)

      // Deliberately stop the engine loop so spawn sequence stalls
      engine.stop()
      const recovered = await waitForCondition(
        () =>
          session2.container
            .querySelector('.maze-viewport-3d')
            .getAttribute('data-controls-enabled') === 'true',
        1200
      )
      assert.equal(
        recovered,
        true,
        'Safety watchdog timeout recovers stalled arrival and unlocks gameplay'
      )
      assert.equal(
        session2.arrivalLog.some((s) => s.timedOut === true),
        true,
        'Arrival controller records timedOut recovery cleanly'
      )
    } finally {
      await session2.cleanup()
    }
    console.log('✓ 4E. Mid-arrival unmount cleanup & stalled-arrival safety timeout passed')
  }

  // --------------------------------------------------------------------------
  // 4F. High-Level Progression (Level 5000 -> 5001) Arrival Integration
  // --------------------------------------------------------------------------
  {
    const baseSeed = 424242
    const wonLevel5000 = buildWonLevelState(5000, baseSeed)
    const expected5001Config = getLevelConfig(5001)

    const session = await mountApp(
      {
        initialPlaying: true,
        initialGameState: wonLevel5000,
        viewportEngineConfig: { skipSpawnSequence: true },
      },
      { reducedMotion: true }
    )
    try {
      const ready = await waitForCondition(() => Boolean(session.getViewportCtx()?.engine))
      assert.equal(ready, true)
      const engine = session.getViewportCtx().engine

      const nextBtn = session.container.querySelector('[data-testid="victory-next-level-btn"]')
      assert.ok(nextBtn, 'Level 5000 victory modal exposes NEXT LEVEL')

      await act(async () => {
        nextBtn.click()
      })

      const done = await waitForCondition(
        () =>
          !session.container.querySelector('[data-testid="elevator-level-transition"]') &&
          session.container
            .querySelector('.maze-viewport-3d')
            .getAttribute('data-arrival-active') === 'false',
        3000
      )
      assert.equal(done, true, 'Level 5000 -> 5001 arrival completes cleanly')

      const maze5001 = engine._currentMaze
      assert.equal(maze5001.level, 5001, 'Advanced cleanly to Level 5001')
      assert.equal(maze5001.rows, expected5001Config.rows)
      assert.equal(maze5001.cols, expected5001Config.cols)
      assert.equal(
        session.container
          .querySelector('.maze-viewport-3d')
          .getAttribute('data-controls-enabled'),
        'true',
        'Level 5001 gameplay controls unlock cleanly after arrival'
      )
    } finally {
      await session.cleanup()
    }
    console.log('✓ 4F. High-level Level 5000 -> 5001 arrival & reduced-motion integration passed')
  }

  console.log('\nALL MAZE-ARRIVAL-001 LEVEL ARRIVAL SEQUENCE TESTS PASSED!')
} finally {
  await viteServer.close()
}
