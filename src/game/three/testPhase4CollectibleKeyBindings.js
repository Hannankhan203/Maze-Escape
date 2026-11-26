import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { COLLECTIBLE_TYPES, MANUAL_COLLECTIBLE_TYPES } from '../mechanics/collectiblesConfig.js'
import { createInitialGameState, gameReducer } from '../engine/gameReducer.js'
import { createContinuousInputController } from '../../hooks/useContinuousInput.js'
import { SETTINGS_SCHEMA } from '../../components/settings/settingsConfig.js'
import {
  loadAllSettings,
  resetAllSettings,
  saveAllSettings,
} from '../../utils/persistence.js'
import {
  DEFAULT_KEY_BINDINGS,
  KEY_BINDING_ACTION_ORDER,
  KEY_BINDING_DEFINITIONS,
  MANUAL_COLLECTIBLE_KEY_BINDING_IDS,
  applyKeyBindingChange,
  findKeyBindingConflict,
} from './threeConfig.js'

console.log('--- Running Phase 4 Customizable Collectible Key Bindings Regression Tests ---')

function createKeyEvent(overrides = {}) {
  let defaultPrevented = false
  let propagationStopped = false
  return {
    type: 'keydown',
    key: '',
    code: '',
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: { tagName: 'BODY', isContentEditable: false },
    get defaultPrevented() {
      return defaultPrevented
    },
    preventDefault() {
      defaultPrevented = true
    },
    stopPropagation() {
      propagationStopped = true
    },
    get propagationStopped() {
      return propagationStopped
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Default Keys, Obsolete Removal & Preserved Non-Collectible Bindings
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Exact 4 manual collectible defaults, conflict-safe alternatives, obsolete removal & auto exclusion')

  // All 10 existing non-collectible bindings preserved unchanged
  assert.equal(DEFAULT_KEY_BINDINGS.moveForward, 'w')
  assert.equal(DEFAULT_KEY_BINDINGS.moveBackward, 's')
  assert.equal(DEFAULT_KEY_BINDINGS.moveLeft, 'a')
  assert.equal(DEFAULT_KEY_BINDINGS.moveRight, 'd')
  assert.equal(DEFAULT_KEY_BINDINGS.sprint, 'shift')
  assert.equal(DEFAULT_KEY_BINDINGS.interact, 'f')
  assert.equal(DEFAULT_KEY_BINDINGS.flashlight, 'l')
  assert.equal(DEFAULT_KEY_BINDINGS.wayfinder, 'h')
  assert.equal(DEFAULT_KEY_BINDINGS.cycleCameraDistance, 'v')
  assert.equal(DEFAULT_KEY_BINDINGS.pause, 'p')

  // Four manual collectible defaults (T & R direct; Q & E avoid preserved V cycleCameraDistance and F interact)
  assert.equal(DEFAULT_KEY_BINDINGS.phantomVeil, 'q')
  assert.equal(DEFAULT_KEY_BINDINGS.timeFragment, 't')
  assert.equal(DEFAULT_KEY_BINDINGS.watchersEye, 'r')
  assert.equal(DEFAULT_KEY_BINDINGS.echoPulse, 'e')

  assert.equal(
    new Set(Object.values(DEFAULT_KEY_BINDINGS)).size,
    14,
    'Every default binding is unique (10 preserved non-collectibles + 4 manual collectibles)'
  )
  assert.equal(KEY_BINDING_ACTION_ORDER.length, 14)
  assert.equal(KEY_BINDING_DEFINITIONS.length, 14)
  assert.deepEqual(Object.keys(MANUAL_COLLECTIBLE_KEY_BINDING_IDS), MANUAL_COLLECTIBLE_TYPES)

  // Obsolete & automatic collectibles must have zero configurable activation bindings
  const keybindItem = SETTINGS_SCHEMA.controls
    .flatMap((g) => g.items)
    .find((item) => item.id === 'keybinds')
  const actionIds = new Set(keybindItem.bindings.map((b) => b.id))
  const actionNames = keybindItem.bindings.map((b) => b.action)

  for (const removedId of ['echoReveal', 'wallPass', 'coinMagnet']) {
    assert.equal(removedId in DEFAULT_KEY_BINDINGS, false, `${removedId} removed from DEFAULT_KEY_BINDINGS`)
    assert.equal(actionIds.has(removedId), false, `${removedId} removed from Settings schema`)
  }
  for (const autoLabel of [
    'Health Capsule',
    'Soul Shards',
    'Spectral Compass',
    'Energy Cell',
    'Warding Charm',
    'Spirit Lantern',
    'Echo Reveal',
  ]) {
    assert.equal(
      actionNames.some((name) => name.includes(autoLabel)),
      false,
      `Automatic pickup "${autoLabel}" has no configurable keyboard binding`
    )
  }

  console.log('✓ Collectible defaults, conflict avoidance & automatic exclusions verified')
}

// ---------------------------------------------------------------------------
// 2. Conflict Detection, Rejection & Swap Resolution for Manual Collectibles
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Conflict detection, rejection, and swap for manual collectible bindings')

  const interactConflict = findKeyBindingConflict(DEFAULT_KEY_BINDINGS, 'echoPulse', 'f')
  assert.deepEqual(interactConflict, {
    actionId: 'interact',
    actionLabel: 'Interact',
    key: 'f',
  })

  const camConflict = findKeyBindingConflict(DEFAULT_KEY_BINDINGS, 'phantomVeil', 'v')
  assert.deepEqual(camConflict, {
    actionId: 'cycleCameraDistance',
    actionLabel: 'Cycle Camera Distance',
    key: 'v',
  })

  const rejected = applyKeyBindingChange(DEFAULT_KEY_BINDINGS, 'timeFragment', 'w', {
    resolution: 'reject',
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.reason, 'conflict')
  assert.equal(rejected.conflict?.actionId, 'moveForward')
  assert.deepEqual(rejected.bindings, DEFAULT_KEY_BINDINGS)

  const reservedC = applyKeyBindingChange(DEFAULT_KEY_BINDINGS, 'watchersEye', 'c', {
    resolution: 'reject',
  })
  assert.equal(reservedC.ok, false)
  assert.equal(reservedC.reason, 'invalid')

  const swapped = applyKeyBindingChange(DEFAULT_KEY_BINDINGS, 'echoPulse', 'f', {
    resolution: 'swap',
  })
  assert.equal(swapped.ok, true)
  assert.equal(swapped.bindings.echoPulse, 'f')
  assert.equal(swapped.bindings.interact, 'e')

  console.log('✓ Conflict detection, rejection & swap verified')
}

// ---------------------------------------------------------------------------
// 3. Keyboard Activation -> Reducer Consumption, Empty Guard & Deduplication
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Keyboard activation consumes 1 stored item, rejects empty inventory & deduplicates')

  let state = createInitialGameState(9191, {
    collectibleConfig: {
      forcedOptionalCategories: MANUAL_COLLECTIBLE_TYPES,
    },
  })

  const collectManual = (type) => {
    const item = state.items.find((entry) => entry.type === type)
    assert.ok(item, `Spawn item exists for ${type}`)
    state = gameReducer(state, {
      type: 'SYNC_PLAYER_CELL',
      row: item.row,
      col: item.col,
    })
  }

  for (const type of MANUAL_COLLECTIBLE_TYPES) {
    collectManual(type)
    assert.equal(state.inventory[type], 1, `${type} stored on pickup`)
  }

  // Automatic Echo Reveal still activates immediately for 4.5s on pickup
  const echoItem = state.items.find((entry) => entry.type === COLLECTIBLE_TYPES.ECHO_REVEAL)
  assert.ok(echoItem)
  state = gameReducer(state, {
    type: 'SYNC_PLAYER_CELL',
    row: echoItem.row,
    col: echoItem.col,
  })
  assert.equal(state.activeEffects.echoRevealRemainingMs, 4500)

  const controller = createContinuousInputController({
    keyBindings: DEFAULT_KEY_BINDINGS,
    onActivateAbility: (abilityType, meta) => {
      state = gameReducer(state, {
        type: 'ACTIVATE_ABILITY',
        abilityType,
        ...(meta?.inputEventId !== undefined ? { inputEventId: meta.inputEventId } : {}),
      })
    },
  })

  // Press default Q -> Phantom Veil (4s), consume 1
  const qEvt = createKeyEvent({ key: 'q' })
  controller.handleKeyDown(qEvt)
  assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 0)
  assert.equal(state.activeEffects.phantomVeilRemainingMs, 4000)

  // Held repeat + same event reference + empty press consume 0 more
  controller.handleKeyDown(createKeyEvent({ key: 'q', repeat: true }))
  controller.handleKeyDown(qEvt)
  controller.handleKeyUp(createKeyEvent({ key: 'q' }))
  controller.handleKeyDown(createKeyEvent({ key: 'q' }))
  assert.equal(state.inventory[COLLECTIBLE_TYPES.PHANTOM_VEIL], 0)

  // Press default T -> Time Fragment (5s), consume 1
  controller.handleKeyDown(createKeyEvent({ key: 't' }))
  assert.equal(state.inventory[COLLECTIBLE_TYPES.TIME_FRAGMENT], 0)
  assert.equal(state.activeEffects.timeFragmentRemainingMs, 5000)
  controller.handleKeyUp(createKeyEvent({ key: 't' }))

  // Press default R -> Watcher's Eye (6s), consume 1
  controller.handleKeyDown(createKeyEvent({ key: 'r' }))
  assert.equal(state.inventory[COLLECTIBLE_TYPES.WATCHERS_EYE], 0)
  assert.equal(state.activeEffects.watchersEyeRemainingMs, 6000)
  controller.handleKeyUp(createKeyEvent({ key: 'r' }))

  // Press default E -> Echo Pulse (2s shockwave), consume 1 (not Echo Reveal!)
  controller.handleKeyDown(createKeyEvent({ key: 'e' }))
  assert.equal(state.inventory[COLLECTIBLE_TYPES.ECHO_PULSE], 0)
  assert.equal(state.lastEvent?.type, 'ability_activated')
  assert.equal(state.lastEvent?.abilityType, COLLECTIBLE_TYPES.ECHO_PULSE)
  assert.equal(state.lastEvent?.echoPulse?.duration, 2000)
  controller.handleKeyUp(createKeyEvent({ key: 'e' }))

  // Empty inventory press does not mutate state or emit activation event
  const prevCounter = state.eventCounter
  controller.handleKeyDown(createKeyEvent({ key: 'e' }))
  controller.handleKeyUp(createKeyEvent({ key: 'e' }))
  assert.equal(state.eventCounter, prevCounter)

  // Same inputEventId across re-dispatched event does not consume two charges even with 2 stored
  let stateTwo = createInitialGameState(9292)
  stateTwo = {
    ...stateTwo,
    inventory: {
      ...stateTwo.inventory,
      [COLLECTIBLE_TYPES.ECHO_PULSE]: 2,
    },
  }
  const ctrlDedup = createContinuousInputController({
    keyBindings: DEFAULT_KEY_BINDINGS,
    onActivateAbility: (abilityType, meta) => {
      stateTwo = gameReducer(stateTwo, {
        type: 'ACTIVATE_ABILITY',
        abilityType,
        ...(meta?.inputEventId !== undefined ? { inputEventId: meta.inputEventId } : {}),
      })
    },
  })
  ctrlDedup.handleKeyDown(createKeyEvent({ key: 'e', inputEventId: 'single-press-1' }))
  ctrlDedup.handleKeyUp(createKeyEvent({ key: 'e' }))
  ctrlDedup.handleKeyDown(createKeyEvent({ key: 'e', inputEventId: 'single-press-1' }))
  ctrlDedup.handleKeyUp(createKeyEvent({ key: 'e' }))
  assert.equal(
    stateTwo.inventory[COLLECTIBLE_TYPES.ECHO_PULSE],
    1,
    'Duplicate inputEventId after keyup consumes only 1 charge'
  )

  console.log('✓ Keyboard activation, empty guard & single-event deduplication verified')
}

