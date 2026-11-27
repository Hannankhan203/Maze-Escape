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
  applySandboxPreset,
  createDefaultSandboxConfig,
  getItemQuantityLimits,
  getSandboxConfigSummary,
  getSupportedPlacementPreferences,
  isItemQuantityEligible,
  isSandboxItemEnabled,
  loadSandboxConfig,
  resetSandboxConfig,
  saveSandboxConfig,
  setCategoryAllEnabled,
  setItemPlacementPreference,
  setItemQuantity,
  setSandboxAllowFallback,
  toggleSandboxItem,
  validateSandboxConfig,
} from '../sandbox/sandboxConfig.js'
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
    }
    get type() {
      return this.getAttribute('type') || 'text'
    }
    set type(val) {
      this.setAttribute('type', String(val))
    }
    get value() {
      return this._value
    }
    set value(val) {
      this._value = String(val)
    }
    get checked() {
      return this._checked
    }
    set checked(val) {
      this._checked = Boolean(val)
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

  console.log('All MAZE-DEV-SANDBOX-001, Stage 2 and Stage 3 tests passed successfully!')
} finally {
  await viteServer.close()
}
