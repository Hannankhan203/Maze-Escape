import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import { generateMaze } from '../generation/mazeGenerator.js'
import { ALL_HIDING_SPOT_TYPES } from '../mechanics/hidingConfig.js'
import {
  addManualPlacement,
  createDefaultSandboxConfig,
  SANDBOX_CATEGORY_IDS,
  setItemQuantity,
} from '../sandbox/sandboxConfig.js'
import {
  DEV_UNLOCKED_STORAGE_KEY,
  isDeveloperAccessEnabled,
  isProductionEnvironment,
} from '../sandbox/sandboxAccess.js'
import { ACTIVE_FLASHLIGHT_INTENSITY, MazeSceneEngine } from './MazeSceneEngine.js'
import { HORROR_EVENT_TYPES } from './HorrorDirector.js'

console.log('--- Running MAZE-DEV-SANDBOX-008 Developer Brightness Override Tests ---')

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
    return selector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .some((part) => matchesSingleSelector(el, part))
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
      if (!refNode) this.childNodes.push(child)
      else {
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
      for (const c of [...this.childNodes]) {
        c.parentNode = null
      }
      this.childNodes = []
      if (val !== undefined && val !== null && String(val) !== '') {
        this.appendChild(this.ownerDocument.createTextNode(String(val)))
      }
    }
  }

  class MiniText extends MiniNode {
    constructor(text, ownerDocument) {
      super(3, ownerDocument)
      this.nodeValue = String(text ?? '')
    }
  }

  class MiniComment extends MiniNode {
    constructor(text, ownerDocument) {
      super(8, ownerDocument)
      this.nodeValue = String(text ?? '')
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
      this.attributes = new Map()
      this.style = {}
      this.dataset = {}
      this._emitter = createEventEmitter()
      this.clientWidth = 1280
      this.clientHeight = 720
    }
    get className() {
      return this.attributes.get('class') || ''
    }
    set className(val) {
      this.setAttribute('class', val)
    }
    get id() {
      return this.attributes.get('id') || ''
    }
    set id(val) {
      this.setAttribute('id', val)
    }
    get classList() {
      const el = this
      const tokens = () => String(el.className || '').split(/\s+/).filter(Boolean)
      return {
        contains: (cls) => tokens().includes(cls),
        add: (...clsList) => {
          const set = new Set(tokens())
          clsList.forEach((c) => set.add(c))
          el.className = [...set].join(' ')
        },
        remove: (...clsList) => {
          const set = new Set(tokens())
          clsList.forEach((c) => set.delete(c))
          el.className = [...set].join(' ')
        },
      }
    }
    setAttribute(name, value) {
      const strVal = String(value)
      this.attributes.set(name, strVal)
      if (name.startsWith('data-')) {
        const camel = name
          .slice(5)
          .replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
        this.dataset[camel] = strVal
      }
    }
    removeAttribute(name) {
      this.attributes.delete(name)
    }
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null
    }
    hasAttribute(name) {
      return this.attributes.has(name)
    }
    getBoundingClientRect() {
      return { width: this.clientWidth, height: this.clientHeight, top: 0, left: 0 }
    }
    closest(selector) {
      let cur = this
      while (cur && cur.nodeType === 1) {
        if (matchesSelector(cur, selector)) return cur
        cur = cur.parentElement
      }
      return null
    }
    querySelector(selector) {
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (matchesSelector(child, selector)) return child
            const nested = walk(child)
            if (nested) return nested
          }
        }
        return null
      }
      return walk(this)
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
    addEventListener(type, fn, opts) {
      this._emitter.addEventListener(type, fn, opts)
    }
    removeEventListener(type, fn, opts) {
      this._emitter.removeEventListener(type, fn, opts)
    }
    dispatchEvent(event) {
      if (!event || !event.type) return true
      let defaultPrevented = false
      let propagationStopped = false
      const evtObj = {
        ...event,
        target: event.target || this,
        currentTarget: this,
        preventDefault() {
          defaultPrevented = true
        },
        stopPropagation() {
          propagationStopped = true
        },
      }
      const path = []
      let cur = this
      while (cur) {
        path.push(cur)
        cur = cur.parentNode
      }
      path.push(this.ownerDocument)
      for (let i = path.length - 1; i >= 0 && !propagationStopped; i -= 1) {
        const node = path[i]
        if (node?._emitter) {
          for (const fn of node._emitter.getListeners(event.type, true)) {
            fn(evtObj)
          }
        }
      }
      for (let i = 0; i < path.length && !propagationStopped; i += 1) {
        const node = path[i]
        if (node?._emitter) {
          for (const fn of node._emitter.getListeners(event.type, false)) {
            fn(evtObj)
          }
        }
        if (event.bubbles === false) break
      }
      return !defaultPrevented
    }
    click() {
      return this.dispatchEvent({ type: 'click', bubbles: true })
    }
    focus() {
      this.ownerDocument.activeElement = this
    }
    blur() {}
  }

  class MiniInputElement extends MiniElement {
    constructor(ownerDocument) {
      super('input', ownerDocument)
      this.value = ''
      this.checked = false
    }
  }

  class MiniTextAreaElement extends MiniElement {
    constructor(ownerDocument) {
      super('textarea', ownerDocument)
      this.value = ''
    }
  }

  class MiniOptionElement extends MiniElement {
    constructor(ownerDocument) {
      super('option', ownerDocument)
      this._value = undefined
    }
    get value() {
      if (this._value !== undefined) return this._value
      return this.attributes.has('value')
        ? this.attributes.get('value')
        : this.textContent
    }
    set value(val) {
      this._value = String(val)
    }
    get selected() {
      return this.hasAttribute('selected')
    }
    set selected(val) {
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
            if (child.tagName === 'OPTION') opts.push(child)
            else walk(child)
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
      return selected ? selected.value : opts[0] ? opts[0].value : ''
    }
    set value(val) {
      this._value = String(val)
      for (const opt of this.options) {
        opt.selected = opt.value === this._value
      }
    }
    get selectedIndex() {
      return this.options.findIndex((o) => o.selected)
    }
    set selectedIndex(idx) {
      const opts = this.options
      opts.forEach((o, i) => {
        o.selected = i === idx
      })
      if (opts[idx]) this._value = opts[idx].value
    }
  }

  function createMemoryStorage() {
    const map = new Map()
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(String(k), String(v)),
      removeItem: (k) => map.delete(String(k)),
      clear: () => map.clear(),
    }
  }

  const localStorage = createMemoryStorage()
  const sessionStorage = createMemoryStorage()

  const documentObj = {
    nodeType: 9,
    documentElement: null,
    head: null,
    body: null,
    activeElement: null,
    pointerLockElement: null,
    _emitter: createEventEmitter(),
    createElement(tag) {
      const lower = String(tag).toLowerCase()
      if (lower === 'input') return new MiniInputElement(documentObj)
      if (lower === 'textarea') return new MiniTextAreaElement(documentObj)
      if (lower === 'select') return new MiniSelectElement(documentObj)
      if (lower === 'option') return new MiniOptionElement(documentObj)
      return new MiniElement(tag, documentObj)
    },
    createElementNS(_ns, tag) {
      return this.createElement(tag)
    },
    createTextNode: (t) => new MiniText(t, documentObj),
    createComment: (t) => new MiniComment(t, documentObj),
    createDocumentFragment: () => new MiniFragment(documentObj),
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
    exitPointerLock() {
      this.pointerLockElement = null
    },
  }

  const windowObj = {
    document: documentObj,
    localStorage,
    sessionStorage,
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
    HTMLTextAreaElement: MiniTextAreaElement,
    HTMLSelectElement: MiniSelectElement,
    HTMLOptionElement: MiniOptionElement,
    Element: MiniElement,
    HTMLElement: MiniElement,
    Node: MiniNode,
    Text: MiniText,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
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
      for (const fn of this._emitter.getListeners(event.type, true)) fn(evtObj)
      for (const fn of this._emitter.getListeners(event.type, false)) fn(evtObj)
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
    sessionStorage,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLInputElement: MiniInputElement,
    HTMLSelectElement: MiniSelectElement,
    Node: MiniNode,
    Text: MiniText,
  }
}

