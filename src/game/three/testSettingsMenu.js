import assert from 'node:assert/strict'
import { act, createElement, useState } from 'react'
import { createServer } from 'vite'
import {
  SETTINGS_CATEGORIES,
  SETTINGS_SCHEMA,
  getDefaultSettingsState,
} from '../../components/settings/settingsConfig.js'

console.log('--- Running Settings Menu Unit & Integration Tests ---')

// ---------------------------------------------------------------------------
// 1. Settings Schema & Categories Verification
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Settings schema categories and configuration completeness')

  // Verify all 4 mandatory categories exist
  const categoryIds = SETTINGS_CATEGORIES.map((c) => c.id)
  assert.deepEqual(
    categoryIds,
    ['audio', 'controls', 'graphics', 'gameplay'],
    'Categories contain audio, controls, graphics, gameplay in correct order'
  )

  const labels = SETTINGS_CATEGORIES.map((c) => c.label)
  assert.ok(labels.includes('Audio'), 'Audio category label present')
  assert.ok(labels.includes('Mouse & Controls'), 'Mouse & Controls category label present')
  assert.ok(labels.includes('Graphics'), 'Graphics category label present')
  assert.ok(labels.includes('Gameplay'), 'Gameplay category label present')

  // Verify each category has defined groups and items in schema
  for (const catId of categoryIds) {
    const groups = SETTINGS_SCHEMA[catId]
    assert.ok(Array.isArray(groups) && groups.length > 0, `Category ${catId} has structured groups`)
    for (const grp of groups) {
      assert.ok(typeof grp.group === 'string' && grp.group.length > 0, 'Group has a title string')
      assert.ok(Array.isArray(grp.items) && grp.items.length > 0, 'Group has items array')
    }
  }

  // Verify default settings dictionary
  const defaults = getDefaultSettingsState()
  assert.ok(typeof defaults.masterVolume === 'number', 'masterVolume default exists')
  assert.ok(typeof defaults.mouseSensitivity === 'number', 'mouseSensitivity default exists')
  assert.ok(typeof defaults.qualityPreset === 'string', 'qualityPreset default exists')
  assert.ok(typeof defaults.defaultCamera === 'string', 'defaultCamera default exists')
  assert.ok(typeof defaults.scareIntensity === 'string', 'scareIntensity default exists')

  console.log('✓ Settings schema and categories verified')
}