// ---------------------------------------------------------------------------
// 4. Full App + SettingsModal + HUD + TouchControls3D + Persistence & Restore
// ---------------------------------------------------------------------------
function createMiniDomEnv() {
  const createEventEmitter = () => {
    const map = new Map()
    return {
      addEventListener(type, fn, opts) {
        if (typeof fn !== 'function') return
        if (!map.has(type)) map.set(type, [])
        const capture = Boolean(opts === true || opts?.capture)
        const list = map.get(type)
        if (!list.some((x) => x.fn === fn && x.capture === capture)) list.push({ fn, capture })
      },
      removeEventListener(type, fn, opts) {
        const list = map.get(type)
        if (!list) return
        const capture = Boolean(opts === true || opts?.capture)
        map.set(type, list.filter((x) => !(x.fn === fn && x.capture === capture)))
      },
      getListeners(type, capture) {
        return (map.get(type) || []).filter((x) => x.capture === capture).map((x) => x.fn)
      },
    }
  }

  const matchesSingle = (el, rawSel) => {
    if (!el || el.nodeType !== 1) return false
    let sel = rawSel.trim()
    if (!sel) return false
    const attrs = []
    sel = sel.replace(
      /\[([^\]=*~|^$]+)(?:([*^$|~]?=)["']?([^"'\]]*)["']?)?\]/g,
      (_m, name, op, val) => {
        attrs.push({ name: name.trim(), op: op || null, val: val ?? '' })
        return ''
      }
    )
    for (const af of attrs) {
      const has = el.hasAttribute(af.name)
      if (!af.op) {
        if (!has) return false
      } else {
        const actual = el.getAttribute(af.name)
        if (actual === null) return false
        if (af.op === '=' && actual !== af.val) return false
      }
    }
    const classes = []
    sel = sel.replace(/\.([A-Za-z0-9_-]+)/g, (_m, cls) => {
      classes.push(cls)
      return ''
    })
    let id = null
    sel = sel.replace(/#([A-Za-z0-9_-]+)/g, (_m, val) => {
      id = val
      return ''
    })
    const tag = sel.trim().toUpperCase()
    if (tag && tag !== '*' && el.tagName !== tag) return false
    if (id !== null && el.id !== id) return false
    for (const c of classes) {
      if (!el.classList.contains(c)) return false
    }
    return true
  }

  const matchesSelector = (el, sel) =>
    sel.split(',').map((s) => s.trim()).filter(Boolean).some((s) => matchesSingle(el, s))

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
      const i = this.parentNode.childNodes.indexOf(this)
      return i >= 0 ? this.parentNode.childNodes[i + 1] || null : null
    }
    get isConnected() {
      let cur = this
      while (cur) {
        if (cur === this.ownerDocument || cur === this.ownerDocument?.documentElement) return true
        cur = cur.parentNode
      }
      return false
    }
    appendChild(c) {
      return this.insertBefore(c, null)
    }
    insertBefore(c, ref) {
      if (!c) return c
      if (c.parentNode) c.parentNode.removeChild(c)
      c.parentNode = this
      if (!ref) this.childNodes.push(c)
      else {
        const idx = this.childNodes.indexOf(ref)
        if (idx === -1) this.childNodes.push(c)
        else this.childNodes.splice(idx, 0, c)
      }
      return c
    }
    removeChild(c) {
      const idx = this.childNodes.indexOf(c)
      if (idx !== -1) {
        this.childNodes.splice(idx, 1)
        c.parentNode = null
      }
      return c
    }
    contains(target) {
      let cur = target
      while (cur) {
        if (cur === this) return true
        cur = cur.parentNode
      }
      return false
    }
    get textContent() {
      if (this.nodeType === 3 || this.nodeType === 8) return this.nodeValue || ''
      return this.childNodes.map((c) => c.textContent).join('')
    }
    set textContent(v) {
      const s = v == null ? '' : String(v)
      if (this.nodeType === 3 || this.nodeType === 8) {
        this.nodeValue = s
        return
      }
      while (this.childNodes.length) this.removeChild(this.childNodes[0])
      if (s !== '') this.appendChild(this.ownerDocument.createTextNode(s))
    }
  }

  class MiniText extends MiniNode {
    constructor(v, d) {
      super(3, d)
      this.nodeValue = String(v ?? '')
    }
  }

  class MiniComment extends MiniNode {
    constructor(v, d) {
      super(8, d)
      this.nodeValue = String(v ?? '')
    }
  }

  class MiniElement extends MiniNode {
    constructor(tag, doc, ns = 'http://www.w3.org/1999/xhtml') {
      super(1, doc)
      this.tagName = String(tag).toUpperCase()
      this.nodeName = this.tagName
      this.namespaceURI = ns
      this._attrs = new Map()
      this._emitter = createEventEmitter()
      this.style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '', display: '', visibility: '' }
      this.clientWidth = 1280
      this.clientHeight = 720
      const elem = this
      this.dataset = new Proxy(
        {},
        {
          get(_target, prop) {
            const attrName =
              'data-' + String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
            return elem.getAttribute(attrName) ?? undefined
          },
          set(_target, prop, value) {
            const attrName =
              'data-' + String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
            elem.setAttribute(attrName, String(value))
            return true
          },
        }
      )
      this.classList = {
        contains: (c) => this.className.split(/\s+/).includes(c),
        add: (c) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean))
          set.add(c)
          this.className = Array.from(set).join(' ')
        },
        remove: (c) => {
          this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' ')
        },
      }
    }
    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1)
    }
    matches(sel) {
      return matchesSelector(this, sel)
    }
    get className() {
      return this._attrs.get('class') || ''
    }
    set className(v) {
      this._attrs.set('class', String(v || ''))
    }
    get id() {
      return this._attrs.get('id') || ''
    }
    set id(v) {
      this._attrs.set('id', String(v || ''))
    }
    get disabled() {
      return this.hasAttribute('disabled')
    }
    set disabled(v) {
      if (v) this.setAttribute('disabled', '')
      else this.removeAttribute('disabled')
    }
    setAttribute(k, v) {
      this._attrs.set(String(k), String(v))
    }
    setAttributeNS(_ns, k, v) {
      this.setAttribute(k, v)
    }
    getAttribute(k) {
      const key = String(k)
      return this._attrs.has(key) ? this._attrs.get(key) : null
    }
    hasAttribute(k) {
      return this._attrs.has(String(k))
    }
    removeAttribute(k) {
      this._attrs.delete(String(k))
    }
    addEventListener(type, fn, opts) {
      this._emitter.addEventListener(type, fn, opts)
    }
    removeEventListener(type, fn, opts) {
      this._emitter.removeEventListener(type, fn, opts)
    }
    focus() {
      if (!this.disabled) this.ownerDocument.activeElement = this
    }
    blur() {
      if (this.ownerDocument.activeElement === this) {
        this.ownerDocument.activeElement = this.ownerDocument.body
      }
    }
    closest(sel) {
      let cur = this
      while (cur && cur.nodeType === 1) {
        if (matchesSelector(cur, sel)) return cur
        cur = cur.parentNode
      }
      return null
    }
    querySelectorAll(sel) {
      const out = []
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 1) {
            if (matchesSelector(c, sel)) out.push(c)
            walk(c)
          }
        }
      }
      walk(this)
      return out
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }
    }
    setPointerCapture() {}
    releasePointerCapture() {}
    hasPointerCapture() {
      return false
    }
    dispatchEvent(rawEvt) {
      const evt = rawEvt || {}
      if (!evt.target) evt.target = this
      if (typeof evt.defaultPrevented !== 'boolean') evt.defaultPrevented = false
      if (typeof evt.preventDefault !== 'function') evt.preventDefault = () => { evt.defaultPrevented = true }
      let stopped = false
      if (typeof evt.stopPropagation !== 'function') evt.stopPropagation = () => { stopped = true }
      const path = []
      let cur = this
      while (cur) {
        path.push(cur)
        cur = cur.parentNode
      }
      const doc = this.ownerDocument
      const win = doc?.defaultView
      if (win && !stopped) {
        evt.currentTarget = win
        for (const fn of win._emitter.getListeners(evt.type, true)) fn(evt)
      }
      if (doc && !stopped) {
        evt.currentTarget = doc
        for (const fn of doc._emitter.getListeners(evt.type, true)) fn(evt)
      }
      for (let i = path.length - 1; i >= 0 && !stopped; i -= 1) {
        evt.currentTarget = path[i]
        for (const fn of path[i]._emitter?.getListeners?.(evt.type, true) || []) fn(evt)
      }
      for (let i = 0; i < path.length && !stopped; i += 1) {
        evt.currentTarget = path[i]
        for (const fn of path[i]._emitter?.getListeners?.(evt.type, false) || []) fn(evt)
        if (evt.bubbles === false) break
      }
      if (evt.bubbles !== false && doc && !stopped) {
        evt.currentTarget = doc
        for (const fn of doc._emitter.getListeners(evt.type, false)) fn(evt)
      }
      if (evt.bubbles !== false && win && !stopped) {
        evt.currentTarget = win
        for (const fn of win._emitter.getListeners(evt.type, false)) fn(evt)
      }
      return !evt.defaultPrevented
    }
  }

  class MiniCanvas extends MiniElement {
    constructor(doc) {
      super('canvas', doc)
    }
    getContext() {
      return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        setTransform() {},
        fillRect() {},
        strokeRect() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        arc() {},
        ellipse() {},
        fill() {},
        stroke() {},
      }
    }
  }

  class MiniIFrame extends MiniElement {}

  const winEmitter = createEventEmitter()
  const docEmitter = createEventEmitter()
  const docObj = {
    nodeType: 9,
    hidden: false,
    visibilityState: 'visible',
    activeElement: null,
    pointerLockElement: null,
    _emitter: docEmitter,
    createElement: (t) => (t.toLowerCase() === 'canvas' ? new MiniCanvas(docObj) : new MiniElement(t, docObj)),
    createElementNS: (_ns, t) => new MiniElement(t, docObj),
    createTextNode: (t) => new MiniText(String(t ?? ''), docObj),
    createComment: (t) => new MiniComment(String(t ?? ''), docObj),
    addEventListener: (t, fn, o) => docEmitter.addEventListener(t, fn, o),
    removeEventListener: (t, fn, o) => docEmitter.removeEventListener(t, fn, o),
    querySelectorAll: (s) => docObj.documentElement.querySelectorAll(s),
    querySelector: (s) => docObj.documentElement.querySelector(s),
    contains: (target) => docObj.documentElement.contains(target),
  }
  docObj.documentElement = new MiniElement('html', docObj)
  docObj.head = new MiniElement('head', docObj)
  docObj.body = new MiniElement('body', docObj)
  docObj.documentElement.appendChild(docObj.head)
  docObj.documentElement.appendChild(docObj.body)
  docObj.activeElement = docObj.body

  const storageMap = new Map()
  const winObj = {
    document: docObj,
    _emitter: winEmitter,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLCanvasElement: MiniCanvas,
    HTMLIFrameElement: MiniIFrame,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    navigator: { userAgent: 'node-test', maxTouchPoints: 0 },
    location: { href: 'http://localhost:3000/', search: '' },
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(String(k), String(v)),
      removeItem: (k) => storageMap.delete(String(k)),
      clear: () => storageMap.clear(),
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener: (t, fn, o) => winEmitter.addEventListener(t, fn, o),
    removeEventListener: (t, fn, o) => winEmitter.removeEventListener(t, fn, o),
    dispatchEvent(rawEvt) {
      const evt = rawEvt || {}
      evt.target = evt.target || winObj
      evt.currentTarget = winObj
      if (typeof evt.defaultPrevented !== 'boolean') evt.defaultPrevented = false
      if (typeof evt.preventDefault !== 'function') evt.preventDefault = () => { evt.defaultPrevented = true }
      let stopped = false
      if (typeof evt.stopPropagation !== 'function') evt.stopPropagation = () => { stopped = true }
      for (const fn of winEmitter.getListeners(evt.type, true)) {
        if (stopped) break
        fn(evt)
      }
      for (const fn of winEmitter.getListeners(evt.type, false)) {
        if (stopped) break
        fn(evt)
      }
      return !evt.defaultPrevented
    },
  }
  docObj.defaultView = winObj

  return {
    window: winObj,
    document: docObj,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLCanvasElement: MiniCanvas,
    HTMLIFrameElement: MiniIFrame,
    ResizeObserver: class { observe() {} disconnect() {} },
  }
}