function createMockWebGLRenderer() {
  const domEl = {
    style: {},
    addEventListener() {},
    removeEventListener() {},
    requestPointerLock() {},
    getBoundingClientRect: () => ({ width: 1280, height: 720, top: 0, left: 0 }),
  }
  return {
    isWebGLRenderer: false,
    renderCount: 0,
    domElement: domEl,
    shadowMap: { enabled: false, type: null, needsUpdate: false },
    toneMapping: null,
    outputColorSpace: null,
    toneMappingExposure: 1.26,
    setSize() {},
    setPixelRatio() {},
    render() {
      this.renderCount += 1
    },
    dispose() {},
  }
}

function createCanvasHost(pointerLockTracker = null) {
  return {
    clientWidth: 1280,
    clientHeight: 720,
    children: [],
    requestPointerLock() {
      if (pointerLockTracker) pointerLockTracker.calls += 1
    },
    appendChild(node) {
      this.children.push(node)
      node.parentNode = this
    },
    removeChild(node) {
      const idx = this.children.indexOf(node)
      if (idx !== -1) this.children.splice(idx, 1)
      if (node) node.parentNode = null
    },
    addEventListener() {},
    removeEventListener() {},
  }
}

const domEnv = createMiniDomEnv('http://localhost:3000/')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.window = domEnv.window
globalThis.document = domEnv.document
globalThis.localStorage = domEnv.localStorage
globalThis.sessionStorage = domEnv.sessionStorage
globalThis.Element = domEnv.Element
globalThis.HTMLElement = domEnv.HTMLElement
globalThis.HTMLInputElement = domEnv.HTMLInputElement
globalThis.HTMLSelectElement = domEnv.HTMLSelectElement
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

