import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import { STANDARD_HAZARD_TYPES } from '../generation/hazardTypes.js'
import { PROP_TYPES } from '../generation/environmentalPropPlacement.js'
import { ENEMY_TYPES } from '../generation/enemyPlacement.js'
import { ALL_COLLECTIBLE_CATEGORIES, KEYCARD_COLLECTIBLE_TYPE } from '../mechanics/collectiblesConfig.js'
import { ALL_HIDING_SPOT_TYPES } from '../mechanics/hidingConfig.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import {
  createAdvanceLevelAction,
  createInitialGameState,
  createNewGameAction,
  createReplayLevelAction,
  createStartSandboxAction,
  gameReducer,
} from '../engine/gameReducer.js'
import {
  isDeveloperAccessEnabled,
  isSandboxViewRequested,
} from '../sandbox/sandboxAccess.js'
import {
  ENVIRONMENTAL_OBJECT_TYPES,
  PLACEMENT_MODES,
  PLACEMENT_PREFERENCES,
  QUANTITY_INELIGIBLE_ENVIRONMENTAL_TYPES,
  SANDBOX_CATEGORY_IDS,
  SANDBOX_GLOBAL_LIMITS,
  SANDBOX_ITEMS_BY_CATEGORY,
  SANDBOX_PRESETS,
  SANDBOX_STORAGE_KEY,
  addManualPlacement,
  applySandboxPreset,
  createDefaultSandboxConfig,
  exportSandboxConfigJson,
  getItemQuantityLimits,
  getSandboxConfigSummary,
  getSupportedPlacementPreferences,
  importSandboxConfigJson,
  isItemQuantityEligible,
  isSandboxItemEnabled,
  loadSandboxConfig,
  resetSandboxConfig,
  saveSandboxConfig,
  setCategoryAllEnabled,
  setItemPlacementPreference,
  setItemQuantity,
  setSandboxAllowFallback,
  setSandboxSeed,
  toggleSandboxItem,
  validateSandboxConfig,
} from '../sandbox/sandboxConfig.js'
import {
  extractLiveEntitiesFromEngine,
  generateLiveVerificationReport,
} from '../sandbox/sandboxDiagnostics.js'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import {
  PLACEMENT_PREFERENCE_REGISTRY,
  computeBfsDistanceMap,
  getCellTopology,
} from '../generation/placementPreferences.js'
import { buildMazeMeshes } from './buildMazeMeshes.js'
import { getElevatorColliderDescriptors } from './buildElevators.js'
import { STORAGE_KEYS } from '../../utils/persistence.js'

console.log('--- Running MAZE-DEV-SANDBOX-001 Developer Testing Sandbox Tests ---')

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

  class MiniFragment extends MiniNode {
    constructor(ownerDocument) {
      super(11, ownerDocument)
    }
  }

  class MiniElement extends MiniNode {
    constructor(tagName, ownerDocument) {
      super(1, ownerDocument)
      this.tagName = String(tagName).toUpperCase()
      this.nodeName = this.tagName
      this.attributes = new Map()
      this.style = {}
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

    getClientRects() {
      return [{ width: 100, height: 32, top: 0, left: 0 }]
    }

    getBoundingClientRect() {
      return { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }
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
      for (let i = path.length - 1; i >= 0; i--) {
        const node = path[i]
        evtObj.currentTarget = node
        if (node._emitter) {
          for (const listener of node._emitter.getListeners(event.type, true)) {
            listener(evtObj)
            if (stopped) return !defaultPrevented
          }
        }
      }
      for (let i = 0; i < path.length; i++) {
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

  class MiniInputElement extends MiniElement {
    constructor(ownerDocument) {
      super('input', ownerDocument)
      this._value = ''
    }
    get type() {
      return this.getAttribute('type') || 'text'
    }
    set type(val) {
      this.setAttribute('type', String(val))
    }
    get value() {
      if (this._value !== undefined && this._value !== '') return this._value
      if (this.props && this.props.value !== undefined) return String(this.props.value)
      return this.textContent || this.getAttribute('value') || ''
    }
    set value(val) {
      this._value = String(val)
      this.textContent = String(val)
      this.setAttribute('value', String(val))
    }
    get checked() {
      return this._checked
    }
    set checked(val) {
      this._checked = Boolean(val)
    }
  }

  class MiniTextAreaElement extends MiniInputElement {
    constructor(ownerDocument) {
      super(ownerDocument)
      this.tagName = 'TEXTAREA'
    }
  }

  class MiniOptionElement extends MiniElement {
    constructor(ownerDocument) {
      super('option', ownerDocument)
      this._selected = false
    }
    get value() {
      return this._value !== undefined && this._value !== ''
        ? this._value
        : (this.getAttribute('value') ?? this.textContent)
    }
    set value(val) {
      this._value = String(val)
      this.setAttribute('value', String(val))
    }
    get selected() {
      return this._selected || this.hasAttribute('selected')
    }
    set selected(val) {
      this._selected = Boolean(val)
      if (val) this.setAttribute('selected', '')
      else this.removeAttribute('selected')
    }
  }

  class MiniSelectElement extends MiniElement {
    constructor(ownerDocument) {
      super('select', ownerDocument)
      this._value = ''
    }
    get multiple() {
      return this.hasAttribute('multiple')
    }
    set multiple(val) {
      if (val) this.setAttribute('multiple', '')
      else this.removeAttribute('multiple')
    }
    get options() {
      const opts = []
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (child.tagName === 'OPTION') {
              opts.push(child)
            } else {
              walk(child)
            }
          }
        }
      }
      walk(this)
      return opts
    }
    get value() {
      if (this._value !== undefined && this._value !== '') return this._value
      const opts = this.options
      const selected = opts.find((o) => o.selected)
      return selected ? selected.value : (opts[0] ? opts[0].value : '')
    }
    set value(val) {
      this._value = String(val)
      const opts = this.options
      for (const opt of opts) {
        opt.selected = opt.value === this._value
      }
    }
    get selectedIndex() {
      const opts = this.options
      return opts.findIndex((o) => o.selected)
    }
    set selectedIndex(idx) {
      const opts = this.options
      opts.forEach((o, i) => {
        o.selected = i === idx
      })
      if (opts[idx]) {
        this._value = opts[idx].value
      }
    }
  }

  const store = new Map()
  const localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(String(key), String(value))
    },
    removeItem(key) {
      store.delete(String(key))
    },
    clear() {
      store.clear()
    },
  }

  const documentObj = {
    nodeType: 9,
    documentElement: null,
    head: null,
    body: null,
    activeElement: null,
    _emitter: createEventEmitter(),
    createElement(tag) {
      const lower = String(tag).toLowerCase()
      if (lower === 'input') {
        return new MiniInputElement(documentObj)
      }
      if (lower === 'textarea') {
        return new MiniTextAreaElement(documentObj)
      }
      if (lower === 'select') {
        return new MiniSelectElement(documentObj)
      }
      if (lower === 'option') {
        return new MiniOptionElement(documentObj)
      }
      return new MiniElement(tag, documentObj)
    },
    createElementNS(_ns, tag) {
      return this.createElement(tag)
    },
    createTextNode(text) {
      return new MiniText(text, documentObj)
    },
    createComment(text) {
      return new MiniComment(text, documentObj)
    },
    createDocumentFragment() {
      return new MiniFragment(documentObj)
    },
    querySelector(sel) {
      return this.body.querySelector(sel)
    },
    querySelectorAll(sel) {
      return this.body.querySelectorAll(sel)
    },
    getElementById(id) {
      return this.body.querySelector(`#${id}`)
    },
    addEventListener(type, fn, opts) {
      this._emitter.addEventListener(type, fn, opts)
    },
    removeEventListener(type, fn, opts) {
      this._emitter.removeEventListener(type, fn, opts)
    },
  }

  const windowObj = {
    document: documentObj,
    localStorage,
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    _emitter: createEventEmitter(),
    get location() {
      return {
        get href() {
          return currentUrl.href
        },
        get search() {
          return currentUrl.search
        },
        get pathname() {
          return currentUrl.pathname
        },
        get hash() {
          return currentUrl.hash
        },
      }
    },
    setUrl(nextUrl) {
      currentUrl = new URL(nextUrl)
    },
    history: {
      state: null,
      replaceState(_state, _title, nextUrl) {
        currentUrl = new URL(nextUrl, currentUrl.origin)
      },
    },
    navigator: { maxTouchPoints: 0, userAgent: 'node-test', vibrate: () => true },
    HTMLIFrameElement: class HTMLIFrameElement {},
    HTMLInputElement: MiniInputElement,
    HTMLSelectElement: MiniSelectElement,
    HTMLOptionElement: MiniOptionElement,
    Element: MiniElement,
    HTMLElement: MiniElement,
    Node: MiniNode,
    Text: MiniText,
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener(type, fn, opts) {
      this._emitter.addEventListener(type, fn, opts)
    },
    removeEventListener(type, fn, opts) {
      this._emitter.removeEventListener(type, fn, opts)
    },
    dispatchEvent(event) {
      if (!event || !event.type) return true
      let defaultPrevented = false
      const evtObj = {
        ...event,
        target: event.target || windowObj,
        currentTarget: windowObj,
        preventDefault() {
          defaultPrevented = true
        },
      }
      for (const listener of this._emitter.getListeners(event.type, true)) {
        listener(evtObj)
      }
      for (const listener of this._emitter.getListeners(event.type, false)) {
        listener(evtObj)
      }
      return !defaultPrevented
    },
  }

  documentObj.defaultView = windowObj
  documentObj.documentElement = new MiniElement('html', documentObj)
  documentObj.head = new MiniElement('head', documentObj)
  documentObj.body = new MiniElement('body', documentObj)
  documentObj.documentElement.appendChild(documentObj.head)
  documentObj.documentElement.appendChild(documentObj.body)

  return {
    window: windowObj,
    document: documentObj,
    localStorage,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLInputElement: MiniInputElement,
    HTMLSelectElement: MiniSelectElement,
    HTMLOptionElement: MiniOptionElement,
    Node: MiniNode,
    Text: MiniText,
  }
}

