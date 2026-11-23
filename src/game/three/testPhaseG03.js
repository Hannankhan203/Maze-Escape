import assert from 'node:assert/strict'
import { StrictMode, act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

console.log('--- Running Phase G Prompt 03 React DOM Integration Tests ---')

/**
 * Lightweight self-contained DOM environment sufficient for React 19
 * createRoot/act, StrictMode, event bubbling, focus/Tab trapping, ResizeObserver,
 * pointer events, URL/history sync, and localStorage without external packages.
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

    // Handle :not([attr]) and :not([attr="val"])
    const notMatches = []
    sel = sel.replace(/:not\(([^)]+)\)/g, (_m, inner) => {
      notMatches.push(inner.trim())
      return ''
    })

    for (const negated of notMatches) {
      if (matchesSingleSelector(el, negated)) {
        return false
      }
    }

    // Extract [attr] / [attr="val"] / [attr*="val"]
    const attrFilters = []
    sel = sel.replace(/\[([^\]=*~|^$]+)(?:([*^$|~]?=)["']?([^"'\]]*)["']?)?\]/g, (_m, name, op, val) => {
      attrFilters.push({ name: name.trim(), op: op || null, val: val ?? '' })
      return ''
    })

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

    // Extract .class and #id and tagName
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
    get data() {
      return this.nodeValue
    }
    set data(v) {
      this.nodeValue = String(v ?? '')
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
      this._capturedPointers = new Set()
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
      this.dataset = new Proxy(
        {},
        {
          get(_target, prop) {
            const attrName = `data-${String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`
            return el.getAttribute(attrName) ?? undefined
          },
          set(_target, prop, value) {
            const attrName = `data-${String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`
            el.setAttribute(attrName, String(value))
            return true
          },
        }
      )
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

    get innerHTML() {
      return ''
    }
    set innerHTML(val) {
      while (this.childNodes.length > 0) {
        this.removeChild(this.childNodes[0])
      }
      if (val) {
        this.appendChild(this.ownerDocument.createTextNode(String(val)))
      }
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

    setPointerCapture(pointerId) {
      this._capturedPointers.add(pointerId)
    }
    releasePointerCapture(pointerId) {
      this._capturedPointers.delete(pointerId)
    }
    hasPointerCapture(pointerId) {
      return this._capturedPointers.has(pointerId)
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
      } else {
        const origStop = evt.stopPropagation.bind(evt)
        evt.stopPropagation = () => {
          propagationStopped = true
          origStop()
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

      // Capture phase: window -> document -> ancestors -> target
      if (win && !propagationStopped) {
        evt.currentTarget = win
        for (const fn of win._emitter.getListeners(evt.type, true)) {
          fn(evt)
        }
      }
      if (doc && !propagationStopped) {
        evt.currentTarget = doc
        for (const fn of doc._emitter.getListeners(evt.type, true)) {
          fn(evt)
        }
      }
      for (const node of path) {
        if (propagationStopped) break
        if (node._emitter) {
          evt.currentTarget = node
          for (const fn of node._emitter.getListeners(evt.type, true)) {
            fn(evt)
          }
        }
      }

      // Bubble phase: target -> ancestors -> document -> window
      for (let i = path.length - 1; i >= 0; i -= 1) {
        if (propagationStopped) break
        const node = path[i]
        if (node._emitter) {
          evt.currentTarget = node
          for (const fn of node._emitter.getListeners(evt.type, false)) {
            fn(evt)
          }
        }
      }
      if (evt.bubbles !== false && doc && !propagationStopped) {
        evt.currentTarget = doc
        for (const fn of doc._emitter.getListeners(evt.type, false)) {
          fn(evt)
        }
      }
      if (evt.bubbles !== false && win && !propagationStopped) {
        evt.currentTarget = win
        for (const fn of win._emitter.getListeners(evt.type, false)) {
          fn(evt)
        }
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
      return String(tag).toLowerCase() === 'canvas'
        ? new MiniCanvasElement(documentObj)
        : new MiniElement(tag, documentObj)
    },
    createElementNS(ns, tag) {
      const el = new MiniElement(tag, documentObj, ns)
      return el
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
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
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
  const { default: MazeViewport3D } = await viteServer.ssrLoadModule(
    '/src/components/game/MazeViewport3D.jsx'
  )
  const { default: Modal } = await viteServer.ssrLoadModule(
    '/src/components/common/Modal.jsx'
  )
  const { default: TouchControls3D } = await viteServer.ssrLoadModule(
    '/src/components/game/TouchControls3D.jsx'
  )
  const { useRunTimer } = await viteServer.ssrLoadModule('/src/hooks/useRunTimer.js')
  const { generateMaze } = await viteServer.ssrLoadModule('/src/game/generation/mazeGenerator.js')
  const { getCollectiblePoolStats } = await viteServer.ssrLoadModule('/src/game/three/buildCollectibles.js')
  const { getEnemyPoolStats } = await viteServer.ssrLoadModule('/src/game/three/buildEnemy.js')
  const { getHazardPoolStats } = await viteServer.ssrLoadModule('/src/game/three/buildHazards.js')
  const { getHidingSpotPoolStats } = await viteServer.ssrLoadModule('/src/game/three/buildHidingSpots.js')
  const {
    disposeAllSharedPools,
    getActiveSharedPoolOwnerCount,
  } = await viteServer.ssrLoadModule('/src/game/three/sharedResources.js')

  const clickDomElement = async (el) => {
    await act(async () => {
      el.dispatchEvent({
        type: 'click',
        bubbles: true,
        detail: 1,
      })
    })
  }

  // -------------------------------------------------------------------------
  // 1. StrictMode Double-Mount Cleanup & Shared-Resource Disposal
  // -------------------------------------------------------------------------
  {
    console.log('Test 1: StrictMode MazeViewport3D mount/unmount cleanup & pool disposal')
    disposeAllSharedPools()

    const maze = generateMaze({ difficulty: 'small', seed: 901, includeObjectives: true })
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    const readyEngines = []
    const cleanupsRun = []

    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(MazeViewport3D, {
            maze,
            runId: 1,
            playerCell: maze.start,
            items: maze.collectibles.items,
            keycards: maze.keycards,
            keysCollected: 0,
            totalKeys: maze.keycards.length,
            isExitLocked: maze.keycards.length > 0,
            objectivesEnabled: true,
            controlsEnabled: true,
            engineConfig: {
              createRenderer: createMockWebGLRenderer,
              isSoftwareGl: true,
              pointerLockEnabled: false,
            },
            onViewportReady: ({ engine }) => {
              readyEngines.push(engine)
              return () => {
                cleanupsRun.push(engine)
              }
            },
          })
        )
      )
    })

    // In StrictMode dev render, mount -> cleanup -> remount runs cleanly:
    // the active engine remains live (1 shared pool owner), while earlier mounts disposed.
    assert.ok(readyEngines.length >= 1, 'MazeViewport3D initialized engine inside StrictMode')
    assert.equal(
      getActiveSharedPoolOwnerCount(),
      1,
      'StrictMode leaves exactly 1 active shared pool owner after cleanup+remount'
    )
    const activeEngine = readyEngines.at(-1)
    assert.equal(activeEngine.isDisposed, false)
    for (let i = 0; i < readyEngines.length - 1; i += 1) {
      assert.equal(readyEngines[i].isDisposed, true, 'Prior StrictMode mount engine was disposed')
    }

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)

    assert.equal(activeEngine.isDisposed, true, 'Active engine disposed on unmount')
    assert.equal(cleanupsRun.length, readyEngines.length, 'All onViewportReady cleanups ran')
    assert.equal(getActiveSharedPoolOwnerCount(), 0, 'All shared pools released after unmount')
    assert.equal(getCollectiblePoolStats().geometries, 0)
    assert.equal(getEnemyPoolStats().geometries, 0)
    assert.equal(getHazardPoolStats().geometries, 0)
    assert.equal(getHidingSpotPoolStats().geometries, 0)

    console.log('✓ StrictMode double-mount cleanup and shared-resource disposal verified')
  }

  // -------------------------------------------------------------------------
  // 2. App Immediate Full-Viewport 3D Launch, Simplified HUD, Shortcuts & Settings
  // -------------------------------------------------------------------------
  {
    console.log('Test 2: App immediate full-screen 3D viewport, simplified HUD, camera toggle & Reduced Motion')
    disposeAllSharedPools()
    domEnv.window.location.href = 'http://localhost:3000/'
    domEnv.window.localStorage.clear()

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    const viewportEngines = []

    try {
      await act(async () => {
        root.render(
          createElement(App, {
            viewportEngineConfig: {
              createRenderer: createMockWebGLRenderer,
              isSoftwareGl: true,
              pointerLockEnabled: false,
            },
            onViewportReady: ({ engine }) => {
              viewportEngines.push(engine)
            },
          })
        )
      })

      const shellEl = container.querySelector('.game-shell')
      assert.ok(shellEl, 'GameShell rendered')
      assert.equal(shellEl.classList.contains('game-shell--viewport'), true)
      assert.equal(shellEl.getAttribute('data-reduced-motion'), 'false')

      const viewportEl = container.querySelector('.maze-viewport-3d')
      assert.ok(viewportEl, '3D viewport mounts immediately on application startup')
      assert.equal(viewportEngines.length, 1, '3D scene engine created on initial render')
      assert.equal(viewportEl.getAttribute('data-camera-mode'), 'first-person')

      // Verify legacy surrounding chrome and removed viewport hints/buttons are absent
      assert.equal(container.querySelector('.screen-header'), null, 'ScreenHeader removed')
      assert.equal(container.querySelector('.game-hud'), null, 'Legacy GameHUD bar removed')
      assert.equal(container.querySelector('.maze-toolbar'), null, 'Legacy toolbar removed')
      assert.equal(container.querySelector('.maze-minimap__bar'), null, 'Map/Hint viewport buttons removed')
      assert.equal(container.querySelector('.maze-pointer-lock-hint'), null, 'Bottom-center pointer-lock hint removed')
      assert.equal(container.querySelector('.maze-controls-hint'), null, 'Bottom controls hint removed')

      // Top-left compact HUD + icon-only fullscreen button present; touch controls hidden on desktop
      const vitalsHud = container.querySelector('.maze-vitals-hud')
      assert.ok(vitalsHud, 'Compact top-left vitals HUD rendered')
      const vitalsItems = Array.from(vitalsHud.querySelectorAll('.maze-vitals-hud__item'))
      assert.equal(vitalsItems.length, 4, 'Compact top-left 2x2 HUD items rendered (Health, Sprint, Light, Keys)')
      assert.equal(vitalsItems[0].classList.contains('maze-vitals-hud__item--hp'), true)
      assert.equal(vitalsItems[1].classList.contains('maze-vitals-hud__item--stamina'), true)
      assert.equal(vitalsItems[2].classList.contains('maze-vitals-hud__item--battery'), true)
      assert.equal(vitalsItems[3].classList.contains('maze-vitals-hud__item--keys'), true)
      const fullscreenBtn = container.querySelector('.maze-fullscreen-btn')
      assert.ok(fullscreenBtn, 'Icon-only fullscreen button rendered')
      assert.equal(fullscreenBtn.textContent.trim(), '', 'Fullscreen button has no visible text label')
      assert.equal(viewportEl.getAttribute('data-touch-controls-visible'), 'false', 'Touch controls hidden on desktop auto mode')
      assert.equal(container.querySelector('[data-touch-controls-root="true"]'), null)

      // Permanent bottom-left minimap is visible on mount without pressing M; M does not toggle/hide it; H triggers Wayfinder
      const minimapEl = container.querySelector('.maze-minimap')
      assert.ok(minimapEl, 'Permanent minimap is visible by default during gameplay without pressing M')
      assert.equal(
        minimapEl.getAttribute('data-minimap-permanent'),
        'true',
        'Minimap reports permanent visibility state'
      )
      const minimapBodyEl = minimapEl.querySelector('.maze-minimap__body')
      const minimapCanvasEl = minimapBodyEl?.querySelector('.maze-minimap__canvas')
      assert.ok(
        minimapBodyEl && minimapCanvasEl,
        'Minimap canvas renders inside .maze-minimap__body wrapper by default'
      )
      assert.equal(
        minimapEl.style?.width || '',
        '',
        'Minimap outer container has no inline width override'
      )
      assert.equal(
        minimapCanvasEl.style?.width || '',
        '',
        'Minimap canvas has no inline width override (CSS controls display size)'
      )
      assert.equal(
        minimapCanvasEl.style?.height || '',
        '',
        'Minimap canvas has no inline height override (CSS controls display size)'
      )
      assert.equal(
        minimapEl.querySelector('.maze-minimap__legend'),
        null,
        'Compact GTA-style minimap omits verbose legend bar'
      )
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'm', repeat: false })
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'M', repeat: false })
      })
      assert.ok(
        container.querySelector('.maze-minimap')?.querySelector('.maze-minimap__canvas'),
        'Pressing M no longer toggles or hides the minimap'
      )
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'h', repeat: false })
      })
      assert.ok(
        container.querySelector('[data-wayfinder-hint]'),
        'Pressing H displays wayfinder hint banner while minimap stays visible'
      )

      // Toggle Third-Person via keyboard C during gameplay (and confirm INPUT focus protection)
      assert.equal(viewportEl.getAttribute('data-camera-mode'), 'first-person')
      await act(async () => {
        domEnv.window.dispatchEvent({
          type: 'keydown',
          key: 'c',
          repeat: false,
          target: { tagName: 'INPUT', isContentEditable: false },
        })
      })
      assert.equal(
        viewportEl.getAttribute('data-camera-mode'),
        'first-person',
        'Pressing C inside an INPUT field does not toggle camera mode'
      )
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'c', repeat: false })
      })
      assert.equal(
        viewportEl.getAttribute('data-camera-mode'),
        'third-person',
        'Pressing C during gameplay toggles First-Person -> Third-Person'
      )

      // Pause via P -> open SettingsModal -> verify C does NOT toggle while paused -> toggle Reduced Motion
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
      })
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'c', repeat: false })
      })
      assert.equal(
        viewportEl.getAttribute('data-camera-mode'),
        'third-person',
        'Pressing C while Pause modal is open does not toggle camera mode'
      )

      const settingsBtn = container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Settings')
      assert.ok(settingsBtn, 'Pause menu exposes Settings button')
      await clickDomElement(settingsBtn)

      const gameplayTab = container.querySelectorAll('[role="tab"]').find((t) => t.textContent.includes('Gameplay'))
      assert.ok(gameplayTab, 'Gameplay tab rendered inside SettingsModal')
      await clickDomElement(gameplayTab)

      assert.equal(
        container.querySelector('[aria-label="Default 3D Camera"]'),
        null,
        'Default 3D Camera toggle removed from SettingsModal Gameplay tab'
      )

      const reducedMotionSwitch = container.querySelectorAll('[role="switch"]').find((sw) => {
        const labelId = sw.getAttribute('aria-labelledby')
        return labelId && container.querySelector(`#${labelId}`)?.textContent?.trim() === 'Reduced Motion'
      })
      assert.ok(reducedMotionSwitch, 'Reduced Motion toggle switch rendered inside Gameplay settings')
      await clickDomElement(reducedMotionSwitch)
      assert.equal(
        shellEl.getAttribute('data-reduced-motion'),
        'true',
        'GameShell data-reduced-motion updates to true across DOM'
      )

      await clickDomElement(container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Back'))

      // Verify Phase 2 redesigned Pause Menu sections & relocated controls
      assert.ok(container.querySelector('.lv-modal--pause'), 'Redesigned PauseMenuModal rendered after returning from Settings')
      const pauseSubtitle = container.querySelector('.lv-modal__subtitle')?.textContent || ''
      assert.ok(pauseSubtitle.includes('Medium'), 'Pause subtitle displays active difficulty')
      assert.equal(pauseSubtitle.includes('×'), false, 'Pause subtitle omits maze dimensions')
      assert.equal(pauseSubtitle.includes('Seed #'), false, 'Pause subtitle omits seed hash')
      assert.equal(container.querySelector('[data-testid="pause-maze-seed"]'), null, 'Separate Seed stat box removed from Pause menu')
      assert.ok(container.querySelector('[data-testid="pause-run-timer"]'), 'Pause menu renders elapsed timer')
      const initialMazeId = viewportEl.getAttribute('data-maze-id')
      assert.ok(container.querySelector('[data-testid="pause-shards"]')?.textContent.includes('/'), 'Pause menu renders soul shards readout')
      assert.ok(container.querySelector('[data-testid="pause-keys"]'), 'Pause menu renders keys readout')
      assert.ok(container.querySelector('[data-testid="pause-moves"]'), 'Pause menu renders moves readout')
      assert.ok(container.querySelector('[data-testid="pause-par"]'), 'Pause menu renders par readout')

      assert.equal(container.querySelectorAll('[data-powerup-indicator]').length, 12, 'All 12 collectibles and abilities rendered with one-word explanations')

      // Duplicated Difficulty & Camera View selectors are removed from Pause Menu
      assert.equal(
        container.querySelectorAll('[data-camera-option]').length,
        0,
        'Camera View selector removed from Pause Menu'
      )
      assert.equal(
        container.querySelectorAll('[data-difficulty-option]').length,
        0,
        'Difficulty selector removed from Pause Menu'
      )
      assert.equal(
        container.querySelector('[aria-label="Camera perspective"]'),
        null,
        'Camera perspective group absent from Pause Menu'
      )
      assert.equal(
        container.querySelector('[aria-label="Difficulty"]'),
        null,
        'Difficulty group absent from Pause Menu'
      )
      assert.equal(
        container.querySelector('[aria-label="Chamber and camera setup"]'),
        null,
        'Chamber and camera setup section absent from Pause Menu'
      )

      // Audio & Mixer section and volume controls are removed from Pause Menu
      assert.equal(
        container.querySelector('[aria-label="Audio controls and mixer"]'),
        null,
        'Audio & Mixer section removed from Pause Menu'
      )
      assert.equal(
        container.querySelector('[data-pause-mute="true"]'),
        null,
        'Pause audio mute toggle removed from Pause Menu'
      )
      assert.equal(
        container.querySelector('.lv-pause-mixer'),
        null,
        'Pause audio mixer removed from Pause Menu'
      )
      for (const chLabel of ['Master volume', 'Ambience volume', 'SFX volume', 'Music volume']) {
        assert.equal(
          container.querySelector(`input[aria-label="${chLabel}"]`),
          null,
          `Pause mixer slider removed for ${chLabel}`
        )
      }

      // Open Settings -> verify Audio controls remain accessible inside Settings -> Audio
      await clickDomElement(
        container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Settings')
      )
      const audioTab = container.querySelectorAll('[role="tab"]').find((t) => t.textContent.includes('Audio'))
      assert.ok(audioTab, 'Audio tab rendered in SettingsModal')
      await clickDomElement(audioTab)
      for (const sliderLabel of [
        'Master Volume slider',
        'Ambience & Drones slider',
        'Sound Effects (SFX) slider',
        'Music & Tension Stems slider',
      ]) {
        assert.ok(
          container.querySelector(`input[aria-label="${sliderLabel}"]`),
          `${sliderLabel} accessible inside Settings -> Audio`
        )
      }

      // Switch to Gameplay tab to verify Default 3D Camera is absent and Difficulty remains accessible there
      await clickDomElement(
        container.querySelectorAll('[role="tab"]').find((t) => t.textContent.includes('Gameplay'))
      )

      assert.equal(
        container.querySelector('[aria-label="Default 3D Camera"]'),
        null,
        'Default 3D Camera control removed from Settings -> Gameplay'
      )
      assert.equal(
        container.querySelectorAll('button').find((b) => b.textContent.trim() === 'First-Person' || b.textContent.trim() === 'Third-Person') || null,
        null,
        'First-Person/Third-Person toggle buttons absent from Settings -> Gameplay'
      )

      const diffGroup = container.querySelector('[aria-label="Difficulty"]')
      assert.ok(diffGroup, 'Difficulty selector rendered inside Settings -> Gameplay')
      const diffBtns = diffGroup.querySelectorAll('button')
      assert.equal(diffBtns.length, 4, 'Difficulty selector displays Easy, Medium, Hard, Hardcore')
      const diffLabels = diffBtns.map((b) => b.textContent.trim())
      assert.deepEqual(diffLabels, ['Easy', 'Medium', 'Hard', 'Hardcore'])
      assert.equal(diffLabels.includes('Small') || diffLabels.includes('Large'), false)

      await clickDomElement(diffBtns.find((b) => b.textContent.trim() === 'Easy'))
      assert.ok(
        viewportEl.getAttribute('data-maze-id')?.startsWith('easy-11x11-'),
        'Selecting Easy difficulty in Settings -> Gameplay generates 11x11 maze'
      )

      await clickDomElement(diffBtns.find((b) => b.textContent.trim() === 'Hard'))
      assert.ok(
        viewportEl.getAttribute('data-maze-id')?.startsWith('hard-23x23-'),
        'Selecting Hard difficulty in Settings -> Gameplay generates 23x23 maze'
      )

      await clickDomElement(diffBtns.find((b) => b.textContent.trim() === 'Hardcore'))
      const hardcoreMazeId = viewportEl.getAttribute('data-maze-id')
      assert.ok(
        hardcoreMazeId?.startsWith('hardcore-31x31-'),
        'Selecting Hardcore difficulty in Settings -> Gameplay generates 31x31 maze'
      )

      // Return to Pause Menu -> verify subtitle and keycard target updated cleanly without duplicating selectors
      await clickDomElement(
        container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Back')
      )
      const hardcoreSubtitle = container.querySelector('.lv-modal__subtitle')?.textContent || ''
      assert.ok(
        hardcoreSubtitle.includes('Hardcore') && !hardcoreSubtitle.includes('31×31') && !hardcoreSubtitle.includes('Seed #'),
        'Pause Menu subtitle displays Hardcore without dimensions or seed hash'
      )
      assert.ok(
        container.querySelector('[data-testid="pause-keys"]')?.textContent.includes('0 / 4'),
        'Hardcore updates keycard target to 0 / 4'
      )

      // Maze Info and Records buttons/dialogs are removed from Pause Menu
      assert.equal(
        container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Maze Info') || null,
        null,
        'Maze Info button removed from Pause Menu'
      )
      assert.equal(
        container.querySelectorAll('button').find((b) => /records/i.test(b.textContent || '')) || null,
        null,
        'Records button removed from Pause Menu'
      )
      assert.equal(
        hardcoreSubtitle.includes('Best'),
        false,
        'Pause Menu subtitle omits personal best time'
      )
      assert.equal(
        container.querySelector('.maze-records-list'),
        null,
        'Records tier list is absent from DOM'
      )
      assert.equal(
        container.querySelector('.maze-records-card'),
        null,
        'Chamber-tier record cards are absent from DOM'
      )
      assert.equal(
        domEnv.window.localStorage.getItem('maze-escape:records:v1'),
        null,
        'No records storage key written'
      )

      // Restart action unpauses and resumes cleanly
      await clickDomElement(container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Restart'))
      assert.equal(container.querySelector('.lv-modal--pause'), null, 'Restart closes Pause Menu')
      assert.equal(viewportEngines[0].isPaused, false, 'Restart unpauses 3D engine cleanly')

      // Open Pause again via P, test New Maze generates a new Hardcore seed & unpauses
      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
      })
      await clickDomElement(container.querySelectorAll('button').find((b) => b.textContent.trim() === 'New Maze'))
      assert.equal(container.querySelector('.lv-modal--pause'), null, 'New Maze closes Pause Menu')
      assert.equal(viewportEngines[0].isPaused, false, 'New Maze unpauses 3D engine cleanly')

      await act(async () => {
        domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
      })
      const updatedMazeId = viewportEl.getAttribute('data-maze-id')
      assert.notEqual(updatedMazeId, hardcoreMazeId, 'New Maze generates a different maze seed')
      assert.notEqual(updatedMazeId, initialMazeId, 'New Maze differs from initial maze')
      assert.ok(
        updatedMazeId?.startsWith('hardcore-31x31-') &&
          container.querySelector('.lv-modal__subtitle')?.textContent.includes('Hardcore'),
        'New Maze preserves active Hardcore 31×31 difficulty'
      )
      await clickDomElement(container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Resume'))
      assert.equal(viewportEngines[0].isPaused, false, 'Resuming from Pause unpauses 3D engine cleanly')
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.parentNode?.removeChild(container)
    }

    assert.equal(viewportEngines[0].isDisposed, true, '3D engine disposed cleanly on App unmount')
    assert.equal(getActiveSharedPoolOwnerCount(), 0, 'Shared pools released on App unmount')
    console.log('✓ App immediate full-screen 3D launch, HUD, Phase 2 Pause Menu, permanent minimap, H shortcut, camera & Reduced Motion verified')
  }

  // -------------------------------------------------------------------------
  // 3. Modal DOM Escape Behavior & Focus Management
  // -------------------------------------------------------------------------
  {
    console.log('Test 3: Live Modal DOM focus entry, Tab trap, Escape & focus restoration')

    function ModalHarness({ closeOnEscape }) {
      const [open, setOpen] = useState(false)
      return createElement(
        'div',
        null,
        createElement(
          'button',
          {
            type: 'button',
            id: 'open-modal-trigger',
            onClick: () => setOpen(true),
          },
          'Open Modal'
        ),
        createElement(
          Modal,
          {
            isOpen: open,
            onClose: () => setOpen(false),
            title: 'Test Dialog',
            closeOnEscape,
            footer: createElement(
              'button',
              { type: 'button', id: 'modal-confirm-btn', onClick: () => setOpen(false) },
              'Confirm'
            ),
          },
          createElement('p', null, 'Dialog content')
        )
      )
    }

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(ModalHarness, { closeOnEscape: true }))
    })

    const triggerBtn = container.querySelector('#open-modal-trigger')
    triggerBtn.focus()
    assert.equal(domEnv.document.activeElement, triggerBtn)

    await clickDomElement(triggerBtn)

    const closeBtn = container.querySelector('.lv-modal__close')
    const confirmBtn = container.querySelector('#modal-confirm-btn')
    assert.ok(closeBtn && confirmBtn, 'Modal focusable buttons rendered')
    assert.equal(
      domEnv.document.activeElement,
      closeBtn,
      'Opening Modal moves focus into first focusable element inside dialog'
    )

    // Shift+Tab from first element wraps to confirmBtn
    await act(async () => {
      domEnv.window.dispatchEvent({
        type: 'keydown',
        key: 'Tab',
        shiftKey: true,
        preventDefault() {},
      })
    })
    assert.equal(domEnv.document.activeElement, confirmBtn, 'Shift+Tab wraps to last modal button')

    // Tab from last element wraps back to closeBtn
    await act(async () => {
      domEnv.window.dispatchEvent({
        type: 'keydown',
        key: 'Tab',
        shiftKey: false,
        preventDefault() {},
      })
    })
    assert.equal(domEnv.document.activeElement, closeBtn, 'Tab wraps to first modal button')

    // Escape closes modal and restores focus to triggerBtn
    await act(async () => {
      domEnv.window.dispatchEvent({
        type: 'keydown',
        key: 'Escape',
        preventDefault() {},
      })
    })
    assert.equal(container.querySelector('.lv-modal'), null, 'Escape closes dismissible modal')
    assert.equal(
      domEnv.document.activeElement,
      triggerBtn,
      'Focus restored to triggering button after Modal closes'
    )

    // Re-render with closeOnEscape=false (Victory / Game Over safety)
    await act(async () => {
      root.render(createElement(ModalHarness, { closeOnEscape: false }))
    })
    await clickDomElement(container.querySelector('#open-modal-trigger'))
    assert.ok(container.querySelector('.lv-modal'))

    await act(async () => {
      domEnv.window.dispatchEvent({
        type: 'keydown',
        key: 'Escape',
        preventDefault() {},
      })
    })
    assert.ok(
      container.querySelector('.lv-modal'),
      'Escape does NOT dismiss Modal when closeOnEscape=false'
    )

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
    console.log('✓ Live Modal DOM focus entry, Tab trap, Escape & focus restoration verified')
  }

  // -------------------------------------------------------------------------
  // 4. TouchControls3D Live Pointer / Click Deduplication
  // -------------------------------------------------------------------------
  {
    console.log('Test 4: TouchControls3D live DOM pointer/click deduplication & outside release')

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    let flashlightCalls = 0
    let abilityCalls = 0

    await act(async () => {
      root.render(
        createElement(TouchControls3D, {
          mode: 'always',
          enabled: true,
          onToggleFlashlight: () => {
            flashlightCalls += 1
          },
          onActivateAbility: () => {
            abilityCalls += 1
          },
        })
      )
    })

    const lightBtn = container.querySelector('[data-touch-action="flashlight"]')
    assert.ok(lightBtn, 'Flashlight touch button rendered')
    lightBtn._rect = { left: 20, top: 20, right: 80, bottom: 70, width: 60, height: 50 }

    // 1) Normal touch tap inside button: pointerdown -> pointerup -> click => ONLY 1 toggle
    await act(async () => {
      lightBtn.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 10, clientX: 40, clientY: 40, bubbles: true })
      lightBtn.dispatchEvent({ type: 'pointerup', pointerId: 10, clientX: 40, clientY: 40, bubbles: true })
      lightBtn.dispatchEvent({ type: 'click', detail: 1, bubbles: true })
    })
    assert.equal(flashlightCalls, 1, 'Pointer tap + click triggers flashlight exactly once')

    // 2) Pointer down inside then released OUTSIDE (no click), followed by keyboard Enter + click
    await act(async () => {
      lightBtn.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 11, clientX: 40, clientY: 40, bubbles: true })
      lightBtn.dispatchEvent({ type: 'pointerup', pointerId: 11, clientX: 300, clientY: 300, bubbles: true })
    })
    assert.equal(flashlightCalls, 2)

    await act(async () => {
      lightBtn.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true })
      lightBtn.dispatchEvent({ type: 'click', detail: 0, bubbles: true })
    })
    assert.equal(flashlightCalls, 3, 'Enter keyboard activation works immediately after outside pointer release')

    // 3) Ability button pointerdown + click deduplication
    const echoBtn = container.querySelector('[data-touch-action="echo_reveal"]')
    assert.ok(echoBtn, 'Echo ability button rendered')
    await act(async () => {
      echoBtn.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 12, bubbles: true })
      echoBtn.dispatchEvent({ type: 'pointerup', pointerId: 12, bubbles: true })
      echoBtn.dispatchEvent({ type: 'click', detail: 1, bubbles: true })
    })
    assert.equal(abilityCalls, 1, 'Ability pointerdown + click triggers exactly once')

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
    console.log('✓ TouchControls3D DOM pointer/click deduplication verified')
  }

  // -------------------------------------------------------------------------
  // 5. useRunTimer Live React DOM Pause/Resume & Zero-Drift Verification
  // -------------------------------------------------------------------------
  {
    console.log('Test 5: useRunTimer live DOM pause/resume & reset behavior')

    const perf = globalThis.performance
    const origNow = perf.now.bind(perf)
    let virtualNowMs = 1000
    perf.now = () => virtualNowMs

    const activeIntervals = new Map()
    let nextIntervalId = 1
    const origSetInterval = domEnv.window.setInterval
    const origClearInterval = domEnv.window.clearInterval
    domEnv.window.setInterval = (fn) => {
      const id = nextIntervalId++
      activeIntervals.set(id, fn)
      return id
    }
    domEnv.window.clearInterval = (id) => {
      activeIntervals.delete(id)
    }

    const flushIntervals = () => {
      for (const fn of [...activeIntervals.values()]) {
        fn()
      }
    }

    function TimerHarness({ resetKey, isPaused, hasWon = false, isGameOver = false, onVictoryTime = null }) {
      const { timeDisplayRef } = useRunTimer({
        resetKey,
        isPaused,
        hasWon,
        isGameOver,
        onVictoryTime,
      })
      return createElement('span', { ref: timeDisplayRef, id: 'timer-readout' }, '00:00.0')
    }

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(TimerHarness, { resetKey: 1, isPaused: false }))
      })
      const readout = container.querySelector('#timer-readout')
      assert.equal(readout.textContent, '00:00.0')

      // Advance 1.5s while running -> readout updates to 00:01.5
      virtualNowMs += 1500
      flushIntervals()
      assert.equal(readout.textContent, '00:01.5')

      // Pause timer -> advance clock 4.0s -> elapsed time MUST stay frozen at 00:01.5
      await act(async () => {
        root.render(createElement(TimerHarness, { resetKey: 1, isPaused: true }))
      })
      assert.equal(activeIntervals.size, 0, 'Interval stopped while paused')
      virtualNowMs += 4000
      flushIntervals()
      assert.equal(readout.textContent, '00:01.5', 'Readout stays frozen while paused')

      // Resume timer -> advance another 1.0s -> elapsed time = 2.5s (no 4s jump!)
      await act(async () => {
        root.render(createElement(TimerHarness, { resetKey: 1, isPaused: false }))
      })
      virtualNowMs += 1000
      flushIntervals()
      assert.equal(readout.textContent, '00:02.5', 'Resumed timer continues cleanly without pause drift')

      // Reset run -> returns to 00:00.0
      await act(async () => {
        root.render(createElement(TimerHarness, { resetKey: 2, isPaused: false }))
      })
      assert.equal(readout.textContent, '00:00.0', 'Reset key resets displayed time to 00:00.0')

      await act(async () => {
        root.unmount()
      })
    } finally {
      perf.now = origNow
      domEnv.window.setInterval = origSetInterval
      domEnv.window.clearInterval = origClearInterval
      container.parentNode?.removeChild(container)
    }

    console.log('✓ useRunTimer DOM pause/resume and zero-drift reset verified')
  }
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

console.log('=== ALL PHASE G PROMPT 03 REACT DOM INTEGRATION TESTS PASSED! ===')