function snapshotLighting(engine) {
  const env = engine.getEnvironment()
  const lights = env.lights
  return {
    ambientIntensity: lights.ambientLight.intensity,
    ambientColor: lights.ambientLight.color.getHex(),
    hemiIntensity: lights.hemiLight.intensity,
    hemiSkyColor: lights.hemiLight.color.getHex(),
    hemiGroundColor: lights.hemiLight.groundColor.getHex(),
    directionalIntensity: lights.directionalLight.intensity,
    directionalColor: lights.directionalLight.color.getHex(),
    fillIntensity: lights.fillLight.intensity,
    fillColor: lights.fillLight.color.getHex(),
    fogDensity: env.fog?.density ?? null,
    environmentIntensity: engine.scene.environmentIntensity,
    exposure: engine.renderer?.toneMappingExposure ?? null,
  }
}

// =========================================================================
// Test 1: Standard Gameplay Isolation in MazeSceneEngine
// =========================================================================
{
  console.log('Test 1: Standard (non-sandbox) MazeSceneEngine rejects Developer Brightness Override')
  const standardMaze = generateMaze({ level: 1, seed: 401001 })
  const engine = new MazeSceneEngine(createCanvasHost(), {
    createRenderer: () => createMockWebGLRenderer(),
    audio: { enabled: false },
    skipSpawnSequence: true,
  })
  engine.setMaze(standardMaze)
  const baseline = snapshotLighting(engine)

  assert.equal(engine.isSandboxMode, false)
  assert.equal(engine.getDevBrightnessOverride(), false)
  assert.equal(engine.setDevBrightnessOverride(true), false, 'Standard mode MUST reject brightness override')
  assert.equal(engine.getDevBrightnessOverride(), false)

  const afterAttempt = snapshotLighting(engine)
  assert.deepEqual(afterAttempt, baseline, 'Standard gameplay lighting/fog/exposure must remain 100% untouched')
  engine.dispose()
}