{
  console.log('Test 4: End-to-end App + Settings UI + HUD badges + keyboard + reload + Restore Defaults')

  const domEnv = createMiniDomEnv()
  const prevGlobals = new Map()
  const install = (k, v) => {
    prevGlobals.set(k, Object.getOwnPropertyDescriptor(globalThis, k))
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  }
  install('IS_REACT_ACT_ENVIRONMENT', true)
  install('window', domEnv.window)
  install('document', domEnv.document)
  install('Node', domEnv.Node)
  install('Element', domEnv.Element)
  install('HTMLElement', domEnv.HTMLElement)
  install('HTMLCanvasElement', domEnv.HTMLCanvasElement)
  install('HTMLIFrameElement', domEnv.HTMLIFrameElement)
  install('ResizeObserver', domEnv.ResizeObserver)
  install('localStorage', domEnv.window.localStorage)

  const viteServer = await createServer({
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })

  try {
    const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')
    const { default: TouchControls3D } = await viteServer.ssrLoadModule('/src/components/game/TouchControls3D.jsx')

    const makeMockRenderer = () => () => ({
      domElement: domEnv.document.createElement('canvas'),
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 1,
      setPixelRatio() {},
      setSize() {},
      render() {},
      dispose() {},
      getContext: () => ({ getContextAttributes: () => ({ antialias: true }) }),
    })

    const clickEl = async (el) => {
      assert.ok(el, 'Target element exists before click')
      await act(async () => {
        el.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
      })
    }

    const pressWindowKey = async (key, extra = {}) => {
      await act(async () => {
        domEnv.window.dispatchEvent({
          type: 'keydown',
          key,
          code: extra.code || '',
          repeat: Boolean(extra.repeat),
          ctrlKey: Boolean(extra.ctrlKey),
          altKey: Boolean(extra.altKey),
          metaKey: Boolean(extra.metaKey),
          shiftKey: Boolean(extra.shiftKey),
          target: extra.target || domEnv.document.body,
        })
      })
      await act(async () => {
        domEnv.window.dispatchEvent({
          type: 'keyup',
          key,
          code: extra.code || '',
          target: extra.target || domEnv.document.body,
        })
      })
    }

    const mountApp = async () => {
      const container = domEnv.document.createElement('div')
      domEnv.document.body.appendChild(container)
      const root = createRoot(container)
      let activeEngine = null
      const gameEvents = []
      await act(async () => {
        root.render(
          createElement(App, {
            initialPlaying: true,
            viewportEngineConfig: {
              isSoftwareGl: false,
              createRenderer: makeMockRenderer(),
              spawnSequence: { enabled: false },
            },
            onViewportReady: ({ engine }) => {
              activeEngine = engine
            },
            onGameEvent: (evt) => gameEvents.push(evt),
          })
        )
      })
      return { container, root, getEngine: () => activeEngine, gameEvents }
    }

    const session1 = await mountApp()
    try {
      // Default HUD badges match Q, T, R, E
      assert.equal(session1.container.querySelector('[data-manual-collectible="phantom_veil"]')?.getAttribute('data-keybind'), 'Q')
      assert.equal(session1.container.querySelector('[data-manual-collectible="time_fragment"]')?.getAttribute('data-keybind'), 'T')
      assert.equal(session1.container.querySelector('[data-manual-collectible="watchers_eye"]')?.getAttribute('data-keybind'), 'R')
      assert.equal(session1.container.querySelector('[data-manual-collectible="echo_pulse"]')?.getAttribute('data-keybind'), 'E')

      // Open Pause -> Settings -> Mouse & Controls
      await pressWindowKey('p')
      await clickEl(session1.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Settings'))
      await clickEl(session1.container.querySelectorAll('[role="tab"]').find((t) => t.textContent.includes('Mouse & Controls')))

      // Conflict rejected when binding echoPulse to 'f' (Interact)
      await clickEl(session1.container.querySelector('[data-keybind-action="echoPulse"]'))
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'f', target: domEnv.document.body })
      })
      assert.ok(
        session1.container.querySelector('.lv-keybind-feedback')?.textContent?.includes('Interact'),
        'Conflict alert names Interact when attempting to bind Echo Pulse to F'
      )
      await clickEl(session1.container.querySelector('[data-keybind-cancel-conflict="true"]'))

      // Customize all 4 manual collectibles -> 1, 2, 3, 4
      const rebind = async (actionId, key) => {
        await clickEl(session1.container.querySelector(`[data-keybind-action="${actionId}"]`))
        await act(async () => {
          domEnv.window.dispatchEvent({ type: 'keydown', key, target: domEnv.document.body })
        })
      }
      await rebind('phantomVeil', '1')
      await rebind('timeFragment', '2')
      await rebind('watchersEye', '3')
      await rebind('echoPulse', '4')

      await clickEl(session1.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Back'))
      await clickEl(session1.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Resume'))

      // HUD immediately reflects customized keys 1, 2, 3, 4
      assert.equal(session1.container.querySelector('[data-manual-collectible="phantom_veil"]')?.getAttribute('data-keybind'), '1')
      assert.equal(session1.container.querySelector('[data-manual-collectible="time_fragment"]')?.getAttribute('data-keybind'), '2')
      assert.equal(session1.container.querySelector('[data-manual-collectible="watchers_eye"]')?.getAttribute('data-keybind'), '3')
      assert.equal(session1.container.querySelector('[data-manual-collectible="echo_pulse"]')?.getAttribute('data-keybind'), '4')

      // Empty inventory press on 1..4 triggers zero activation events
      const beforeEmptyCount = session1.gameEvents.length
      await pressWindowKey('1')
      await pressWindowKey('2')
      await pressWindowKey('3')
      await pressWindowKey('4')
      assert.equal(session1.gameEvents.length, beforeEmptyCount, 'Pressing keys with empty inventory does nothing')

      // Collect one Echo Pulse inside the live engine & confirm old 'e' fails while custom '4' activates once
      const engine1 = session1.getEngine()
      assert.ok(engine1)
      const pulseEntry = Array.from(engine1.getCollectibleManager()?.items?.values?.() || []).find(
        (c) => c.type === COLLECTIBLE_TYPES.ECHO_PULSE
      )
      assert.ok(pulseEntry)
      await act(async () => {
        engine1.setPlayerGridPosition(pulseEntry.row, pulseEntry.col, { immediate: true })
        engine1._movementOptions?.onPlayerCellChange?.({
          row: pulseEntry.row,
          col: pulseEntry.col,
        })
        engine1.stepFrame(0.016)
      })
      assert.equal(
        session1.container.querySelector('[data-manual-collectible="echo_pulse"]')?.getAttribute('data-stored-count'),
        '1'
      )

      await pressWindowKey('e')
      assert.equal(
        session1.container.querySelector('[data-manual-collectible="echo_pulse"]')?.getAttribute('data-stored-count'),
        '1',
        'Old default key E does not activate rebound Echo Pulse'
      )

      await pressWindowKey('4')
      assert.equal(
        session1.container.querySelector('[data-manual-collectible="echo_pulse"]')?.getAttribute('data-stored-count'),
        '0',
        'Custom key 4 consumes Echo Pulse and activates it'
      )
      assert.ok(
        session1.gameEvents.some(
          (e) => e.type === 'ability_activated' && e.abilityType === COLLECTIBLE_TYPES.ECHO_PULSE
        )
      )
    } finally {
      await act(async () => {
        session1.root.unmount()
      })
      session1.container.parentNode?.removeChild(session1.container)
    }

    // Verify localStorage persistence and reload survival
    const persisted = loadAllSettings(domEnv.window.localStorage)
    assert.equal(persisted.controls.keyBindings.phantomVeil, '1')
    assert.equal(persisted.controls.keyBindings.timeFragment, '2')
    assert.equal(persisted.controls.keyBindings.watchersEye, '3')
    assert.equal(persisted.controls.keyBindings.echoPulse, '4')

    const session2 = await mountApp()
    try {
      assert.equal(session2.container.querySelector('[data-manual-collectible="phantom_veil"]')?.getAttribute('data-keybind'), '1')
      assert.equal(session2.container.querySelector('[data-manual-collectible="time_fragment"]')?.getAttribute('data-keybind'), '2')
      assert.equal(session2.container.querySelector('[data-manual-collectible="watchers_eye"]')?.getAttribute('data-keybind'), '3')
      assert.equal(session2.container.querySelector('[data-manual-collectible="echo_pulse"]')?.getAttribute('data-keybind'), '4')

      // Collect Phantom Veil in reloaded session and trigger via persisted key '1'
      const engine2 = session2.getEngine()
      const veilEntry = Array.from(engine2.getCollectibleManager()?.items?.values?.() || []).find(
        (c) => c.type === COLLECTIBLE_TYPES.PHANTOM_VEIL
      )
      assert.ok(veilEntry)
      await act(async () => {
        engine2.setPlayerGridPosition(veilEntry.row, veilEntry.col, { immediate: true })
        engine2._movementOptions?.onPlayerCellChange?.({
          row: veilEntry.row,
          col: veilEntry.col,
        })
        engine2.stepFrame(0.016)
      })
      assert.equal(
        session2.container.querySelector('[data-manual-collectible="phantom_veil"]')?.getAttribute('data-stored-count'),
        '1'
      )
      await pressWindowKey('1')
      assert.equal(
        session2.container.querySelector('[data-manual-collectible="phantom_veil"]')?.getAttribute('data-stored-count'),
        '0'
      )
      assert.equal(
        session2.container.querySelector('[data-manual-collectible="phantom_veil"]')?.getAttribute('data-active'),
        'true'
      )

      // Restore Default Keys inside Settings -> HUD updates back to Q, T, R, E
      await pressWindowKey('p')
      await clickEl(session2.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Settings'))
      await clickEl(session2.container.querySelectorAll('[role="tab"]').find((t) => t.textContent.includes('Mouse & Controls')))
      await clickEl(session2.container.querySelector('[data-keybind-restore-defaults="true"]'))
      await clickEl(session2.container.querySelector('[data-keybind-confirm-reset="true"]'))
      await clickEl(session2.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Back'))
      await clickEl(session2.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Resume'))

      assert.equal(session2.container.querySelector('[data-manual-collectible="phantom_veil"]')?.getAttribute('data-keybind'), 'Q')
      assert.equal(session2.container.querySelector('[data-manual-collectible="time_fragment"]')?.getAttribute('data-keybind'), 'T')
      assert.equal(session2.container.querySelector('[data-manual-collectible="watchers_eye"]')?.getAttribute('data-keybind'), 'R')
      assert.equal(session2.container.querySelector('[data-manual-collectible="echo_pulse"]')?.getAttribute('data-keybind'), 'E')
    } finally {
      await act(async () => {
        session2.root.unmount()
      })
      session2.container.parentNode?.removeChild(session2.container)
    }

    // TouchControls3D remains fully functional with custom bindings
    const touchHost = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(touchHost)
    const touchRoot = createRoot(touchHost)
    const touchTriggers = []
    await act(async () => {
      touchRoot.render(
        createElement(TouchControls3D, {
          enabled: true,
          mode: 'always',
          inventory: { [COLLECTIBLE_TYPES.TIME_FRAGMENT]: 1 },
          activeEffects: {},
          keyBindings: { ...DEFAULT_KEY_BINDINGS, timeFragment: '8' },
          onActivateAbility: (type) => touchTriggers.push(type),
        })
      )
    })
    const tfTouch = touchHost.querySelector(`[data-touch-action="${COLLECTIBLE_TYPES.TIME_FRAGMENT}"]`)
    assert.ok(tfTouch?.getAttribute('aria-label')?.includes('8'))
    await act(async () => {
      tfTouch.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 3, bubbles: true })
      tfTouch.dispatchEvent({ type: 'pointerup', pointerId: 3, bubbles: true })
      tfTouch.dispatchEvent({ type: 'click', detail: 1, bubbles: true })
    })
    assert.deepEqual(touchTriggers, [COLLECTIBLE_TYPES.TIME_FRAGMENT])
    await act(async () => {
      touchRoot.unmount()
    })
    touchHost.parentNode?.removeChild(touchHost)

    // Save/reset storage helpers maintain defaults cleanly
    saveAllSettings(
      {
        ...loadAllSettings(domEnv.window.localStorage),
        controls: {
          ...loadAllSettings(domEnv.window.localStorage).controls,
          keyBindings: { ...DEFAULT_KEY_BINDINGS, timeFragment: '7' },
        },
      },
      domEnv.window.localStorage
    )
    const resetResult = resetAllSettings(domEnv.window.localStorage)
    assert.deepEqual(resetResult.settings.controls.keyBindings, DEFAULT_KEY_BINDINGS)

    console.log('✓ Full App + Settings UI + HUD badges + persistence & Restore Defaults verified')
  } finally {
    await viteServer.close()
    for (const [k, desc] of prevGlobals.entries()) {
      if (desc) Object.defineProperty(globalThis, k, desc)
      else delete globalThis[k]
    }
  }
}

console.log('--- ALL PHASE 4 COLLECTIBLE KEYBINDING TESTS PASSED! ---')
