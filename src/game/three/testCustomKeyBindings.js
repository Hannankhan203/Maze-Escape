import assert from 'node:assert/strict'
import { act, createElement, useState } from 'react'
import { createServer } from 'vite'
import {
  DEFAULT_KEY_BINDINGS,
  KEY_BINDING_ACTION_ORDER,
  KEY_BINDING_DEFINITIONS,
  applyKeyBindingChange,
  findKeyBindingConflict,
  formatKeyTokenLabel,
  isValidCustomKeyToken,
  normalizeBindingKeyToken,
  normalizeKeyBindings,
} from './threeConfig.js'
import { COLLECTIBLE_TYPES } from '../mechanics/collectiblesConfig.js'
import { POWERUP_TYPES } from '../mechanics/powerups.js'
import {
  STORAGE_KEYS,
  getDefaultAllSettings,
  loadAllSettings,
  resetAllSettings,
  saveAllSettings,
} from '../../utils/persistence.js'
import { createContinuousInputController } from '../../hooks/useContinuousInput.js'
import { SETTINGS_SCHEMA } from '../../components/settings/settingsConfig.js'

console.log('--- Running Full Customizable Key-Binding System Tests ---')

function createMemoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  }
}

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
// 1. Default Bindings & Schema Completeness
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Default key bindings and Settings schema completeness')

  assert.deepEqual(DEFAULT_KEY_BINDINGS, {
    moveForward: 'w',
    moveBackward: 's',
    moveLeft: 'a',
    moveRight: 'd',
    sprint: 'shift',
    interact: 'f',
    flashlight: 'l',
    wayfinder: 'h',
    phantomVeil: 'q',
    timeFragment: 't',
    watchersEye: 'r',
    echoPulse: 'e',
    cycleCameraDistance: 'v',
    pause: 'p',
  })

  assert.equal('echoReveal' in DEFAULT_KEY_BINDINGS, false, 'Obsolete Echo Reveal manual binding removed')
  assert.equal('wallPass' in DEFAULT_KEY_BINDINGS, false, 'Obsolete Wall Pass manual binding removed')
  assert.equal('coinMagnet' in DEFAULT_KEY_BINDINGS, false, 'Obsolete Coin Magnet manual binding removed')
  assert.equal(KEY_BINDING_ACTION_ORDER.length, 14)
  assert.equal(KEY_BINDING_DEFINITIONS.length, 14)

  const keybindItem = SETTINGS_SCHEMA.controls
    .flatMap((g) => g.items)
    .find((item) => item.id === 'keybinds')
  assert.ok(keybindItem, 'Controls schema includes keybinds table')
  assert.equal(keybindItem.bindings.length, 14)
  for (const row of keybindItem.bindings) {
    assert.equal(row.customizable, true, `Action ${row.id} is marked customizable`)
    assert.equal(row.defaultKey, DEFAULT_KEY_BINDINGS[row.id])
  }

  // Invalid / reserved / modifier keys rejected, single gameplay keys allowed
  for (const validTok of [
    'w',
    'a',
    's',
    'd',
    'shift',
    'shiftleft',
    'shiftright',
    'space',
    ' ',
    'f',
    'l',
    'h',
    'e',
    'q',
    'v',
    'p',
    'arrowup',
    'tab',
    'enter',
    '1',
    'f2',
    'f8',
  ]) {
    assert.equal(
      isValidCustomKeyToken(validTok),
      true,
      `Expected ${JSON.stringify(validTok)} to be valid custom binding token`
    )
  }

  for (const invalidTok of [
    '',
    'c',
    'escape',
    'esc',
    'control',
    'ctrl',
    'alt',
    'altgraph',
    'meta',
    'os',
    'super',
    'capslock',
    'numlock',
    'scrolllock',
    'printscreen',
    'f1',
    'f3',
    'f5',
    'f6',
    'f7',
    'f11',
    'f12',
    'dead',
    'unidentified',
  ]) {
    assert.equal(
      isValidCustomKeyToken(invalidTok),
      false,
      `Expected ${JSON.stringify(invalidTok)} to be rejected`
    )
  }

  assert.equal(normalizeBindingKeyToken(' '), 'space')
  assert.equal(normalizeBindingKeyToken('ShiftLeft'), 'shift')
  assert.equal(normalizeBindingKeyToken('ShiftRight'), 'shift')
  assert.equal(formatKeyTokenLabel('space'), 'Space')
  assert.equal(formatKeyTokenLabel('shift'), 'Shift')
  assert.equal(formatKeyTokenLabel('arrowup'), 'Arrow Up')
}