// =========================================================================
// Test 2: Full-Environment Illumination, Visual Contrast Guardrails,
//         Exact OFF Restoration, and Repeated Toggle Non-Accumulation
// =========================================================================
{
  console.log('Test 2: Sandbox Brightness Override ON/OFF lighting, fog, environmentIntensity, exposure & repeated-toggle non-accumulation')
  let sbCfg = createDefaultSandboxConfig()
  // Include a Manual Grid Editor placement and verify sandbox maze mounting
  const probeMaze = generateMaze({ level: 1, seed: 882244, sandboxConfig: sbCfg })
  let manualSpot = null
  for (let r = 1; r < probeMaze.rows - 1 && !manualSpot; r += 1) {
    for (let c = 1; c < probeMaze.cols - 1 && !manualSpot; c += 1) {
      if (
        probeMaze.grid[r][c] === 0 &&
        !(r === probeMaze.start.row && c === probeMaze.start.col) &&
        !(r === probeMaze.exit.row && c === probeMaze.exit.col)
      ) {
        manualSpot = { row: r, col: c }
      }
    }
  }
  assert.ok(manualSpot, 'Expected open cell for manual placement')
  sbCfg = addManualPlacement(sbCfg, SANDBOX_CATEGORY_IDS.HAZARDS, 'steam_pipe_burst', manualSpot.row, manualSpot.col).config
  sbCfg = setItemQuantity(sbCfg, SANDBOX_CATEGORY_IDS.HIDING_SPOTS, ALL_HIDING_SPOT_TYPES[0], 1).config
  const sbMaze = generateMaze({ level: 1, seed: 882244, sandboxConfig: sbCfg })

  const engine = new MazeSceneEngine(createCanvasHost(), {
    createRenderer: () => createMockWebGLRenderer(),
    audio: { enabled: false },
    sandbox: { isSandbox: true, enabled: true, config: sbCfg },
    skipSpawnSequence: true,
  })
  engine.setMaze(sbMaze)
  // Match WebGL PMREM environmentIntensity baseline (0.13 set in _syncEnvironmentMap when WebGLRenderer is active)
  engine.scene.environmentIntensity = 0.13
  const baseline = snapshotLighting(engine)

  assert.equal(engine.isSandboxMode, true)
  assert.equal(engine.getDevBrightnessOverride(), false)

  // Enable override
  assert.equal(engine.setDevBrightnessOverride(true), true)
  assert.equal(engine.getDevBrightnessOverride(), true)
  const lit = snapshotLighting(engine)

  // Verify broad environment visibility improvements without blowing out whites
  assert.ok(lit.ambientIntensity >= 1.5 && lit.ambientIntensity <= 2.2, `Ambient ${lit.ambientIntensity} must brightly illuminate floors/corners without blowout`)
  assert.ok(lit.ambientIntensity > baseline.ambientIntensity * 4)
  assert.ok(lit.hemiIntensity >= 1.4 && lit.hemiIntensity <= 2.0)
  assert.ok(lit.directionalIntensity >= 1.0 && lit.directionalIntensity <= 1.5)
  assert.ok(lit.fillIntensity >= 0.7 && lit.fillIntensity <= 1.2)
  assert.ok(lit.environmentIntensity > baseline.environmentIntensity * 3, 'Scene environmentIntensity must rise to inspect PBR hiding spots, collectibles & machinery')
  assert.ok(lit.fogDensity !== null && lit.fogDensity < 0.001, 'Fog density must drop far below culling threshold during override')
  assert.ok(lit.exposure > baseline.exposure && lit.exposure <= 1.65, `Exposure ${lit.exposure} must stay moderate to avoid washed-out whites`)

  // Repeated ON -> OFF toggles (5 cycles) must NEVER accumulate and MUST restore exact baseline every time
  let firstLitSnapshot = null
  for (let i = 0; i < 5; i += 1) {
    assert.equal(engine.setDevBrightnessOverride(true), true)
    const curLit = snapshotLighting(engine)
    if (!firstLitSnapshot) firstLitSnapshot = curLit
    assert.deepEqual(curLit, firstLitSnapshot, `Cycle ${i}: ON state must be identical with zero accumulation`)

    assert.equal(engine.setDevBrightnessOverride(false), false)
    const restored = snapshotLighting(engine)
    assert.deepEqual(restored, baseline, `Cycle ${i}: OFF state must restore exact original lighting/fog/exposure`)
  }

  // Paused toggle triggers immediate re-render
  const rendersBefore = engine.renderer.renderCount
  engine.setPaused(true)
  engine.setDevBrightnessOverride(true)
  assert.ok(engine.renderer.renderCount > rendersBefore, 'Toggling brightness while paused must immediately render frame')

  engine.dispose()
}

