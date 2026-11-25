import assert from 'node:assert/strict'
import fs from 'node:fs'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import {
  DEFAULT_KEY_BINDINGS,
  KEY_BINDING_ACTION_ORDER,
  formatKeyTokenLabel,
} from './threeConfig.js'
import { STORAGE_KEYS } from '../../utils/persistence.js'

console.log('--- Running START-SCREEN-NAV-001 Embedded Start Screen Settings Tests ---')

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

  class MiniDocument extends MiniNode {
    constructor(windowObj) {
      super(9, null)
      this.ownerDocument = this
      this.defaultView = windowObj
      this._emitter = createEventEmitter()
      this.oninput = null
      this.onchange = null
      this.onclick = null
      this.documentElement = new MiniElement('html', this)
      this.head = new MiniElement('head', this)
      this.body = new MiniElement('body', this)
      this.documentElement.appendChild(this.head)
      this.documentElement.appendChild(this.body)
      this.appendChild(this.documentElement)
      this.activeElement = this.body
    }

    createElement(tag) {
      if (String(tag).toLowerCase() === 'input') {
        return new MiniInputElement(this)
      }
      return new MiniElement(tag, this)
    }
    createElementNS(_ns, tag) {
      return new MiniElement(tag, this)
    }
    createTextNode(text) {
      return new MiniText(text, this)
    }
    createComment(text) {
      return new MiniComment(text, this)
    }
    createDocumentFragment() {
      return new MiniFragment(this)
    }
    addEventListener(type, fn, options) {
      this._emitter.addEventListener(type, fn, options)
    }
    removeEventListener(type, fn, options) {
      this._emitter.removeEventListener(type, fn, options)
    }
    querySelectorAll(selector) {
      return this.documentElement.querySelectorAll(selector)
    }
    querySelector(selector) {
      return this.documentElement.querySelector(selector)
    }
  }

  const storageMap = new Map()
  const localStorage = {
    getItem(k) {
      return storageMap.has(String(k)) ? storageMap.get(String(k)) : null
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
  }

  const windowObj = {
    _emitter: createEventEmitter(),
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    location: {
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
    },
    history: {
      state: null,
      replaceState(state, _title, nextUrl) {
        this.state = state
        currentUrl = new URL(nextUrl, currentUrl)
      },
    },
    navigator: { maxTouchPoints: 0, vibrate: () => true },
    localStorage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    addEventListener(type, fn, options) {
      this._emitter.addEventListener(type, fn, options)
    },
    HTMLIFrameElement: class HTMLIFrameElement {},
    HTMLInputElement: MiniInputElement,
    Element: MiniElement,
    HTMLElement: MiniElement,
    Node: MiniNode,
    removeEventListener(type, fn, options) {
      this._emitter.removeEventListener(type, fn, options)
    },
    dispatchEvent(event) {
      let stopped = false
      let defaultPrevented = Boolean(event?.defaultPrevented)
      const evtObj = {
        ...event,
        target: event?.target || windowObj,
        currentTarget: windowObj,
        get defaultPrevented() {
          return defaultPrevented
        },
        preventDefault() {
          defaultPrevented = true
        },
        stopPropagation() {
          stopped = true
        },
      }
      for (const listener of this._emitter.getListeners(event.type, true)) {
        listener(evtObj)
        if (stopped) return !defaultPrevented
      }
      for (const listener of this._emitter.getListeners(event.type, false)) {
        listener(evtObj)
        if (stopped) return !defaultPrevented
      }
      return !defaultPrevented
    },
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  }

  const documentObj = new MiniDocument(windowObj)
  windowObj.document = documentObj

  return {
    window: windowObj,
    document: documentObj,
    localStorage,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLInputElement: MiniInputElement,
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

const domEnv = createMiniDomEnv()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.window = domEnv.window
globalThis.document = domEnv.document
globalThis.localStorage = domEnv.localStorage
globalThis.Element = domEnv.Element
globalThis.HTMLElement = domEnv.HTMLElement
globalThis.HTMLInputElement = domEnv.HTMLInputElement
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

async function setSliderValue(container, ariaLabel, value) {
  const input = container.querySelector(`input[aria-label="${ariaLabel}"]`)
  assert.ok(input, `Slider "${ariaLabel}" exists`)
  const setter = Object.getOwnPropertyDescriptor(domEnv.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, String(value))
  await act(async () => {
    input.dispatchEvent({ type: 'input', bubbles: true })
    input.dispatchEvent({ type: 'change', bubbles: true })
  })
}

function findSwitchByLabel(container, labelText) {
  return container.querySelectorAll('[role="switch"]').find((sw) => {
    const labelId = sw.getAttribute('aria-labelledby')
    return labelId && container.querySelector(`#${labelId}`)?.textContent?.trim() === labelText
  })
}

function findButtonByText(container, text) {
  return container.querySelectorAll('button').find((b) => b.textContent.trim() === text)
}

async function pressWindowKey(key, extra = {}) {
  await act(async () => {
    domEnv.window.dispatchEvent({
      type: 'keydown',
      key,
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...extra,
    })
  })
}

const viteServer = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'silent',
})