// ---------------------------------------------------------------------------
// 2. Conflict Detection, Swap Resolution, and Duplicate-Free Normalization
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Duplicate-key conflict detection, swap, and sanitization')

  const conflict = findKeyBindingConflict(DEFAULT_KEY_BINDINGS, 'cycleCameraDistance', 'w')
  assert.deepEqual(conflict, {
    actionId: 'moveForward',
    actionLabel: 'Move Forward',
    key: 'w',
  })

  const rejected = applyKeyBindingChange(DEFAULT_KEY_BINDINGS, 'cycleCameraDistance', 'w', {
    resolution: 'reject',
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.reason, 'conflict')
  assert.equal(rejected.conflict?.actionId, 'moveForward')
  assert.deepEqual(rejected.bindings, DEFAULT_KEY_BINDINGS, 'Rejected conflict leaves bindings unchanged')

  const swapped = applyKeyBindingChange(DEFAULT_KEY_BINDINGS, 'cycleCameraDistance', 'w', {
    resolution: 'swap',
  })
  assert.equal(swapped.ok, true)
  assert.equal(swapped.reason, 'swapped')
  assert.equal(swapped.bindings.cycleCameraDistance, 'w')
  assert.equal(swapped.bindings.moveForward, 'v')
  assert.equal(
    applyKeyBindingChange(DEFAULT_KEY_BINDINGS, 'cycleCameraDistance', 'c').reason,
    'invalid',
    'Reserved camera toggle key C cannot be rebound to another action'
  )
  assert.equal(
    new Set(Object.values(swapped.bindings)).size,
    KEY_BINDING_ACTION_ORDER.length,
    'Swapped bindings contain zero duplicate keys'
  )

  // Raw object with duplicate custom bindings must never produce duplicates
  const normalizedDupes = normalizeKeyBindings({
    moveForward: 'i',
    moveBackward: 'i',
    sprint: 'Escape',
    pause: 'F12',
  })
  assert.equal(normalizedDupes.moveForward, 'i')
  assert.notEqual(normalizedDupes.moveBackward, 'i', 'Duplicate key removed on normalize')
  assert.equal(normalizedDupes.sprint, 'shift', 'Reserved Escape falls back to default Shift')
  assert.equal(normalizedDupes.pause, 'p', 'Reserved F12 falls back to default P')
  assert.equal(
    new Set(Object.values(normalizedDupes)).size,
    KEY_BINDING_ACTION_ORDER.length,
    'Normalized bindings always have unique keys for every action'
  )
}