function createMockWebGLRenderer() {
  return {
    domElement: {
      style: {},
      addEventListener() {},
      removeEventListener() {},
      requestPointerLock() {},
      getBoundingClientRect: () => ({ width: 1280, height: 720, top: 0, left: 0 }),
    },
    shadowMap: { enabled: false, type: null },
    setSize() {},
    setPixelRatio() {},
    render() {},
    dispose() {},
  }
}

const domEnv = createMiniDomEnv('http://localhost:3000/')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.window = domEnv.window
globalThis.document = domEnv.document
globalThis.localStorage = domEnv.localStorage
globalThis.Element = domEnv.Element
globalThis.HTMLElement = domEnv.HTMLElement
globalThis.HTMLInputElement = domEnv.HTMLInputElement
globalThis.HTMLSelectElement = domEnv.HTMLSelectElement
globalThis.HTMLOptionElement = domEnv.HTMLOptionElement
globalThis.Node = domEnv.Node
globalThis.Text = domEnv.Text
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { createRoot } = await import('react-dom/client')

async function clickEl(el) {
  assert.ok(el, 'Expected clickable element to exist')
  await act(async () => {
    el.dispatchEvent({ type: 'click', bubbles: true })
  })
}

async function pressWindowKey(key) {
  await act(async () => {
    domEnv.window.dispatchEvent({
      type: 'keydown',
      key,
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    })
  })
}

async function flushTick(ms = 25) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

// =========================================================================
// PART A — Unit & Data Model Verification (Phases 3, 4, 5)
// =========================================================================
{
  console.log('Test 1: Sandbox catalog completeness & extensibility schema')
  const defaults = createDefaultSandboxConfig()
  assert.equal(defaults.mode, 'sandbox')

  // Hazards: all 10 existing hazard types
  const hazardIds = SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.HAZARDS].map((i) => i.id)
  assert.equal(hazardIds.length, 10)
  for (const h of STANDARD_HAZARD_TYPES) {
    assert.ok(hazardIds.includes(h), `Missing hazard ${h}`)
    const entry = defaults.categories.hazards.items[h]
    assert.equal(entry.enabled, true)
    assert.equal(entry.quantity, null)
    assert.equal(entry.placementMode, PLACEMENT_MODES.AUTO)
    assert.equal(entry.placementPreference, 'auto')
    assert.equal(entry.customConfig, null)
  }

  // Collectibles: all 12 existing collectible categories (4 permanent + 8 optional)
  const collectibleIds = SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.COLLECTIBLES].map(
    (i) => i.id
  )
  assert.equal(collectibleIds.length, ALL_COLLECTIBLE_CATEGORIES.length)
  for (const c of ALL_COLLECTIBLE_CATEGORIES) {
    assert.ok(collectibleIds.includes(c), `Missing collectible ${c}`)
  }

  // Hiding spots: all 8 existing types
  const hidingIds = SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.HIDING_SPOTS].map((i) => i.id)
  assert.equal(hidingIds.length, 8)
  for (const hs of ALL_HIDING_SPOT_TYPES) {
    assert.ok(hidingIds.includes(hs), `Missing hiding spot ${hs}`)
  }

  // Enemies: Stalker, Hunter, Brute
  const enemyIds = SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.ENEMIES].map((i) => i.id)
  assert.deepEqual(enemyIds, [ENEMY_TYPES.STALKER, ENEMY_TYPES.HUNTER, ENEMY_TYPES.BRUTE])

  // Environmental objects & interactive elements: real audited entities only
  const envIds = SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS].map(
    (i) => i.id
  )
  assert.equal(envIds.length, 22)
  for (const propType of Object.values(PROP_TYPES)) {
    assert.ok(envIds.includes(propType), `Missing prop type ${propType}`)
  }
  assert.ok(envIds.includes(ENVIRONMENTAL_OBJECT_TYPES.BROKEN_START_ELEVATOR))
  assert.ok(envIds.includes(ENVIRONMENTAL_OBJECT_TYPES.EXTRACTION_ELEVATOR))
  assert.ok(envIds.includes(ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK))
  assert.ok(envIds.includes(ENVIRONMENTAL_OBJECT_TYPES.HAZARD_DECOYS))
  assert.ok(envIds.includes(ENVIRONMENTAL_OBJECT_TYPES.CEILING_LIGHTS))
}

{
  console.log('Test 2: Contradiction prevention, independent categories, Select All / Clear All / Reset')
  let cfg = createDefaultSandboxConfig()

  // Disabling Resonance Keycard automatically disables Keycard Exit Gate Lock
  const resDisableKeycard = toggleSandboxItem(
    cfg,
    SANDBOX_CATEGORY_IDS.COLLECTIBLES,
    KEYCARD_COLLECTIBLE_TYPE,
    false
  )
  cfg = resDisableKeycard.config
  assert.equal(
    isSandboxItemEnabled(cfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, KEYCARD_COLLECTIBLE_TYPE),
    false
  )
  assert.equal(
    isSandboxItemEnabled(
      cfg,
      SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK
    ),
    false
  )
  assert.ok(resDisableKeycard.notices.length >= 1)

  // Re-enabling Keycard Exit Gate Lock restores Resonance Keycard dependency
  const resEnableLock = toggleSandboxItem(
    cfg,
    SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
    ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK,
    true
  )
  cfg = resEnableLock.config
  assert.equal(
    isSandboxItemEnabled(cfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, KEYCARD_COLLECTIBLE_TYPE),
    true
  )
  assert.equal(
    isSandboxItemEnabled(
      cfg,
      SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK
    ),
    true
  )

  // Spectral Compass warning when Soul Shards disabled
  cfg = toggleSandboxItem(cfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'soul_shards', false).config
  const validation = validateSandboxConfig(cfg)
  assert.equal(validation.valid, true)
  assert.ok(validation.warnings.some((w) => w.includes('Spectral Compass')))

  // Independent Clear All / Select All on Hazards does not alter other categories
  const clearedHazards = setCategoryAllEnabled(cfg, SANDBOX_CATEGORY_IDS.HAZARDS, false).config
  const clearedSummary = getSandboxConfigSummary(clearedHazards)
  assert.equal(clearedSummary.byCategory.hazards.enabledCount, 0)
  assert.equal(clearedSummary.byCategory.enemies.enabledCount, 3)
  assert.equal(clearedSummary.byCategory.hidingSpots.enabledCount, 8)

  const selectedHazards = setCategoryAllEnabled(
    clearedHazards,
    SANDBOX_CATEGORY_IDS.HAZARDS,
    true
  ).config
  assert.equal(getSandboxConfigSummary(selectedHazards).byCategory.hazards.enabledCount, 10)

  // Reset restores full defaults cleanly
  const reset = resetSandboxConfig().config
  assert.equal(getSandboxConfigSummary(reset).totalEnabled, 55)
}

{
  console.log('Test 3: Reducer, MazeGenerator & Normal Progression Isolation')
  // Normal maze generation must remain deterministic and untouched
  const normalMazeA = generateMaze({ seed: 424242, baseSeed: 424242, level: 2 })
  const normalMazeB = generateMaze({ seed: 424242, baseSeed: 424242, level: 2 })
  assert.equal(normalMazeA.isSandbox, undefined)
  assert.equal(normalMazeA.gameMode, undefined)
  assert.deepEqual(normalMazeA.grid, normalMazeB.grid)
  assert.deepEqual(normalMazeA.hazards, normalMazeB.hazards)
  assert.deepEqual(normalMazeA.enemies, normalMazeB.enemies)

  // Normal initial state & progression
  const normalInit = createInitialGameState({ baseSeed: 333333 })
  assert.equal(normalInit.isSandbox, false)
  assert.equal(normalInit.gameMode, 'standard')
  assert.equal(normalInit.sandboxConfig, null)
  const normalAdvanceAction = createAdvanceLevelAction(normalInit)
  const level2 = gameReducer(normalInit, normalAdvanceAction)
  assert.equal(level2.currentLevel, 2)
  assert.equal(level2.isSandbox, false)

  // Sandbox launch via START_SANDBOX
  let sandboxCfg = createDefaultSandboxConfig()
  sandboxCfg = toggleSandboxItem(
    sandboxCfg,
    SANDBOX_CATEGORY_IDS.COLLECTIBLES,
    KEYCARD_COLLECTIBLE_TYPE,
    false
  ).config
  const startSandboxAction = createStartSandboxAction(sandboxCfg, { baseSeed: 555555 })
  assert.equal(startSandboxAction.type, 'START_SANDBOX')
  assert.equal(startSandboxAction.isSandbox, true)
  assert.equal(startSandboxAction.gameMode, 'sandbox')
  assert.equal(startSandboxAction.maze.isSandbox, true)
  assert.equal(startSandboxAction.maze.gameMode, 'sandbox')
  assert.equal(startSandboxAction.objectivesEnabled, false)

  const sandboxState = gameReducer(level2, startSandboxAction)
  assert.equal(sandboxState.isSandbox, true)
  assert.equal(sandboxState.gameMode, 'sandbox')
  assert.equal(sandboxState.currentLevel, 1)
  assert.equal(sandboxState.cumulativeScore, 0)
  assert.equal(sandboxState.objectivesEnabled, false)

  // Replaying stays in sandbox
  const replayedSandbox = gameReducer(
    sandboxState,
    createReplayLevelAction(sandboxState)
  )
  assert.equal(replayedSandbox.isSandbox, true)
  assert.equal(replayedSandbox.gameMode, 'sandbox')

  // Infinite ADVANCE_LEVEL is ignored inside sandbox mode
  const blockedAdvance = gameReducer(sandboxState, { type: 'ADVANCE_LEVEL' })
  assert.equal(blockedAdvance, sandboxState)

  // Starting a normal New Game after sandbox resets to clean standard mode
  const freshNormal = gameReducer(sandboxState, createNewGameAction())
  assert.equal(freshNormal.isSandbox, false)
  assert.equal(freshNormal.gameMode, 'standard')
  assert.equal(freshNormal.sandboxConfig, null)
  assert.equal(freshNormal.currentLevel, 1)
  assert.equal(freshNormal.cumulativeScore, 0)

  // Normal seed lifecycle isolation: creating a standard game with an explicit baseSeed
  // before vs after sandbox runs produces identical deterministic Level 1 seed and grid
  const baselineStandard = createInitialGameState({ baseSeed: 777777 })
  const postSandboxStandard = gameReducer(sandboxState, createNewGameAction({ baseSeed: 777777 }))
  assert.equal(postSandboxStandard.seed, baselineStandard.seed)
  assert.equal(postSandboxStandard.baseSeed, baselineStandard.baseSeed)
  assert.deepEqual(postSandboxStandard.maze.grid, baselineStandard.maze.grid)
}