// =========================================================================
// Test 3: Runtime Persistence Across stepFrame, HorrorDirector Scares,
//         Spirit Lantern, Fog Culling, Settings Updates, & Flashlight
// =========================================================================
{
  console.log('Test 3: Brightness Override stability across stepFrame, HorrorDirector, SpiritLantern, Graphics Updates, Flashlight & Scene Reloads')
  const sbCfg = createDefaultSandboxConfig()
  const sbMaze = generateMaze({ level: 2, seed: 556677, sandboxConfig: sbCfg })
  const standardMaze = generateMaze({ level: 1, seed: 112233 })

  const engine = new MazeSceneEngine(createCanvasHost(), {
    createRenderer: () => createMockWebGLRenderer(),
    audio: { enabled: false },
    sandbox: { isSandbox: true, enabled: true, config: sbCfg },
    skipSpawnSequence: true,
    horrorDirector: { visualScaresEnabled: true },
  })
  engine.setMaze(sbMaze)
  const baseline = snapshotLighting(engine)

  engine.setDevBrightnessOverride(true)
  const lit = snapshotLighting(engine)

  // Step multiple animation frames (catches stepFrame fog overwrite regression)
  for (let i = 0; i < 10; i += 1) {
    engine.stepFrame(0.016, { render: true })
  }
  const afterSteps = snapshotLighting(engine)
  assert.equal(afterSteps.fogDensity, lit.fogDensity, 'stepFrame() must NOT reset override fog density back to dark fogDensity')
  assert.equal(afterSteps.ambientIntensity, lit.ambientIntensity)
  assert.equal(engine._lastRenderCullingStats.active, false, 'Fog distance culling must remain inactive while brightness override is ON')

  // HorrorDirector BLACKOUT and LIGHT_FLICKER must NOT dim override lights
  engine.horrorDirector.triggerEvent(HORROR_EVENT_TYPES.BLACKOUT, { force: true, duration: 2.0 })
  engine.stepFrame(0.05, { render: false })
  assert.equal(engine.getEnvironment().lights.ambientLight.intensity, lit.ambientIntensity, 'HorrorDirector blackout must not dim active brightness override')
  assert.equal(engine.getEnvironment().lights.directionalLight.intensity, lit.directionalIntensity)

  // Spirit Lantern activation and expiration must NOT raise fog density or overwrite override lighting
  engine.setActiveEffects({ spiritLanternRemainingMs: 1200 })
  engine.stepFrame(0.016, { render: false })
  assert.equal(engine.getEnvironment().fog.density, lit.fogDensity, 'Spirit Lantern must not thicken fog while brightness override is ON')
  engine.setActiveEffects({ spiritLanternRemainingMs: 0 })
  engine.stepFrame(0.016, { render: false })
  assert.equal(engine.getEnvironment().lights.ambientLight.intensity, lit.ambientIntensity, 'Spirit Lantern expiry must not reset lights to dark baseline while override is ON')

  // Flashlight still works independently while override is ON
  assert.equal(engine.flashlightActive, false)
  assert.equal(engine.toggleFlashlight(), true)
  assert.equal(engine.spotlight.visible, true)
  assert.equal(engine.spotlight.intensity, ACTIVE_FLASHLIGHT_INTENSITY)
  assert.equal(engine.toggleFlashlight(), false)
  assert.equal(engine.spotlight.visible, false)

  // Updating graphics settings (volumetricFog off -> on) while ON keeps override and updates restored baseline cleanly
  engine.updateGraphicsConfig({ volumetricFog: false })
  assert.equal(engine.getDevBrightnessOverride(), true)
  assert.equal(engine.getEnvironment().lights.ambientLight.intensity, lit.ambientIntensity)
  assert.equal(engine.getEnvironment().fog, null)

  // Turning OFF after volumetricFog=false restores dark lights cleanly with fog=null
  assert.equal(engine.setDevBrightnessOverride(false), false)
  assert.equal(engine.getEnvironment().lights.ambientLight.intensity, baseline.ambientIntensity)
  assert.equal(engine.getEnvironment().fog, null)

  // Restore volumetricFog=true, turn ON override, reload another Sandbox maze -> stays ON
  engine.updateGraphicsConfig({ volumetricFog: true })
  engine.setDevBrightnessOverride(true)
  const sbMaze2 = generateMaze({ level: 3, seed: 556677, sandboxConfig: sbCfg })
  engine.setMaze(sbMaze2)
  assert.equal(engine.getDevBrightnessOverride(), true, 'Reloading a Sandbox maze preserves active override')
  assert.ok(engine.getEnvironment().lights.ambientLight.intensity >= 1.5)

  // Switching to a non-sandbox maze or clearing sandbox config immediately disables override & restores baseline
  engine.setSandboxConfig(null)
  engine.setMaze(standardMaze)
  assert.equal(engine.isSandboxMode, false)
  assert.equal(engine.getDevBrightnessOverride(), false, 'Transitioning to non-sandbox maze must disable brightness override')
  assert.equal(engine.getEnvironment().lights.ambientLight.intensity, baseline.ambientIntensity)
  assert.equal(engine.getEnvironment().fog.density, baseline.fogDensity)

  engine.dispose()
}

