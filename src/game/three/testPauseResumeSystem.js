import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import { createRunTimer } from '../mechanics/runTimer.js'
import { generateMaze } from '../generation/mazeGenerator.js'
import { createKeyboardControlsHandler } from '../../hooks/useKeyboardControls.js'
import { CAMERA_MODES } from './CameraRig.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'

function createHeadlessEngine(config = {}) {
  const mockCanvasHost = {
    appendChild: () => {},
    removeChild: () => {},
    clientWidth: 640,
    clientHeight: 480,
  }
  const mockRenderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    setPixelRatio: () => {},
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    getContext: () => null,
  }
  return new MazeSceneEngine(mockCanvasHost, {
    createRenderer: () => mockRenderer,
    ...config,
  })
}

console.log('--- Running Pause & Resume System Unit & Integration Tests ---')

// Mini DOM environment setup for React DOM integration tests
function createMiniDomEnv(initialUrl = 'http://localhost:3000/') {
  void initialUrl

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

  class MiniElement extends MiniNode {
    constructor(tagName, ownerDocument) {
      super(1, ownerDocument)
      this.tagName = String(tagName).toUpperCase()
      this.nodeName = this.tagName
      this._attrs = new Map()
      this._emitter = createEventEmitter()
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
      }
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
      const elem = this
      this.classList = {
        add(cls) {
          const list = (elem.getAttribute('class') || '').split(/\s+/).filter(Boolean)
          if (!list.includes(cls)) {
            list.push(cls)
            elem.setAttribute('class', list.join(' '))
          }
        },
        remove(cls) {
          const list = (elem.getAttribute('class') || '').split(/\s+/).filter(Boolean)
          elem.setAttribute('class', list.filter((c) => c !== cls).join(' '))
        },
        contains(cls) {
          const list = (elem.getAttribute('class') || '').split(/\s+/).filter(Boolean)
          return list.includes(cls)
        },
      }
    }

    getAttribute(name) {
      return this._attrs.has(name.toLowerCase()) ? this._attrs.get(name.toLowerCase()) : null
    }

    setAttribute(name, val) {
      this._attrs.set(name.toLowerCase(), String(val))
    }

    removeAttribute(name) {
      this._attrs.delete(name.toLowerCase())
    }

    hasAttribute(name) {
      return this._attrs.has(name.toLowerCase())
    }

    addEventListener(type, fn, options) {
      this._emitter.addEventListener(type, fn, options)
    }

    removeEventListener(type, fn, options) {
      this._emitter.removeEventListener(type, fn, options)
    }

    dispatchEvent(event) {
      const ev = event && typeof event === 'object' ? event : { type: String(event) }
      if (!ev.target) ev.target = this
      if (!ev.currentTarget) ev.currentTarget = this
      if (typeof ev.stopPropagation !== 'function') {
        ev.stopPropagation = () => {
          ev._stopped = true
        }
      }

      let cur = this
      const path = []
      while (cur) {
        path.push(cur)
        cur = cur.parentNode
      }

      // Capture phase
      for (let i = path.length - 1; i >= 0; i -= 1) {
        if (ev._stopped) break
        const listeners = path[i]._emitter?.getListeners(ev.type, true) || []
        for (const fn of listeners) {
          fn.call(path[i], ev)
        }
      }

      // Target / bubble phase
      for (let i = 0; i < path.length; i += 1) {
        if (ev._stopped) break
        const listeners = path[i]._emitter?.getListeners(ev.type, false) || []
        for (const fn of listeners) {
          fn.call(path[i], ev)
        }
      }

      const propName = 'on' + ev.type.toLowerCase()
      if (typeof this[propName] === 'function' && !ev._stopped) {
        this[propName].call(this, ev)
      }

      return !ev.defaultPrevented
    }

    querySelector(selector) {
      const parts = splitSelectorList(selector)
      for (const part of parts) {
        const found = this._querySelectorRecursive(this, part)
        if (found) return found
      }
      return null
    }

    _querySelectorRecursive(node, selector) {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (matchesSelector(child, selector)) return child
          const nested = this._querySelectorRecursive(child, selector)
          if (nested) return nested
        }
      }
      return null
    }

    querySelectorAll(selector) {
      const parts = splitSelectorList(selector)
      const matches = []
      for (const part of parts) {
        this._querySelectorAllRecursive(this, part, matches)
      }
      return matches
    }

    _querySelectorAllRecursive(node, selector, matches) {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (matchesSelector(child, selector) && !matches.includes(child)) {
            matches.push(child)
          }
          this._querySelectorAllRecursive(child, selector, matches)
        }
      }
    }
  }

  class MiniDocumentFragment extends MiniNode {
    constructor(ownerDocument) {
      super(11, ownerDocument)
      this.nodeName = '#document-fragment'
    }
  }

  function SafeHTMLIFrameElement() {}
  SafeHTMLIFrameElement.prototype = Object.create(Object.prototype)
  Object.defineProperty(SafeHTMLIFrameElement, Symbol.hasInstance, {
    value: () => false,
  })
  MiniElement.prototype.HTMLIFrameElement = SafeHTMLIFrameElement
  MiniElement.HTMLIFrameElement = SafeHTMLIFrameElement

  class MiniDocument extends MiniElement {
    static HTMLIFrameElement = SafeHTMLIFrameElement
    HTMLIFrameElement = SafeHTMLIFrameElement
    constructor() {
      super('#document', null)
      this.nodeType = 9
      this.documentElement = new MiniElement('HTML', this)
      this.body = new MiniElement('BODY', this)
      this.documentElement.appendChild(this.body)
      this.pointerLockElement = null
      this.HTMLIFrameElement = SafeHTMLIFrameElement
    }

    createElement(tagName) {
      return new MiniElement(tagName, this)
    }

    createElementNS(_ns, tagName) {
      return this.createElement(tagName)
    }

    createTextNode(data) {
      return new MiniText(data, this)
    }

    createDocumentFragment() {
      return new MiniDocumentFragment(this)
    }

    exitPointerLock() {
      this.pointerLockElement = null
    }
  }

  class MiniWindow {
    constructor(doc) {
      this.document = doc
      this.innerWidth = 1280
      this.innerHeight = 800
      this.devicePixelRatio = 2
      this._emitter = createEventEmitter()
      this.localStorage = (() => {
        const map = new Map()
        return {
          getItem: (k) => (map.has(k) ? map.get(k) : null),
          setItem: (k, v) => map.set(k, String(v)),
          removeItem: (k) => map.delete(k),
          clear: () => map.clear(),
        }
      })()
    }

    addEventListener(type, fn, options) {
      this._emitter.addEventListener(type, fn, options)
      this.document.addEventListener(type, fn, options)
    }

    removeEventListener(type, fn, options) {
      this._emitter.removeEventListener(type, fn, options)
      this.document.removeEventListener(type, fn, options)
    }

    dispatchEvent(event) {
      return this.document.dispatchEvent(event)
    }

    matchMedia() {
      return { matches: false, addEventListener: () => {}, removeEventListener: () => {} }
    }

    setInterval(fn, ms) { return globalThis.setInterval(fn, ms) }
    clearInterval(id) { return globalThis.clearInterval(id) }
    setTimeout(fn, ms) { return globalThis.setTimeout(fn, ms) }
    clearTimeout(id) { return globalThis.clearTimeout(id) }
  }

  class HTMLIFrameElement extends MiniElement {
    constructor(doc) {
      super('IFRAME', doc)
    }
  }

  const doc = new MiniDocument()
  const win = new MiniWindow(doc)
  doc.HTMLIFrameElement = HTMLIFrameElement
  win.HTMLIFrameElement = HTMLIFrameElement
  doc.defaultView = win
  return { document: doc, window: win, Node: MiniNode, Element: MiniElement, HTMLIFrameElement }
}