// =========================================================================
// PART B — Full React UI, URL Access, Persistence & Engine Boundary Checks
// =========================================================================
const viteServer = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'silent',
})

try {
  const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')
  const { default: VictoryModal } = await viteServer.ssrLoadModule(
    '/src/components/game/VictoryModal.jsx'
  )
  const { default: PauseScreen } = await viteServer.ssrLoadModule(
    '/src/components/game/PauseScreen.jsx'
  )

  // -----------------------------------------------------------------------
  // 4. Normal user URL (?devtools absent) hides all developer entry points
  // -----------------------------------------------------------------------
  {
    console.log('Test 4: Developer controls hidden when ?devtools=1 is absent & in normal gameplay')
    domEnv.localStorage.clear()
    domEnv.window.setUrl('http://localhost:3000/')
    assert.equal(isDeveloperAccessEnabled(domEnv.window.location), false)
    assert.equal(isSandboxViewRequested(domEnv.window.location), false)

    // Even ?sandbox=1 without ?devtools=1 must NOT grant sandbox access
    domEnv.window.setUrl('http://localhost:3000/?sandbox=1')
    assert.equal(isDeveloperAccessEnabled(domEnv.window.location), false)
    assert.equal(isSandboxViewRequested(domEnv.window.location), false)

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    let latestEngine = null

    await act(async () => {
      root.render(
        createElement(App, {
          arrivalConfig: { startOverlayMinMs: 0 },
          viewportEngineConfig: { createRenderer: createMockWebGLRenderer },
          onViewportReady: (ctx) => {
            latestEngine = ctx.engine
          },
        })
      )
    })

    assert.equal(container.querySelector('[data-testid="start-dev-sandbox-btn"]'), null)
    assert.equal(container.querySelector('[data-testid="start-dev-sandbox-view"]'), null)
    assert.ok(container.querySelector('[data-testid="start-game-btn"]'))

    // Launch ordinary gameplay -> no developer controls or sandbox badge
    await clickEl(container.querySelector('[data-testid="start-game-btn"]'))
    await flushTick(30)
    assert.equal(container.querySelector('[data-testid="maze-sandbox-badge"]'), null)
    assert.equal(container.querySelector('[data-testid="start-dev-sandbox-view"]'), null)
    assert.ok(latestEngine)
    assert.equal(latestEngine.getSandboxState().isSandbox, false)
    assert.equal(latestEngine.getSandboxState().gameMode, 'standard')

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
  }

  // -----------------------------------------------------------------------
  // 5. Developer URL (?devtools=1) entry, all 5 sections, Select All/Clear All/Reset, tab persistence
  // -----------------------------------------------------------------------
  {
    console.log('Test 5: Developer Sandbox UI controls, tab persistence, Select All/Clear All, Reset')
    domEnv.localStorage.clear()
    // Seed existing normal game settings to verify isolation
    domEnv.localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({ version: 1, gameplay: { fieldOfView: 88 } })
    )
    domEnv.window.setUrl('http://localhost:3000/?devtools=1')
    assert.equal(isDeveloperAccessEnabled(domEnv.window.location), true)

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    let latestEngine = null

    await act(async () => {
      root.render(
        createElement(App, {
          arrivalConfig: { startOverlayMinMs: 0 },
          viewportEngineConfig: { createRenderer: createMockWebGLRenderer },
          onViewportReady: (ctx) => {
            latestEngine = ctx.engine
          },
        })
      )
    })

    const entryBtn = container.querySelector('[data-testid="start-dev-sandbox-btn"]')
    assert.ok(entryBtn, 'Developer Sandbox entry button visible when ?devtools=1 is enabled')
    await clickEl(entryBtn)

    const sandboxView = container.querySelector('[data-testid="start-dev-sandbox-view"]')
    assert.ok(sandboxView, 'Developer Sandbox configuration screen rendered')
    assert.ok(domEnv.window.location.search.includes('sandbox=1'))

    // Verify all 5 category tabs exist
    for (const catId of Object.values(SANDBOX_CATEGORY_IDS)) {
      assert.ok(container.querySelector(`[data-testid="sandbox-tab-${catId}"]`))
    }

    // Hazards default 10/10 -> toggle Ceiling Collapse OFF
    const ceilingToggle = container.querySelector(
      '[data-testid="sandbox-toggle-hazards-ceiling_collapse"]'
    )
    assert.ok(ceilingToggle)
    assert.equal(ceilingToggle.getAttribute('aria-checked'), 'true')
    await clickEl(ceilingToggle)
    assert.equal(
      container
        .querySelector('[data-testid="sandbox-toggle-hazards-ceiling_collapse"]')
        .getAttribute('aria-checked'),
      'false'
    )
    assert.equal(
      container.querySelector('[data-testid="sandbox-tab-count-hazards"]').textContent.trim(),
      '9/10'
    )

    // Switch through Collectibles, Hiding Spots, Enemies, Environmental tabs and verify items
    await clickEl(container.querySelector('[data-testid="sandbox-tab-collectibles"]'))
    assert.ok(container.querySelector('[data-testid="sandbox-panel-collectibles"]'))
    assert.ok(container.querySelector('[data-testid="sandbox-toggle-collectibles-soul_shards"]'))
    assert.ok(
      container.querySelector('[data-testid="sandbox-toggle-collectibles-resonance_keycard"]')
    )
    assert.ok(container.querySelector('[data-testid="sandbox-toggle-collectibles-phantom_veil"]'))

    await clickEl(container.querySelector('[data-testid="sandbox-tab-hidingSpots"]'))
    assert.ok(container.querySelector('[data-testid="sandbox-toggle-hidingSpots-metal_cupboard"]'))
    assert.ok(container.querySelector('[data-testid="sandbox-toggle-hidingSpots-storage_shelves"]'))

    await clickEl(container.querySelector('[data-testid="sandbox-tab-enemies"]'))
    assert.ok(container.querySelector('[data-testid="sandbox-toggle-enemies-stalker"]'))
    assert.ok(container.querySelector('[data-testid="sandbox-toggle-enemies-hunter"]'))
    assert.ok(container.querySelector('[data-testid="sandbox-toggle-enemies-brute"]'))

    // Clear All Enemies -> 0/3, Hazards remains 9/10
    await clickEl(container.querySelector('[data-testid="sandbox-clear-all-btn"]'))
    assert.equal(
      container.querySelector('[data-testid="sandbox-tab-count-enemies"]').textContent.trim(),
      '0/3'
    )
    assert.equal(
      container.querySelector('[data-testid="sandbox-tab-count-hazards"]').textContent.trim(),
      '9/10'
    )

    // Select All Enemies -> 3/3
    await clickEl(container.querySelector('[data-testid="sandbox-select-all-btn"]'))
    assert.equal(
      container.querySelector('[data-testid="sandbox-tab-count-enemies"]').textContent.trim(),
      '3/3'
    )

    await clickEl(container.querySelector('[data-testid="sandbox-tab-environmentalObjects"]'))
    assert.ok(
      container.querySelector(
        '[data-testid="sandbox-toggle-environmentalObjects-keycard_exit_lock"]'
      )
    )
    assert.ok(
      container.querySelector('[data-testid="sandbox-toggle-environmentalObjects-ceiling_lights"]')
    )

    // Return to Hazards tab -> Ceiling Collapse is STILL false (preserved across tabs)
    await clickEl(container.querySelector('[data-testid="sandbox-tab-hazards"]'))
    assert.equal(
      container
        .querySelector('[data-testid="sandbox-toggle-hazards-ceiling_collapse"]')
        .getAttribute('aria-checked'),
      'false'
    )

    // Reset Configuration restores 10/10 hazards and 55/55 total
    await clickEl(container.querySelector('[data-testid="sandbox-reset-btn"]'))
    assert.equal(
      container
        .querySelector('[data-testid="sandbox-toggle-hazards-ceiling_collapse"]')
        .getAttribute('aria-checked'),
      'true'
    )
    assert.ok(
      container
        .querySelector('[data-testid="sandbox-summary-total"]')
        .textContent.includes('55 / 55 Enabled')
    )

    // Toggle Ceiling Collapse + Brute OFF and Start Test Level -> propagates to engine boundary
    await clickEl(
      container.querySelector('[data-testid="sandbox-toggle-hazards-ceiling_collapse"]')
    )
    await clickEl(container.querySelector('[data-testid="sandbox-tab-enemies"]'))
    await clickEl(container.querySelector('[data-testid="sandbox-toggle-enemies-brute"]'))

    await clickEl(container.querySelector('[data-testid="sandbox-start-test-btn"]'))
    await flushTick(30)
    const badge = container.querySelector('[data-testid="maze-sandbox-badge"]')
    assert.ok(badge && badge.textContent.includes('SANDBOX'))
    assert.ok(latestEngine)
    const engineSandbox = latestEngine.getSandboxState()
    assert.equal(engineSandbox.isSandbox, true)
    assert.equal(engineSandbox.gameMode, 'sandbox')
    assert.equal(
      isSandboxItemEnabled(
        engineSandbox.sandboxConfig,
        SANDBOX_CATEGORY_IDS.HAZARDS,
        'ceiling_collapse'
      ),
      false
    )
    assert.equal(
      isSandboxItemEnabled(
        engineSandbox.sandboxConfig,
        SANDBOX_CATEGORY_IDS.ENEMIES,
        'brute'
      ),
      false
    )

    // Pause during sandbox run -> click Sandbox Config -> returns cleanly to config view
    await pressWindowKey('p')
    const pauseReturnBtn = container.querySelector('[data-testid="pause-return-sandbox-btn"]')
    assert.ok(pauseReturnBtn, 'Pause screen offers Sandbox Config return during sandbox session')
    await clickEl(pauseReturnBtn)
    assert.ok(container.querySelector('[data-testid="start-dev-sandbox-view"]'))

    // Verify all 5 summary cards reflect the saved edits (9/10 hazards, 2/3 enemies)
    assert.ok(
      container
        .querySelector('[data-testid="sandbox-summary-hazards"]')
        .textContent.includes('9 / 10')
    )
    assert.ok(
      container
        .querySelector('[data-testid="sandbox-summary-collectibles"]')
        .textContent.includes('12 / 12')
    )
    assert.ok(
      container
        .querySelector('[data-testid="sandbox-summary-hidingSpots"]')
        .textContent.includes('8 / 8')
    )
    assert.ok(
      container
        .querySelector('[data-testid="sandbox-summary-enemies"]')
        .textContent.includes('2 / 3')
    )
    assert.ok(
      container
        .querySelector('[data-testid="sandbox-summary-environmentalObjects"]')
        .textContent.includes('22 / 22')
    )

    // Normal game settings remained completely untouched
    const rawNormalSettings = JSON.parse(
      domEnv.localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}'
    )
    assert.equal(rawNormalSettings?.gameplay?.fieldOfView, 88)

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
  }

  // -----------------------------------------------------------------------
  // 6. Browser refresh / direct URL (?devtools=1&sandbox=1) & Back to Menu
  // -----------------------------------------------------------------------
  {
    console.log('Test 6: Direct URL / browser refresh (?devtools=1&sandbox=1) & Back navigation')
    domEnv.window.setUrl('http://localhost:3000/?devtools=1&sandbox=1')
    assert.equal(isSandboxViewRequested(domEnv.window.location), true)

    // Verify saved config persisted from Test 5 (ceiling_collapse=false, brute=false)
    const persisted = loadSandboxConfig(domEnv.localStorage)
    assert.equal(
      isSandboxItemEnabled(persisted, SANDBOX_CATEGORY_IDS.HAZARDS, 'ceiling_collapse'),
      false
    )
    assert.equal(
      isSandboxItemEnabled(persisted, SANDBOX_CATEGORY_IDS.ENEMIES, 'brute'),
      false
    )
    assert.ok(domEnv.localStorage.getItem(SANDBOX_STORAGE_KEY))

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(App, {
          arrivalConfig: { startOverlayMinMs: 0 },
          viewportEngineConfig: { createRenderer: createMockWebGLRenderer },
        })
      )
    })

    // Immediately opens Developer Sandbox view with saved configuration
    assert.ok(container.querySelector('[data-testid="start-dev-sandbox-view"]'))
    assert.equal(
      container
        .querySelector('[data-testid="sandbox-toggle-hazards-ceiling_collapse"]')
        .getAttribute('aria-checked'),
      'false'
    )

    // Escape or Back button returns cleanly to Main Menu and clears ?sandbox=1
    await pressWindowKey('Escape')
    assert.equal(container.querySelector('[data-testid="start-dev-sandbox-view"]'), null)
    assert.ok(container.querySelector('[data-testid="start-game-btn"]'))
    assert.ok(container.querySelector('[data-testid="start-dev-sandbox-btn"]'))
    assert.equal(domEnv.window.location.search.includes('sandbox=1'), false)

    // Starting normal game afterwards runs cleanly in standard mode
    await clickEl(container.querySelector('[data-testid="start-game-btn"]'))
    await flushTick(30)
    assert.equal(container.querySelector('[data-testid="maze-sandbox-badge"]'), null)

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
  }

  // -----------------------------------------------------------------------
  // 7. PauseScreen & VictoryModal Sandbox Mode vs Standard Mode Isolation
  // -----------------------------------------------------------------------
  {
    console.log('Test 7: PauseScreen & VictoryModal sandbox actions vs standard progression actions')
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    let returnedToSandbox = false
    await act(async () => {
      root.render(
        createElement(VictoryModal, {
          isOpen: true,
          isSandbox: true,
          completedLevel: 1,
          nextLevel: 2,
          onReturnToSandbox: () => {
            returnedToSandbox = true
          },
          onReplayLevel: () => {},
          onMainMenu: () => {},
        })
      )
    })

    assert.equal(container.querySelector('[data-testid="victory-next-level-btn"]'), null)
    assert.ok(container.querySelector('[data-testid="victory-sandbox-banner"]'))
    const returnBtn = container.querySelector('[data-testid="victory-return-sandbox-btn"]')
    assert.ok(returnBtn)
    await clickEl(returnBtn)
    assert.equal(returnedToSandbox, true)

    await act(async () => {
      root.render(
        createElement(PauseScreen, {
          isOpen: true,
          isSandbox: true,
          onResume: () => {},
          onRestart: () => {},
          onReturnToSandbox: () => {},
        })
      )
    })
    assert.ok(container.querySelector('[data-testid="pause-return-sandbox-btn"]'))

    await act(async () => {
      root.render(
        createElement(PauseScreen, {
          isOpen: true,
          isSandbox: false,
          onResume: () => {},
          onRestart: () => {},
        })
      )
    })
    assert.equal(container.querySelector('[data-testid="pause-return-sandbox-btn"]'), null)

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
  }

  // Ensure saveSandboxConfig / loadSandboxConfig works with isolated key
  const saved = saveSandboxConfig(createDefaultSandboxConfig(), domEnv.localStorage)
  assert.equal(saved.saved, true)

  // -----------------------------------------------------------------------
  // Test 8: Stage 2 Procedural Generation Filtering & Guaranteed Content
  // -----------------------------------------------------------------------
  {
    console.log('Test 8: Stage 2 Procedural Generation Filtering & Guaranteed Content')
    let customCfg = createDefaultSandboxConfig()
    for (const h of STANDARD_HAZARD_TYPES) {
      if (h !== 'steam_pipe_burst') {
        const res = toggleSandboxItem(customCfg, SANDBOX_CATEGORY_IDS.HAZARDS, h, false)
        customCfg = res.config
      }
    }
    for (const e of ['stalker', 'hunter', 'brute']) {
      if (e !== 'brute') {
        const res = toggleSandboxItem(customCfg, SANDBOX_CATEGORY_IDS.ENEMIES, e, false)
        customCfg = res.config
      }
    }

    const testMaze = generateMaze({
      level: 1,
      seed: 999999,
      sandboxConfig: customCfg,
    })

    assert.equal(testMaze.isSandbox, true)
    for (const h of testMaze.hazards) {
      assert.equal(h.type, 'steam_pipe_burst')
    }
    for (const en of testMaze.enemies) {
      assert.equal(en.type, 'brute')
    }
  }

  // -----------------------------------------------------------------------
  // Test 9: Stage 3 Per-Item Quantities, Limits, Input Guards & All Categories
  // -----------------------------------------------------------------------
  {
    console.log('Test 9: Stage 3 Per-Item Quantities, Limits, Input Guards & All Categories')

    // Verify all 9 preferences documented and eligibility partitions 13 eligible vs 9 ineligible environmental items
    assert.equal(PLACEMENT_PREFERENCES.length, 9)
    assert.equal(Object.keys(PLACEMENT_PREFERENCE_REGISTRY).length, 9)
    assert.equal(Object.keys(QUANTITY_INELIGIBLE_ENVIRONMENTAL_TYPES).length, 9)

    const envItems = SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS]
    const eligibleEnv = envItems.filter((i) =>
      isItemQuantityEligible(SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS, i.id)
    )
    const ineligibleEnv = envItems.filter(
      (i) => !isItemQuantityEligible(SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS, i.id)
    )
    assert.equal(eligibleEnv.length, 13)
    assert.equal(ineligibleEnv.length, 9)

    // Invalid inputs & caps
    let cfg = createDefaultSandboxConfig()
    const nanRes = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'steam_pipe_burst', Number.NaN)
    assert.equal(
      nanRes.config.categories.hazards.items.steam_pipe_burst.quantity,
      null,
      'NaN quantity must be ignored'
    )
    assert.ok(nanRes.notices.length > 0)

    const negRes = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'steam_pipe_burst', -5)
    assert.equal(negRes.config.categories.hazards.items.steam_pipe_burst.quantity, 0)

    const hazardLimit = getItemQuantityLimits(SANDBOX_CATEGORY_IDS.HAZARDS, 'steam_pipe_burst')
    const overMaxRes = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'steam_pipe_burst', 999)
    assert.equal(overMaxRes.config.categories.hazards.items.steam_pipe_burst.quantity, hazardLimit.max)

    // Ineligible item ignores quantity & preference mutations
    const ineligQtyRes = setItemQuantity(
      cfg,
      SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      ENVIRONMENTAL_OBJECT_TYPES.CEILING_LIGHTS,
      5
    )
    assert.equal(
      ineligQtyRes.config.categories.environmentalObjects.items.ceiling_lights.quantity,
      null
    )
    assert.deepEqual(
      getSupportedPlacementPreferences(
        SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
        ENVIRONMENTAL_OBJECT_TYPES.CEILING_LIGHTS
      ),
      []
    )

    // Exact 0, 1, N spawning across ALL 5 categories (and keycard=0 unlocking exit gate)
    cfg = createDefaultSandboxConfig()
    for (const h of STANDARD_HAZARD_TYPES) {
      cfg = setItemQuantity(
        cfg,
        SANDBOX_CATEGORY_IDS.HAZARDS,
        h,
        h === 'steam_pipe_burst' ? 3 : h === 'ceiling_collapse' ? 1 : 0
      ).config
    }
    for (const c of ALL_COLLECTIBLE_CATEGORIES) {
      cfg = setItemQuantity(
        cfg,
        SANDBOX_CATEGORY_IDS.COLLECTIBLES,
        c,
        c === 'soul_shards' ? 6 : c === 'time_fragment' ? 2 : 0
      ).config
    }
    for (const hs of ALL_HIDING_SPOT_TYPES) {
      cfg = setItemQuantity(
        cfg,
        SANDBOX_CATEGORY_IDS.HIDING_SPOTS,
        hs,
        hs === 'metal_cupboard' ? 4 : 0
      ).config
    }
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'stalker', 2).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'hunter', 0).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'brute', 2).config
    for (const prop of Object.values(PROP_TYPES)) {
      cfg = setItemQuantity(
        cfg,
        SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
        prop,
        prop === PROP_TYPES.WOODEN_CRATE ? 5 : 0
      ).config
    }
    cfg = setItemQuantity(
      cfg,
      SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      ENVIRONMENTAL_OBJECT_TYPES.HAZARD_DECOYS,
      4
    ).config

    const summary = getSandboxConfigSummary(cfg)
    assert.equal(summary.objectivesEnabled, false, 'keycard qty 0 automatically unlocks exit gate')
    assert.ok(summary.totalConfiguredSpawnCount <= SANDBOX_GLOBAL_LIMITS.maxTotalSpawnableEntities)

    const maze = generateMaze({ level: 1, seed: 888888, sandboxConfig: cfg })
    assert.equal(maze.isSandbox, true)
    assert.equal(maze.requiredKeys, 0)
    assert.equal(maze.keycards.length, 0)
    assert.equal(maze.hazards.filter((h) => h.type === 'steam_pipe_burst').length, 3)
    assert.equal(maze.hazards.filter((h) => h.type === 'ceiling_collapse').length, 1)
    assert.equal(maze.hazards.length, 4)
    assert.equal(maze.collectibles.items.filter((i) => i.type === 'soul_shards').length, 6)
    assert.equal(maze.collectibles.items.filter((i) => i.type === 'time_fragment').length, 2)
    assert.equal(maze.collectibles.items.length, 8)
    assert.equal(maze.hidingSpots.filter((s) => s.type === 'metal_cupboard').length, 4)
    assert.equal(maze.hidingSpots.length, 4)
    assert.equal(maze.enemies.filter((e) => e.type === 'stalker').length, 2)
    assert.equal(maze.enemies.filter((e) => e.type === 'hunter').length, 0)
    assert.equal(maze.enemies.filter((e) => e.type === 'brute').length, 2)
    assert.equal(maze.environmentalProps.filter((p) => p.type === PROP_TYPES.WOODEN_CRATE).length, 5)
    assert.equal(maze.environmentalProps.length, 5)
    assert.equal(maze.hazardDecoys.decoys.length, 4)
    assert.equal(maze.sandboxValidationReport.fullySatisfied, true)
    assert.equal(maze.sandboxValidationReport.totalFailed, 0)

    // Total zero quantities cleanly yields zero spawned entities
    let zeroCfg = createDefaultSandboxConfig()
    for (const h of STANDARD_HAZARD_TYPES) {
      zeroCfg = setItemQuantity(zeroCfg, SANDBOX_CATEGORY_IDS.HAZARDS, h, 0).config
    }
    for (const c of ALL_COLLECTIBLE_CATEGORIES) {
      zeroCfg = setItemQuantity(zeroCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, c, 0).config
    }
    for (const hs of ALL_HIDING_SPOT_TYPES) {
      zeroCfg = setItemQuantity(zeroCfg, SANDBOX_CATEGORY_IDS.HIDING_SPOTS, hs, 0).config
    }
    for (const en of ['stalker', 'hunter', 'brute']) {
      zeroCfg = setItemQuantity(zeroCfg, SANDBOX_CATEGORY_IDS.ENEMIES, en, 0).config
    }
    for (const prop of Object.values(PROP_TYPES)) {
      zeroCfg = setItemQuantity(zeroCfg, SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS, prop, 0).config
    }
    zeroCfg = setItemQuantity(
      zeroCfg,
      SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      ENVIRONMENTAL_OBJECT_TYPES.HAZARD_DECOYS,
      0
    ).config

    const emptyMaze = generateMaze({ level: 1, seed: 101010, sandboxConfig: zeroCfg })
    assert.equal(emptyMaze.hazards.length, 0)
    assert.equal(emptyMaze.keycards.length, 0)
    assert.equal(emptyMaze.collectibles.items.length, 0)
    assert.equal(emptyMaze.hidingSpots.length, 0)
    assert.equal(emptyMaze.enemies.length, 0)
    assert.equal(emptyMaze.environmentalProps.length, 0)
    assert.equal(emptyMaze.hazardDecoys.decoys.length, 0)
  }

  // -----------------------------------------------------------------------
  // Test 10: All 9 Placement Preferences, Safety Margins, Determinism & Strict/Fallback Reporting
  // -----------------------------------------------------------------------
  {
    console.log('Test 10: All 9 Placement Preferences, Safety, Determinism & Strict/Fallback')

    // 1. Test spatial/topological preferences with deterministic seed
    let prefCfg = createDefaultSandboxConfig()
    // Keep only tested items active with exact quantities to verify placement geometry
    for (const h of STANDARD_HAZARD_TYPES) {
      prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.HAZARDS, h, 0).config
    }
    for (const c of ALL_COLLECTIBLE_CATEGORIES) {
      prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, c, 0).config
    }
    for (const hs of ALL_HIDING_SPOT_TYPES) {
      prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.HIDING_SPOTS, hs, 0).config
    }
    for (const en of ['stalker', 'hunter', 'brute']) {
      prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.ENEMIES, en, 0).config
    }
    for (const prop of Object.values(PROP_TYPES)) {
      prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS, prop, 0).config
    }
    prefCfg = setItemQuantity(
      prefCfg,
      SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      ENVIRONMENTAL_OBJECT_TYPES.HAZARD_DECOYS,
      0
    ).config

    // Assign each preference across entities
    prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'brute', 2).config
    prefCfg = setItemPlacementPreference(prefCfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'brute', 'near_start').config
    prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'hunter', 2).config
    prefCfg = setItemPlacementPreference(prefCfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'hunter', 'far_start').config

    prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'soul_shards', 4).config
    prefCfg = setItemPlacementPreference(prefCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'soul_shards', 'dead_ends').config
    prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'health_capsule', 3).config
    prefCfg = setItemPlacementPreference(prefCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'health_capsule', 'spread').config
    prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'energy_cell', 3).config
    prefCfg = setItemPlacementPreference(prefCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'energy_cell', 'clustered').config
    prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'resonance_keycard', 2).config
    prefCfg = setItemPlacementPreference(prefCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'resonance_keycard', 'central').config

    prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'steam_pipe_burst', 3).config
    prefCfg = setItemPlacementPreference(prefCfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'steam_pipe_burst', 'corridors').config
    prefCfg = setItemQuantity(prefCfg, SANDBOX_CATEGORY_IDS.HIDING_SPOTS, 'metal_cupboard', 2).config
    prefCfg = setItemPlacementPreference(prefCfg, SANDBOX_CATEGORY_IDS.HIDING_SPOTS, 'metal_cupboard', 'isolated').config

    prefCfg = setSandboxAllowFallback(prefCfg, false).config
    const mazeA = generateMaze({ level: 2, seed: 543210, sandboxConfig: prefCfg })
    const mazeB = generateMaze({ level: 2, seed: 543210, sandboxConfig: prefCfg })

    // Determinism check
    assert.deepEqual(
      mazeA.collectibles.items.map((i) => ({ type: i.type, row: i.row, col: i.col })),
      mazeB.collectibles.items.map((i) => ({ type: i.type, row: i.row, col: i.col })),
      'Sandbox preferences must be deterministic for identical seeds'
    )

    const bfsStart = computeBfsDistanceMap(mazeA.grid, mazeA.start)
    const brutes = mazeA.enemies.filter((e) => e.type === 'brute')
    const hunters = mazeA.enemies.filter((e) => e.type === 'hunter')
    assert.equal(brutes.length, 2)
    assert.equal(hunters.length, 2)

    // Verify brute near_start strictly honors dist >= 3 safety buffer and is closer than hunters (far_start)
    for (const b of brutes) {
      const dist = bfsStart.dists[b.spawnCell.row * bfsStart.cols + b.spawnCell.col]
      assert.ok(dist >= 3, `Enemy near_start (${b.spawnCell.row},${b.spawnCell.col}) violated min start distance (${dist})`)
    }
    const avgBruteDist =
      brutes.reduce((s, b) => s + bfsStart.dists[b.spawnCell.row * bfsStart.cols + b.spawnCell.col], 0) /
      brutes.length
    const avgHunterDist =
      hunters.reduce((s, h) => s + bfsStart.dists[h.spawnCell.row * bfsStart.cols + h.spawnCell.col], 0) /
      hunters.length
    assert.ok(avgBruteDist < avgHunterDist, `Expected near_start (${avgBruteDist}) < far_start (${avgHunterDist})`)

    // Dead ends check
    const shards = mazeA.collectibles.items.filter((i) => i.type === 'soul_shards')
    assert.equal(shards.length, 4)
    for (const sh of shards) {
      assert.equal(getCellTopology(mazeA.grid, sh.row, sh.col), 'dead_end')
    }

    // Corridors check for steam_pipe_burst
    const steamHazards = mazeA.hazards.filter((h) => h.type === 'steam_pipe_burst')
    assert.equal(steamHazards.length, 3)
    for (const hz of steamHazards) {
      assert.equal(getCellTopology(mazeA.grid, hz.row, hz.col), 'corridor')
    }

    // Spread check (>= 3 path steps mutual separation on health_capsule)
    const capsules = mazeA.collectibles.items.filter((i) => i.type === 'health_capsule')
    assert.equal(capsules.length, 3)
    for (let i = 0; i < capsules.length; i += 1) {
      const dMap = computeBfsDistanceMap(mazeA.grid, capsules[i])
      for (let j = i + 1; j < capsules.length; j += 1) {
        const mutual = dMap.dists[capsules[j].row * dMap.cols + capsules[j].col]
        assert.ok(mutual >= 3, `Spread instances (${i},${j}) too close: ${mutual}`)
      }
    }

    // Clustered check (within 1-5 path steps of first energy_cell anchor)
    const cells = mazeA.collectibles.items.filter((i) => i.type === 'energy_cell')
    assert.equal(cells.length, 3)
    const anchorBfs = computeBfsDistanceMap(mazeA.grid, cells[0])
    for (let i = 1; i < cells.length; i += 1) {
      const distToAnchor = anchorBfs.dists[cells[i].row * anchorBfs.cols + cells[i].col]
      assert.ok(distToAnchor >= 1 && distToAnchor <= 5, `Clustered energy_cell dist=${distToAnchor}`)
    }

    // Strict mode (allowPreferenceFallback: false) vs Fallback (true) when strict dead_ends are exhausted
    let strictCfg = setSandboxAllowFallback(prefCfg, false).config
    strictCfg = setItemQuantity(strictCfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'soul_shards', 28).config
    strictCfg = setItemPlacementPreference(
      strictCfg,
      SANDBOX_CATEGORY_IDS.COLLECTIBLES,
      'soul_shards',
      'dead_ends'
    ).config
    const strictMaze = generateMaze({ level: 1, seed: 543210, sandboxConfig: strictCfg })
    const strictShardReport = strictMaze.sandboxValidationReport.itemsReport.collectibles.soul_shards
    assert.equal(strictShardReport.requestedQuantity, 28)
    assert.ok(
      strictShardReport.placedQuantity < 28,
      'Strict mode must NOT silently place remaining instances in non-dead-ends'
    )
    assert.ok(strictShardReport.failedQuantity > 0)
    assert.equal(strictShardReport.fallbackPlacementUsed, false)
    assert.equal(strictShardReport.placementPreferenceAchieved, false)

    const fallbackCfg = setSandboxAllowFallback(strictCfg, true).config
    const fallbackMaze = generateMaze({ level: 1, seed: 543210, sandboxConfig: fallbackCfg })
    const fallbackShardReport = fallbackMaze.sandboxValidationReport.itemsReport.collectibles.soul_shards
    assert.equal(fallbackShardReport.placedQuantity, 28)
    assert.equal(fallbackShardReport.failedQuantity, 0)
    assert.equal(fallbackShardReport.fallbackPlacementUsed, true)
  }

  // -----------------------------------------------------------------------
  // Test 11: Architectural / Singleton 3D Gating & Stage 3 Presets
  // -----------------------------------------------------------------------
  {
    console.log('Test 11: Architectural / Singleton 3D Gating & Stage 3 Presets')

    // Turn off architectural layers & singleton elevators
    let archOffCfg = createDefaultSandboxConfig()
    for (const itemId of Object.keys(QUANTITY_INELIGIBLE_ENVIRONMENTAL_TYPES)) {
      archOffCfg = toggleSandboxItem(
        archOffCfg,
        SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
        itemId,
        false
      ).config
    }
    const archOffMaze = generateMaze({ level: 1, seed: 314159, sandboxConfig: archOffCfg })
    const offGroup = buildMazeMeshes(archOffMaze)
    assert.ok(offGroup)
    assert.equal(getElevatorColliderDescriptors(archOffMaze).length, 0)
    assert.equal(offGroup.userData.startElevator, null)
    assert.equal(offGroup.userData.exitGate, null)
    assert.equal(offGroup.userData.ceilingLightsGroup, null)
    assert.equal(offGroup.userData.ceilingVentsGroup, null)
    assert.equal(offGroup.userData.ceilingElectricalGroup, null)
    assert.equal(offGroup.userData.structuralDeteriorationGroup, null)
    assert.equal(offGroup.userData.elevatorShaftsGroup, null)
    assert.equal(offGroup.userData.floorImperfectionsMesh, null)
    assert.equal(offGroup.userData.wallImperfectionsMesh, null)
    assert.equal(offGroup.userData.ceilingImperfectionsMesh, null)
    assert.equal(offGroup.userData.graffitiMesh, null)

    const defaultMaze = generateMaze({ level: 1, seed: 314159, sandboxConfig: createDefaultSandboxConfig() })
    const onGroup = buildMazeMeshes(defaultMaze)
    assert.ok(getElevatorColliderDescriptors(defaultMaze).length > 0)
    assert.ok(onGroup.userData.startElevator)
    assert.ok(onGroup.userData.exitGate)
    assert.ok(onGroup.userData.ceilingLightsGroup)
    assert.ok(onGroup.userData.ceilingVentsGroup)
    assert.ok(onGroup.userData.ceilingElectricalGroup)
    assert.ok(onGroup.userData.structuralDeteriorationGroup)
    assert.ok(onGroup.userData.elevatorShaftsGroup)

    // Presets validation
    for (const preset of SANDBOX_PRESETS) {
      const applied = applySandboxPreset(createDefaultSandboxConfig(), preset.id)
      const val = validateSandboxConfig(applied.config)
      assert.equal(val.valid, true, `Preset ${preset.id} produced invalid sandbox config`)
    }
  }

  // -----------------------------------------------------------------------
  // Test 12: DeveloperSandboxView Stage 3 Quantity, Preference & Fallback UI
  // -----------------------------------------------------------------------
  {
    console.log('Test 12: DeveloperSandboxView Stage 3 Quantity, Preference & Fallback UI')
    const { default: DeveloperSandboxView } = await viteServer.ssrLoadModule(
      '/src/components/sandbox/DeveloperSandboxView.jsx'
    )
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    let latestCfg = createDefaultSandboxConfig()

    await act(async () => {
      root.render(
        createElement(DeveloperSandboxView, {
          sandboxConfig: latestCfg,
          onChangeConfig: (next) => {
            latestCfg = next
            root.render(
              createElement(DeveloperSandboxView, {
                sandboxConfig: latestCfg,
                onChangeConfig: (c) => {
                  latestCfg = c
                },
              })
            )
          },
        })
      )
    })

    const rerenderWithLatest = async (nextCfg) => {
      latestCfg = nextCfg
      await act(async () => {
        root.render(
          createElement(DeveloperSandboxView, {
            sandboxConfig: latestCfg,
            onChangeConfig: rerenderWithLatest,
            onResetConfig: rerenderWithLatest,
          })
        )
      })
    }

    await rerenderWithLatest(createDefaultSandboxConfig())

    // Stepper + increases from Auto -> 1, then + -> 2
    await clickEl(
      container.querySelector('[data-testid="sandbox-qty-inc-hazards-steam_pipe_burst"]')
    )
    assert.equal(latestCfg.categories.hazards.items.steam_pipe_burst.quantity, 1)
    await clickEl(
      container.querySelector('[data-testid="sandbox-qty-inc-hazards-steam_pipe_burst"]')
    )
    assert.equal(latestCfg.categories.hazards.items.steam_pipe_burst.quantity, 2)

    // Stepper - down to 0 renders Disabled (0) badge
    await clickEl(
      container.querySelector('[data-testid="sandbox-qty-dec-hazards-steam_pipe_burst"]')
    )
    await clickEl(
      container.querySelector('[data-testid="sandbox-qty-dec-hazards-steam_pipe_burst"]')
    )
    assert.equal(latestCfg.categories.hazards.items.steam_pipe_burst.quantity, 0)
    assert.ok(
      container.querySelector('[data-testid="sandbox-qty-zero-hazards-steam_pipe_burst"]')
    )

    // Auto button restores null
    await clickEl(
      container.querySelector('[data-testid="sandbox-qty-auto-hazards-steam_pipe_burst"]')
    )
    assert.equal(latestCfg.categories.hazards.items.steam_pipe_burst.quantity, null)

    // Placement preference select
    const prefSelect = container.querySelector(
      '[data-testid="sandbox-pref-hazards-steam_pipe_burst"]'
    )
    assert.ok(prefSelect)
    await act(async () => {
      prefSelect.value = 'corridors'
      prefSelect.dispatchEvent({ type: 'change', bubbles: true })
    })
    assert.equal(
      latestCfg.categories.hazards.items.steam_pipe_burst.placementPreference,
      'corridors'
    )

    // Allow Preference Fallback toggle
    const fallbackToggle = container.querySelector(
      '[data-testid="sandbox-allow-fallback-toggle"]'
    )
    assert.equal(fallbackToggle.getAttribute('aria-checked'), 'false')
    await clickEl(fallbackToggle)
    assert.equal(latestCfg.allowPreferenceFallback, true)

    // Switch to Environmental Objects tab -> Fixed System notes shown for ineligible items, no qty input
    await clickEl(container.querySelector('[data-testid="sandbox-tab-environmentalObjects"]'))
    assert.ok(
      container.querySelector(
        '[data-testid="sandbox-ineligible-environmentalObjects-ceiling_lights"]'
      )
    )
    assert.equal(
      container.querySelector(
        '[data-testid="sandbox-qty-environmentalObjects-ceiling_lights"]'
      ),
      null
    )

    // Switch back to Hazards -> preference survived navigation
    await clickEl(container.querySelector('[data-testid="sandbox-tab-hazards"]'))
    assert.equal(
      container.querySelector('[data-testid="sandbox-pref-hazards-steam_pipe_burst"]').value,
      'corridors'
    )

    // Preset button -> Hazard Stress Test
    await clickEl(container.querySelector('[data-testid="sandbox-preset-hazard_stress_test"]'))
    assert.equal(latestCfg.categories.hazards.items.ceiling_collapse.quantity, 3)
    assert.equal(latestCfg.categories.hazards.items.ceiling_collapse.placementPreference, 'corridors')

    // Reset restores defaults
    await clickEl(container.querySelector('[data-testid="sandbox-reset-btn"]'))
    assert.equal(latestCfg.categories.hazards.items.ceiling_collapse.quantity, null)
    assert.equal(latestCfg.allowPreferenceFallback, false)

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
  }

  // -----------------------------------------------------------------------
  // Test 13: Manual Grid Editor State, Assignments & Validation UI
  // -----------------------------------------------------------------------
  {
    console.log('Test 13: Manual Grid Editor State, Assignments & Validation UI')
    const { default: ManualGridEditorModal } = await viteServer.ssrLoadModule(
      '/src/components/sandbox/ManualGridEditorModal.jsx'
    )
    let cfg = createDefaultSandboxConfig()
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    let latestCfg = cfg

    await act(async () => {
      root.render(
        createElement(ManualGridEditorModal, {
          sandboxConfig: latestCfg,
          onChangeConfig: (next) => {
            latestCfg = next
          },
        })
      )
    })

    assert.ok(container.querySelector('[data-testid="manual-grid-editor-view"]'))
    assert.ok(container.querySelector('[data-testid="manual-maze-grid-canvas"]'))

    const updated = addManualPlacement(latestCfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'ceiling_collapse', 3, 3)
    assert.equal(updated.config.categories.hazards.items.ceiling_collapse.manualPlacements.length, 1)
    assert.deepEqual(updated.config.categories.hazards.items.ceiling_collapse.manualPlacements[0], { row: 3, col: 3 })

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
  }

  // -----------------------------------------------------------------------
  // Test 14: Manual Placements Runtime Coordinate Verification
  // -----------------------------------------------------------------------
  {
    console.log('Test 14: Manual Placements Runtime Coordinate Verification')
    let manualCfg = createDefaultSandboxConfig()
    manualCfg = addManualPlacement(manualCfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'ceiling_collapse', 5, 5).config
    manualCfg = setItemQuantity(manualCfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'ceiling_collapse', 1).config

    const generatedMaze = generateMaze({
      level: 1,
      seed: 987654,
      sandboxConfig: manualCfg,
    })

    assert.ok(generatedMaze.hazards.some((h) => h.row === 5 && h.col === 5), 'Manually placed hazard must spawn at exact configured coordinates (5,5)')
  }

  // -----------------------------------------------------------------------
  // Test 15: Stage 5 Seed Management, Preset State & Safe JSON Export/Import
  // -----------------------------------------------------------------------
  {
    console.log('Test 15: Stage 5 Seed Management, Preset Tracking & Safe JSON Import/Export')
    let cfg = createDefaultSandboxConfig()
    cfg = applySandboxPreset(cfg, 'hazard_stress_test').config
    assert.equal(cfg.activePreset, 'hazard_stress_test')
    assert.equal(cfg.customModified, false)

    cfg = setSandboxSeed(cfg, 424242).config
    assert.equal(cfg.seed, 424242)
    assert.equal(cfg.customModified, true)

    const exportedJson = exportSandboxConfigJson(cfg)
    const parsed = JSON.parse(exportedJson)
    assert.equal(parsed.config.seed, 424242)

    const invalidImport = importSandboxConfigJson('{"not_valid_json": ', cfg)
    assert.equal(invalidImport.imported, false)
    assert.ok(invalidImport.errors.length > 0)
    assert.equal(invalidImport.config.seed, 424242, 'Invalid JSON must preserve existing config untouched')

    const nonObjImport = importSandboxConfigJson('["bad"]', cfg)
    assert.equal(nonObjImport.imported, false)
    assert.equal(nonObjImport.config.seed, 424242)

    const validImport = importSandboxConfigJson(exportedJson, createDefaultSandboxConfig())
    assert.equal(validImport.imported, true)
    assert.equal(validImport.config.seed, 424242)
    assert.equal(validImport.config.activePreset, 'hazard_stress_test')
  }

  // -----------------------------------------------------------------------
  // Test 16: Stage 5 All-Category Manual Spawning & Structured Failure Reasons
  // -----------------------------------------------------------------------
  {
    console.log('Test 16: Stage 5 All-Category Manual Spawning & Structured Failure Diagnostics')
    // Generate a clean baseline maze to read real walkable/wall/start cells
    const probeMaze = generateMaze({ level: 1, seed: 654321, sandboxConfig: createDefaultSandboxConfig() })
    const findCells = () => {
      let wallCell = null
      const farWalkable = []
      let nearStartWalkable = null
      for (let r = 1; r < probeMaze.rows - 1; r += 1) {
        for (let c = 1; c < probeMaze.cols - 1; c += 1) {
          const isStart = probeMaze.start.row === r && probeMaze.start.col === c
          const isExit = probeMaze.exit.row === r && probeMaze.exit.col === c
          if (isStart || isExit) continue
          const distStart = Math.abs(r - probeMaze.start.row) + Math.abs(c - probeMaze.start.col)
          if (probeMaze.grid[r][c] === CELL_TYPES.WALL && !wallCell) {
            wallCell = { row: r, col: c }
          } else if (probeMaze.grid[r][c] === CELL_TYPES.PATH) {
            if (distStart >= 1 && distStart <= 2 && !nearStartWalkable) {
              nearStartWalkable = { row: r, col: c }
            }
            if (distStart >= 5) {
              farWalkable.push({ row: r, col: c })
            }
          }
        }
      }
      return { wallCell, farWalkable, nearStartWalkable }
    }
    const { wallCell, farWalkable, nearStartWalkable } = findCells()
    assert.ok(wallCell && farWalkable.length >= 6 && nearStartWalkable)

    let cfg = createDefaultSandboxConfig()
    cfg = setSandboxSeed(cfg, 654321).config
    // Manual spawns across ALL 6 entity families: hazard, collectible, keycard, hiding spot, enemy, environmental prop
    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'steam_pipe_burst', farWalkable[0].row, farWalkable[0].col).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'steam_pipe_burst', 2).config // 1 manual + 1 auto

    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'soul_shards', farWalkable[1].row, farWalkable[1].col).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'soul_shards', 2).config

    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'resonance_keycard', farWalkable[2].row, farWalkable[2].col).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'resonance_keycard', 1).config

    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.HIDING_SPOTS, 'metal_cupboard', farWalkable[3].row, farWalkable[3].col).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.HIDING_SPOTS, 'metal_cupboard', 1).config

    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'stalker', farWalkable[4].row, farWalkable[4].col).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'stalker', 1).config

    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS, PROP_TYPES.WOODEN_CRATE, farWalkable[5].row, farWalkable[5].col).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS, PROP_TYPES.WOODEN_CRATE, 1).config

    // Deliberate failures: wall cell & enemy near start
    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'collapsing_floor_grate', wallCell.row, wallCell.col).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'collapsing_floor_grate', 1).config

    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'brute', nearStartWalkable.row, nearStartWalkable.col).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'brute', 1).config

    const m = generateMaze({ level: 1, seed: 654321, sandboxConfig: cfg })
    assert.equal(m.sandboxValidationReport.generationMode, 'sandbox')
    assert.equal(m.sandboxValidationReport.seed, 654321)
    assert.ok(m.sandboxValidationReport.categorySummaries.keycards, 'Report must include keycards summary')
    assert.ok(m.sandboxValidationReport.categorySummaries.environmentalProps, 'Report must include environmentalProps summary')

    // Verify valid manual origins
    const manualSteam = m.hazards.find((h) => h.type === 'steam_pipe_burst' && h.isManual)
    assert.ok(manualSteam && manualSteam.row === farWalkable[0].row && manualSteam.col === farWalkable[0].col)
    assert.equal(manualSteam.placementOrigin, 'manual')
    const autoSteam = m.hazards.find((h) => h.type === 'steam_pipe_burst' && !h.isManual)
    assert.ok(autoSteam && autoSteam.placementOrigin === 'automatic')

    const manualShard = m.collectibles.items.find((c) => c.type === 'soul_shards' && c.row === farWalkable[1].row && c.col === farWalkable[1].col)
    assert.ok(manualShard && manualShard.isManual === true)

    const manualKeycard = m.keycards.find((k) => k.row === farWalkable[2].row && k.col === farWalkable[2].col)
    assert.ok(manualKeycard && manualKeycard.isManual === true)

    const manualHide = m.hidingSpots.find((s) => s.row === farWalkable[3].row && s.col === farWalkable[3].col)
    assert.ok(manualHide && manualHide.isManual === true)

    const manualEnemy = m.enemies.find((e) => e.spawnCell.row === farWalkable[4].row && e.spawnCell.col === farWalkable[4].col)
    assert.ok(manualEnemy && manualEnemy.isManual === true)

    const manualProp = m.environmentalProps.find((p) => p.row === farWalkable[5].row && p.col === farWalkable[5].col)
    assert.ok(manualProp && manualProp.isManual === true)

    // Verify failure reasons recorded for wall cell & start safety violation
    assert.ok(
      m.sandboxValidationReport.failures.some(
        (f) =>
          (f.reason === 'non_walkable_cell' || f.reason === 'wall_cell') &&
          f.row === wallCell.row &&
          f.col === wallCell.col
      ),
      'Wall cell manual placement failure must report non_walkable_cell/wall_cell reason and coords'
    )
    assert.ok(
      m.sandboxValidationReport.failures.some(
        (f) =>
          f.reason === 'start_safety_clearance' &&
          f.row === nearStartWalkable.row
      ),
      'Enemy near start must report start_safety_clearance failure reason'
    )
  }

  // -----------------------------------------------------------------------
  // Test 17: Stage 5 Live Runtime Extraction & Verification Engine
  // -----------------------------------------------------------------------
  {
    console.log('Test 17: Stage 5 Live Runtime Extraction & Verification Report')
    const probeMaze = generateMaze({ level: 1, seed: 777111, sandboxConfig: createDefaultSandboxConfig() })
    let spot = null
    let spot2 = null
    for (let r = 1; r < probeMaze.rows - 1; r += 1) {
      for (let c = 1; c < probeMaze.cols - 1; c += 1) {
        if (
          probeMaze.grid[r][c] === CELL_TYPES.PATH &&
          !(r === probeMaze.start.row && c === probeMaze.start.col) &&
          !(r === probeMaze.exit.row && c === probeMaze.exit.col)
        ) {
          const dist = Math.abs(r - probeMaze.start.row) + Math.abs(c - probeMaze.start.col)
          if (dist >= 10) {
            if (!spot) spot = { row: r, col: c }
            else if (!spot2 && (r !== spot.row || c !== spot.col)) {
              spot2 = { row: r, col: c }
              break
            }
          }
        }
      }
      if (spot2) break
    }
    let cfg = createDefaultSandboxConfig()
    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'stalker', spot.row, spot.col).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.ENEMIES, 'stalker', 1).config
    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'soul_shards', spot2.row, spot2.col).config
    cfg = setItemQuantity(cfg, SANDBOX_CATEGORY_IDS.COLLECTIBLES, 'soul_shards', 1).config

    const m = generateMaze({ level: 1, seed: 777111, sandboxConfig: cfg })
    const stalkerMeta = m.enemies.find((e) => e.type === 'stalker')
    const shardMeta = m.collectibles.items.find((c) => c.type === 'soul_shards')

    // Simulated live engine returning all generated managers cleanly (matching real agent shapes)
    const mockEngine = {
      getMaze: () => m,
      getHazardManager: () => ({
        getHazards: () =>
          m.hazards.map((h) => ({
            ...h,
            state: 'dormant',
            getState: () => 'dormant',
            worldPos: { x: h.col * 4, y: 0, z: h.row * 4 },
            isDisposed: false,
          })),
      }),
      getEnemyManager: () => ({
        getEnemies: () =>
          m.enemies.map((e) => ({
            ...e,
            state: 'patrol',
            getState: () => 'patrol',
            getGridCell: () => ({ ...e.spawnCell }),
            worldPos: { x: e.spawnCell.col * 4, y: 0, z: e.spawnCell.row * 4 },
            isDisposed: false,
            isStunned: false,
            isTimeSlowed: false,
            speedMultiplier: 1,
          })),
      }),
      getHidingSpotManager: () => ({
        getHidingSpots: () =>
          m.hidingSpots.map((s) => ({
            ...s,
            worldPos: { x: s.col * 4, y: 0, z: s.row * 4 },
            compromised: false,
            isOccupied: false,
            isDisposed: false,
          })),
      }),
      getCollectibleManager: () => ({
        getActiveKeycards: () =>
          m.keycards.map((kc) => ({
            ...kc,
            worldPos: { x: kc.col * 4, y: 1.0, z: kc.row * 4 },
          })),
        getActiveItems: () =>
          m.collectibles.items.map((it) => ({
            ...it,
            worldPos: { x: it.col * 4, y: 0.5, z: it.row * 4 },
          })),
      }),
      getEnvironmentalProps: () => m.environmentalProps || [],
      getHazardDecoys: () => m.hazardDecoys?.decoys || [],
    }

    const liveExtraction = extractLiveEntitiesFromEngine(mockEngine, m, cfg)
    assert.ok(liveExtraction.entities.some((e) => e.id === stalkerMeta.id && e.origin === 'manual' && e.manualId === stalkerMeta.manualId))
    assert.ok(liveExtraction.entities.some((e) => e.id === shardMeta.id && e.origin === 'manual' && e.status === 'Active'))

    const report = generateLiveVerificationReport(mockEngine, m, cfg)
    assert.equal(report.status, 'PASS')
    assert.ok(report.comparisonRows.some((r) => r.itemId === 'stalker' && r.manual >= 1 && r.actual >= 1 && r.failed === 0))
    assert.ok(report.manualVerificationResults.every((mv) => mv.status === 'PASS'))

    // Now test relocation / missing manual entity detection -> FAIL
    const brokenEngine = {
      ...mockEngine,
      getEnemyManager: () => ({ getEnemies: () => [] }),
    }
    const failReport = generateLiveVerificationReport(brokenEngine, m, cfg)
    assert.equal(failReport.status, 'FAIL')
    assert.ok(failReport.manualVerificationResults.some((mv) => mv.itemId === 'stalker' && mv.status === 'FAIL'))
  }

  // -----------------------------------------------------------------------
  // Test 18: Stage 5 Diagnostics Modal, Manual Focus Navigation & Seed/JSON UI
  // -----------------------------------------------------------------------
  {
    console.log('Test 18: Stage 5 SandboxDiagnosticsModal & DeveloperSandboxView Seed/JSON/Focus UI')
    const [{ default: SandboxDiagnosticsModal }, { default: DeveloperSandboxView }] = await Promise.all([
      viteServer.ssrLoadModule('/src/components/sandbox/SandboxDiagnosticsModal.jsx'),
      viteServer.ssrLoadModule('/src/components/sandbox/DeveloperSandboxView.jsx'),
    ])

    let cfg = createDefaultSandboxConfig()
    cfg = setSandboxSeed(cfg, 313131).config
    // Put a deliberate bad manual placement on row 0 col 0 (wall) to verify navigable failure action
    cfg = addManualPlacement(cfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'steam_pipe_burst', 0, 0).config
    const badMaze = generateMaze({ level: 1, seed: 313131, sandboxConfig: cfg })

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    let jumpedCoord = null

    await act(async () => {
      root.render(
        createElement(SandboxDiagnosticsModal, {
          isOpen: true,
          maze: badMaze,
          sandboxConfig: cfg,
          onClose: () => {},
          onOpenManualEditor: (coord) => {
            jumpedCoord = coord
          },
        })
      )
    })

    const modalEl = container.querySelector('[data-testid="sandbox-diagnostics-modal"]')
    assert.ok(modalEl, 'SandboxDiagnosticsModal must render when open')
    assert.ok(modalEl.textContent.includes('Keycards'), 'Category summary must display Keycards')
    assert.ok(modalEl.textContent.includes('Environmental Props'), 'Category summary must display Environmental Props')
    const goBtn = container.querySelector('[data-testid="diagnostics-goto-0"]')
    assert.ok(goBtn, 'Failure row must expose navigable Go to (row, col) button')
    await clickEl(goBtn)
    assert.deepEqual(
      { row: jumpedCoord?.row, col: jumpedCoord?.col, itemId: jumpedCoord?.itemId },
      { row: 0, col: 0, itemId: 'steam_pipe_burst' }
    )

    // Verify Comparison Table, Verification Tab, and Live Entity Inspector Tab
    await clickEl(container.querySelector('[data-testid="diagnostics-tab-comparison"]'))
    assert.ok(container.querySelector('[data-testid="diagnostics-comparison-table"]'))
    await clickEl(container.querySelector('[data-testid="diagnostics-tab-verification"]'))
    assert.ok(container.querySelector('[data-testid="manual-verification-table"]'))
    await clickEl(container.querySelector('[data-testid="diagnostics-tab-inspector"]'))
    assert.ok(container.querySelector('[data-testid="entity-inspector-details"]'))

    // Render DeveloperSandboxView with Seed + JSON Import/Export + initialFocusCoord forwarding
    let latestCfg = cfg
    const rerenderView = async (nextProps = {}) => {
      await act(async () => {
        root.render(
          createElement(DeveloperSandboxView, {
            sandboxConfig: latestCfg,
            onChangeConfig: (c) => {
              latestCfg = c
            },
            ...nextProps,
          })
        )
      })
    }

    await rerenderView()
    assert.ok(container.querySelector('[data-testid="sandbox-seed-input"]'))
    assert.ok(container.querySelector('[data-testid="sandbox-export-json-btn"]'))
    await clickEl(container.querySelector('[data-testid="sandbox-export-json-btn"]'))
    await flushTick(40)
    const exportedJson = exportSandboxConfigJson(latestCfg)
    assert.ok(exportedJson.includes('313131'))

    // Test import validation of invalid JSON safely preserves config
    const badImport = importSandboxConfigJson('{broken json', latestCfg)
    assert.equal(badImport.success, false)
    assert.ok(badImport.error)
    assert.equal(latestCfg.seed, 313131)

    // Test import validation of valid exported JSON
    const goodImport = importSandboxConfigJson(exportedJson, createDefaultSandboxConfig())
    assert.equal(goodImport.success, true)
    assert.equal(goodImport.config.seed, 313131)

    // initialFocusCoord opens ManualGridEditorModal focused at (0, 0) cleanly (with fixed 'center' flex alignment)
    await rerenderView({
      initialShowManualEditor: true,
      initialFocusCoord: { row: 0, col: 0, categoryId: SANDBOX_CATEGORY_IDS.HAZARDS, itemId: 'steam_pipe_burst' },
    })
    assert.ok(container.querySelector('[data-testid="manual-grid-editor-view"]'))
    assert.ok(container.querySelector('[data-testid="manual-cell-inspector"]')?.textContent.includes('Cell (0, 0)'))
    const zeroCell = container.querySelector('[data-cell-row="0"][data-cell-col="0"]')
    assert.equal(zeroCell?.style?.justifyContent, 'center', 'Cell alignment typo center.ipynb must be fixed to center')

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
  }

  // -----------------------------------------------------------------------
  // Test 19: Hotkey Non-Collision ('D' Movement vs F1 / Shift+D) & Pause/App Isolation
  // -----------------------------------------------------------------------
  {
    console.log("Test 19: Diagnostics Hotkey ('D' Safe vs F1 / Shift+D) & Sandbox Pause/Isolation")
    const [{ default: MazeViewport3D }, { default: PauseScreen }] = await Promise.all([
      viteServer.ssrLoadModule('/src/components/game/MazeViewport3D.jsx'),
      viteServer.ssrLoadModule('/src/components/game/PauseScreen.jsx'),
    ])

    const sbCfg = createDefaultSandboxConfig()
    const sbMaze = generateMaze({ level: 1, seed: 112233, sandboxConfig: sbCfg })

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    const diagStates = []

    await act(async () => {
      root.render(
        createElement(MazeViewport3D, {
          maze: sbMaze,
          currentLevel: 1,
          sandboxConfig: sbCfg,
          controlsEnabled: true,
          onDiagnosticsOpenChange: (isOpen) => diagStates.push(isOpen),
          engineConfig: { renderCanvas: false, audio: { enabled: false } },
        })
      )
    })

    // Pressing plain 'd' or 'D' must NOT open SandboxDiagnosticsModal!
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'd', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false })
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'D', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false })
    })
    assert.equal(container.querySelector('[data-testid="sandbox-diagnostics-modal"]'), null, "Bare 'd'/'D' movement key must NOT open Diagnostics modal")

    // Pressing F1 opens SandboxDiagnosticsModal; Shift+D toggles it closed
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'F1', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false })
    })
    assert.ok(container.querySelector('[data-testid="sandbox-diagnostics-modal"]'), 'F1 must open SandboxDiagnosticsModal')
    assert.equal(diagStates[diagStates.length - 1], true)
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'D', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false })
    })
    assert.equal(container.querySelector('[data-testid="sandbox-diagnostics-modal"]'), null, 'Shift+D must toggle SandboxDiagnosticsModal closed')
    assert.equal(diagStates[diagStates.length - 1], false)

    // PauseScreen in sandbox mode renders Restart (New Seed), Sandbox Config, and Main Menu
    let triggeredNewSeed = false
    let triggeredMainMenu = false
    await act(async () => {
      root.render(
        createElement(PauseScreen, {
          isOpen: true,
          isSandbox: true,
          onResume: () => {},
          onRestart: () => {},
          onRestartNewSeed: () => { triggeredNewSeed = true },
          onReturnToSandbox: () => {},
          onMainMenu: () => { triggeredMainMenu = true },
        })
      )
    })
    await clickEl(container.querySelector('[data-testid="pause-restart-new-seed-btn"]'))
    await clickEl(container.querySelector('[data-testid="pause-main-menu-btn"]'))
    assert.equal(triggeredNewSeed, true)
    assert.equal(triggeredMainMenu, true)

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
  }

  console.log('All MAZE-DEV-SANDBOX Stages 1-5 tests passed successfully!')
} finally {
  await viteServer.close()
}
