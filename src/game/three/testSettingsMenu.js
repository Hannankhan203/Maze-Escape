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
  assert.equal('defaultCamera' in defaults, false, 'defaultCamera control is removed from Settings schema')
  assert.ok(typeof defaults.scareIntensity === 'string', 'scareIntensity default exists')
  assert.ok(typeof defaults.difficulty === 'string', 'difficulty default exists')

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
      if (typeof evt.defaultPrevented !== 'boolean') {
        evt.defaultPrevented = false
      }
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
    assert.equal(panel.querySelector('[aria-label="Default 3D Camera"]'), null, 'First-Person/Third-Person switch removed from Settings Gameplay tab')
    assert.ok(panel.querySelector('[aria-label="Third-Person Camera Mode"]'), 'Third-Person Camera Mode control rendered in Gameplay tab')
    assert.ok(panel.querySelector('[aria-label="Difficulty"]'), 'Difficulty control rendered in Gameplay tab')

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

  const openPauseAndSettings = async (container) => {
    if (!container.querySelector('.lv-modal--settings')) {
      let settingsBtn = container
        .querySelectorAll('button')
        .find((b) => b.textContent.trim() === 'Settings')
      if (!settingsBtn) {
        await act(async () => {
          domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
        })
        settingsBtn = container
          .querySelectorAll('button')
          .find((b) => b.textContent.trim() === 'Settings')
      }
      assert.ok(settingsBtn, 'Settings button rendered inside Game Paused modal')
      await clickElement(settingsBtn)
    }
  }

  const closeSettingsAndResume = async (container) => {
    const backBtn = container
      .querySelectorAll('button')
      .find((b) => b.textContent.trim() === 'Back')
    assert.ok(backBtn, 'Back button rendered in SettingsModal')
    await clickElement(backBtn)
    assert.equal(container.querySelector('.lv-modal--settings'), null, 'SettingsModal closed after clicking Back')
    const resumeBtn = container
      .querySelectorAll('button')
      .find((b) => b.textContent.trim() === 'Resume')
    if (resumeBtn) {
      await clickElement(resumeBtn)
    }
  }

  // -------------------------------------------------------------------------
  // 3. App Integration: Pause Overlay Settings Entry and Modal Synchronization
  // -------------------------------------------------------------------------
  {
    console.log('Test 3: App Pause menu Settings option and pause overlay synchronization')

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(App))
      })

      // ScreenHeader is removed in Phase 1; Settings is accessed from Pause (P)
      assert.equal(container.querySelector('.screen-header'), null, 'ScreenHeader removed in Phase 1')
      await openPauseAndSettings(container)

      // Verify SettingsModal is open on Audio tab with full audio controls
      const modalDialog = container.querySelector('.lv-modal--settings')
      assert.ok(modalDialog, 'SettingsModal is open in App after clicking Settings in Pause menu')
      const audioPanel = modalDialog.querySelector('#settings-panel-audio')
      assert.ok(audioPanel, 'Settings -> Audio panel active by default')
      assert.ok(audioPanel.querySelector('input[aria-label="Master Volume slider"]'), 'Master Volume slider present in Settings -> Audio')
      assert.ok(audioPanel.querySelector('input[aria-label="Ambience & Drones slider"]'), 'Ambience slider present in Settings -> Audio')
      assert.ok(audioPanel.querySelector('input[aria-label="Sound Effects (SFX) slider"]'), 'SFX slider present in Settings -> Audio')
      assert.ok(audioPanel.querySelector('input[aria-label="Music & Tension Stems slider"]'), 'Music slider present in Settings -> Audio')

      // Verify Back returns to Pause modal (without duplicated Difficulty/Camera View/Audio & Mixer), and Resume returns cleanly to gameplay
      await clickElement(
        container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Back')
      )
      const pauseModal = container.querySelector('.lv-modal--pause')
      assert.ok(pauseModal, 'Returned to Pause menu after clicking Back')
      assert.equal(
        pauseModal.querySelectorAll('button').find((b) => b.textContent.trim() === 'Records') || null,
        null,
        'Records button absent from Pause menu'
      )
      assert.equal(pauseModal.querySelector('[aria-label="Difficulty"]'), null, 'Difficulty selector absent from Pause menu')
      assert.equal(pauseModal.querySelector('[aria-label="Camera perspective"]'), null, 'Camera View selector absent from Pause menu')
      assert.equal(pauseModal.querySelector('[aria-label="Audio controls and mixer"]'), null, 'Audio & Mixer section absent from Pause menu')
      assert.equal(pauseModal.querySelector('[data-pause-mute="true"]'), null, 'Mute Audio button absent from Pause menu')
      assert.equal(pauseModal.querySelector('.lv-pause-mixer'), null, 'Audio mixer absent from Pause menu')
      const resumeBtn = container
        .querySelectorAll('button')
        .find((b) => b.textContent.trim() === 'Resume')
      assert.ok(resumeBtn, 'Resume button rendered in Pause menu')
      await clickElement(resumeBtn)
      assert.equal(container.querySelector('[role="dialog"]'), null, 'Pause & Settings modals closed after Resume')
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.parentNode?.removeChild(container)
    }

    console.log('✓ App Pause menu Settings option and modal dismissal verified')
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

    assert.ok(activeEngine, 'MazeSceneEngine mounted immediately in 3D mode')
    const audioEngine = activeEngine.getAudioEngine()
    assert.ok(audioEngine, 'HorrorAudioEngine attached to MazeSceneEngine')

    // Unlock audio via active gameplay gesture
    assert.equal(activeEngine.unlockAudio(), true, 'Audio unlocked during active 3D gameplay')
    assert.equal(mockAudio.stats.created, 1, 'AudioContext initialized once')
    assert.equal(mockAudio.ctx.state, 'running', 'AudioContext running during active gameplay')

    const initialMaster = audioEngine.masterGain.gain.value
    assert.ok(initialMaster > 0, 'Master gain active before opening Settings')

    // Open Settings Modal from Pause menu
    await openPauseAndSettings(container)

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

    // Close Settings modal & resume -> audio resumes with updated Master Volume scaling all categories
    await closeSettingsAndResume(container)

    assert.equal(activeEngine.isPaused, false, 'Closing Settings & resuming unpauses scene engine')
    assert.equal(audioEngine.isPaused, false, 'Closing Settings & resuming unpauses audio engine')
    assert.equal(mockAudio.ctx.state, 'running', 'AudioContext resumes upon closing Settings & resuming')
    assert.equal(
      audioEngine.masterGain.gain.value,
      0.5,
      'Master GainNode reflects updated 50% Master Volume immediately upon resuming'
    )
    const effective = audioEngine.getEffectiveVolumes()
    assert.ok(Math.abs(effective.ambience - 0.2) < 1e-6, 'Master scales Ambience (0.5 * 0.4 = 0.2)')
    assert.ok(Math.abs(effective.effects - 0.4) < 1e-6, 'Master scales Effects (0.5 * 0.8 = 0.4)')
    assert.ok(Math.abs(effective.music - 0.3) < 1e-6, 'Master scales Music (0.5 * 0.6 = 0.3)')

    // Open Settings again and test Mute All toggle
    await openPauseAndSettings(container)
    const muteSwitch = findSwitchByLabel('Mute All Audio')
    assert.ok(muteSwitch, 'Mute All Audio toggle rendered')
    await clickElement(muteSwitch)
    assert.equal(audioEngine.volumes.muted, true, 'Mute All updates HorrorAudioEngine.volumes.muted')

    // Close Settings & resume while muted -> masterGain stays 0 even though game is unpaused
    await closeSettingsAndResume(container)
    assert.equal(audioEngine.isPaused, false, 'Game unpaused while Mute All is enabled')
    assert.equal(
      audioEngine.masterGain.gain.value,
      0,
      'Master GainNode remains 0 after resuming when Mute All is enabled'
    )

    // Unmute via SettingsModal and confirm master volume restores to 0.5
    await openPauseAndSettings(container)
    await clickElement(findSwitchByLabel('Mute All Audio'))
    await closeSettingsAndResume(container)
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

  // -------------------------------------------------------------------------
  // 5. Mouse & Controls Settings: Mouse Look, Touch Look, D-Pad, Haptics & Keybinds
  // -------------------------------------------------------------------------
  {
    console.log(
      'Test 5: Mouse & Controls settings (Invert-Y, sensitivities, D-Pad modes, haptics, keybinds, 2D & 3D compatibility)'
    )

    const hapticsModule = await viteServer.ssrLoadModule('/src/utils/haptics.js')
    const {
      HAPTIC_PATTERNS,
      isHapticsSupported,
      triggerHapticFeedback,
      triggerHapticForGameEvent,
    } = hapticsModule

    // 5a. Safe unsupported-device & disabled behavior for haptics helper
    assert.equal(isHapticsSupported(null), false, 'Null navigator reports unsupported haptics')
    assert.equal(isHapticsSupported({}), false, 'Navigator without vibrate reports unsupported haptics')
    assert.equal(
      triggerHapticFeedback(HAPTIC_PATTERNS.COLLISION, { navigator: {} }),
      false,
      'Unsupported device safely no-ops without throwing'
    )
    const unitVibrateCalls = []
    const unitNav = {
      vibrate(pattern) {
        unitVibrateCalls.push(pattern)
        return true
      },
    }
    assert.equal(isHapticsSupported(unitNav), true, 'Navigator with vibrate reports supported haptics')
    assert.equal(
      triggerHapticForGameEvent({ type: 'player_damaged' }, { enabled: false, navigator: unitNav }),
      false,
      'Disabled haptics suppresses vibration'
    )
    assert.equal(unitVibrateCalls.length, 0, 'No vibrate call made when haptics disabled')
    assert.equal(
      triggerHapticForGameEvent({ type: 'player_damaged' }, { enabled: true, navigator: unitNav }),
      true
    )
    assert.equal(
      triggerHapticForGameEvent({ type: 'blocked' }, { enabled: true, navigator: unitNav }),
      true
    )
    assert.equal(
      triggerHapticForGameEvent({ type: 'echo_reveal_activated' }, { enabled: true, navigator: unitNav }),
      true
    )
    assert.deepEqual(unitVibrateCalls, [
      HAPTIC_PATTERNS.DAMAGE,
      HAPTIC_PATTERNS.COLLISION,
      HAPTIC_PATTERNS.ABILITY,
    ])

    // Install configurable mock navigator.vibrate for React/App integration test
    const originalGlobalNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const vibrateCalls = []
    const mockNavigator = {
      userAgent: 'node-test',
      maxTouchPoints: 0,
      vibrate(pattern) {
        vibrateCalls.push(pattern)
        return true
      },
    }
    Object.defineProperty(globalThis, 'navigator', {
      value: mockNavigator,
      configurable: true,
      writable: true,
    })
    domEnv.window.navigator = mockNavigator

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
    domEnv.window.location.href = 'http://localhost:3000/'
    let activeEngine = null
    let latestGameEvent = null

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

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
        const labelEl = labelledBy ? container.querySelector(`#${labelledBy}`) : null
        return labelEl?.textContent?.trim() === labelText
      })
    }

    const findButton = (text) =>
      container.querySelectorAll('button').find((b) => b.textContent.trim() === text)

    const openControlsTab = async () => {
      await openPauseAndSettings(container)
      const controlsTab = container
        .querySelectorAll('[role="tab"]')
        .find((t) => t.textContent.includes('Mouse & Controls'))
      assert.ok(controlsTab, 'Mouse & Controls tab present')
      await clickElement(controlsTab)
    }

    const closeSettingsModal = async () => {
      await closeSettingsAndResume(container)
    }

    try {
      await act(async () => {
        root.render(
          createElement(App, {
            onGameEvent: (evt) => {
              latestGameEvent = evt
            },
            viewportEngineConfig: {
              createRenderer: () => mockRenderer,
            },
            onViewportReady: (ctx) => {
              activeEngine = ctx.engine
            },
          })
        )
      })

      const deadline = Date.now() + 3000
      while (!activeEngine && Date.now() < deadline) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 25))
        })
      }
      assert.ok(activeEngine, 'MazeSceneEngine mounted immediately in 3D mode')
      const stageHost = container.querySelector('.maze-viewport-3d__stage')
      assert.ok(stageHost, '3D stage host rendered')

      // 5b. Customizable Key Bindings section & Haptic Feedback persistence
      await openControlsTab()

      const keybindList = container.querySelector('[aria-label="Key bindings"]')
      assert.ok(keybindList, 'Key bindings list rendered')
      const keybindText = keybindList.textContent
      for (const expectedToken of ['W', 'A', 'S', 'D', 'Shift', 'L', 'F', 'Space', 'E', 'Q', 'H', 'V', 'P', 'Cycle Camera Distance']) {
        assert.ok(
          keybindText.includes(expectedToken),
          `Keybindings list displays "${expectedToken}"`
        )
      }
      assert.equal(
        keybindText.includes('Tactical Minimap'),
        false,
        'Obsolete Tactical Minimap (M) entry is removed from Settings keybindings'
      )

      // Toggle Haptic Feedback OFF -> verify unified settings storage persistence -> re-enable
      const hapticsSwitch = findSwitchByLabel('Haptic Feedback')
      assert.ok(hapticsSwitch, 'Haptic Feedback toggle rendered')
      assert.equal(hapticsSwitch.getAttribute('aria-checked'), 'true', 'Haptic Feedback defaults to enabled')
      await clickElement(hapticsSwitch)
      assert.equal(hapticsSwitch.getAttribute('aria-checked'), 'false', 'Haptic Feedback toggled off')

      const persistedSettingsRaw = domEnv.window.localStorage.getItem('maze-escape:settings:v1')
      assert.ok(persistedSettingsRaw, 'Unified settings persisted on touchHaptics change')
      const persistedSettingsParsed = JSON.parse(persistedSettingsRaw)
      assert.equal(
        persistedSettingsParsed.controls?.touchHaptics,
        false,
        'touchHaptics persisted to maze-escape:settings:v1'
      )

      await clickElement(findSwitchByLabel('Haptic Feedback'))
      assert.equal(
        findSwitchByLabel('Haptic Feedback').getAttribute('aria-checked'),
        'true'
      )
      await closeSettingsModal()

      // 5c. Mouse Look & Invert Y in 3D Mode
      domEnv.document.pointerLockElement = stageHost
      activeEngine.cameraRig.setLookDirection(0, 0)
      await act(async () => {
        domEnv.document.dispatchEvent({
          type: 'mousemove',
          movementX: 100,
          movementY: 50,
        })
      })
      const baseLook = activeEngine.cameraRig.getLookDirection()
      assert.ok(baseLook.yaw < 0, 'Baseline mouse move right decreases yaw')
      assert.ok(baseLook.pitch < 0, 'Baseline mouse move down looks down when Invert Y is off')

      // Adjust Mouse Sensitivity to 200% in Settings -> applies immediately without restarting engine
      const engineBeforeMouseSetting = activeEngine
      await openControlsTab()
      await setSliderValue('Mouse Sensitivity slider', 200)
      await closeSettingsModal()
      assert.equal(
        activeEngine,
        engineBeforeMouseSetting,
        'Changing Mouse Sensitivity does not restart MazeSceneEngine'
      )

      domEnv.document.pointerLockElement = stageHost
      activeEngine.cameraRig.setLookDirection(0, 0)
      await act(async () => {
        domEnv.document.dispatchEvent({
          type: 'mousemove',
          movementX: 100,
          movementY: 50,
        })
      })
      const scaledLook = activeEngine.cameraRig.getLookDirection()
      assert.ok(
        Math.abs(scaledLook.yaw - baseLook.yaw * 2) < 1e-6,
        'Doubling Mouse Sensitivity immediately doubles horizontal yaw sensitivity'
      )
      assert.ok(
        Math.abs(scaledLook.pitch - baseLook.pitch * 2) < 1e-6,
        'Doubling Mouse Sensitivity immediately doubles vertical pitch sensitivity'
      )

      // Enable Invert Y-Axis -> vertical mouse-down looks UP, horizontal yaw stays identical
      await openControlsTab()
      const invertYSwitch = findSwitchByLabel('Invert Y-Axis')
      assert.ok(invertYSwitch, 'Invert Y-Axis toggle rendered')
      assert.equal(invertYSwitch.getAttribute('aria-checked'), 'false')
      await clickElement(invertYSwitch)
      assert.equal(invertYSwitch.getAttribute('aria-checked'), 'true')
      await closeSettingsModal()

      domEnv.document.pointerLockElement = stageHost
      activeEngine.cameraRig.setLookDirection(0, 0)
      await act(async () => {
        domEnv.document.dispatchEvent({
          type: 'mousemove',
          movementX: 100,
          movementY: 50,
        })
      })
      const invertedLook = activeEngine.cameraRig.getLookDirection()
      assert.ok(
        Math.abs(invertedLook.yaw - scaledLook.yaw) < 1e-6,
        'Invert Y-Axis does NOT invert or alter horizontal mouse look'
      )
      assert.ok(
        invertedLook.pitch > 0 && Math.abs(invertedLook.pitch - Math.abs(scaledLook.pitch)) < 1e-6,
        'Invert Y-Axis reverses vertical look so mouse down (dy > 0) looks UP (pitch > 0)'
      )
      domEnv.document.pointerLockElement = null

      // 5d. Touch D-Pad Auto hides on desktop, Always Visible mounts for Touch Look Sensitivity testing
      assert.equal(
        container.querySelector('[data-touch-controls-root="true"]'),
        null,
        'TouchControls3D is hidden on desktop in default auto mode'
      )
      await openControlsTab()
      await clickElement(findButton('Always Visible'))
      await closeSettingsModal()

      const lookPad = container.querySelector('[data-touch-zone="look"]')
      assert.ok(lookPad, 'TouchControls3D look pad mounted in Always Visible mode')

      activeEngine.cameraRig.setLookDirection(0, 0)
      await act(async () => {
        lookPad.dispatchEvent({
          type: 'pointerdown',
          bubbles: true,
          pointerId: 11,
          pointerType: 'touch',
          button: 0,
          clientX: 200,
          clientY: 200,
        })
        lookPad.dispatchEvent({
          type: 'pointermove',
          bubbles: true,
          pointerId: 11,
          pointerType: 'touch',
          clientX: 250,
          clientY: 230,
        })
        lookPad.dispatchEvent({
          type: 'pointerup',
          bubbles: true,
          pointerId: 11,
          pointerType: 'touch',
        })
      })
      const touchLook180 = activeEngine.cameraRig.getLookDirection()
      assert.ok(touchLook180.yaw < 0 && touchLook180.pitch > 0, 'Touch look applies invertY cleanly')

      // Increase Touch Look Sensitivity from 180% -> 270% (1.5x) and turn Invert Y back OFF
      await openControlsTab()
      await setSliderValue('Touch Look Sensitivity slider', 270)
      await clickElement(findSwitchByLabel('Invert Y-Axis'))
      await closeSettingsModal()

      const lookPadAfter = container.querySelector('[data-touch-zone="look"]')
      assert.ok(lookPadAfter, 'TouchControls3D look pad re-mounted after closing Settings')
      activeEngine.cameraRig.setLookDirection(0, 0)
      await act(async () => {
        lookPadAfter.dispatchEvent({
          type: 'pointerdown',
          bubbles: true,
          pointerId: 12,
          pointerType: 'touch',
          button: 0,
          clientX: 200,
          clientY: 200,
        })
        lookPadAfter.dispatchEvent({
          type: 'pointermove',
          bubbles: true,
          pointerId: 12,
          pointerType: 'touch',
          clientX: 250,
          clientY: 230,
        })
        lookPadAfter.dispatchEvent({
          type: 'pointerup',
          bubbles: true,
          pointerId: 12,
          pointerType: 'touch',
        })
      })
      const touchLook270 = activeEngine.cameraRig.getLookDirection()
      assert.ok(
        Math.abs(touchLook270.yaw - touchLook180.yaw * 1.5) < 1e-6,
        `Touch Look Sensitivity slider (270% vs 180%) immediately scales TouchControls3D yaw by 1.5x (got 180=${JSON.stringify(touchLook180)}, 270=${JSON.stringify(touchLook270)})`
      )
      assert.ok(
        touchLook270.pitch < 0 &&
          Math.abs(Math.abs(touchLook270.pitch) - touchLook180.pitch * 1.5) < 1e-6,
        'Touch Look Sensitivity slider scales pitch and honors Invert Y OFF'
      )

      // Also verify canvas-host touch drag uses touchLookSensitivity (2.7 * 0.0022) rather than mouseSensitivity
      activeEngine.cameraRig.setLookDirection(0, 0)
      await act(async () => {
        stageHost.dispatchEvent({
          type: 'pointerdown',
          bubbles: true,
          pointerId: 13,
          pointerType: 'touch',
          button: 0,
          clientX: 100,
          clientY: 100,
        })
        stageHost.dispatchEvent({
          type: 'pointermove',
          bubbles: true,
          pointerId: 13,
          pointerType: 'touch',
          clientX: 150,
          clientY: 130,
        })
        stageHost.dispatchEvent({
          type: 'pointerup',
          bubbles: true,
          pointerId: 13,
          pointerType: 'touch',
        })
      })
      const canvasTouchDrag = activeEngine.cameraRig.getLookDirection()
      assert.ok(
        Math.abs(canvasTouchDrag.yaw - touchLook270.yaw) < 1e-6 &&
          Math.abs(canvasTouchDrag.pitch - touchLook270.pitch) < 1e-6,
        'Canvas touch-drag uses touchLookSensitivity independently of Mouse Sensitivity'
      )

      // 5e. Touch D-Pad Mode: Always Visible, Disabled (Off), Auto (Touch Only)
      let touchRoot = container.querySelector('[data-touch-controls-root="true"]')
      assert.ok(touchRoot, 'TouchControls3D rendered in Always Visible mode')
      assert.equal(touchRoot.getAttribute('data-touch-mode'), 'always')
      assert.ok(
        touchRoot.classList.contains('maze-touch-controls--always'),
        'Always mode adds maze-touch-controls--always class'
      )

      await openControlsTab()
      await clickElement(findButton('Disabled'))
      await closeSettingsModal()
      assert.equal(
        container.querySelector('[data-touch-controls-root="true"]'),
        null,
        'Disabled (off) mode unmounts TouchControls3D'
      )
      assert.equal(
        container.querySelector('.maze-viewport-3d')?.getAttribute('data-touch-controls-visible'),
        'false'
      )

      // In auto mode, after prior touch activity it mounts, then a mouse click on stage returns to desktop hidden
      await openControlsTab()
      await clickElement(findButton('Auto (Touch Only)'))
      await closeSettingsModal()
      touchRoot = container.querySelector('[data-touch-controls-root="true"]')
      assert.ok(touchRoot, 'Auto mode shows TouchControls3D after prior touch interaction')
      assert.equal(touchRoot.getAttribute('data-touch-mode'), 'auto')
      assert.equal(
        touchRoot.classList.contains('maze-touch-controls--always'),
        false,
        'Auto mode does not force always-visible desktop class'
      )

      // 5f. Haptic Feedback on 3D Touch Buttons (enabled vs disabled)
      let sprintTouchBtn = container.querySelector('[data-touch-action="sprint"]')
      assert.ok(sprintTouchBtn, 'Touch sprint button rendered')
      vibrateCalls.length = 0
      await act(async () => {
        sprintTouchBtn.dispatchEvent({
          type: 'pointerdown',
          bubbles: true,
          pointerId: 21,
          pointerType: 'touch',
          button: 0,
        })
        sprintTouchBtn.dispatchEvent({
          type: 'pointerup',
          bubbles: true,
          pointerId: 21,
          pointerType: 'touch',
        })
      })
      assert.deepEqual(
        vibrateCalls,
        [HAPTIC_PATTERNS.INTERACT],
        'Touch action button triggers haptic feedback when Haptic Feedback is enabled'
      )

      await openControlsTab()
      await clickElement(findSwitchByLabel('Haptic Feedback'))
      await closeSettingsModal()
      sprintTouchBtn = container.querySelector('[data-touch-action="sprint"]')
      assert.ok(sprintTouchBtn, 'Touch sprint button re-mounted after closing Settings')
      vibrateCalls.length = 0
      await act(async () => {
        sprintTouchBtn.dispatchEvent({
          type: 'pointerdown',
          bubbles: true,
          pointerId: 22,
          pointerType: 'touch',
          button: 0,
        })
        sprintTouchBtn.dispatchEvent({
          type: 'pointerup',
          bubbles: true,
          pointerId: 22,
          pointerType: 'touch',
        })
      })
      assert.equal(
        vibrateCalls.length,
        0,
        'Touch action button does not vibrate when Haptic Feedback is disabled'
      )

      // Mouse interaction on desktop stage hides auto touch controls again
      await act(async () => {
        stageHost.dispatchEvent({
          type: 'pointerdown',
          bubbles: true,
          pointerId: 23,
          pointerType: 'mouse',
          button: 0,
          clientX: 120,
          clientY: 120,
        })
      })
      assert.equal(
        container.querySelector('[data-touch-controls-root="true"]'),
        null,
        'Mouse interaction on desktop hides auto touch controls again'
      )
      assert.equal(latestGameEvent, null)

      console.log('✓ Mouse & Controls Settings end-to-end 3D integration verified')
    } finally {
      domEnv.document.pointerLockElement = null
      if (originalGlobalNavDesc) {
        Object.defineProperty(globalThis, 'navigator', originalGlobalNavDesc)
      }
      await act(async () => {
        root.unmount()
      })
      container.parentNode?.removeChild(container)
    }
  }

  // -------------------------------------------------------------------------
  // 6. Graphics Settings: Resolution Quality, Antialiasing, Fog, Dust, Lights & High Contrast
  // -------------------------------------------------------------------------
  {
    console.log(
      'Test 6: Graphics settings (Quality presets, Antialiasing, Fog, Dust, Chamber Lights, High-Contrast, 2D & 3D compatibility)'
    )

    const prevDevicePixelRatio = domEnv.window.devicePixelRatio
    domEnv.window.devicePixelRatio = 2
    domEnv.window.localStorage.clear()
    domEnv.window.location.href = 'http://localhost:3000/'

    const rendererCreations = []
    let failNextAntialiasCreate = false
    let currentRenderer = null

    const createTrackedRenderer = (opts = {}) => {
      if (failNextAntialiasCreate && opts.antialias) {
        failNextAntialiasCreate = false
        throw new Error('Simulated MSAA context creation failure')
      }
      const tracked = {
        opts: { ...opts },
        domElement: domEnv.document.createElement('canvas'),
        outputColorSpace: null,
        toneMapping: null,
        toneMappingExposure: 1,
        pixelRatio: 1,
        disposed: false,
        setPixelRatio(r) {
          this.pixelRatio = r
        },
        setSize() {},
        render() {},
        dispose() {
          this.disposed = true
        },
        getContext: () => ({
          getContextAttributes: () => ({ antialias: Boolean(opts.antialias) }),
        }),
      }
      rendererCreations.push(tracked)
      currentRenderer = tracked
      return tracked
    }

    let activeEngine = null
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    const findButton = (text) =>
      container.querySelectorAll('button').find((b) => b.textContent.trim() === text)

    const findSwitchByLabel = (labelText) => {
      const switches = container.querySelectorAll('[role="switch"]')
      return switches.find((sw) => {
        const labelledBy = sw.getAttribute('aria-labelledby')
        const labelEl = labelledBy ? container.querySelector(`#${labelledBy}`) : null
        return labelEl?.textContent?.trim() === labelText
      })
    }

    const openGraphicsTab = async () => {
      await openPauseAndSettings(container)
      const graphicsTab = container
        .querySelectorAll('[role="tab"]')
        .find((t) => t.textContent.includes('Graphics'))
      assert.ok(graphicsTab, 'Graphics tab button present')
      await clickElement(graphicsTab)
    }

    const closeSettingsModal = async () => {
      await closeSettingsAndResume(container)
    }

    try {
      await act(async () => {
        root.render(
          createElement(App, {
            viewportEngineConfig: {
              isSoftwareGl: false,
              createRenderer: createTrackedRenderer,
            },
            onViewportReady: (ctx) => {
              activeEngine = ctx.engine
            },
          })
        )
      })

      const deadline = Date.now() + 3000
      while (!activeEngine && Date.now() < deadline) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 25))
        })
      }
      assert.ok(activeEngine, 'MazeSceneEngine mounted immediately in 3D mode')

      // 6a. High-Contrast toggle updates GameShell data attribute & persists cleanly
      const shellEl = container.querySelector('.game-shell')
      assert.ok(shellEl, 'GameShell rendered')
      assert.equal(shellEl.getAttribute('data-high-contrast'), 'false')

      await openGraphicsTab()
      const hcSwitchInit = findSwitchByLabel('High-Contrast Wall Outlines')
      assert.ok(hcSwitchInit, 'High-Contrast toggle present in Graphics tab')
      await clickElement(hcSwitchInit)
      assert.equal(
        container.querySelector('.game-shell')?.getAttribute('data-high-contrast'),
        'true',
        'Enabling High-Contrast applies data-high-contrast="true" immediately'
      )

      await clickElement(findSwitchByLabel('High-Contrast Wall Outlines'))
      assert.equal(
        container.querySelector('.game-shell')?.getAttribute('data-high-contrast'),
        'false'
      )
      const persistedAfterHcRaw = domEnv.window.localStorage.getItem('maze-escape:settings:v1')
      assert.ok(persistedAfterHcRaw, 'Graphics settings change persists to maze-escape:settings:v1')
      const persistedAfterHc = JSON.parse(persistedAfterHcRaw)
      assert.equal(
        persistedAfterHc.graphics?.highContrast,
        false,
        'Graphics highContrast persisted accurately in unified settings storage'
      )
      await closeSettingsModal()
      const engineBeforeGraphicsChanges = activeEngine
      const mazeGroupBefore = activeEngine.getMazeGroup()
      activeEngine.cameraRig.setLookDirection(1.23, -0.15)

      // 6b. Default High quality baseline (2.0x DPR, antialias true, fog active, 110 dust, chamber + enemy lights)
      assert.equal(currentRenderer.pixelRatio, 2, 'High quality renders at 2.0x pixelRatio on HiDPI screen')
      assert.equal(currentRenderer.opts.antialias, true, 'Default High preset initializes antialias: true')
      assert.ok(activeEngine.scene.fog, 'Volumetric Vault Fog enabled by default')
      assert.ok(activeEngine.getEnvironment().details.dustPoints, 'Dust particles enabled by default')
      assert.equal(
        activeEngine.getEnvironment().details.dustPoints.geometry.getAttribute('position').count,
        110,
        'High preset uses 110 dust particles'
      )
      assert.ok(activeEngine.getEnvironment().lights.startLight.intensity > 0, 'Start light enabled by default')
      assert.ok(activeEngine.getEnvironment().lights.exitLight.intensity > 0, 'Exit light enabled by default')
      const highEnemyLights = activeEngine
        .getEnemies()
        .filter((e) => Boolean(e.mesh?.userData?.rig?.sensorLight)).length
      assert.ok(
        highEnemyLights >= 1 && highEnemyLights <= 2,
        `High preset allows up to 2 enemy ocular lights (got ${highEnemyLights})`
      )

      // 6c. Resolution Quality: Performance (1.0x) and Balanced (1.5x)
      await openGraphicsTab()
      await clickElement(findButton('Performance (1.0x)'))
      assert.equal(
        currentRenderer.pixelRatio,
        1,
        'Performance preset immediately caps rendering pixelRatio to 1.0'
      )
      assert.equal(
        activeEngine.getEnvironment().details.dustPoints.geometry.getAttribute('position').count,
        36,
        'Performance preset immediately lowers dust particle count to 36'
      )
      assert.equal(
        activeEngine.getEnemies().filter((e) => Boolean(e.mesh?.userData?.rig?.sensorLight)).length,
        0,
        'Performance preset immediately disables enemy ocular PointLights to reduce workload'
      )

      await clickElement(findButton('Balanced (1.5x)'))
      assert.equal(
        currentRenderer.pixelRatio,
        1.5,
        'Balanced preset immediately adjusts rendering pixelRatio to 1.5'
      )
      assert.equal(
        activeEngine.getEnvironment().details.dustPoints.geometry.getAttribute('position').count,
        72,
        'Balanced preset uses 72 dust particles'
      )
      assert.ok(
        activeEngine.getEnemies().filter((e) => Boolean(e.mesh?.userData?.rig?.sensorLight)).length <= 1,
        'Balanced preset caps enemy ocular PointLights to <= 1'
      )

      await clickElement(findButton('High (2.0x)'))
      assert.equal(currentRenderer.pixelRatio, 2, 'Switching back to High restores 2.0x pixelRatio')

      // 6d. Antialiasing toggle + graceful fallback on unsupported/failing context
      const countBeforeAA = rendererCreations.length
      await clickElement(findSwitchByLabel('Edge Smoothing (Antialiasing)'))
      assert.equal(rendererCreations.length, countBeforeAA + 1, 'Toggling Antialiasing swaps WebGLRenderer cleanly')
      assert.equal(currentRenderer.opts.antialias, false, 'Renderer recreated with antialias: false')
      assert.equal(rendererCreations[countBeforeAA - 1].disposed, true, 'Previous renderer disposed cleanly')
      assert.equal(activeEngine, engineBeforeGraphicsChanges, 'Toggling Antialiasing preserves MazeSceneEngine instance')
      assert.equal(activeEngine.getMazeGroup(), mazeGroupBefore, 'Toggling Antialiasing does not rebuild maze geometry')
      assert.ok(
        Math.abs(activeEngine.cameraRig.getLookDirection().yaw - 1.23) < 1e-6,
        'Toggling Antialiasing preserves camera yaw/orientation without restarting game'
      )

      // Simulate MSAA failure when turning Antialiasing back ON -> engine stays alive with previous renderer
      const fallbackRendererBefore = currentRenderer
      failNextAntialiasCreate = true
      await clickElement(findSwitchByLabel('Edge Smoothing (Antialiasing)'))
      assert.equal(
        activeEngine.renderer,
        fallbackRendererBefore,
        'Gracefully retains active renderer when antialiasing context fails'
      )
      assert.equal(
        activeEngine.getRendererCapabilities().antialiasSupported,
        false,
        'Reports antialiasSupported: false when hardware/browser rejects MSAA'
      )

      // 6e. Volumetric Vault Fog toggle (stays disabled even after HorrorDirector step)
      await clickElement(findSwitchByLabel('Volumetric Vault Fog'))
      assert.equal(activeEngine.scene.fog, null, 'Disabling Volumetric Vault Fog removes scene.fog immediately')
      await clickElement(findSwitchByLabel('Volumetric Vault Fog'))
      assert.ok(activeEngine.scene.fog, 'Re-enabling Volumetric Vault Fog restores scene.fog immediately')
      await clickElement(findSwitchByLabel('Volumetric Vault Fog'))

      // 6f. Floating Dust Motes toggle
      await clickElement(findSwitchByLabel('Floating Dust Motes'))
      assert.equal(
        activeEngine.getEnvironment().details.dustPoints,
        null,
        'Disabling Dust Particles removes maze-env-dust points immediately'
      )
      await clickElement(findSwitchByLabel('Floating Dust Motes'))
      assert.ok(
        activeEngine.getEnvironment().details.dustPoints,
        'Re-enabling Dust Particles restores maze-env-dust points immediately'
      )

      // 6g. Localized Chamber Lights toggle (controls start/exit PointLights AND enemy sensorLights)
      await clickElement(findSwitchByLabel('Localized Chamber Lights'))
      assert.equal(activeEngine.getEnvironment().lights.startLight.intensity, 0, 'Start light extinguished')
      assert.equal(activeEngine.getEnvironment().lights.startLight.visible, false, 'Start light hidden')
      assert.equal(activeEngine.getEnvironment().lights.exitLight.intensity, 0, 'Exit light extinguished')
      assert.equal(activeEngine.getEnvironment().lights.exitLight.visible, false, 'Exit light hidden')
      assert.equal(
        activeEngine.getEnemies().filter((e) => Boolean(e.mesh?.userData?.rig?.sensorLight)).length,
        0,
        'Enemy ocular PointLights disabled when Localized Chamber Lights are off'
      )

      // Verify HorrorDirector step keeps fog off and localized lights off when user disabled them
      await closeSettingsModal()
      activeEngine.horrorDirector.update(0.05, {
        playerWorldPos: activeEngine.getPlayerWorldPosition(),
        playerGridCell: activeEngine.getPlayerGridCell(),
        elapsedTime: 10,
        enemies: [],
      })
      activeEngine.horrorDirector.triggerEvent('light_flicker', {
        playerWorldPos: activeEngine.getPlayerWorldPosition(),
        elapsedTime: 11,
      })
      activeEngine.horrorDirector.update(2.0, {
        playerWorldPos: activeEngine.getPlayerWorldPosition(),
        playerGridCell: activeEngine.getPlayerGridCell(),
        elapsedTime: 13,
        enemies: [],
      })
      assert.equal(activeEngine.scene.fog, null, 'HorrorDirector does not re-enable disabled fog')
      assert.equal(
        activeEngine.getEnvironment().lights.startLight.intensity,
        0,
        'HorrorDirector light_flicker does not re-illuminate disabled localized lights'
      )

      // Re-enable Localized Chamber Lights and verify lights & enemy sensor lights come back
      await openGraphicsTab()
      await clickElement(findSwitchByLabel('Localized Chamber Lights'))
      assert.ok(activeEngine.getEnvironment().lights.startLight.intensity > 0, 'Start light restored')
      assert.ok(activeEngine.getEnvironment().lights.exitLight.intensity > 0, 'Exit light restored')
      assert.ok(
        activeEngine.getEnemies().filter((e) => Boolean(e.mesh?.userData?.rig?.sensorLight)).length >= 1,
        'Enemy ocular lights restored when Localized Chamber Lights re-enabled'
      )

      // 6h. High-Contrast Outlines (walls, start/exit, collectible items, keycards, hiding spots, hazards, enemies)
      await clickElement(findSwitchByLabel('High-Contrast Wall Outlines'))
      assert.equal(
        container.querySelector('.game-shell')?.getAttribute('data-high-contrast'),
        'true',
        'High-Contrast toggle updates data-high-contrast="true" in 3D mode'
      )
      assert.ok(
        activeEngine.getMazeGroup().getObjectByName('maze-walls-outline')?.visible,
        'Maze wall high-contrast outline added and visible'
      )
      assert.ok(
        activeEngine.getExitGateGroup()?.userData?.highContrastOutline?.visible,
        'Exit gate high-contrast outline added and visible'
      )
      const itemsIter = Array.from(activeEngine.getCollectibleManager().items.values())
      assert.ok(itemsIter.length > 0, 'Collectible items present for high-contrast outline verification')
      for (const entry of itemsIter) {
        assert.ok(entry.mesh.userData.highContrastOutline?.visible, `Collectible (${entry.type}) has visible high-contrast outline`)
      }
      for (const entry of activeEngine.getCollectibleManager().keycards.values()) {
        assert.ok(entry.mesh.userData.highContrastOutline?.visible, 'Keycard has visible high-contrast outline')
        break
      }
      for (const hazard of activeEngine.getHazardManager().getHazards()) {
        assert.ok(hazard.getMesh().userData.highContrastOutline?.visible, 'Hazard has visible high-contrast outline')
        break
      }
      for (const spot of activeEngine.getHidingSpotManager().getHidingSpots()) {
        assert.ok(spot.getMesh().userData.highContrastOutline?.visible, 'Hiding spot has visible high-contrast outline')
        break
      }
      for (const enemy of activeEngine.getEnemies()) {
        assert.ok(enemy.getMesh().userData.highContrastOutline?.visible, 'Enemy has visible high-contrast outline')
        break
      }

      // Disabling High-Contrast hides 3D outlines without leaking or restarting
      await clickElement(findSwitchByLabel('High-Contrast Wall Outlines'))
      assert.equal(
        activeEngine.getMazeGroup().getObjectByName('maze-walls-outline')?.visible,
        false,
        'Maze wall outline hidden when High-Contrast disabled'
      )
      for (const enemy of activeEngine.getEnemies()) {
        assert.equal(
          enemy.getMesh().userData.highContrastOutline?.visible,
          false,
          'Enemy outline hidden when High-Contrast disabled'
        )
        break
      }

      await closeSettingsModal()
      assert.equal(activeEngine, engineBeforeGraphicsChanges, 'No engine restart across all Graphics setting updates')
      assert.equal(activeEngine.getMazeGroup(), mazeGroupBefore, 'No maze rebuild across all Graphics setting updates')

      console.log('✓ Graphics Settings end-to-end 2D/3D integration verified')
    } finally {
      domEnv.document.pointerLockElement = null
      domEnv.window.devicePixelRatio = prevDevicePixelRatio
      await act(async () => {
        root.unmount()
      })
      container.parentNode?.removeChild(container)
    }
  }

  // -------------------------------------------------------------------------
  // 7. Phase 6: Persistent Settings Storage, Gameplay Settings, Normalization & Restore Defaults
  // -------------------------------------------------------------------------
  {
    console.log(
      'Test 7: Phase 6 persistent settings storage across reloads, all 4 categories, corrupted/outdated recovery, and Restore Defaults'
    )

    const {
      STORAGE_KEYS,
      getDefaultAllSettings,
      loadAllSettings,
    } = await viteServer.ssrLoadModule('/src/utils/persistence.js')

    // 7a. Persistence unit tests: missing, corrupted, invalid types, outdated schema, and read-only init
    {
      const mem = new Map()
      const trackedWrites = []
      const trackedStorage = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => {
          trackedWrites.push({ key: k, value: String(v) })
          mem.set(k, String(v))
        },
        removeItem: (k) => {
          mem.delete(k)
        },
      }

      // Missing storage -> returns defaults without writing
      const missingLoaded = loadAllSettings(trackedStorage)
      assert.deepEqual(missingLoaded, getDefaultAllSettings())
      assert.equal(trackedWrites.length, 0, 'loadAllSettings must not write when storage is empty')

      // Corrupted JSON -> safely returns defaults without overwriting corrupted key
      mem.set(STORAGE_KEYS.SETTINGS, '{not-valid-json')
      const corruptLoaded = loadAllSettings(trackedStorage)
      assert.deepEqual(corruptLoaded, getDefaultAllSettings())
      assert.equal(trackedWrites.length, 0, 'loadAllSettings must not overwrite storage on corrupt read')

      // Primitive / Array root -> safely falls back to defaults
      mem.set(STORAGE_KEYS.SETTINGS, '[1, 2, 3]')
      assert.deepEqual(loadAllSettings(trackedStorage), getDefaultAllSettings())

      // Partial/invalid fields -> clamps/falls back invalid values while preserving valid fields
      mem.set(
        STORAGE_KEYS.SETTINGS,
        JSON.stringify({
          version: 1, // outdated schema version
          deprecatedKey: 'ignore-me',
          audio: {
            master: 0.45,
            ambience: null,
            effects: 99,
            music: 'bad',
            muted: true,
            spatialAudio: 'yes',
            footstepEchoes: false,
          },
          controls: {
            mouseSensitivity: -2,
            touchLookSensitivity: 2.4,
            invertY: true,
            touchControls: 'gamepad-invalid',
            touchHaptics: false,
          },
          graphics: {
            qualityPreset: 'ultra-fake',
            antialias: false,
            volumetricFog: 'nope',
            particlesEnabled: false,
            dynamicLights: false,
            highContrast: true,
          },
          gameplay: {
            cameraMode: 'third-person',
            fieldOfView: 80,
            cameraShake: false,
            scareIntensity: 'extreme',
            visualScaresEnabled: false,
            reducedMotion: true,
            wayfinderGuide: false,
          },
        })
      )

      const normalized = loadAllSettings(trackedStorage)
      assert.equal(normalized.version, 2)
      assert.equal(normalized.audio.master, 0.45)
      assert.equal(normalized.audio.ambience, 0.55, 'null ambience falls back to default 0.55')
      assert.equal(normalized.audio.effects, 1, 'Out-of-range effects clamped to 1')
      assert.equal(normalized.audio.music, 0.6, 'Invalid string music falls back to default')
      assert.equal(normalized.audio.muted, true)
      assert.equal(normalized.audio.spatialAudio, true, 'Invalid spatialAudio falls back to default')
      assert.equal(normalized.audio.footstepEchoes, false)

      assert.equal(normalized.controls.mouseSensitivity, 0.0005, 'Negative mouseSensitivity clamped safely')
      assert.equal(normalized.controls.touchLookSensitivity, 2.4)
      assert.equal(normalized.controls.invertY, true)
      assert.equal(normalized.controls.touchControls, 'auto', 'Invalid touchControls falls back to auto')
      assert.equal(normalized.controls.touchHaptics, false)

      assert.equal(normalized.graphics.qualityPreset, 'high', 'Invalid preset falls back to high')
      assert.equal(normalized.graphics.antialias, false)
      assert.equal(normalized.graphics.volumetricFog, true, 'Invalid volumetricFog falls back to true')
      assert.equal(normalized.graphics.particlesEnabled, false)
      assert.equal(normalized.graphics.dynamicLights, false)
      assert.equal(normalized.graphics.highContrast, true)

      assert.equal(normalized.gameplay.cameraMode, 'third-person')
      assert.equal(normalized.gameplay.thirdPersonCameraMode, 'character-follow')
      assert.equal(normalized.gameplay.fieldOfView, 80)
      assert.equal(normalized.gameplay.cameraShake, false)
      assert.equal(normalized.gameplay.scareIntensity, 'medium', 'Invalid scareIntensity falls back to medium')
      assert.equal(normalized.gameplay.visualScaresEnabled, false)
      assert.equal(normalized.gameplay.reducedMotion, true)
      assert.equal(normalized.gameplay.wayfinderGuide, false)
      assert.equal('deprecatedKey' in normalized, false, 'Unknown outdated keys stripped cleanly')
      assert.equal(trackedWrites.length, 0, 'Migration read does not mutate storage before user save')

      // Legacy PREFERENCES migration when SETTINGS is missing
      mem.clear()
      mem.set(
        STORAGE_KEYS.PREFERENCES,
        JSON.stringify({
          audioVolumes: { master: 0.3, ambience: 0.4, effects: 0.5, music: 0.2, muted: true },
          cameraMode: 'third-person',
          horrorConfig: { intensity: 'high', visualScaresEnabled: false, reducedMotion: true },
          controlSettings: {
            mouseSensitivity: 0.0033,
            touchLookSensitivity: 2.2,
            invertY: true,
            touchControls: 'always',
          },
        })
      )
      const migrated = loadAllSettings(trackedStorage)
      assert.equal(migrated.audio.master, 0.3)
      assert.equal(migrated.audio.muted, true)
      assert.equal(migrated.gameplay.cameraMode, 'third-person')
      assert.equal(migrated.gameplay.scareIntensity, 'high')
      assert.equal(migrated.controls.touchControls, 'always')
      assert.equal(trackedWrites.length, 0)
    }

    // 7b. End-to-end App reload persistence, pre-gameplay engine sync, and Restore Defaults with confirmation
    const prevDevicePixelRatio = domEnv.window.devicePixelRatio
    domEnv.window.devicePixelRatio = 2
    domEnv.window.localStorage.clear()
    domEnv.window.location.href = 'http://localhost:3000/'

    // Store unrelated saved data first -> must remain completely untouched by settings & Restore Defaults
    const UNRELATED_STORAGE_KEY = 'maze-escape:unrelated-save-data'
    const initialUnrelatedJson = JSON.stringify({ progress: 42 })
    domEnv.window.localStorage.setItem(UNRELATED_STORAGE_KEY, initialUnrelatedJson)

    const makeTrackedRenderer = () => {
      let antialiasState = true
      return (opts = {}) => {
        antialiasState = Boolean(opts.antialias)
        return {
          opts: { ...opts },
          domElement: domEnv.document.createElement('canvas'),
          outputColorSpace: null,
          toneMapping: null,
          toneMappingExposure: 1,
          pixelRatio: 1,
          setPixelRatio(r) {
            this.pixelRatio = r
          },
          setSize() {},
          render() {},
          dispose() {},
          getContext: () => ({
            getContextAttributes: () => ({ antialias: antialiasState }),
          }),
        }
      }
    }

    const mountConfiguredApp = async () => {
      let engine = null
      const container = domEnv.document.createElement('div')
      domEnv.document.body.appendChild(container)
      const root = createRoot(container)
      await act(async () => {
        root.render(
          createElement(App, {
            viewportEngineConfig: {
              isSoftwareGl: false,
              createRenderer: makeTrackedRenderer(),
            },
            onViewportReady: (ctx) => {
              engine = ctx.engine
            },
          })
        )
      })
      return {
        container,
        root,
        getEngine: () => engine,
      }
    }

    const findButton = (container, text) =>
      container.querySelectorAll('button').find((b) => b.textContent.trim() === text)

    const findSwitchByLabel = (container, labelText) => {
      const switches = container.querySelectorAll('[role="switch"]')
      return switches.find((sw) => {
        const labelledBy = sw.getAttribute('aria-labelledby')
        const labelEl = labelledBy ? container.querySelector(`#${labelledBy}`) : null
        return labelEl?.textContent?.trim() === labelText
      })
    }

    const setSliderIn = async (container, ariaLabel, nextValue) => {
      const slider = container.querySelector(`input[aria-label="${ariaLabel}"]`)
      assert.ok(slider, `Slider "${ariaLabel}" found`)
      const desc = Object.getOwnPropertyDescriptor(
        domEnv.HTMLInputElement.prototype,
        'value'
      )
      desc?.set?.call(slider, String(nextValue))
      await act(async () => {
        slider.dispatchEvent({ type: 'input', bubbles: true })
        slider.dispatchEvent({ type: 'change', bubbles: true })
      })
    }

    const openTab = async (container, tabLabelPart) => {
      await openPauseAndSettings(container)
      const tab = container
        .querySelectorAll('[role="tab"]')
        .find((t) => t.textContent.includes(tabLabelPart))
      assert.ok(tab, `Tab "${tabLabelPart}" found`)
      await clickElement(tab)
    }

    // Session 1: Modify every setting across all 4 categories
    const session1 = await mountConfiguredApp()
    try {
      // Verify initialization did NOT write to localStorage when untouched
      assert.equal(
        domEnv.window.localStorage.getItem(STORAGE_KEYS.SETTINGS),
        null,
        'Initial mount with empty storage does not write default settings prematurely'
      )

      // Audio tab
      await openTab(session1.container, 'Audio')
      await setSliderIn(session1.container, 'Master Volume slider', 40)
      await setSliderIn(session1.container, 'Ambience & Drones slider', 25)
      await setSliderIn(session1.container, 'Sound Effects (SFX) slider', 70)
      await setSliderIn(session1.container, 'Music & Tension Stems slider', 35)
      await clickElement(findSwitchByLabel(session1.container, 'Mute All Audio'))
      await clickElement(findSwitchByLabel(session1.container, '3D Spatial Audio'))
      await clickElement(findSwitchByLabel(session1.container, 'Acoustic Corridor Reverb'))

      // Mouse & Controls tab
      await openTab(session1.container, 'Mouse & Controls')
      await setSliderIn(session1.container, 'Mouse Sensitivity slider', 150)
      await clickElement(findSwitchByLabel(session1.container, 'Invert Y-Axis'))
      await setSliderIn(session1.container, 'Touch Look Sensitivity slider', 240)
      await clickElement(findButton(session1.container, 'Always Visible'))
      await clickElement(findSwitchByLabel(session1.container, 'Haptic Feedback'))

      // Rebind Cycle Camera Distance: verify Escape cancels without closing Settings, reserved key W & fixed C rejected, custom G saved
      const rebindBtn = session1.container.querySelector('[data-keybind-action="cycleCameraDistance"]')
      assert.ok(rebindBtn, 'Customizable Cycle Camera Distance keybind button rendered')
      assert.equal(rebindBtn.textContent.trim(), 'V', 'Cycle Camera Distance defaults to V')

      await clickElement(rebindBtn)
      assert.equal(rebindBtn.getAttribute('data-keybind-listening'), 'true')
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'Escape' })
      })
      assert.ok(
        session1.container.querySelector('.lv-modal--settings'),
        'Pressing Escape during key capture cancels rebind without closing Settings modal'
      )
      assert.equal(
        session1.container.querySelector('[data-keybind-action="cycleCameraDistance"]')?.textContent?.trim(),
        'V'
      )

      await clickElement(session1.container.querySelector('[data-keybind-action="cycleCameraDistance"]'))
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'w' })
      })
      assert.ok(
        session1.container.querySelector('.lv-keybind-feedback'),
        'Reserved movement key rejected with feedback alert'
      )
      assert.equal(
        session1.container.querySelector('[data-keybind-action="cycleCameraDistance"]')?.getAttribute('data-keybind-listening'),
        'true',
        'Listening remains active after reserved key rejection'
      )
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'c' })
      })
      assert.ok(
        session1.container.querySelector('.lv-keybind-feedback')?.textContent?.includes('reserved'),
        'Fixed C camera toggle key rejected from rebinding'
      )
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'g' })
      })
      assert.equal(
        session1.container.querySelector('[data-keybind-action="cycleCameraDistance"]')?.textContent?.trim(),
        'G',
        'Cycle Camera Distance rebound to G'
      )

      // Graphics tab
      await openTab(session1.container, 'Graphics')
      await clickElement(findButton(session1.container, 'Balanced (1.5x)'))
      await clickElement(findSwitchByLabel(session1.container, 'Edge Smoothing (Antialiasing)'))
      await clickElement(findSwitchByLabel(session1.container, 'Volumetric Vault Fog'))
      await clickElement(findSwitchByLabel(session1.container, 'Floating Dust Motes'))
      await clickElement(findSwitchByLabel(session1.container, 'Localized Chamber Lights'))
      await clickElement(findSwitchByLabel(session1.container, 'High-Contrast Wall Outlines'))

      // Gameplay tab (no Default 3D Camera switch in Settings; Free Look still configurable)
      await openTab(session1.container, 'Gameplay')
      assert.equal(
        session1.container.querySelector('[aria-label="Default 3D Camera"]'),
        null,
        'Default 3D Camera control absent from Gameplay Settings'
      )
      assert.ok(
        findButton(session1.container, 'Character Follow') &&
          findButton(session1.container, 'Free Look'),
        'Third-Person Camera Mode options rendered inside Gameplay settings'
      )
      await clickElement(findButton(session1.container, 'Free Look'))
      await setSliderIn(session1.container, 'Field of View (FOV) slider', 80)
      await clickElement(findSwitchByLabel(session1.container, 'Camera Shake & Sway'))
      await clickElement(findButton(session1.container, 'High'))
      await clickElement(findSwitchByLabel(session1.container, 'Visual Scares & Anomalies'))
      await clickElement(findSwitchByLabel(session1.container, 'Reduced Motion'))
      await clickElement(findSwitchByLabel(session1.container, 'Wayfinder Objective Compass'))

      await closeSettingsAndResume(session1.container)

      // Toggle Third-Person via keyboard key C during active gameplay
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'c', repeat: false })
      })
      assert.equal(
        session1.container.querySelector('.maze-viewport-3d')?.getAttribute('data-camera-mode'),
        'third-person',
        'Pressing C during active gameplay switches camera to Third-Person'
      )
    } finally {
      await act(async () => {
        session1.root.unmount()
      })
      session1.container.parentNode?.removeChild(session1.container)
    }

    // Spy on localStorage.setItem to ensure Session 2 initialization does NOT overwrite valid saved settings
    const origSetItem = domEnv.window.localStorage.setItem.bind(domEnv.window.localStorage)
    let initWriteCount = 0
    domEnv.window.localStorage.setItem = (k, v) => {
      initWriteCount += 1
      return origSetItem(k, v)
    }

    // Also navigate directly to ?view=3d (simulating reloading in 3D mode) to verify pre-gameplay engine application
    domEnv.window.location.href = 'http://localhost:3000/?view=3d'
    const session2 = await mountConfiguredApp()
    try {
      const deadline = Date.now() + 3000
      while (!session2.getEngine() && Date.now() < deadline) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 25))
        })
      }
      domEnv.window.localStorage.setItem = origSetItem
      assert.equal(initWriteCount, 0, 'Session 2 initialization does NOT overwrite saved localStorage preferences')

      const restoredEngine = session2.getEngine()
      assert.ok(restoredEngine, '3D engine initialized with restored preferences')

      // Verify restored settings were applied to GameShell & 3D engines BEFORE gameplay begins
      const shell = session2.container.querySelector('.game-shell')
      assert.equal(shell.getAttribute('data-reduced-motion'), 'true', 'Restored reducedMotion applied to GameShell')
      assert.equal(shell.getAttribute('data-high-contrast'), 'true', 'Restored highContrast applied to GameShell')

      // Audio engine restored
      const audioVol = restoredEngine.getAudioVolumes()
      assert.equal(audioVol.master, 0.4)
      assert.equal(audioVol.ambience, 0.25)
      assert.equal(audioVol.effects, 0.7)
      assert.equal(audioVol.music, 0.35)
      assert.equal(audioVol.muted, true)
      const audioOpts = restoredEngine.getAudioOptions()
      assert.equal(audioOpts.spatialAudio, false)
      assert.equal(audioOpts.footstepEchoes, false)

      // Controls & Third-person mode restored
      const camCfg = restoredEngine.getCameraRig().getConfig()
      assert.equal(camCfg.mode, 'third-person', 'Restored defaultCamera applied before gameplay')
      assert.equal(
        restoredEngine.getThirdPersonCameraMode(),
        'free-look',
        'Restored Third-Person Camera Mode (Free Look) applied before gameplay'
      )
      assert.equal(camCfg.sensitivity, 0.0033, 'Restored mouseSensitivity applied before gameplay')
      assert.equal(camCfg.invertY, true, 'Restored invertY applied before gameplay')
      const touchRoot = session2.container.querySelector('[data-touch-controls-root="true"]')
      assert.equal(touchRoot?.getAttribute('data-touch-mode'), 'always', 'Restored Touch D-Pad mode applied')

      // Graphics restored
      const gfx = restoredEngine.getGraphicsConfig()
      assert.equal(gfx.qualityPreset, 'balanced')
      assert.equal(gfx.antialias, false)
      assert.equal(gfx.volumetricFog, false)
      assert.equal(gfx.particlesEnabled, false)
      assert.equal(gfx.dynamicLights, false)
      assert.equal(gfx.highContrast, true)
      assert.equal(restoredEngine.renderer.pixelRatio, 1.5, 'Balanced preset pixelRatio applied before gameplay')
      assert.equal(restoredEngine.scene.fog, null, 'Disabled fog applied before gameplay')
      assert.equal(restoredEngine.getEnvironment().details.dustPoints, null, 'Disabled dust applied before gameplay')
      assert.equal(restoredEngine.getEnvironment().lights.startLight.intensity, 0, 'Disabled lights applied before gameplay')
      assert.ok(
        restoredEngine.getMazeGroup().getObjectByName('maze-walls-outline')?.visible,
        'Restored High-Contrast outlines applied before gameplay'
      )

      // Gameplay restored (FOV, Camera Shake, Horror Director, Wayfinder)
      assert.equal(restoredEngine.camera.fov, 80, 'Restored FOV applied to PerspectiveCamera before gameplay')
      assert.equal(restoredEngine.cameraShakeEnabled, false, 'Restored cameraShake=false applied before gameplay')
      const horrorCfg = restoredEngine.getHorrorConfig()
      assert.equal(horrorCfg.intensity, 'high')
      assert.equal(horrorCfg.visualScaresEnabled, false)
      assert.equal(horrorCfg.reducedMotion, true)

      assert.equal(
        session2.container.querySelector('.maze-minimap__bar'),
        null,
        'Viewport Map/Hint button bar removed in Phase 1'
      )
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'h', repeat: false })
      })
      assert.equal(
        session2.container.querySelector('[data-wayfinder-hint]'),
        null,
        'Pressing H does not trigger Wayfinder hint when disabled in restored Gameplay settings'
      )
      assert.ok(
        session2.container.querySelector('.maze-minimap')?.querySelector('.maze-minimap__canvas'),
        'Permanent minimap is visible by default in restored session without pressing M'
      )
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'm', repeat: false })
      })
      assert.ok(
        session2.container.querySelector('.maze-minimap')?.querySelector('.maze-minimap__canvas'),
        'Pressing M does not hide or toggle the permanently visible minimap'
      )

      // Custom Cycle Camera Distance binding (G) works, old default V no longer cycles, and C toggles camera mode cleanly
      assert.equal(restoredEngine.getCameraDistancePreset(), 'medium')
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'v', repeat: false })
      })
      assert.equal(
        restoredEngine.getCameraDistancePreset(),
        'medium',
        'Old default key V no longer triggers cycle after rebinding to G'
      )
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'g', repeat: false })
      })
      assert.equal(
        restoredEngine.getCameraDistancePreset(),
        'far',
        'Restored custom key G cycles camera distance from medium to far'
      )
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'g', repeat: false })
      })
      assert.equal(
        restoredEngine.getCameraDistancePreset(),
        'close',
        'Restored custom key G cycles camera distance from far to close'
      )

      // Pressing C toggles First-Person <-> Third-Person in restored gameplay while preserving Close distance
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'c', repeat: false })
      })
      assert.equal(restoredEngine.getCameraMode(), 'first-person', 'Pressing C toggles Third-Person -> First-Person')
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'c', repeat: false })
      })
      assert.equal(restoredEngine.getCameraMode(), 'third-person', 'Pressing C again toggles First-Person -> Third-Person')
      assert.equal(restoredEngine.getCameraDistancePreset(), 'close', 'Close distance preserved across C toggles')

      // Verify every Settings UI control reflects restored values
      await openTab(session2.container, 'Audio')
      assert.equal(session2.container.querySelector('input[aria-label="Master Volume slider"]').value, '40')
      assert.equal(session2.container.querySelector('input[aria-label="Ambience & Drones slider"]').value, '25')
      assert.equal(session2.container.querySelector('input[aria-label="Sound Effects (SFX) slider"]').value, '70')
      assert.equal(session2.container.querySelector('input[aria-label="Music & Tension Stems slider"]').value, '35')
      assert.equal(findSwitchByLabel(session2.container, 'Mute All Audio').getAttribute('aria-checked'), 'true')
      assert.equal(findSwitchByLabel(session2.container, '3D Spatial Audio').getAttribute('aria-checked'), 'false')
      assert.equal(findSwitchByLabel(session2.container, 'Acoustic Corridor Reverb').getAttribute('aria-checked'), 'false')

      await openTab(session2.container, 'Mouse & Controls')
      assert.equal(session2.container.querySelector('input[aria-label="Mouse Sensitivity slider"]').value, '150')
      assert.equal(findSwitchByLabel(session2.container, 'Invert Y-Axis').getAttribute('aria-checked'), 'true')
      assert.equal(session2.container.querySelector('input[aria-label="Touch Look Sensitivity slider"]').value, '240')
      assert.equal(findButton(session2.container, 'Always Visible').getAttribute('aria-pressed'), 'true')
      assert.equal(findSwitchByLabel(session2.container, 'Haptic Feedback').getAttribute('aria-checked'), 'false')
      assert.equal(
        session2.container.querySelector('[data-keybind-action="cycleCameraDistance"]')?.textContent?.trim(),
        'G',
        'Mouse & Controls UI displays persisted custom key G'
      )

      await openTab(session2.container, 'Graphics')
      assert.equal(findButton(session2.container, 'Balanced (1.5x)').getAttribute('aria-pressed'), 'true')
      assert.equal(findSwitchByLabel(session2.container, 'Edge Smoothing (Antialiasing)').getAttribute('aria-checked'), 'false')
      assert.equal(findSwitchByLabel(session2.container, 'Volumetric Vault Fog').getAttribute('aria-checked'), 'false')
      assert.equal(findSwitchByLabel(session2.container, 'Floating Dust Motes').getAttribute('aria-checked'), 'false')
      assert.equal(findSwitchByLabel(session2.container, 'Localized Chamber Lights').getAttribute('aria-checked'), 'false')
      assert.equal(findSwitchByLabel(session2.container, 'High-Contrast Wall Outlines').getAttribute('aria-checked'), 'true')

      await openTab(session2.container, 'Gameplay')
      assert.equal(session2.container.querySelector('[aria-label="Default 3D Camera"]'), null)
      assert.equal(findButton(session2.container, 'Free Look').getAttribute('aria-pressed'), 'true')
      assert.equal(findButton(session2.container, 'Character Follow').getAttribute('aria-pressed'), 'false')
      assert.equal(session2.container.querySelector('input[aria-label="Field of View (FOV) slider"]').value, '80')
      assert.equal(findSwitchByLabel(session2.container, 'Camera Shake & Sway').getAttribute('aria-checked'), 'false')
      assert.equal(findButton(session2.container, 'High').getAttribute('aria-pressed'), 'true')
      assert.equal(findSwitchByLabel(session2.container, 'Visual Scares & Anomalies').getAttribute('aria-checked'), 'false')
      assert.equal(findSwitchByLabel(session2.container, 'Reduced Motion').getAttribute('aria-checked'), 'true')
      assert.equal(findSwitchByLabel(session2.container, 'Wayfinder Objective Compass').getAttribute('aria-checked'), 'false')

      // Capture active maze ID & player position before seamless switching and Restore Defaults
      const activeMazeIdBeforeReset = session2.container
        .querySelector('.maze-viewport-3d')
        ?.getAttribute('data-maze-id')
      const playerPosBeforeSwitch = restoredEngine.getPlayerWorldPosition()

      // Switch seamlessly between Free Look and Character Follow via Settings UI
      await clickElement(findButton(session2.container, 'Character Follow'))
      assert.equal(
        restoredEngine.getThirdPersonCameraMode(),
        'character-follow',
        'UI selection updates engine to Character Follow mode'
      )
      assert.deepEqual(
        restoredEngine.getPlayerWorldPosition(),
        playerPosBeforeSwitch,
        'Switching third-person mode does not reset player position'
      )
      assert.equal(
        session2.container.querySelector('.maze-viewport-3d')?.getAttribute('data-maze-id'),
        activeMazeIdBeforeReset,
        'Switching third-person mode does not reset current maze'
      )
      await clickElement(findButton(session2.container, 'Free Look'))
      assert.equal(
        restoredEngine.getThirdPersonCameraMode(),
        'free-look',
        'UI selection updates engine back to Free Look mode seamlessly'
      )

      // Test Restore Defaults -> Cancel keeps everything untouched
      await clickElement(findButton(session2.container, 'Restore Defaults'))
      assert.ok(
        session2.container.querySelector('[role="alertdialog"]'),
        'Confirmation prompt appears before restoring defaults'
      )
      await clickElement(findButton(session2.container, 'Cancel'))
      assert.equal(
        session2.container.querySelector('input[aria-label="Field of View (FOV) slider"]').value,
        '80',
        'Canceling Restore Defaults preserves current settings'
      )
      assert.equal(restoredEngine.camera.fov, 80)

      // Test Restore Defaults -> Confirm resets all 4 categories, engines, storage, while keeping unrelated data & maze untouched
      await clickElement(findButton(session2.container, 'Restore Defaults'))
      await clickElement(findButton(session2.container, 'Confirm Restore'))

      // Gameplay UI & engine back to defaults
      assert.equal(session2.container.querySelector('[aria-label="Default 3D Camera"]'), null)
      assert.equal(restoredEngine.getCameraMode(), 'first-person')
      assert.equal(findButton(session2.container, 'Character Follow').getAttribute('aria-pressed'), 'true')
      assert.equal(restoredEngine.getThirdPersonCameraMode(), 'character-follow')
      assert.equal(session2.container.querySelector('input[aria-label="Field of View (FOV) slider"]').value, '65')
      assert.equal(findSwitchByLabel(session2.container, 'Camera Shake & Sway').getAttribute('aria-checked'), 'true')
      const intensityGroup = session2.container.querySelector('[aria-label="Horror Director Intensity"]')
      assert.equal(
        intensityGroup?.querySelectorAll('button').find((b) => b.textContent.trim() === 'Medium')?.getAttribute('aria-pressed'),
        'true'
      )
      assert.equal(findSwitchByLabel(session2.container, 'Visual Scares & Anomalies').getAttribute('aria-checked'), 'true')
      assert.equal(findSwitchByLabel(session2.container, 'Reduced Motion').getAttribute('aria-checked'), 'false')
      assert.equal(findSwitchByLabel(session2.container, 'Wayfinder Objective Compass').getAttribute('aria-checked'), 'true')

      assert.equal(restoredEngine.camera.fov, 65, 'Live camera FOV restored to 65°')
      assert.equal(restoredEngine.cameraShakeEnabled, true)
      assert.equal(restoredEngine.getAudioVolumes().muted, false)
      assert.equal(restoredEngine.getAudioOptions().spatialAudio, true)
      assert.equal(restoredEngine.getGraphicsConfig().highContrast, false)
      assert.equal(restoredEngine.getGraphicsConfig().qualityPreset, 'high')
      assert.equal(restoredEngine.getHorrorConfig().intensity, 'medium')

      assert.equal(
        domEnv.window.localStorage.getItem(UNRELATED_STORAGE_KEY),
        initialUnrelatedJson,
        'Restore Defaults does not touch unrelated saved storage data'
      )
      assert.equal(
        session2.container.querySelector('.maze-viewport-3d')?.getAttribute('data-maze-id'),
        activeMazeIdBeforeReset,
        'Restore Defaults does not reset current maze or run state'
      )

      // Confirm no Records tab, button, or control exists inside SettingsModal
      assert.equal(
        session2.container
          .querySelectorAll('[role="tab"], button')
          .find((el) => /record/i.test(el.textContent || '')) || null,
        null,
        'SettingsModal exposes no Records tab or control'
      )

      const resetStored = loadAllSettings(domEnv.window.localStorage)
      assert.deepEqual(resetStored, getDefaultAllSettings(), 'Storage holds clean normalized defaults after Restore Defaults')

      await clickElement(findButton(session2.container, 'Back'))

      console.log('✓ Phase 6 persistent settings storage, gameplay integration, corrupted recovery & Restore Defaults verified')
    } finally {
      domEnv.window.localStorage.setItem = origSetItem
      domEnv.window.devicePixelRatio = prevDevicePixelRatio
      domEnv.window.location.href = 'http://localhost:3000/'
      await act(async () => {
        session2.root.unmount()
      })
      session2.container.parentNode?.removeChild(session2.container)
    }
  }
} finally {
  await viteServer.close()
}

console.log('=== ALL SETTINGS MENU TESTS PASSED! ===')