try {
  const { default: App } = await viteServer.ssrLoadModule('/src/App.jsx')

  // -------------------------------------------------------------------------
  // 1. Start Screen -> Embedded Settings -> Back -> Background & Modal Checks
  // -------------------------------------------------------------------------
  {
    console.log('Test 1: Start Screen integrates SettingsView in-place with Back navigation')
    domEnv.localStorage.clear()
    const container = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(container)
    const root = createRoot(container)

    let latestEngine = null
    await act(async () => {
      root.render(
        createElement(App, {
          viewportEngineConfig: { createRenderer: createMockWebGLRenderer },
          onViewportReady: (ctx) => {
            latestEngine = ctx.engine
          },
        })
      )
    })

    // Initial Main Menu assertions
    const startScreenEl = container.querySelector('.lv-start-screen')
    assert.ok(startScreenEl, 'Start Screen root element mounted')
    const initialBgStyle = startScreenEl.style.backgroundImage
    assert.ok(
      initialBgStyle && initialBgStyle.includes('start_screen_background'),
      'Underground facility background image set on Start Screen'
    )
    const backdropEl = startScreenEl.querySelector('.lv-start-backdrop')
    assert.ok(backdropEl, 'Dark readability overlay present')
    assert.ok(container.querySelector('.lv-start-title')?.textContent?.includes('MAZE ESCAPE'))
    assert.ok(
      container.querySelector('.lv-start-subtitle')?.textContent?.includes('You were never meant to leave.')
    )
    assert.ok(container.querySelector('[data-testid="start-game-btn"]'))
    assert.ok(container.querySelector('[data-testid="start-settings-btn"]'))
    assert.ok(container.querySelector('[data-testid="start-how-to-play-btn"]'))
    assert.ok(container.querySelector('[data-testid="start-about-btn"]'))
    assert.equal(container.querySelector('.lv-modal--settings'), null)

    // Click Settings on Start Screen
    await clickEl(container.querySelector('[data-testid="start-settings-btn"]'))

    // Must remain on same StartScreen node with identical background & backdrop
    const sameStartScreen = container.querySelector('.lv-start-screen')
    assert.equal(sameStartScreen, startScreenEl, 'Same Start Screen DOM node remains mounted')
    assert.equal(
      sameStartScreen.style.backgroundImage,
      initialBgStyle,
      'Underground facility background image remains completely unchanged'
    )
    assert.equal(
      sameStartScreen.querySelector('.lv-start-backdrop'),
      backdropEl,
      'Dark readability overlay remains mounted'
    )

    // Main menu content must be hidden
    assert.equal(container.querySelector('.lv-start-container'), null, 'Main menu container hidden')
    assert.equal(container.querySelector('.lv-start-title'), null, 'MAZE ESCAPE heading hidden')
    assert.equal(container.querySelector('.lv-start-subtitle'), null, 'Tagline hidden')
    assert.equal(container.querySelector('[data-testid="start-game-btn"]'), null, 'Start Game button hidden')
    assert.equal(container.querySelector('[data-testid="start-settings-btn"]'), null, 'Settings button hidden')
    assert.equal(container.querySelector('[data-testid="start-how-to-play-btn"]'), null, 'How to Play button hidden')
    assert.equal(container.querySelector('[data-testid="start-about-btn"]'), null, 'About button hidden')

    // Must NOT open SettingsModal popup
    assert.equal(container.querySelector('[role="dialog"]'), null, 'No modal dialog opened')
    assert.equal(container.querySelector('.lv-modal--settings'), null, 'SettingsModal not opened from Start Screen')

    // Embedded SettingsView must be mounted inside Start Screen
    const embeddedHost = container.querySelector('[data-testid="start-settings-view"]')
    assert.ok(embeddedHost, 'Embedded Settings container rendered inside Start Screen')
    assert.ok(
      embeddedHost.querySelector('.lv-settings-view--embedded'),
      'Embedded SettingsView class applied'
    )
    assert.ok(embeddedHost.querySelector('[data-testid="settings-nav"]'), 'Category tabs rendered')
    assert.ok(
      embeddedHost.querySelector('[data-testid="settings-scroll-container"]'),
      'Scrollable content container rendered'
    )
    assert.ok(
      embeddedHost.querySelector('[data-testid="settings-header-back-btn"]'),
      'Header Back button rendered'
    )

    // Verify all 4 categories render cleanly & test Audio controls
    const tabs = embeddedHost.querySelectorAll('[role="tab"]')
    assert.equal(tabs.length, 4)
    await setSliderValue(embeddedHost, 'Master Volume slider', 40)
    await clickEl(findSwitchByLabel(embeddedHost, 'Audio Subtitles'))

    // Mouse & Controls + Keybindings (verifies no subgroups crash and full rebind flow)
    await clickEl(tabs.find((t) => t.textContent.includes('Mouse & Controls')))
    await setSliderValue(embeddedHost, 'Mouse Sensitivity slider', 150)
    await clickEl(findSwitchByLabel(embeddedHost, 'Invert Y-Axis'))
    for (const actionId of KEY_BINDING_ACTION_ORDER) {
      const btn = embeddedHost.querySelector(`[data-keybind-action="${actionId}"]`)
      assert.ok(btn, `Keybind button rendered for ${actionId}`)
      assert.equal(btn.textContent.trim(), formatKeyTokenLabel(DEFAULT_KEY_BINDINGS[actionId]))
    }
    // Test Escape cancels listening WITHOUT exiting Start Screen Settings
    await clickEl(embeddedHost.querySelector('[data-keybind-action="interact"]'))
    assert.equal(
      embeddedHost.querySelector('[data-keybind-action="interact"]').textContent.trim(),
      'Press key...'
    )
    await pressWindowKey('Escape')
    assert.ok(
      container.querySelector('[data-testid="start-settings-view"]'),
      'Escape cancels keybind capture without leaving embedded Settings'
    )
    // Test reserved key + custom bind + conflict swap
    await clickEl(embeddedHost.querySelector('[data-keybind-action="interact"]'))
    await pressWindowKey('c')
    assert.ok(
      embeddedHost.querySelector('.lv-keybind-feedback')?.textContent?.includes('reserved'),
      'Fixed camera key C rejected inside embedded Settings'
    )
    await pressWindowKey('g')
    assert.equal(embeddedHost.querySelector('[data-keybind-action="interact"]').textContent.trim(), 'G')

    await clickEl(embeddedHost.querySelector('[data-keybind-action="pause"]'))
    await pressWindowKey('u')
    assert.equal(embeddedHost.querySelector('[data-keybind-action="pause"]').textContent.trim(), 'U')

    // Graphics category
    await clickEl(tabs.find((t) => t.textContent.includes('Graphics')))
    await clickEl(findButtonByText(embeddedHost, 'Balanced (1.5x)'))
    await clickEl(findSwitchByLabel(embeddedHost, 'High-Contrast Wall Outlines'))
    assert.equal(
      container.querySelector('.game-shell')?.getAttribute('data-high-contrast'),
      'true',
      'High-Contrast applied live to GameShell from Start Screen Settings'
    )

    // Gameplay category
    await clickEl(tabs.find((t) => t.textContent.includes('Gameplay')))
    await clickEl(findButtonByText(embeddedHost, 'Free Look'))
    await setSliderValue(embeddedHost, 'Field of View (FOV) slider', 80)
    await clickEl(findSwitchByLabel(embeddedHost, 'Reduced Motion'))
    assert.equal(
      container.querySelector('.game-shell')?.getAttribute('data-reduced-motion'),
      'true',
      'Reduced Motion applied live to GameShell from Start Screen Settings'
    )

    // Header Back returns to Main Menu while keeping background unchanged
    await clickEl(embeddedHost.querySelector('[data-testid="settings-header-back-btn"]'))
    assert.equal(container.querySelector('[data-testid="start-settings-view"]'), null)
    assert.ok(container.querySelector('.lv-start-title'), 'Main menu title restored after header Back')
    assert.equal(
      container.querySelector('.lv-start-screen'),
      startScreenEl,
      'Start Screen element persisted across Settings -> Back'
    )
    assert.equal(
      startScreenEl.style.backgroundImage,
      initialBgStyle,
      'Background unchanged after returning from Settings'
    )

    // Re-open Settings and verify Footer Back button also returns to Main Menu
    await clickEl(container.querySelector('[data-testid="start-settings-btn"]'))
    const footerBackBtn = container
      .querySelector('.lv-settings-footer')
      ?.querySelectorAll('button')
      .find((b) => b.textContent.trim() === 'Back')
    assert.ok(footerBackBtn, 'Footer Back button rendered inside embedded Settings')
    await clickEl(footerBackBtn)
    assert.equal(container.querySelector('[data-testid="start-settings-view"]'), null)
    assert.ok(container.querySelector('[data-testid="start-game-btn"]'), 'Footer Back returned to Main Menu')

    // Verify localStorage saved all changes made on Start Screen
    const persisted = JSON.parse(domEnv.localStorage.getItem(STORAGE_KEYS.SETTINGS))
    assert.equal(persisted.audio.master, 0.4)
    assert.equal(persisted.audio.subtitles, true)
    assert.equal(persisted.controls.invertY, true)
    assert.equal(persisted.controls.keyBindings.interact, 'g')
    assert.equal(persisted.controls.keyBindings.pause, 'u')
    assert.equal(persisted.graphics.qualityPreset, 'balanced')
    assert.equal(persisted.graphics.highContrast, true)
    assert.equal(persisted.gameplay.fieldOfView, 80)
    assert.equal(persisted.gameplay.reducedMotion, true)

    // Click Start Game and verify selected settings remain active in gameplay + in-game SettingsModal works
    await clickEl(container.querySelector('[data-testid="start-game-btn"]'))
    const deadline = Date.now() + 4000
    while (!latestEngine && Date.now() < deadline) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25))
      })
    }
    assert.ok(latestEngine, 'Game engine mounted after Start Game')
    assert.equal(latestEngine.config?.fov, 80, 'Gameplay FOV active from Start Screen settings')
    assert.equal(latestEngine.config?.invertY, true, 'Gameplay Invert Y active from Start Screen settings')
    assert.equal(latestEngine.config?.keyBindings?.interact, 'g', 'Custom interact key active in gameplay')
    assert.equal(latestEngine.config?.keyBindings?.pause, 'u', 'Custom pause key active in gameplay')

    // Wait for transition overlay to finish (or verify custom Pause key works once playing)
    const playDeadline = Date.now() + 4000
    while (container.querySelector('.lv-start-transition') && Date.now() < playDeadline) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
    }

    // Open in-game Pause Menu using customized pause key 'u'
    await pressWindowKey('u')
    const pauseModal = container.querySelector('.lv-modal--pause')
    assert.ok(pauseModal, 'In-game Pause Menu opened with Start Screen custom pause key U')

    // Open in-game SettingsModal from Pause Menu and verify modal popup works identically
    await clickEl(findButtonByText(pauseModal, 'Settings'))
    const settingsModal = container.querySelector('.lv-modal--settings')
    assert.ok(settingsModal, 'In-game SettingsModal popup still opens from Pause Menu')
    const modalBody = settingsModal.querySelector('.lv-modal__body')
    assert.equal(
      modalBody.childNodes[0],
      settingsModal.querySelector('[data-testid="settings-nav"]'),
      'In-game SettingsModal preserves fixed nav DOM structure'
    )
    assert.equal(
      modalBody.childNodes[1],
      settingsModal.querySelector('[data-testid="settings-scroll-container"]'),
      'In-game SettingsModal preserves scroll container DOM structure'
    )
    assert.equal(
      settingsModal.querySelector('input[aria-label="Master Volume slider"]').value,
      '40',
      'In-game SettingsModal reflects Start Screen volume change'
    )

    // Close in-game SettingsModal -> returns to Pause Menu
    await clickEl(findButtonByText(settingsModal, 'Back'))
    assert.equal(container.querySelector('.lv-modal--settings'), null)
    assert.ok(container.querySelector('.lv-modal--pause'), 'Back from in-game Settings returns to Pause Menu')

    await act(async () => {
      root.unmount()
    })
    container.parentNode?.removeChild(container)
    console.log('✓ Start Screen embedded Settings, persistence, gameplay startup, and in-game SettingsModal verified')
  }

  // -------------------------------------------------------------------------
  // 2. Embedded Settings CSS & Responsive Rules Verification
  // -------------------------------------------------------------------------
  {
    console.log('Test 2: Embedded Settings CSS layout and responsive rules')
    const settingsCss = fs.readFileSync(
      new URL('../../styles/settings.css', import.meta.url),
      'utf8'
    )
    assert.ok(settingsCss.includes('.lv-start-settings-panel'), '.lv-start-settings-panel rule defined')
    assert.ok(settingsCss.includes('.lv-settings-view--embedded'), '.lv-settings-view--embedded rule defined')
    assert.ok(settingsCss.includes('.lv-start-settings-header'), '.lv-start-settings-header rule defined')
    assert.ok(settingsCss.includes('.lv-settings-footer-wrapper'), '.lv-settings-footer-wrapper rule defined')
    console.log('✓ Embedded Settings CSS verified')
  }

  console.log('\n=== ALL START-SCREEN-NAV-001 TESTS PASSED! ===')
} finally {
  await viteServer.close()
}