// ---------------------------------------------------------------------------
// 3. Rebinding Every Action + Live Input Controller & Input-Focus Protections
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Default WASD/C and customized bindings across all gameplay actions')

  let counts = {
    interact: 0,
    flashlight: 0,
    wayfinder: 0,
    camera: 0,
    abilities: [],
  }

  const controller = createContinuousInputController({
    keyBindings: DEFAULT_KEY_BINDINGS,
    onInteract: () => {
      counts.interact += 1
    },
    onToggleFlashlight: () => {
      counts.flashlight += 1
    },
    onTriggerWayfinder: () => {
      counts.wayfinder += 1
    },
    onCycleCameraDistance: () => {
      counts.camera += 1
    },
    onActivateAbility: (type) => {
      counts.abilities.push(type)
    },
  })

  // Default WASD + Shift + V + action keys work
  controller.handleKeyDown(createKeyEvent({ key: 'w' }))
  controller.handleKeyDown(createKeyEvent({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))
  assert.equal(controller.state.forward, true)
  assert.equal(controller.state.sprint, true)
  controller.handleKeyUp(createKeyEvent({ key: 'w' }))
  controller.handleKeyUp(createKeyEvent({ key: 'Shift', code: 'ShiftLeft', shiftKey: false }))
  assert.equal(controller.state.forward, false)
  assert.equal(controller.state.sprint, false)

  controller.handleKeyDown(createKeyEvent({ key: 'v' }))
  controller.handleKeyDown(createKeyEvent({ key: 'f' }))
  controller.handleKeyDown(createKeyEvent({ key: 'l' }))
  controller.handleKeyDown(createKeyEvent({ key: 'h' }))
  controller.handleKeyDown(createKeyEvent({ key: 'q' }))
  controller.handleKeyDown(createKeyEvent({ key: 't' }))
  controller.handleKeyDown(createKeyEvent({ key: 'r' }))
  controller.handleKeyDown(createKeyEvent({ key: 'e' }))
  assert.equal(counts.camera, 1)
  assert.equal(counts.interact, 1)
  assert.equal(counts.flashlight, 1)
  assert.equal(counts.wayfinder, 1)
  assert.deepEqual(counts.abilities, [
    COLLECTIBLE_TYPES.PHANTOM_VEIL,
    COLLECTIBLE_TYPES.TIME_FRAGMENT,
    COLLECTIBLE_TYPES.WATCHERS_EYE,
    COLLECTIBLE_TYPES.ECHO_PULSE,
  ])
  controller.reset()

  // Custom bindings for all actions
  const customBindings = {
    moveForward: 'i',
    moveBackward: 'k',
    moveLeft: 'j',
    moveRight: 'l',
    sprint: 'z',
    interact: 'g',
    flashlight: '9',
    wayfinder: 'y',
    phantomVeil: '1',
    timeFragment: '2',
    watchersEye: '3',
    echoPulse: '4',
    cycleCameraDistance: 'b',
    pause: 'u',
  }

  // Hold 'w' before rebinding and verify rebinding clears held keyboard keys safely while preserving touch
  controller.setTouchSprint(true)
  controller.handleKeyDown(createKeyEvent({ key: 'w' }))
  assert.equal(controller.state.forward, true)

  controller.setKeyBindings(customBindings)
  assert.equal(controller.state.forward, false, 'Rebinding clears previously held keyboard keys')
  assert.equal(controller.state.sprint, true, 'Rebinding preserves active touch state')
  controller.resetTouch()

  counts = {
    interact: 0,
    flashlight: 0,
    wayfinder: 0,
    camera: 0,
    abilities: [],
  }

  // Old defaults no longer fire
  for (const oldEvt of [
    createKeyEvent({ key: 'w' }),
    createKeyEvent({ key: 's' }),
    createKeyEvent({ key: 'a' }),
    createKeyEvent({ key: 'd' }),
    createKeyEvent({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }),
    createKeyEvent({ key: 'f' }),
    createKeyEvent({ key: 'h' }),
    createKeyEvent({ key: 'q' }),
    createKeyEvent({ key: 't' }),
    createKeyEvent({ key: 'r' }),
    createKeyEvent({ key: 'e' }),
    createKeyEvent({ key: 'v' }),
  ]) {
    controller.handleKeyDown(oldEvt)
  }
  assert.equal(controller.state.forward, false)
  assert.equal(controller.state.backward, false)
  assert.equal(controller.state.left, false)
  assert.equal(controller.state.right, false)
  assert.equal(controller.state.sprint, false)
  assert.equal(controller.state.interact, false)
  assert.equal(counts.interact, 0)
  assert.equal(counts.flashlight, 0)
  assert.equal(counts.wayfinder, 0)
  assert.equal(counts.camera, 0)
  assert.deepEqual(counts.abilities, [])

  // New custom movement + non-Shift sprint simultaneous hold & release
  controller.handleKeyDown(createKeyEvent({ key: 'z' }))
  controller.handleKeyDown(createKeyEvent({ key: 'i', shiftKey: false }))
  assert.equal(controller.state.sprint, true, 'Custom sprint Z stays active when pressing I without Shift')
  assert.equal(controller.state.forward, true)
  controller.handleKeyUp(createKeyEvent({ key: 'i' }))
  assert.equal(controller.state.forward, false)
  assert.equal(controller.state.sprint, true)
  controller.handleKeyUp(createKeyEvent({ key: 'z' }))
  assert.equal(controller.state.sprint, false)

  controller.handleKeyDown(createKeyEvent({ key: 'k' }))
  assert.equal(controller.state.backward, true)
  controller.handleKeyUp(createKeyEvent({ key: 'k' }))

  controller.handleKeyDown(createKeyEvent({ key: 'j' }))
  assert.equal(controller.state.left, true)
  controller.handleKeyUp(createKeyEvent({ key: 'j' }))

  controller.handleKeyDown(createKeyEvent({ key: 'l' }))
  assert.equal(controller.state.right, true, 'Custom moveRight L works even though L used to be flashlight')
  assert.equal(counts.flashlight, 0, 'Old flashlight key L does not toggle flashlight when rebound to moveRight')
  controller.handleKeyUp(createKeyEvent({ key: 'l' }))

  // Custom actions & abilities
  controller.handleKeyDown(createKeyEvent({ key: 'g' }))
  assert.equal(controller.state.interact, true)
  controller.handleKeyUp(createKeyEvent({ key: 'g' }))
  controller.handleKeyDown(createKeyEvent({ key: '9' }))
  controller.handleKeyDown(createKeyEvent({ key: 'y' }))
  controller.handleKeyDown(createKeyEvent({ key: 'b' }))
  controller.handleKeyDown(createKeyEvent({ key: '1' }))
  controller.handleKeyDown(createKeyEvent({ key: '2' }))
  controller.handleKeyDown(createKeyEvent({ key: '3' }))
  controller.handleKeyDown(createKeyEvent({ key: '4' }))

  assert.equal(counts.interact, 1)
  assert.equal(counts.flashlight, 1)
  assert.equal(counts.wayfinder, 1)
  assert.equal(counts.camera, 1)
  assert.deepEqual(counts.abilities, [
    COLLECTIBLE_TYPES.PHANTOM_VEIL,
    COLLECTIBLE_TYPES.TIME_FRAGMENT,
    COLLECTIBLE_TYPES.WATCHERS_EYE,
    COLLECTIBLE_TYPES.ECHO_PULSE,
  ])

  // Secondary Arrow keys still move when unbound, and respect explicit custom binding when bound
  controller.handleKeyDown(createKeyEvent({ key: 'ArrowUp' }))
  assert.equal(controller.state.forward, true, 'Unbound ArrowUp still works as secondary forward')
  controller.handleKeyUp(createKeyEvent({ key: 'ArrowUp' }))

  controller.setKeyBindings({ ...customBindings, flashlight: 'arrowup' })
  controller.handleKeyDown(createKeyEvent({ key: 'ArrowUp' }))
  assert.equal(controller.state.forward, false, 'Bound ArrowUp triggers bound action instead of secondary movement')
  assert.equal(counts.flashlight, 2)

  // Repeat & modifier-chord protections
  controller.handleKeyDown(createKeyEvent({ key: 'b', repeat: true }))
  assert.equal(counts.camera, 1, 'Auto-repeat keydown does not re-trigger discrete action')
  controller.handleKeyDown(createKeyEvent({ key: 'b', ctrlKey: true }))
  controller.handleKeyDown(createKeyEvent({ key: 'b', altKey: true }))
  controller.handleKeyDown(createKeyEvent({ key: 'b', metaKey: true }))
  assert.equal(counts.camera, 1, 'Modifier shortcuts do not trigger gameplay key bindings')

  // Input-focus protections
  for (const target of [
    { tagName: 'INPUT', isContentEditable: false },
    { tagName: 'TEXTAREA', isContentEditable: false },
    { tagName: 'SELECT', isContentEditable: false },
    { tagName: 'DIV', isContentEditable: true },
  ]) {
    controller.handleKeyDown(createKeyEvent({ key: 'i', target }))
    controller.handleKeyDown(createKeyEvent({ key: 'b', target }))
    controller.handleKeyDown(createKeyEvent({ key: 'g', target }))
  }
  assert.equal(controller.state.forward, false, 'Editable targets suppress gameplay movement keys')
  assert.equal(counts.camera, 1, 'Editable targets suppress discrete action keys')
  assert.equal(counts.interact, 1, 'Editable targets suppress interact keys')
}

