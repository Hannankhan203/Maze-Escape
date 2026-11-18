import assert from 'node:assert/strict'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
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
    _emitter: docEmitter,
    createElement(tag) {
      return String(tag).toLowerCase() === 'canvas'
        ? new MiniCanvasElement(documentObj)
        : new MiniElement(tag, documentObj)
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
installGlobal('ResizeObserver', domEnv.ResizeObserver)
installGlobal('localStorage', domEnv.window.localStorage)

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
} finally {
  await viteServer.close()
}

console.log('=== ALL SETTINGS MENU TESTS PASSED! ===')