// ---------------------------------------------------------------------------
// Mini DOM Environment Setup for React DOM Integration
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
        for (const item of moved) {
          this.insertBefore(item, refNode)
        }
        return child
      }
      if (child.parentNode) {
        child.parentNode.removeChild(child)
      }
      child.parentNode = this
      if (!refNode) {
        this.childNodes.push(child)
      } else {
        const idx = this.childNodes.indexOf(refNode)
        if (idx === -1) {
          this.childNodes.push(child)
        } else {
          this.childNodes.splice(idx, 0, child)
        }
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
      if (this.nodeType === 3 || this.nodeType === 8) {
        return this.nodeValue || ''
      }
      return this.childNodes.map((c) => c.textContent).join('')
    }

    set textContent(val) {
      const text = val == null ? '' : String(val)
      if (this.nodeType === 3 || this.nodeType === 8) {
        this.nodeValue = text
        return
      }
      while (this.childNodes.length > 0) {
        this.removeChild(this.childNodes[0])
      }
      if (text !== '') {
        this.appendChild(this.ownerDocument.createTextNode(text))
      }
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
      this.oninput = null
      this.onchange = null
      this.onclick = null
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
      const el = this
      this.classList = {
        _list() {
          return String(el._attrs.get('class') || '')
            .split(/\s+/)
            .filter(Boolean)
        },
        contains(cls) {
          return this._list().includes(cls)
        },
        add(...tokens) {
          const set = new Set(this._list())
          tokens.forEach((t) => set.add(t))
          el._attrs.set('class', [...set].join(' '))
        },
        remove(...tokens) {
          const set = new Set(this._list())
          tokens.forEach((t) => set.delete(t))
          el._attrs.set('class', [...set].join(' '))
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
            if (matchesSelector(child, selector)) {
              results.push(child)
            }
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
      if (typeof evt.preventDefault !== 'function') {
        evt.defaultPrevented = false
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

      // Capture phase
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

      // Bubble phase
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
    oninput: null,
    onchange: null,
    onclick: null,
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
      getItem(k) {
        return storageMap.has(k) ? storageMap.get(k) : null
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
      for (const fn of winEmitter.getListeners(evt.type, true)) fn(evt)
      for (const fn of winEmitter.getListeners(evt.type, false)) fn(evt)
      return true
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

try {
  const { default: SettingsModal } = await viteServer.ssrLoadModule(
    '/src/components/settings/SettingsModal.jsx'
  )
  const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')

  const clickElement = async (el) => {
    await act(async () => {
      el.dispatchEvent({
        type: 'click',
        bubbles: true,
        detail: 1,
      })
    })
  }

  // -------------------------------------------------------------------------
  // 2. SettingsModal DOM Rendering, Accessibility, Tabs, Panels & Back Button
  // -------------------------------------------------------------------------
  {
    console.log('Test 2: SettingsModal tabs, panels, controls & Back button dismissal')

    let closed = false
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    function TestHarness() {
      const [open, setOpen] = useState(true)
      return createElement(SettingsModal, {
        isOpen: open,
        onClose: () => {
          closed = true
          setOpen(false)
        },
      })
    }

    await act(async () => {
      root.render(createElement(TestHarness))
    })

    // Verify dialog container and modal attributes
    const dialog = container.querySelector('[role="dialog"]')
    assert.ok(dialog, 'Settings modal dialog rendered')
    assert.equal(dialog.getAttribute('aria-modal'), 'true')

    // Verify Category Tab Bar (role="tablist")
    const tablist = container.querySelector('[role="tablist"]')
    assert.ok(tablist, 'Category tablist exists with role="tablist"')
    assert.equal(tablist.getAttribute('aria-label'), 'Settings categories')

    // Verify 4 Category Tabs (role="tab")
    const tabs = container.querySelectorAll('[role="tab"]')
    assert.equal(tabs.length, 4, 'Exactly 4 category tabs rendered')

    const tabTexts = tabs.map((t) => t.textContent.trim())
    assert.ok(tabTexts.some((txt) => txt.includes('Audio')), 'Audio tab rendered')
    assert.ok(tabTexts.some((txt) => txt.includes('Mouse & Controls')), 'Mouse & Controls tab rendered')
    assert.ok(tabTexts.some((txt) => txt.includes('Graphics')), 'Graphics tab rendered')
    assert.ok(tabTexts.some((txt) => txt.includes('Gameplay')), 'Gameplay tab rendered')

    // Active tab initially is audio
    const initialActive = tabs.find((t) => t.getAttribute('aria-selected') === 'true')
    assert.ok(initialActive && initialActive.textContent.includes('Audio'), 'Initial active tab is Audio')

    // Verify tabpanel
    let panel = container.querySelector('[role="tabpanel"]')
    assert.ok(panel, 'Tabpanel rendered for active category')
    assert.equal(panel.getAttribute('id'), 'settings-panel-audio')

    // Switch to Mouse & Controls tab
    const controlsTab = tabs.find((t) => t.textContent.includes('Mouse & Controls'))
    assert.ok(controlsTab, 'Controls tab button found')
    await clickElement(controlsTab)

    panel = container.querySelector('[role="tabpanel"]')
    assert.equal(panel.getAttribute('id'), 'settings-panel-controls', 'Tabpanel switched to controls')

    // Switch to Graphics tab
    const graphicsTab = tabs.find((t) => t.textContent.includes('Graphics'))
    assert.ok(graphicsTab, 'Graphics tab button found')
    await clickElement(graphicsTab)

    panel = container.querySelector('[role="tabpanel"]')
    assert.equal(panel.getAttribute('id'), 'settings-panel-graphics', 'Tabpanel switched to graphics')

    // Switch to Gameplay tab
    const gameplayTab = tabs.find((t) => t.textContent.includes('Gameplay'))
    assert.ok(gameplayTab, 'Gameplay tab button found')
    await clickElement(gameplayTab)

    panel = container.querySelector('[role="tabpanel"]')
    assert.equal(panel.getAttribute('id'), 'settings-panel-gameplay', 'Tabpanel switched to gameplay')

    // Verify Back button exists in footer
    const buttons = container.querySelectorAll('button')
    const backBtn = buttons.find((b) => b.textContent.trim() === 'Back')
    assert.ok(backBtn, 'Back button is present in Settings modal')

    // Click Back button -> calls onClose and closes modal
    await clickElement(backBtn)
    assert.equal(closed, true, 'Clicking Back button calls onClose()')
    assert.equal(container.querySelector('[role="dialog"]'), null, 'Modal unmounted after Back button click')

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)

    console.log('✓ SettingsModal tabs, accessibility attributes, tab switching, and Back button verified')
  }

  // -------------------------------------------------------------------------
  // 3. App Integration: Settings Option in Header and Pause Overlay Logic
  // -------------------------------------------------------------------------
  {
    console.log('Test 3: App header Settings option and pause overlay synchronization')

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(App))
    })

    // Find Settings button in ScreenHeader
    const allButtons = container.querySelectorAll('button')
    const settingsBtn = allButtons.find((b) => b.textContent.trim() === 'Settings')
    assert.ok(settingsBtn, 'Settings button rendered in ScreenHeader')

    // Click Settings button
    await clickElement(settingsBtn)

    // Verify SettingsModal is open
    const modalDialog = container.querySelector('.lv-modal--settings')
    assert.ok(modalDialog, 'SettingsModal is open in App after clicking Settings button')

    // Verify Back button closes the modal
    const modalBackBtn = container
      .querySelectorAll('button')
      .find((b) => b.textContent.trim() === 'Back')
    assert.ok(modalBackBtn, 'Back button rendered in SettingsModal within App')

    await clickElement(modalBackBtn)
    assert.equal(
      container.querySelector('.lv-modal--settings'),
      null,
      'SettingsModal closed after clicking Back button in App'
    )

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)

    console.log('✓ App header Settings option and modal dismissal verified')
  }

  // -------------------------------------------------------------------------
  // 4. End-to-End Audio Settings Integration with 3D HorrorAudioEngine
  // -------------------------------------------------------------------------
  {
    console.log('Test 4: End-to-end Audio Settings connected to HorrorAudioEngine in 3D mode')

    function makeMockWebAudioContext() {
      const stats = {
        created: 0,
        resumeCount: 0,
        suspendCount: 0,
        delayNodes: 0,
      }
      const makeParam = (initial = 0) => ({
        value: initial,
        setValueAtTime(v) {
          this.value = v
        },
        setTargetAtTime(v) {
          this.value = v
        },
        linearRampToValueAtTime(v) {
          this.value = v
        },
        exponentialRampToValueAtTime(v) {
          this.value = v
        },
      })
      const makeNode = (extra = {}) => ({
        connect() {},
        disconnect() {},
        ...extra,
      })
      const ctx = {
        state: 'suspended',
        currentTime: 1,
        sampleRate: 44100,
        destination: makeNode(),
        listener: {
          positionX: makeParam(0),
          positionY: makeParam(0),
          positionZ: makeParam(0),
          forwardX: makeParam(0),
          forwardY: makeParam(0),
          forwardZ: makeParam(-1),
          upX: makeParam(0),
          upY: makeParam(1),
          upZ: makeParam(0),
        },
        async resume() {
          stats.resumeCount += 1
          ctx.state = 'running'
        },
        async suspend() {
          stats.suspendCount += 1
          ctx.state = 'suspended'
        },
        async close() {
          ctx.state = 'closed'
        },
        createGain() {
          return makeNode({ gain: makeParam(1) })
        },
        createDelay() {
          stats.delayNodes += 1
          return makeNode({ delayTime: makeParam(0) })
        },
        createDynamicsCompressor() {
          return makeNode({
            threshold: makeParam(-24),
            knee: makeParam(30),
            ratio: makeParam(12),
          })
        },
        createBiquadFilter() {
          return makeNode({
            type: 'lowpass',
            frequency: makeParam(1000),
            Q: makeParam(1),
          })
        },
        createPanner() {
          return makeNode({
            panningModel: 'HRTF',
            distanceModel: 'linear',
            refDistance: 1,
            maxDistance: 100,
            rolloffFactor: 1,
            positionX: makeParam(0),
            positionY: makeParam(0),
            positionZ: makeParam(0),
          })
        },
        createOscillator() {
          return makeNode({
            type: 'sine',
            frequency: makeParam(440),
            onended: null,
            start() {},
            stop() {},
          })
        },
        createBuffer(channels, length, sampleRate) {
          return {
            numberOfChannels: channels,
            length,
            sampleRate,
            duration: length / sampleRate,
            getChannelData() {
              return new Float32Array(length)
            },
          }
        },
        createBufferSource() {
          return makeNode({
            buffer: null,
            loop: false,
            onended: null,
            start() {},
            stop() {},
          })
        },
      }
      return { ctx, stats }
    }

    const mockAudio = makeMockWebAudioContext()
    const mockRenderer = {
      domElement: domEnv.document.createElement('canvas'),
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 1,
      setPixelRatio() {},
      setSize() {},
      render() {},
      dispose() {},
      getContext: () => null,
    }

    domEnv.window.localStorage.clear()
    let activeEngine = null

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          createElement(App, {
            viewportEngineConfig: {
              createRenderer: () => mockRenderer,
              audio: {
                createAudioContext: () => {
                  mockAudio.stats.created += 1
                  return mockAudio.ctx
                },
                recordCueHistory: true,
              },
            },
            onViewportReady: (ctx) => {
              activeEngine = ctx.engine
            },
          })
        )
      })

    // Enter 3D mode (switch button) and wait inside act() for lazy Suspense + engine mount
    const preview3dBtn = container
      .querySelectorAll('button')
      .find((b) => b.textContent.trim() === '3D Preview')
    assert.ok(preview3dBtn, '3D Preview button present')
    await clickElement(preview3dBtn)
    const deadline = Date.now() + 3000
    while (!activeEngine && Date.now() < deadline) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25))
      })
    }
    const fallbackEl = container.querySelector('.maze-fallback-notice')
    assert.equal(
      fallbackEl,
      null,
      `3D viewport fallback triggered: ${fallbackEl?.textContent || ''}`
    )

    assert.ok(activeEngine, 'MazeSceneEngine mounted in 3D mode')
    const audioEngine = activeEngine.getAudioEngine()
    assert.ok(audioEngine, 'HorrorAudioEngine attached to MazeSceneEngine')

    // Unlock audio via active gameplay gesture
    assert.equal(activeEngine.unlockAudio(), true, 'Audio unlocked during active 3D gameplay')
    assert.equal(mockAudio.stats.created, 1, 'AudioContext initialized once')
    assert.equal(mockAudio.ctx.state, 'running', 'AudioContext running during active gameplay')

    const initialMaster = audioEngine.masterGain.gain.value
    assert.ok(initialMaster > 0, 'Master gain active before opening Settings')

    // Open Settings Modal from 3D mode
    const openSettingsBtn = container
      .querySelectorAll('button')
      .find((b) => b.textContent.trim() === 'Settings')
    assert.ok(openSettingsBtn, 'Settings button present in 3D mode')
    await clickElement(openSettingsBtn)

    assert.ok(container.querySelector('.lv-modal--settings'), 'Settings modal opened')
    assert.equal(activeEngine.isPaused, true, 'Scene engine pauses when Settings modal opens')
    assert.equal(audioEngine.isPaused, true, 'Audio engine pauses when Settings modal opens')
    assert.equal(
      audioEngine.masterGain.gain.value,
      0,
      'Master gain is muted while Settings modal is open'
    )
    assert.equal(
      mockAudio.ctx.state,
      'suspended',
      'AudioContext is suspended while Settings modal is open'
    )

    // Locate all 4 volume sliders and Mute All / Spatial / Reverb switches in Audio tab
    const setSliderValue = async (ariaLabel, nextVal) => {
      const slider = container.querySelector(`input[aria-label="${ariaLabel}"]`)
      assert.ok(slider, `Slider "${ariaLabel}" rendered`)
      const desc = Object.getOwnPropertyDescriptor(
        domEnv.HTMLInputElement.prototype,
        'value'
      )
      desc?.set?.call(slider, String(nextVal))
      await act(async () => {
        slider.dispatchEvent({ type: 'input', bubbles: true })
        slider.dispatchEvent({ type: 'change', bubbles: true })
      })
    }

    const findSwitchByLabel = (labelText) => {
      const switches = container.querySelectorAll('[role="switch"]')
      return switches.find((sw) => {
        const labelledBy = sw.getAttribute('aria-labelledby')
        const labelEl = labelledBy
          ? container.querySelector(`#${labelledBy}`)
          : null
        return labelEl?.textContent?.trim() === labelText
      })
    }

    await setSliderValue('Master Volume slider', 50)
    await setSliderValue('Ambience & Drones slider', 40)
    await setSliderValue('Sound Effects (SFX) slider', 80)
    await setSliderValue('Music & Tension Stems slider', 60)

    // While Settings is open, audio must STAY paused and muted!
    assert.equal(audioEngine.isPaused, true, 'Adjusting sliders inside Settings does not unpause audio')
    assert.equal(
      audioEngine.masterGain.gain.value,
      0,
      'Master GainNode remains 0 while Settings modal is open'
    )
    assert.equal(
      mockAudio.ctx.state,
      'suspended',
      'AudioContext stays suspended when sliders move inside Settings'
    )

    // Individual channel buses & volume config already updated immediately without restarting engine
    assert.equal(activeEngine.getAudioEngine(), audioEngine, 'Engine instance was not recreated/restarted')
    assert.equal(audioEngine.volumes.master, 0.5, 'Master volume config updated to 0.5')
    assert.equal(audioEngine.ambienceGain.gain.value, 0.4, 'Ambience GainNode updated immediately to 0.4')
    assert.equal(audioEngine.effectsGain.gain.value, 0.8, 'Effects GainNode updated immediately to 0.8')
    assert.equal(audioEngine.musicGain.gain.value, 0.6, 'Music GainNode updated immediately to 0.6')

    // Toggle 3D Spatial Audio & Acoustic Corridor Reverb off
    const spatialSwitch = findSwitchByLabel('3D Spatial Audio')
    const reverbSwitch = findSwitchByLabel('Acoustic Corridor Reverb')
    assert.ok(spatialSwitch && reverbSwitch, 'Spatial audio and corridor reverb toggles exist')
    await clickElement(spatialSwitch)
    await clickElement(reverbSwitch)
    assert.deepEqual(
      audioEngine.getAudioOptions(),
      { spatialAudio: false, footstepEchoes: false },
      'Spatial audio and Acoustic Corridor Reverb options propagate immediately to HorrorAudioEngine'
    )

    // Re-enable them so defaults are verified
    await clickElement(findSwitchByLabel('3D Spatial Audio'))
    await clickElement(findSwitchByLabel('Acoustic Corridor Reverb'))
    assert.deepEqual(
      audioEngine.getAudioOptions(),
      { spatialAudio: true, footstepEchoes: true },
      'Re-enabling Spatial Audio and Acoustic Corridor Reverb updates HorrorAudioEngine'
    )

    // Close Settings modal -> audio resumes with updated Master Volume scaling all categories
    const backBtn = container
      .querySelectorAll('button')
      .find((b) => b.textContent.trim() === 'Back')
    await clickElement(backBtn)

    assert.equal(activeEngine.isPaused, false, 'Closing Settings unpauses scene engine')
    assert.equal(audioEngine.isPaused, false, 'Closing Settings unpauses audio engine')
    assert.equal(mockAudio.ctx.state, 'running', 'AudioContext resumes upon closing Settings')
    assert.equal(
      audioEngine.masterGain.gain.value,
      0.5,
      'Master GainNode reflects updated 50% Master Volume immediately upon closing Settings'
    )
    const effective = audioEngine.getEffectiveVolumes()
    assert.ok(Math.abs(effective.ambience - 0.2) < 1e-6, 'Master scales Ambience (0.5 * 0.4 = 0.2)')
    assert.ok(Math.abs(effective.effects - 0.4) < 1e-6, 'Master scales Effects (0.5 * 0.8 = 0.4)')
    assert.ok(Math.abs(effective.music - 0.3) < 1e-6, 'Master scales Music (0.5 * 0.6 = 0.3)')

    // Open Settings again and test Mute All toggle
    await clickElement(
      container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Settings')
    )
    const muteSwitch = findSwitchByLabel('Mute All Audio')
    assert.ok(muteSwitch, 'Mute All Audio toggle rendered')
    await clickElement(muteSwitch)
    assert.equal(audioEngine.volumes.muted, true, 'Mute All updates HorrorAudioEngine.volumes.muted')

    // Close Settings while muted -> masterGain stays 0 even though game is unpaused
    await clickElement(
      container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Back')
    )
    assert.equal(audioEngine.isPaused, false, 'Game unpaused while Mute All is enabled')
    assert.equal(
      audioEngine.masterGain.gain.value,
      0,
      'Master GainNode remains 0 after closing Settings when Mute All is enabled'
    )

    // Unmute via SettingsModal and confirm master volume restores to 0.5
    await clickElement(
      container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Settings')
    )
    await clickElement(findSwitchByLabel('Mute All Audio'))
    await clickElement(
      container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Back')
    )
    assert.equal(
      audioEngine.masterGain.gain.value,
      0.5,
      'Unmuting via SettingsModal restores configured Master Volume without losing slider values'
    )

      console.log('✓ End-to-end Audio Settings integration with HorrorAudioEngine verified')
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.parentNode?.removeChild(container)
    }
  }
} finally {
  await viteServer.close()
}

console.log('=== ALL SETTINGS MENU TESTS PASSED! ===')