// ---------------------------------------------------------------------------
// Mini DOM Environment & React Integration Tests (Settings UI, App, Reload, Restore Defaults)
// ---------------------------------------------------------------------------
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
        const moved = [...child.childNodes]
        for (const item of moved) this.insertBefore(item, refNode)
        return child
      }
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
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
      if (!target) return false
      if (target === this) return true
      let cur = target.parentNode
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
    set textContent(val) {
      const text = val == null ? '' : String(val)
      if (this.nodeType === 3 || this.nodeType === 8) {
        this.nodeValue = text
        return
      }
      while (this.childNodes.length > 0) this.removeChild(this.childNodes[0])
      if (text !== '') this.appendChild(this.ownerDocument.createTextNode(text))
    }
  }

  class MiniText extends MiniNode {
    constructor(data, ownerDocument) {
      super(3, ownerDocument)
      this.nodeName = '#text'
      this.nodeValue = String(data ?? '')
    }
  }

  class MiniComment extends MiniNode {
    constructor(data, ownerDocument) {
      super(8, ownerDocument)
      this.nodeName = '#comment'
      this.nodeValue = String(data ?? '')
    }
  }

  class MiniDocumentFragment extends MiniNode {
    constructor(ownerDocument) {
      super(11, ownerDocument)
      this.nodeName = '#document-fragment'
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
      this._rect = { left: 0, top: 0, right: 120, bottom: 48, width: 120, height: 48 }
      this.clientWidth = 800
      this.clientHeight = 500
      this.style = {
        _props: new Map(),
        setProperty(k, v) {
          this._props.set(k, String(v))
        },
        getPropertyValue(k) {
          return this._props.get(k) || ''
        },
        removeProperty(k) {
          this._props.delete(k)
        },
        display: '',
        visibility: '',
        overflow: '',
        transform: '',
        width: '',
        height: '',
      }
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
        _list() {
          return String(elem._attrs.get('class') || '')
            .split(/\s+/)
            .filter(Boolean)
        },
        contains(cls) {
          return this._list().includes(cls)
        },
        add(...tokens) {
          const set = new Set(this._list())
          tokens.forEach((t) => set.add(t))
          elem._attrs.set('class', [...set].join(' '))
        },
        remove(...tokens) {
          const set = new Set(this._list())
          tokens.forEach((t) => set.delete(t))
          elem._attrs.set('class', [...set].join(' '))
        },
      }
    }
    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1)
    }
    get className() {
      return this.getAttribute('class') || ''
    }
    set className(val) {
      this.setAttribute('class', val ?? '')
    }
    get id() {
      return this.getAttribute('id') || ''
    }
    set id(val) {
      this.setAttribute('id', val ?? '')
    }
    get disabled() {
      return this.hasAttribute('disabled')
    }
    set disabled(val) {
      if (val) this.setAttribute('disabled', '')
      else this.removeAttribute('disabled')
    }
    get tabIndex() {
      const raw = this.getAttribute('tabindex')
      return raw === null ? (this.tagName === 'BUTTON' || this.tagName === 'INPUT' ? 0 : -1) : Number(raw)
    }
    set tabIndex(val) {
      this.setAttribute('tabindex', String(val))
    }
    setAttribute(name, value) {
      this._attrs.set(String(name), String(value))
    }
    setAttributeNS(_ns, name, value) {
      this.setAttribute(name, value)
    }
    getAttribute(name) {
      const key = String(name)
      return this._attrs.has(key) ? this._attrs.get(key) : null
    }
    hasAttribute(name) {
      return this._attrs.has(String(name))
    }
    removeAttribute(name) {
      this._attrs.delete(String(name))
    }
    removeAttributeNS(_ns, name) {
      this.removeAttribute(name)
    }
    focus() {
      if (this.disabled) return
      this.ownerDocument.activeElement = this
    }
    blur() {
      if (this.ownerDocument.activeElement === this) {
        this.ownerDocument.activeElement = this.ownerDocument.body
      }
    }
    getBoundingClientRect() {
      return { ...this._rect }
    }
    addEventListener(type, fn, opts) {
      this._emitter.addEventListener(type, fn, opts)
    }
    removeEventListener(type, fn, opts) {
      this._emitter.removeEventListener(type, fn, opts)
    }
    matches(selector) {
      return matchesSelector(this, selector)
    }
    closest(selector) {
      let cur = this
      while (cur && cur.nodeType === 1) {
        if (matchesSelector(cur, selector)) return cur
        cur = cur.parentNode
      }
      return null
    }
    querySelectorAll(selector) {
      const results = []
      const visit = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (matchesSelector(child, selector)) results.push(child)
            visit(child)
          }
        }
      }
      visit(this)
      return results
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    }
    dispatchEvent(event) {
      const evt = event || {}
      if (!evt.target) evt.target = this
      if (typeof evt.defaultPrevented !== 'boolean') evt.defaultPrevented = false
      if (typeof evt.preventDefault !== 'function') {
        evt.preventDefault = () => {
          evt.defaultPrevented = true
        }
      }
      let propagationStopped = false
      if (typeof evt.stopPropagation !== 'function') {
        evt.stopPropagation = () => {
          propagationStopped = true
        }
      }

      const path = []
      let cur = this
      while (cur) {
        path.unshift(cur)
        cur = cur.parentNode
      }
      const doc = this.ownerDocument
      const win = doc?.defaultView

      if (win && !propagationStopped) {
        evt.currentTarget = win
        for (const fn of win._emitter.getListeners(evt.type, true)) fn(evt)
      }
      if (doc && !propagationStopped) {
        evt.currentTarget = doc
        for (const fn of doc._emitter.getListeners(evt.type, true)) fn(evt)
      }
      for (const node of path) {
        if (propagationStopped) break
        if (node._emitter) {
          evt.currentTarget = node
          for (const fn of node._emitter.getListeners(evt.type, true)) fn(evt)
        }
      }
      for (let i = path.length - 1; i >= 0; i -= 1) {
        if (propagationStopped) break
        const node = path[i]
        if (node._emitter) {
          evt.currentTarget = node
          for (const fn of node._emitter.getListeners(evt.type, false)) fn(evt)
        }
      }
      if (evt.bubbles !== false && doc && !propagationStopped) {
        evt.currentTarget = doc
        for (const fn of doc._emitter.getListeners(evt.type, false)) fn(evt)
      }
      if (evt.bubbles !== false && win && !propagationStopped) {
        evt.currentTarget = win
        for (const fn of win._emitter.getListeners(evt.type, false)) fn(evt)
      }
      return !evt.defaultPrevented
    }
  }

  class MiniCanvasElement extends MiniElement {
    constructor(ownerDocument) {
      super('canvas', ownerDocument)
      this.width = 300
      this.height = 150
    }
    getContext() {
      return null
    }
  }

  class MiniIFrameElement extends MiniElement {}

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

  class MiniResizeObserver {
    observe() {}
    disconnect() {}
  }

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
    activeElement: null,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLCanvasElement: MiniCanvasElement,
    HTMLIFrameElement: MiniIFrameElement,
    HTMLInputElement: MiniInputElement,
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
    HTMLInputElement: MiniInputElement,
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
      replaceState(_s, _t, nextUrl) {
        currentUrl = new URL(nextUrl, currentUrl)
      },
    },
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(String(k), String(v)),
      removeItem: (k) => storageMap.delete(String(k)),
      clear: () => storageMap.clear(),
    },
    navigator: { userAgent: 'node-test', maxTouchPoints: 0 },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: (el) => ({
      display: el?.style?.display || 'block',
      visibility: el?.style?.visibility || 'visible',
    }),
    setInterval: (...args) => setInterval(...args),
    clearInterval: (id) => clearInterval(id),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (id) => clearTimeout(id),
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
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
      if (typeof evt.defaultPrevented !== 'boolean') evt.defaultPrevented = false
      if (typeof evt.preventDefault !== 'function') {
        evt.preventDefault = () => {
          evt.defaultPrevented = true
        }
      }
      let propagationStopped = false
      if (typeof evt.stopPropagation !== 'function') {
        evt.stopPropagation = () => {
          propagationStopped = true
        }
      }
      for (const fn of winEmitter.getListeners(evt.type, true)) {
        if (propagationStopped) break
        fn(evt)
      }
      for (const fn of winEmitter.getListeners(evt.type, false)) {
        if (propagationStopped) break
        fn(evt)
      }
      return !evt.defaultPrevented
    },
  }
  documentObj.defaultView = windowObj

  return {
    window: windowObj,
    document: documentObj,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLCanvasElement: MiniCanvasElement,
    HTMLIFrameElement: MiniIFrameElement,
    HTMLInputElement: MiniInputElement,
    ResizeObserver: MiniResizeObserver,
  }
}