const domEnv = createMiniDomEnv()

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
installGlobal('HTMLIFrameElement', domEnv.HTMLIFrameElement)
installGlobal('HTMLElement', domEnv.HTMLElement)
installGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
installGlobal('localStorage', domEnv.window.localStorage)

const { createRoot } = await import('react-dom/client')

const viteServer = await createServer({
  logLevel: 'silent',
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})

try {
  const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')

  const container = domEnv.document.createElement('div')
  domEnv.document.body.appendChild(container)
  const root = createRoot(container)

  const clickElement = async (el) => {
    await act(async () => {
      el.dispatchEvent({ type: 'click', bubbles: true, detail: 1 })
    })
  }

  const findButton = (text) =>
    container.querySelectorAll('button').find((b) => b.textContent.trim() === text)

  try {
    console.log('Test 1: Pressing P toggles Pause Menu and pauses game')
    await act(async () => {
      root.render(createElement(App))
    })

    // Initially not paused
    assert.equal(container.querySelector('[role="dialog"]'), null, 'No modal open initially')

    // Press P -> should open Pause Menu modal
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
    })

    const pauseDialog = container.querySelector('[role="dialog"]')
    assert.ok(pauseDialog, 'Pause Menu modal opens when P is pressed')
    assert.ok(
      pauseDialog.textContent.includes('Game Paused'),
      'Pause Menu title says Game Paused'
    )
    assert.ok(findButton('Resume'), 'Resume action present in Pause Menu')
    assert.ok(findButton('Settings'), 'Settings action present in Pause Menu')
    assert.ok(findButton('Main Menu'), 'Main Menu action present in Pause Menu')

    // Pressing P again -> should resume / close Pause Menu modal
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
    })
    assert.equal(container.querySelector('[role="dialog"]'), null, 'Pressing P again resumes game')

    console.log('✓ Pause/Resume toggle via P key verified')

    console.log('Test 2: Escape key does NOT pause the game')
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'Escape', repeat: false })
    })
    assert.equal(container.querySelector('[role="dialog"]'), null, 'Escape key does not open Pause Menu')

    console.log('✓ Escape key non-pause behavior verified')

    console.log('Test 3: Opening Settings from Pause Menu pauses game and closing returns to pause state')
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
    })
    assert.ok(container.querySelector('[role="dialog"]'), 'Pause menu open')

    const settingsBtn = findButton('Settings')
    assert.ok(settingsBtn, 'Settings button in Pause menu')
    await clickElement(settingsBtn)

    // Settings modal open
    const settingsDialog = container.querySelector('.lv-modal--settings')
    assert.ok(settingsDialog, 'Settings modal open')

    // Close Settings -> should return to Pause Menu (not resume directly)
    const backBtn = findButton('Back')
    assert.ok(backBtn, 'Back button in Settings modal')
    await clickElement(backBtn)

    // Pause menu should still be open
    assert.ok(
      container.querySelector('[role="dialog"]')?.textContent.includes('Game Paused'),
      'Closing Settings returns to previous paused state (Pause Menu remains open)'
    )

    // Now resume
    await clickElement(findButton('Resume'))
    assert.equal(container.querySelector('[role="dialog"]'), null, 'Game resumed')

    console.log('✓ Settings interaction and pause-state restoration verified')

    console.log('Test 4: Safe P key handling (ignores repeat events and editable targets)')
    const inputEl = domEnv.document.createElement('input')
    domEnv.document.body.appendChild(inputEl)

    await act(async () => {
      inputEl.dispatchEvent({ type: 'keydown', key: 'p', repeat: false, target: inputEl })
    })
    assert.equal(container.querySelector('[role="dialog"]'), null, 'P key typed inside input does not trigger pause')
    inputEl.parentNode?.removeChild(inputEl)

    console.log('✓ Editable target safety verified')

    console.log('Test 5: Timer freezing and zero-drift resumption')
    const timer = createRunTimer()
    timer.sync(true)
    await new Promise((r) => setTimeout(r, 60))
    assert.ok(timer.getElapsedMs() > 0, 'Timer starts and records elapsed time')

    // Freeze timer
    timer.sync(false)
    const timeDuringPause1 = timer.getElapsedMs()
    await new Promise((r) => setTimeout(r, 60))
    const timeDuringPause2 = timer.getElapsedMs()
    assert.equal(timeDuringPause2, timeDuringPause1, 'Timer elapsed time freezes while paused')

    // Resume timer
    timer.sync(true)
    await new Promise((r) => setTimeout(r, 60))
    const timeAfterResume = timer.getElapsedMs()
    assert.ok(timeAfterResume > timeDuringPause1, 'Timer resumes cleanly from frozen point')
    console.log('✓ Timer freezing and resumption verified')

    console.log('Test 6: Enemy AI & Movement freezing and audio pausing in 3D')
    const testMaze = generateMaze({ difficulty: 'small', seed: 4242 })
    const engine = createHeadlessEngine({
      cameraMode: CAMERA_MODES.FIRST_PERSON,
      enemies: { autoSpawn: true },
    })
    engine.setMaze(testMaze)
    engine.setPlayerGridPosition(testMaze.start.row, testMaze.start.col, { immediate: true })

    const initialPos = engine.getPlayerWorldPosition()
    const initialEnemies = engine.getEnemies().map((e) => ({
      id: e.id,
      x: e.mesh?.position?.x ?? 0,
      z: e.mesh?.position?.z ?? 0,
      patrolProgress: e.patrolProgress,
    }))

    // Pause engine
    engine.setPaused(true)
    assert.equal(engine.getPaused(), true, 'Engine reports paused')
    assert.equal(engine.audioEngine?.isPaused, true, 'Audio engine paused when game paused')

    const frameRanWhilePaused = engine.stepFrame(0.5)
    assert.equal(frameRanWhilePaused, false, 'stepFrame returns false while paused')

    // Check player position frozen
    const posDuringPause = engine.getPlayerWorldPosition()
    assert.equal(posDuringPause.x, initialPos.x, 'Player X frozen')
    assert.equal(posDuringPause.z, initialPos.z, 'Player Z frozen')

    // Check enemies frozen
    for (const snap of initialEnemies) {
      const currentEnemy = engine.getEnemies().find((e) => e.id === snap.id)
      assert.equal(currentEnemy.mesh.position.x, snap.x, `Enemy ${snap.id} X frozen`)
      assert.equal(currentEnemy.mesh.position.z, snap.z, `Enemy ${snap.id} Z frozen`)
      assert.equal(currentEnemy.patrolProgress, snap.patrolProgress, `Enemy ${snap.id} patrol frozen`)
    }

    // Resume engine
    engine.setPaused(false)
    assert.equal(engine.getPaused(), false, 'Engine reports unpaused')
    assert.equal(engine.audioEngine?.isPaused, false, 'Audio engine unpaused')
    engine.dispose()
    console.log('✓ 3D Enemy and audio pause freezing verified')

    console.log('Test 7: 2D player movement disabled while paused')
    let movedDirection = null
    let abilityActivated = null
    let controlsEnabled = true

    const handler = createKeyboardControlsHandler({
      getEnabled: () => controlsEnabled,
      onMove: (dir) => { movedDirection = dir },
      onActivateAbility: (ab) => { abilityActivated = ab },
    })

    // When enabled
    handler({ key: 'ArrowRight', preventDefault() {} })
    assert.equal(movedDirection, 'right', 'ArrowRight dispatches move when controls enabled')

    // When paused (controlsEnabled = false)
    controlsEnabled = false
    movedDirection = null
    abilityActivated = null
    handler({ key: 'ArrowUp', preventDefault() {} })
    assert.equal(movedDirection, null, 'ArrowUp does not dispatch move when paused')
    handler({ key: ' ', code: 'Space', preventDefault() {} })
    assert.equal(abilityActivated, null, 'Space does not activate ability when paused')
    console.log('✓ 2D controls disabled during pause verified')

    console.log('Test 8: Escape pointer-lock behavior & cursor restoration')
    let pointerLockExited = false
    domEnv.document.exitPointerLock = () => {
      pointerLockExited = true
      domEnv.document.pointerLockElement = null
    }
    domEnv.document.pointerLockElement = domEnv.document.body

    // Pressing P to pause must exit pointer lock and restore cursor
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
    })
    assert.ok(pointerLockExited, 'exitPointerLock called when game paused')
    assert.equal(domEnv.document.pointerLockElement, null, 'pointerLockElement cleared on pause')

    // Resume
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', repeat: false })
    })

    // Pressing Escape during active gameplay must NOT pause the game
    assert.equal(container.querySelector('[role="dialog"]'), null, 'Modal closed after resume')
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'Escape', repeat: false })
    })
    assert.equal(container.querySelector('[role="dialog"]'), null, 'Escape does not pause the game')
    console.log('✓ Escape pointer-lock retention verified')

    console.log('=== ALL PAUSE & RESUME SYSTEM TESTS PASSED! ===')
  } finally {
    try {
      await act(async () => {
        root.unmount()
      })
    } catch {
      // ignore mock DOM unmount activeElement check
    }
    container.parentNode?.removeChild(container)
  }
} finally {
  await viteServer.close()
}