// =========================================================================
// Test 4: React HUD & Isolation (StartScreen, Standard MazeViewport3D,
//         Sandbox MazeViewport3D Toggle, Pointer Lock Safety, & App Resets)
// =========================================================================
const viteServer = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'silent',
})

try {
  const [
    { default: StartScreen },
    { default: MazeViewport3D },
    { default: App },
  ] = await Promise.all([
    viteServer.ssrLoadModule('/src/components/game/StartScreen.jsx'),
    viteServer.ssrLoadModule('/src/components/game/MazeViewport3D.jsx'),
    viteServer.ssrLoadModule('/src/App.jsx'),
  ])

  // 4A. Ordinary StartScreen must NEVER show brightness toggle
  {
    console.log('Test 4A: Ordinary StartScreen omits Developer Brightness toggle')
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(StartScreen, {
          onStartGame: () => {},
          developerAccess: false,
        })
      )
    })
    assert.equal(container.querySelector('[data-testid="maze-sandbox-brightness-btn"]'), null)
    assert.equal(container.textContent.includes('TEST BRIGHTNESS'), false)
    await act(async () => root.unmount())
    container.parentNode?.removeChild(container)
  }

  // 4B. Ordinary gameplay MazeViewport3D must NEVER show brightness toggle
  {
    console.log('Test 4B: Ordinary gameplay MazeViewport3D omits Developer Brightness toggle')
    const stdMaze = generateMaze({ level: 1, seed: 300111 })
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(MazeViewport3D, {
          maze: stdMaze,
          currentLevel: 1,
          controlsEnabled: true,
          engineConfig: { createRenderer: () => createMockWebGLRenderer(), audio: { enabled: false } },
        })
      )
    })
    assert.equal(container.querySelector('[data-testid="maze-sandbox-hud-cluster"]'), null)
    assert.equal(container.querySelector('[data-testid="maze-sandbox-brightness-btn"]'), null)
    await act(async () => root.unmount())
    container.parentNode?.removeChild(container)
  }

  // 4C. Sandbox MazeViewport3D shows TEST BRIGHTNESS: OFF -> ON immediately, updates engine, and does not trigger pointer lock
  {
    console.log('Test 4C: Authorized Sandbox MazeViewport3D toggles immediately without restarting or interfering with pointer lock')
    const sbCfg = createDefaultSandboxConfig()
    const sbMaze = generateMaze({ level: 1, seed: 919191, sandboxConfig: sbCfg })
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    let capturedEngine = null
    let pointerLockRequests = 0
    await act(async () => {
      root.render(
        createElement(MazeViewport3D, {
          maze: sbMaze,
          currentLevel: 1,
          sandboxConfig: sbCfg,
          canUseDevBrightness: true,
          controlsEnabled: true,
          onViewportReady: ({ engine, canvasHost }) => {
            capturedEngine = engine
            if (canvasHost) {
              const orig = canvasHost.requestPointerLock
              canvasHost.requestPointerLock = () => {
                pointerLockRequests += 1
                return orig?.call(canvasHost)
              }
            }
          },
          engineConfig: {
            createRenderer: () => createMockWebGLRenderer(),
            audio: { enabled: false },
            sandbox: { isSandbox: true, enabled: true, config: sbCfg },
          },
        })
      )
    })

    assert.ok(capturedEngine, 'Engine should initialize in Sandbox viewport')
    const btn = container.querySelector('[data-testid="maze-sandbox-brightness-btn"]')
    assert.ok(btn, 'Brightness toggle button must render inside Sandbox HUD cluster')
    assert.equal(btn.getAttribute('data-viewport-control'), 'true')
    assert.equal(btn.getAttribute('aria-pressed'), 'false')
    assert.equal(btn.getAttribute('data-active'), 'false')
    assert.ok(btn.textContent.includes('TEST BRIGHTNESS: OFF'))
    assert.equal(capturedEngine.getDevBrightnessOverride(), false)

    // Initial mount may request pointer lock once when controlsEnabled; reset counter before clicking HUD toggle
    pointerLockRequests = 0
    const mazeBeforeToggle = capturedEngine.getMaze()

    await clickEl(btn)
    assert.equal(btn.getAttribute('aria-pressed'), 'true')
    assert.equal(btn.getAttribute('data-active'), 'true')
    assert.ok(btn.textContent.includes('TEST BRIGHTNESS: ON'))
    assert.equal(capturedEngine.getDevBrightnessOverride(), true)
    assert.equal(pointerLockRequests, 0, 'Clicking brightness toggle must NOT acquire pointer lock')
    assert.equal(capturedEngine.getMaze(), mazeBeforeToggle, 'Toggling brightness must NOT restart level/maze')

    // Toggle back OFF
    await clickEl(btn)
    assert.equal(btn.getAttribute('aria-pressed'), 'false')
    assert.equal(btn.getAttribute('data-active'), 'false')
    assert.ok(btn.textContent.includes('TEST BRIGHTNESS: OFF'))
    assert.equal(capturedEngine.getDevBrightnessOverride(), false)

    await act(async () => root.unmount())
    container.parentNode?.removeChild(container)
  }

  // 4D. App-level Sandbox authorization & cleanup on Sandbox exit / Main Menu return
  {
    console.log('Test 4D: App resets Developer Brightness Override on Sandbox exit / Main Menu & enforces developerAccess')
    domEnv.window.setUrl('http://localhost:3000/?devtools=1')
    domEnv.sessionStorage.setItem(DEV_UNLOCKED_STORAGE_KEY, 'true')
    assert.equal(isDeveloperAccessEnabled(domEnv.window.location), true)
    assert.equal(isProductionEnvironment(), false)

    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    let appEngine = null

    await act(async () => {
      root.render(
        createElement(App, {
          arrivalConfig: {
            startOverlayMinMs: 0,
            spawnDoorDelayMs: 0,
            doorOpenDurationMs: 0,
          },
          viewportEngineConfig: {
            createRenderer: () => createMockWebGLRenderer(),
            audio: { enabled: false },
            skipSpawnSequence: true,
          },
          onViewportReady: ({ engine }) => {
            appEngine = engine
          },
        })
      )
    })

    // Start Screen should NOT have brightness toggle
    assert.equal(container.querySelector('[data-testid="maze-sandbox-brightness-btn"]'), null)

    // Open Developer Sandbox view and start Sandbox test
    await clickEl(container.querySelector('[data-testid="start-dev-sandbox-btn"]'))
    await clickEl(container.querySelector('[data-testid="sandbox-start-test-btn"]'))

    // Wait for transition to complete if timer-based or render directly
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80))
    })

    const sbBtn = container.querySelector('[data-testid="maze-sandbox-brightness-btn"]')
    assert.ok(sbBtn, 'Sandbox gameplay inside App must render brightness toggle')
    assert.ok(sbBtn.textContent.includes('TEST BRIGHTNESS: OFF'))

    // Turn brightness ON
    await clickEl(sbBtn)
    assert.ok(container.querySelector('[data-testid="maze-sandbox-brightness-btn"]').textContent.includes('TEST BRIGHTNESS: ON'))
    assert.equal(appEngine.getDevBrightnessOverride(), true)

    // Open Pause Menu and return to Main Menu -> must reset override and hide button
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', code: 'KeyP', repeat: false })
    })
    const mainMenuBtn = container.querySelector('[data-testid="pause-main-menu-btn"]')
    assert.ok(mainMenuBtn, 'Pause menu Main Menu button should exist')
    await clickEl(mainMenuBtn)
    assert.equal(container.querySelector('[data-testid="maze-sandbox-brightness-btn"]'), null)

    // Re-enter Sandbox test -> brightness MUST start OFF again (not leaked from previous session)
    await clickEl(container.querySelector('[data-testid="start-dev-sandbox-btn"]'))
    await clickEl(container.querySelector('[data-testid="sandbox-start-test-btn"]'))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80))
    })
    const nextSbBtn = container.querySelector('[data-testid="maze-sandbox-brightness-btn"]')
    assert.ok(nextSbBtn, 'Re-entered Sandbox test must render brightness toggle')
    assert.ok(nextSbBtn.textContent.includes('TEST BRIGHTNESS: OFF'), 'New Sandbox test session must reset override to OFF')
    assert.equal(appEngine.getDevBrightnessOverride(), false)

    // Turn ON again, then Restart New Seed -> must reset to OFF
    await clickEl(nextSbBtn)
    assert.ok(nextSbBtn.textContent.includes('TEST BRIGHTNESS: ON'))
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', code: 'KeyP', repeat: false })
    })
    const restartNewSeedBtn = container.querySelector('[data-testid="pause-restart-new-seed-btn"]')
    assert.ok(restartNewSeedBtn)
    await clickEl(restartNewSeedBtn)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80))
    })
    const afterNewSeedBtn = container.querySelector('[data-testid="maze-sandbox-brightness-btn"]')
    assert.ok(afterNewSeedBtn)
    assert.ok(afterNewSeedBtn.textContent.includes('TEST BRIGHTNESS: OFF'), 'Restarting with a new seed must reset brightness override to OFF')

    // Turn ON again, then Return to Sandbox Config -> must reset to OFF
    await clickEl(afterNewSeedBtn)
    assert.ok(afterNewSeedBtn.textContent.includes('TEST BRIGHTNESS: ON'))
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'p', code: 'KeyP', repeat: false })
    })
    const backToSandboxBtn = container.querySelector('[data-testid="pause-return-sandbox-btn"]')
    assert.ok(backToSandboxBtn)
    await clickEl(backToSandboxBtn)
    assert.equal(container.querySelector('[data-testid="maze-sandbox-brightness-btn"]'), null, 'Leaving Sandbox gameplay to Sandbox Config must remove HUD toggle')

    await act(async () => root.unmount())
    container.parentNode?.removeChild(container)
  }

  // 4E. Unauthorized developerAccess=false / canUseDevBrightness=false blocks brightness override UI
  {
    console.log('Test 4E: canUseDevBrightness=false blocks brightness button even if sandbox maze is passed')
    const sbCfg = createDefaultSandboxConfig()
    const sbMaze = generateMaze({ level: 1, seed: 242424, sandboxConfig: sbCfg })
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)
    let capturedEngine = null

    await act(async () => {
      root.render(
        createElement(MazeViewport3D, {
          maze: sbMaze,
          currentLevel: 1,
          sandboxConfig: sbCfg,
          canUseDevBrightness: false,
          devBrightnessOverride: true,
          controlsEnabled: true,
          onViewportReady: ({ engine }) => {
            capturedEngine = engine
          },
          engineConfig: {
            createRenderer: () => createMockWebGLRenderer(),
            audio: { enabled: false },
            sandbox: { isSandbox: true, enabled: true, config: sbCfg },
          },
        })
      )
    })

    assert.equal(container.querySelector('[data-testid="maze-sandbox-brightness-btn"]'), null)
    assert.equal(capturedEngine.getDevBrightnessOverride(), false)

    await act(async () => root.unmount())
    container.parentNode?.removeChild(container)
  }

  console.log('ALL MAZE-DEV-SANDBOX-008 DEVELOPER BRIGHTNESS OVERRIDE TESTS PASSED!')
} finally {
  await viteServer.close()
}