const domEnv = createMiniDomEnv('http://localhost:3000/')
const installGlobal = (key, value) => {
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
installGlobal('HTMLInputElement', domEnv.HTMLInputElement)
installGlobal('ResizeObserver', domEnv.ResizeObserver)
installGlobal('localStorage', domEnv.window.localStorage)

const { createRoot } = await import('react-dom/client')
const viteServer = await createServer({
  logLevel: 'silent',
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
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
}

try {
  const { default: SettingsModal } = await viteServer.ssrLoadModule(
    '/src/components/settings/SettingsModal.jsx'
  )
  const { default: PauseMenuModal } = await viteServer.ssrLoadModule(
    '/src/components/game/PauseMenuModal.jsx'
  )
  const { default: TouchControls3D } = await viteServer.ssrLoadModule(
    '/src/components/game/TouchControls3D.jsx'
  )
  const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')

  // -------------------------------------------------------------------------
  // 4. SettingsModal Key Bindings UI: All 13 Actions, Conflict Swap/Cancel, Invalid/Modifier, Restore Default Keys
  // -------------------------------------------------------------------------
  {
    console.log('Test 4: SettingsModal Key Bindings UI, conflict resolution, and Restore Default Keys')

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    let latestBindings = { ...DEFAULT_KEY_BINDINGS }

    function SettingsHarness() {
      const [keyBindings, setKeyBindings] = useState(DEFAULT_KEY_BINDINGS)
      latestBindings = keyBindings
      return createElement(SettingsModal, {
        isOpen: true,
        onClose: () => {},
        controlSettings: {
          mouseSensitivity: 100,
          touchLookSensitivity: 100,
          invertY: false,
          touchControlsMode: 'auto',
          touchHaptics: true,
          keyBindings,
        },
        onControlSettingChange: (id, val) => {
          if (id === 'keyBindings') {
            setKeyBindings(val)
          }
        },
        onRestoreDefaults: () => {
          setKeyBindings({ ...DEFAULT_KEY_BINDINGS })
        },
      })
    }

    await act(async () => {
      root.render(createElement(SettingsHarness))
    })

    const controlsTab = container
      .querySelectorAll('[role="tab"]')
      .find((t) => t.textContent.includes('Mouse & Controls'))
    await clickEl(controlsTab)

    // Verify all 13 action rows exist with expected defaults
    for (const actionId of KEY_BINDING_ACTION_ORDER) {
      const btn = container.querySelector(`[data-keybind-action="${actionId}"]`)
      assert.ok(btn, `Action button rendered for ${actionId}`)
      assert.equal(
        btn.textContent.trim(),
        formatKeyTokenLabel(DEFAULT_KEY_BINDINGS[actionId])
      )
    }

    // Active rebind + Cancel button
    await clickEl(container.querySelector('[data-keybind-action="moveForward"]'))
    assert.equal(
      container.querySelector('[data-keybind-action="moveForward"]').textContent.trim(),
      'Press key...'
    )
    const cancelBtn = container.querySelector('[data-keybind-cancel="moveForward"]')
    assert.ok(cancelBtn, 'Cancel button visible while listening')
    await clickEl(cancelBtn)
    assert.equal(
      container.querySelector('[data-keybind-action="moveForward"]').getAttribute('data-keybind-listening'),
      'false'
    )
    assert.equal(
      container.querySelector('[data-keybind-action="moveForward"]').textContent.trim(),
      'W'
    )

    // Invalid / modifier / browser-reserved keys during capture
    await clickEl(container.querySelector('[data-keybind-action="interact"]'))
    await pressWindowKey('Control')
    assert.ok(
      container.querySelector('.lv-keybind-feedback')?.textContent?.includes('Modifier keys'),
      'Modifier-only Control key shows clear feedback'
    )
    await pressWindowKey('c', { ctrlKey: true })
    assert.ok(
      container.querySelector('.lv-keybind-feedback')?.textContent?.includes('Single keys only'),
      'Ctrl+C chord rejected with clear feedback'
    )
    await pressWindowKey('F5')
    assert.ok(
      container.querySelector('.lv-keybind-feedback')?.textContent?.includes('reserved'),
      'Browser-reserved F5 rejected'
    )
    await pressWindowKey('CapsLock')
    assert.ok(
      container.querySelector('.lv-keybind-feedback')?.textContent?.includes('reserved'),
      'CapsLock rejected'
    )
    await pressWindowKey('c')
    assert.ok(
      container.querySelector('.lv-keybind-feedback')?.textContent?.includes('reserved'),
      'Camera perspective toggle key C rejected as reserved'
    )
    await pressWindowKey('g', { repeat: true })
    assert.equal(
      container.querySelector('[data-keybind-action="interact"]').getAttribute('data-keybind-listening'),
      'true',
      'Repeat keydown ignored during capture'
    )

    // Valid custom bind for interact -> G
    await pressWindowKey('g')
    assert.equal(latestBindings.interact, 'g')
    assert.equal(container.querySelector('[data-keybind-action="interact"]').textContent.trim(), 'G')

    // Conflict flow: try binding cycleCameraDistance to 'w' (assigned to Move Forward)
    await clickEl(container.querySelector('[data-keybind-action="cycleCameraDistance"]'))
    await pressWindowKey('w')
    const conflictFeedback = container.querySelector('.lv-keybind-feedback')
    assert.ok(conflictFeedback, 'Conflict alert rendered')
    assert.ok(
      conflictFeedback.textContent.includes('Move Forward'),
      'Conflict message explains which action owns the key'
    )
    assert.equal(latestBindings.cycleCameraDistance, 'v', 'Conflict does not silently overwrite')
    assert.equal(latestBindings.moveForward, 'w')

    // Cancel conflict keeps original keys
    await clickEl(container.querySelector('[data-keybind-cancel-conflict="true"]'))
    assert.equal(latestBindings.cycleCameraDistance, 'v')
    assert.equal(latestBindings.moveForward, 'w')
    assert.equal(container.querySelector('.lv-keybind-feedback'), null)

    // Re-trigger conflict with 'w' -> Swap Keys swaps moveForward <-> cycleCameraDistance cleanly
    await clickEl(container.querySelector('[data-keybind-action="cycleCameraDistance"]'))
    await pressWindowKey('w')
    await clickEl(container.querySelector('[data-keybind-swap="true"]'))
    assert.equal(latestBindings.cycleCameraDistance, 'w')
    assert.equal(latestBindings.moveForward, 'v')
    assert.equal(
      new Set(Object.values(latestBindings)).size,
      KEY_BINDING_ACTION_ORDER.length,
      'Zero duplicate bindings after Swap Keys'
    )

    // Restore Default Keys with confirmation (Cancel keeps custom; Confirm Reset restores all)
    await clickEl(container.querySelector('[data-keybind-restore-defaults="true"]'))
    assert.ok(
      container.querySelector('[data-keybind-reset-confirm="true"]'),
      'Restore Default Keys asks for confirmation'
    )
    await clickEl(container.querySelector('[data-keybind-cancel-reset="true"]'))
    assert.equal(latestBindings.moveForward, 'v', 'Canceling reset preserves custom bindings')
    assert.equal(latestBindings.interact, 'g')

    await clickEl(container.querySelector('[data-keybind-restore-defaults="true"]'))
    await clickEl(container.querySelector('[data-keybind-confirm-reset="true"]'))
    assert.deepEqual(
      latestBindings,
      DEFAULT_KEY_BINDINGS,
      'Confirming Restore Default Keys restores every binding to built-in defaults'
    )

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
  }

  // -------------------------------------------------------------------------
  // 5. Dynamic Shortcut Labels in PauseMenuModal & TouchControls3D
  // -------------------------------------------------------------------------
  {
    console.log('Test 5: Dynamic shortcut prompts reflect customized bindings')

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    const custom = {
      ...DEFAULT_KEY_BINDINGS,
      sprint: 'z',
      interact: 'g',
      flashlight: '9',
      phantomVeil: '1',
      timeFragment: '2',
      watchersEye: '3',
      echoPulse: '4',
    }

    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(PauseMenuModal, {
            isOpen: true,
            maze: { id: 'm1', difficultyLabel: 'Medium', grid: [[0]], start: { row: 0, col: 0 }, exit: { row: 0, col: 0 } },
            shardsCollected: 2,
            totalShards: 5,
            shardBonus: 100,
            keysCollected: 0,
            totalKeys: 1,
            isExitLocked: true,
            objectivesEnabled: true,
            inventory: { [POWERUP_TYPES.ECHO_REVEAL]: 1 },
            activeEffects: {},
            keyBindings: custom,
            onResume: () => {},
            onRestart: () => {},
            onNewMaze: () => {},
            onOpenSettings: () => {},
          }),
          createElement(TouchControls3D, {
            enabled: true,
            mode: 'always',
            inventory: {
              [POWERUP_TYPES.ECHO_REVEAL]: 1,
              [COLLECTIBLE_TYPES.PHANTOM_VEIL]: 1,
              [COLLECTIBLE_TYPES.TIME_FRAGMENT]: 1,
              [COLLECTIBLE_TYPES.WATCHERS_EYE]: 1,
              [COLLECTIBLE_TYPES.ECHO_PULSE]: 1,
            },
            activeEffects: {},
            stealthState: { canInteract: true, isHidden: false },
            flashlightActive: false,
            keyBindings: custom,
            onMoveAxes: () => {},
            onLookDelta: () => {},
            onSprintChange: () => {},
            onInteractChange: () => {},
            onTriggerInteract: () => {},
            onToggleFlashlight: () => {},
            onActivateAbility: () => {},
          })
        )
      )
    })

    const pauseModal = container.querySelector('.lv-modal--pause')
    assert.ok(pauseModal, 'PauseMenuModal rendered')
    assert.equal(pauseModal.querySelector('[aria-label="Current run telemetry"]'), null, 'Run Overview section removed from PauseMenuModal')
    assert.equal(pauseModal.textContent.includes('Run Overview'), false, 'Run Overview heading removed from PauseMenuModal')
    assert.equal(pauseModal.querySelector('[data-testid="pause-run-timer"]'), null, 'Run timer absent from PauseMenuModal')
    assert.equal(pauseModal.querySelector('[data-testid="pause-moves"]'), null, 'Moves stat absent from PauseMenuModal')
    assert.equal(pauseModal.querySelector('[data-testid="pause-par"]'), null, 'Par stat absent from PauseMenuModal')
    assert.equal(
      pauseModal.querySelector('[data-testid="pause-keys"]')?.textContent?.trim(),
      '0 / 1 Locked',
      'PauseMenuModal preserves Keys status readout'
    )
    assert.equal(
      pauseModal.querySelector('[data-testid="pause-shards"]')?.textContent?.trim(),
      '2 / 5 (+100)',
      'PauseMenuModal preserves Soul Shards counter and bonus readout'
    )

    const pauseWords = container.querySelectorAll('.lv-pause-powerup').map((card) => {
      const name = card.querySelector('.lv-pause-powerup__name')?.textContent?.trim()
      const word = card.querySelector('.lv-pause-powerup__key')?.textContent?.trim()
      return `${name}:${word}`
    })
    assert.deepEqual(pauseWords, [
      'Health Capsule:Heal',
      'Soul Shards:Score',
      'Spectral Compass:Attract',
      'Phantom Veil:Conceal',
      'Energy Cell:Recharge',
      'Warding Charm:Protect',
      'Time Fragment:Slow',
      "Watcher's Eye:Reveal",
      'Echo Pulse:Stun',
      'Spirit Lantern:Illuminate',
      'Keys / Keycards:Unlock',
      'Echo Reveal:Navigate',
    ], 'PauseMenuModal displays all 12 collectibles and abilities with exact one-word explanations')

    const sprintTouch = container.querySelector('.maze-touch-btn--sprint')
    const flashTouch = container.querySelector('.maze-touch-btn--flashlight')
    const interactTouch = container.querySelector('.maze-touch-btn--interact')
    const veilTouch = container.querySelector(`[data-touch-action="${COLLECTIBLE_TYPES.PHANTOM_VEIL}"]`)
    const timeTouch = container.querySelector(`[data-touch-action="${COLLECTIBLE_TYPES.TIME_FRAGMENT}"]`)
    const eyeTouch = container.querySelector(`[data-touch-action="${COLLECTIBLE_TYPES.WATCHERS_EYE}"]`)
    const pulseTouch = container.querySelector(`[data-touch-action="${COLLECTIBLE_TYPES.ECHO_PULSE}"]`)
    assert.ok(sprintTouch?.getAttribute('aria-label')?.includes('Z'))
    assert.ok(flashTouch?.getAttribute('aria-label')?.includes('9'))
    assert.ok(interactTouch?.getAttribute('aria-label')?.includes('G'))
    assert.ok(veilTouch?.getAttribute('aria-label')?.includes('1'))
    assert.ok(timeTouch?.getAttribute('aria-label')?.includes('2'))
    assert.ok(eyeTouch?.getAttribute('aria-label')?.includes('3'))
    assert.ok(pulseTouch?.getAttribute('aria-label')?.includes('4'))

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
  }

  // -------------------------------------------------------------------------
  // 6. Full App Integration: Custom Pause Shortcut, Reload Persistence, Restore Defaults, Focus Protection
  // -------------------------------------------------------------------------
  {
    console.log('Test 6: Full App integration, persistence across reloads, Pause shortcut & Restore Defaults')

    domEnv.window.localStorage.clear()
    domEnv.window.location.href = 'http://localhost:3000/'

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

    const mountApp = async () => {
      const container = domEnv.document.createElement('div')
      domEnv.document.body.appendChild(container)
      const root = createRoot(container)
      await act(async () => {
        root.render(
          createElement(App, {
            viewportEngineConfig: { isSoftwareGl: false, createRenderer: makeMockRenderer() },
          })
        )
      })
      return { container, root }
    }

    const session1 = await mountApp()
    try {
      // Open Settings via default Pause shortcut (P)
      await pressWindowKey('p')
      assert.ok(session1.container.querySelector('.lv-modal--pause'), 'Pause menu opens with P')

      // Editable focus protection on Pause shortcut
      await pressWindowKey('p', {
        target: { tagName: 'INPUT', isContentEditable: false },
      })
      assert.ok(
        session1.container.querySelector('.lv-modal--pause'),
        'Pressing P inside an INPUT element does not toggle Pause'
      )

      const settingsBtn = session1.container
        .querySelectorAll('button')
        .find((b) => b.textContent.trim() === 'Settings')
      await clickEl(settingsBtn)
      const controlsTab = session1.container
        .querySelectorAll('[role="tab"]')
        .find((t) => t.textContent.includes('Mouse & Controls'))
      await clickEl(controlsTab)

      // Customize Move Forward -> I, Pause -> U, Cycle Camera -> B
      await clickEl(session1.container.querySelector('[data-keybind-action="moveForward"]'))
      await pressWindowKey('i')
      await clickEl(session1.container.querySelector('[data-keybind-action="pause"]'))
      await pressWindowKey('u')
      await clickEl(session1.container.querySelector('[data-keybind-action="cycleCameraDistance"]'))
      await pressWindowKey('b')

      // Back -> Resume
      await clickEl(
        session1.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Back')
      )
      await clickEl(
        session1.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Resume')
      )
      assert.equal(session1.container.querySelector('.lv-modal--pause'), null)

      // Old Pause key 'p' does nothing; custom Pause key 'u' toggles Pause!
      await pressWindowKey('p')
      assert.equal(session1.container.querySelector('.lv-modal--pause'), null, 'Old Pause key P ignored after rebinding to U')
      await pressWindowKey('u')
      assert.ok(session1.container.querySelector('.lv-modal--pause'), 'Custom Pause key U opens Pause menu')
      await pressWindowKey('u')
      assert.equal(session1.container.querySelector('.lv-modal--pause'), null, 'Custom Pause key U closes Pause menu')
    } finally {
      await act(async () => {
        session1.root.unmount()
      })
      session1.container.parentNode?.removeChild(session1.container)
    }

    // Verify saved in localStorage and restored across reload
    const storedBeforeReload = loadAllSettings(domEnv.window.localStorage)
    assert.equal(storedBeforeReload.controls.keyBindings.moveForward, 'i')
    assert.equal(storedBeforeReload.controls.keyBindings.pause, 'u')
    assert.equal(storedBeforeReload.controls.keyBindings.cycleCameraDistance, 'b')

    const session2 = await mountApp()
    try {
      await pressWindowKey('p')
      assert.equal(
        session2.container.querySelector('.lv-modal--pause'),
        null,
        'After reload, old Pause key P remains inactive'
      )
      await pressWindowKey('u')
      assert.ok(
        session2.container.querySelector('.lv-modal--pause'),
        'After reload, saved custom Pause key U toggles Pause'
      )

      const settingsBtn = session2.container
        .querySelectorAll('button')
        .find((b) => b.textContent.trim() === 'Settings')
      await clickEl(settingsBtn)
      const controlsTab = session2.container
        .querySelectorAll('[role="tab"]')
        .find((t) => t.textContent.includes('Mouse & Controls'))
      await clickEl(controlsTab)

      assert.equal(
        session2.container.querySelector('[data-keybind-action="moveForward"]').textContent.trim(),
        'I'
      )
      assert.equal(
        session2.container.querySelector('[data-keybind-action="pause"]').textContent.trim(),
        'U'
      )
      assert.equal(
        session2.container.querySelector('[data-keybind-action="cycleCameraDistance"]').textContent.trim(),
        'B'
      )

      // Restore Default Keys inside Settings UI restores built-in WASD + V + P defaults
      await clickEl(session2.container.querySelector('[data-keybind-restore-defaults="true"]'))
      await clickEl(session2.container.querySelector('[data-keybind-confirm-reset="true"]'))

      assert.equal(
        session2.container.querySelector('[data-keybind-action="moveForward"]').textContent.trim(),
        'W'
      )
      assert.equal(
        session2.container.querySelector('[data-keybind-action="cycleCameraDistance"]').textContent.trim(),
        'V'
      )
      assert.equal(
        session2.container.querySelector('[data-keybind-action="pause"]').textContent.trim(),
        'P'
      )

      await clickEl(
        session2.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Back')
      )
      await clickEl(
        session2.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Resume')
      )

      await pressWindowKey('u')
      assert.equal(session2.container.querySelector('.lv-modal--pause'), null, 'Restored defaults deactivate old U pause key')
      await pressWindowKey('p')
      assert.ok(session2.container.querySelector('.lv-modal--pause'), 'Restored defaults re-activate P pause key')
    } finally {
      await act(async () => {
        session2.root.unmount()
      })
      session2.container.parentNode?.removeChild(session2.container)
    }

    // Corrupted / duplicate storage entry check + resetAllSettings helper check
    const mem = createMemoryStorage()
    mem.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        version: 2,
        controls: {
          keyBindings: {
            moveForward: 'x',
            moveBackward: 'x',
            pause: 'Escape',
          },
        },
      })
    )
    const sanitized = loadAllSettings(mem)
    assert.equal(sanitized.controls.keyBindings.moveForward, 'x')
    assert.notEqual(sanitized.controls.keyBindings.moveBackward, 'x')
    assert.equal(sanitized.controls.keyBindings.pause, 'p')
    assert.equal(
      new Set(Object.values(sanitized.controls.keyBindings)).size,
      KEY_BINDING_ACTION_ORDER.length
    )

    saveAllSettings(
      {
        ...getDefaultAllSettings(),
        controls: {
          ...getDefaultAllSettings().controls,
          keyBindings: { ...DEFAULT_KEY_BINDINGS, moveLeft: 'j', moveRight: 'l' },
        },
      },
      mem
    )
    const afterReset = resetAllSettings(mem)
    assert.deepEqual(afterReset.settings.controls.keyBindings, DEFAULT_KEY_BINDINGS)
  }

  console.log('=== ALL CUSTOMIZABLE KEY-BINDING TESTS PASSED! ===')
} finally {
  await viteServer.close()
}
