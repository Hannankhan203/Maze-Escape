import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { createServer } from 'vite'
import { CELL_TYPES } from '../generation/mazeConfig.js'
import { HAZARD_TYPES } from '../generation/hazardPlacement.js'
import { ALL_HIDING_SPOT_TYPES } from '../mechanics/hidingConfig.js'
import { gridToWorld } from '../world/worldCoords.js'
import { createContinuousInputController } from '../../hooks/useContinuousInput.js'
import { SETTINGS_SCHEMA } from '../../components/settings/settingsConfig.js'
import { loadAllSettings, resetAllSettings, saveAllSettings } from '../../utils/persistence.js'
import { CAMERA_MODES } from './CameraRig.js'
import { FURNITURE_HANDLING_STATES } from './RottenFurnitureController.js'
import { HAZARD_STATES } from './HazardAgent.js'
import { PIPES_HANDLING_STATES } from './FallingPipesController.js'
import { RUBBLE_CONTROLLER_STATES } from './CeilingRubbleController.js'
import { STEAM_REPAIR_STATES } from './SteamRepairController.js'
import { MazeSceneEngine } from './MazeSceneEngine.js'
import {
  DEFAULT_KEY_BINDINGS,
  KEY_BINDING_ACTION_ORDER,
  KEY_BINDING_DEFINITIONS,
  normalizeKeyBindings,
  resolveLookInputConfig,
} from './threeConfig.js'
import { createViewportPointerController } from './viewportPointerCapture.js'

const W = CELL_TYPES.WALL
const P = CELL_TYPES.PATH
const S = CELL_TYPES.START
const E = CELL_TYPES.EXIT

console.log('--- RUNNING MAZE-INPUT-REWORK-001 VERIFICATION SUITE ---')

function createSpecDomEnv() {
  const winListeners = new Map()
  const docListeners = new Map()
  const storageMap = new Map()

  const addEvt = (map, type, fn, opts) => {
    if (!map.has(type)) map.set(type, new Set())
    map.get(type).add({ fn, capture: Boolean(typeof opts === 'boolean' ? opts : opts?.capture) })
  }
  const remEvt = (map, type, fn) => {
    const set = map.get(type)
    if (!set) return
    for (const item of [...set]) {
      if (item.fn === fn) set.delete(item)
    }
  }
  const dispatchEvt = (map, rawEvt, targetDefault) => {
    const evt = rawEvt || {}
    evt.target = evt.target || targetDefault
    evt.currentTarget = targetDefault
    if (typeof evt.defaultPrevented !== 'boolean') evt.defaultPrevented = false
    if (typeof evt.preventDefault !== 'function') {
      evt.preventDefault = () => {
        evt.defaultPrevented = true
      }
    }
    let stopped = false
    if (typeof evt.stopPropagation !== 'function') {
      evt.stopPropagation = () => {
        stopped = true
      }
    }
    const set = [...(map.get(evt.type) || [])]
    for (const item of set.filter((x) => x.capture)) {
      if (stopped) break
      item.fn(evt)
    }
    for (const item of set.filter((x) => !x.capture)) {
      if (stopped) break
      item.fn(evt)
    }
    return !evt.defaultPrevented
  }

  const createEmitterNode = () => {
    const map = new Map()
    return {
      listeners: map,
      addEventListener: (t, fn, o) => addEvt(map, t, fn, o),
      removeEventListener: (t, fn) => remEvt(map, t, fn),
      dispatchEvent: (e) => dispatchEvt(map, e, null),
    }
  }

  const matchSelector = (el, sel) => {
    if (!el || el.nodeType !== 1) return false
    if (sel.startsWith('.')) return el.classList.contains(sel.slice(1))
    const attrMatch = sel.match(/^\[([a-zA-Z0-9_-]+)="([^"]+)"\]$/)
    if (attrMatch) return el.getAttribute(attrMatch[1]) === attrMatch[2]
    const attrBare = sel.match(/^\[([a-zA-Z0-9_-]+)\]$/)
    if (attrBare) return el.hasAttribute(attrBare[1])
    return el.tagName === sel.toUpperCase()
  }

  class MiniNode {
    constructor(doc) {
      this.ownerDocument = doc
      this.parentNode = null
      this.childNodes = []
    }
    appendChild(child) {
      if (!child) return child
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      this.childNodes.push(child)
      return child
    }
    insertBefore(child, ref) {
      if (!ref) return this.appendChild(child)
      if (child.parentNode) child.parentNode.removeChild(child)
      const idx = this.childNodes.indexOf(ref)
      child.parentNode = this
      if (idx === -1) this.childNodes.push(child)
      else this.childNodes.splice(idx, 0, child)
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
      return this.childNodes.some((c) => c.contains?.(target))
    }
    get textContent() {
      return this.childNodes.map((c) => c.textContent ?? '').join('')
    }
    set textContent(v) {
      this.childNodes = v ? [new MiniText(String(v), this.ownerDocument)] : []
    }
  }

  class MiniText extends MiniNode {
    constructor(text, doc) {
      super(doc)
      this.nodeType = 3
      this.data = text
    }
    get textContent() {
      return this.data
    }
    set textContent(v) {
      this.data = String(v ?? '')
    }
  }

  class MiniComment extends MiniNode {
    constructor(text, doc) {
      super(doc)
      this.nodeType = 8
      this.data = text
    }
    get textContent() {
      return ''
    }
  }

  class MiniElement extends MiniNode {
    constructor(tag, doc) {
      super(doc)
      this.nodeType = 1
      this.tagName = String(tag).toUpperCase()
      this.attributes = new Map()
      this.style = {}
      this._emitter = createEmitterNode()
      this.clientWidth = 960
      this.clientHeight = 540
      this.isConnected = true
      this.value = ''
      this.checked = false
      this.disabled = false
      const self = this
      this.classList = {
        add: (...c) => {
          const cur = new Set(String(self.attributes.get('class') || '').split(/\s+/).filter(Boolean))
          c.forEach((x) => cur.add(x))
          self.attributes.set('class', [...cur].join(' '))
        },
        remove: (...c) => {
          const cur = new Set(String(self.attributes.get('class') || '').split(/\s+/).filter(Boolean))
          c.forEach((x) => cur.delete(x))
          self.attributes.set('class', [...cur].join(' '))
        },
        contains: (c) => String(self.attributes.get('class') || '').split(/\s+/).includes(c),
      }
    }
    set className(v) {
      this.attributes.set('class', String(v || ''))
    }
    get className() {
      return this.attributes.get('class') || ''
    }
    setAttribute(k, v) {
      this.attributes.set(k, String(v))
    }
    getAttribute(k) {
      return this.attributes.has(k) ? this.attributes.get(k) : null
    }
    hasAttribute(k) {
      return this.attributes.has(k)
    }
    removeAttribute(k) {
      this.attributes.delete(k)
    }
    addEventListener(t, fn, o) {
      this._emitter.addEventListener(t, fn, o)
    }
    removeEventListener(t, fn) {
      this._emitter.removeEventListener(t, fn)
    }
    dispatchEvent(e) {
      const evt = e || {}
      evt.target = evt.target || this
      evt.currentTarget = this
      if (typeof evt.preventDefault !== 'function') evt.preventDefault = () => { evt.defaultPrevented = true }
      if (typeof evt.stopPropagation !== 'function') evt.stopPropagation = () => {}
      const set = [...(this._emitter.listeners.get(evt.type) || [])]
      for (const item of set) item.fn(evt)
      if (evt.type === 'click' && typeof this.onclick === 'function') this.onclick(evt)
      if (evt.bubbles && this.parentNode && this.parentNode.dispatchEvent) {
        this.parentNode.dispatchEvent(evt)
      }
      return !evt.defaultPrevented
    }
    focus() {
      this.ownerDocument.activeElement = this
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }
    }
    hasPointerCapture() {
      return false
    }
    setPointerCapture() {}
    releasePointerCapture() {}
    querySelectorAll(sel) {
      const out = []
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 1) {
            if (matchSelector(c, sel)) out.push(c)
            walk(c)
          }
        }
      }
      walk(this)
      return out
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null
    }
  }

  class MiniCanvas extends MiniElement {
    constructor(doc) {
      super('canvas', doc)
    }
    getContext() {
      return {
        getContextAttributes: () => ({ antialias: true }),
        clearRect() {},
        fillRect() {},
        beginPath() {},
        arc() {},
        fill() {},
        stroke() {},
      }
    }
  }

  const docObj = {
    nodeType: 9,
    hidden: false,
    visibilityState: 'visible',
    pointerLockElement: null,
    activeElement: null,
    createElement: (t) => (t.toLowerCase() === 'canvas' ? new MiniCanvas(docObj) : new MiniElement(t, docObj)),
    createElementNS: (_ns, t) => new MiniElement(t, docObj),
    createTextNode: (t) => new MiniText(String(t ?? ''), docObj),
    createComment: (t) => new MiniComment(String(t ?? ''), docObj),
    addEventListener: (t, fn, o) => addEvt(docListeners, t, fn, o),
    removeEventListener: (t, fn) => remEvt(docListeners, t, fn),
    dispatchEvent: (e) => dispatchEvt(docListeners, e, docObj),
    querySelectorAll: (s) => docObj.documentElement.querySelectorAll(s),
    querySelector: (s) => docObj.documentElement.querySelector(s),
    contains: (target) => docObj.documentElement.contains(target),
  }
  docObj.documentElement = new MiniElement('html', docObj)
  docObj.head = new MiniElement('head', docObj)
  docObj.body = new MiniElement('body', docObj)
  docObj.documentElement.appendChild(docObj.head)
  docObj.documentElement.appendChild(docObj.body)
  docObj.activeElement = docObj.body

  const winObj = {
    document: docObj,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLCanvasElement: MiniCanvas,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    navigator: { userAgent: 'node-test', maxTouchPoints: 0 },
    location: { href: 'http://localhost:3000/', search: '' },
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(String(k), String(v)),
      removeItem: (k) => storageMap.delete(String(k)),
      clear: () => storageMap.clear(),
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener: (t, fn, o) => addEvt(winListeners, t, fn, o),
    removeEventListener: (t, fn) => remEvt(winListeners, t, fn),
    dispatchEvent: (e) => dispatchEvt(winListeners, e, winObj),
  }
  docObj.defaultView = winObj

  return {
    window: winObj,
    document: docObj,
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLCanvasElement: MiniCanvas,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  }
}

function createHeadlessEngine(opts = {}) {
  const mockRenderer = {
    domElement: { style: {} },
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    setPixelRatio() {},
    setSize() {},
    render() {},
    dispose() {},
    getContext: () => null,
  }
  const container = {
    clientWidth: 960,
    clientHeight: 540,
    appendChild() {},
    removeChild() {},
  }
  const engine = new MazeSceneEngine(container, {
    createRenderer: () => mockRenderer,
    skipSpawnSequence: true,
    enemies: { autoSpawn: false },
    ...opts,
  })
  return { engine, container }
}

function aimAtPoint(engine, tx, ty, tz, px, pz) {
  engine.setPlayerWorldPosition(px, 0, pz, { immediate: true })
  engine._notifyStealthChange?.(true)
  engine.cameraRig?.setMode?.(CAMERA_MODES.FIRST_PERSON, { immediate: true })
  const eyeY = engine.cameraRig?.config?.firstPersonEyeHeight ?? 1.66
  const dx = tx - px
  const dy = ty - eyeY
  const dz = tz - pz
  const horiz = Math.hypot(dx, dz) || 1
  const yaw = Math.atan2(-dx, -dz)
  const pitch = Math.atan2(dy, horiz)
  engine.setLookDirection(yaw, pitch, { immediate: true })
  engine.camera.position.set(px, eyeY, pz)
  engine.camera.lookAt(tx, ty, tz)
  engine.camera.updateMatrixWorld(true)
  engine.stepFrame(0.016, { render: false })
}

// -----------------------------------------------------------------------------
// 1. Keybinding Removal, Normalization & Zero F-Key Dispatch in ContinuousInput
// -----------------------------------------------------------------------------
{
  console.log('Test 1: Keybinding config drops interact/F and useContinuousInput ignores F keys')

  assert.equal('interact' in DEFAULT_KEY_BINDINGS, false)
  assert.equal(KEY_BINDING_ACTION_ORDER.includes('interact'), false)
  assert.equal(KEY_BINDING_DEFINITIONS.some((d) => d.id === 'interact'), false)
  assert.equal(KEY_BINDING_ACTION_ORDER.length, 13)

  const keybindSchema = SETTINGS_SCHEMA.controls
    .flatMap((g) => g.items)
    .find((i) => i.id === 'keybinds')
  assert.equal(keybindSchema.bindings.some((b) => b.id === 'interact'), false)
  assert.equal(keybindSchema.bindings.length, 13)

  // Legacy persisted settings with interact: 'f' must drop interact cleanly
  const normalized = normalizeKeyBindings({ interact: 'f', flashlight: 'k' })
  assert.equal('interact' in normalized, false)
  assert.equal(normalized.flashlight, 'k')

  // Continuous input controller ignores 'f', 'F', KeyF (and never triggers onInteract even if legacy key passed)
  let interactCalls = 0
  const ctrl = createContinuousInputController({
    enabled: true,
    keyBindings: { ...DEFAULT_KEY_BINDINGS, interact: 'f' },
    onInteract: () => {
      interactCalls += 1
    },
  })
  ctrl.handleKeyDown({ key: 'f', code: 'KeyF', target: { tagName: 'BODY' } })
  ctrl.handleKeyDown({ key: 'F', code: 'KeyF', target: { tagName: 'BODY' } })
  ctrl.handleKeyUp({ key: 'f', code: 'KeyF', target: { tagName: 'BODY' } })
  assert.equal(interactCalls, 0, 'F key never fires interaction callback')
  assert.equal(ctrl.state.interact, false, 'F key never sets state.interact')

  // Mobile touch setTouchInteract & triggerInteract still work cleanly
  ctrl.setTouchInteract(true)
  assert.equal(ctrl.state.interact, true, 'TouchControls3D setTouchInteract(true) sets state.interact')
  ctrl.setTouchInteract(false)
  assert.equal(ctrl.state.interact, false, 'TouchControls3D setTouchInteract(false) clears state.interact')
  ctrl.triggerInteract()
  assert.equal(interactCalls, 1, 'TouchControls3D triggerInteract() fires onInteract for mobile')

  console.log('✓ Test 1 Passed: Obsolete F-key binding removed & continuous input ignores F')
}

// -----------------------------------------------------------------------------
// 2. Pointer Capture & Mouse Click Routing (Pointer Lock ON/OFF, Modals, Drag, Right-Click)
// -----------------------------------------------------------------------------
{
  console.log('Test 2: Mouse routing (locked/unlocked, single dispatch, contextmenu, modal guards)')

  const grid = [
    [W, W, W, W, W, W, W],
    [W, S, P, P, P, E, W],
    [W, W, W, W, W, W, W],
  ]
  const maze = { grid, rows: 3, cols: 7, start: { row: 1, col: 1 }, exit: { row: 1, col: 5 }, level: 2, seed: 999 }
  const doc = {
    pointerLockElement: null,
    addEventListener() {},
    removeEventListener() {},
  }
  const activePointers = new Set()
  const canvasHost = {
    clientWidth: 960,
    clientHeight: 540,
    isConnected: true,
    ownerDocument: doc,
    addEventListener() {},
    removeEventListener() {},
    hasPointerCapture: () => false,
    setPointerCapture: (id) => {
      if (doc.pointerLockElement) throw new Error('InvalidStateError during pointerLock')
      if (!activePointers.has(id)) throw new Error('NotFoundError')
    },
    releasePointerCapture() {},
  }

  let primaryCalls = 0
  let secondaryCalls = 0
  let audioUnlockCalls = 0
  const fakeEngine = {
    unlockAudio: () => {
      audioUnlockCalls += 1
    },
    applyLookDelta: () => {},
    handlePrimaryAction: () => {
      primaryCalls += 1
      return { handled: true }
    },
    handleSecondaryAction: () => {
      secondaryCalls += 1
      return { handled: true }
    },
  }
  const latestProps = {
    controlsEnabled: true,
    hasWon: false,
    isGameOver: false,
    isArrivalLocked: false,
    showDiagnosticsModal: false,
    engineConfig: {},
  }
  const ptr = createViewportPointerController({
    canvasHost,
    doc,
    getEngine: () => fakeEngine,
    getLatestProps: () => latestProps,
    resolveLookInputConfig,
  })
  ptr.attach()

  // Unlocked Left-Click (single dispatch per click)
  activePointers.add(1)
  ptr.handlePointerDown({ type: 'pointerdown', pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 480, clientY: 270, preventDefault() {} })
  ptr.handlePointerUp({ type: 'pointerup', pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: 481, clientY: 271, preventDefault() {} })
  assert.equal(primaryCalls, 1, 'Unlocked Left-Click dispatches primary action once')
  assert.equal(secondaryCalls, 0)
  assert.ok(audioUnlockCalls >= 1)

  // Dragging beyond threshold suppresses Left-Click
  activePointers.add(2)
  ptr.handlePointerDown({ type: 'pointerdown', pointerId: 2, pointerType: 'mouse', button: 0, buttons: 1, clientX: 480, clientY: 270, preventDefault() {} })
  ptr.handlePointerMove({ type: 'pointermove', pointerId: 2, pointerType: 'mouse', buttons: 1, clientX: 520, clientY: 270, movementX: 40, movementY: 0 })
  ptr.handlePointerUp({ type: 'pointerup', pointerId: 2, pointerType: 'mouse', button: 0, buttons: 0, clientX: 520, clientY: 270, preventDefault() {} })
  assert.equal(primaryCalls, 1, 'Camera drag Left-Click release does NOT dispatch primary interaction')

  // Pointer-locked Left-Click
  doc.pointerLockElement = canvasHost
  ptr.handlePointerDown({ type: 'pointerdown', pointerId: 3, pointerType: 'mouse', button: 0, buttons: 1, clientX: 480, clientY: 270, preventDefault() {} })
  ptr.handlePointerUp({ type: 'pointerup', pointerId: 3, pointerType: 'mouse', button: 0, buttons: 0, clientX: 480, clientY: 270, preventDefault() {} })
  assert.equal(primaryCalls, 2, 'Pointer-locked Left-Click dispatches primary action cleanly')

  // Right-Click locked & unlocked + contextmenu prevented
  let ctxPrevented = false
  ptr.handleContextMenu({ type: 'contextmenu', preventDefault() { ctxPrevented = true } })
  assert.equal(ctxPrevented, true, 'Context menu suppressed during active gameplay')
  ptr.handlePointerDown({ type: 'pointerdown', pointerId: 4, pointerType: 'mouse', button: 2, buttons: 2, clientX: 480, clientY: 270, preventDefault() {} })
  assert.equal(secondaryCalls, 1, 'Pointer-locked Right-Click dispatches secondary action once')

  doc.pointerLockElement = null
  activePointers.add(5)
  ptr.handlePointerDown({ type: 'pointerdown', pointerId: 5, pointerType: 'mouse', button: 2, buttons: 2, clientX: 480, clientY: 270, preventDefault() {} })
  assert.equal(secondaryCalls, 2, 'Unlocked Right-Click dispatches secondary action once')

  // Modal / lockout suppression
  for (const [propKey, propVal] of [
    ['showDiagnosticsModal', true],
    ['hasWon', true],
    ['isGameOver', true],
    ['isArrivalLocked', true],
    ['controlsEnabled', false],
  ]) {
    const prev = latestProps[propKey]
    latestProps[propKey] = propVal
    let blockedCtx = false
    ptr.handleContextMenu({ type: 'contextmenu', preventDefault() { blockedCtx = true } })
    ptr.handlePointerDown({ type: 'pointerdown', pointerId: 6, pointerType: 'mouse', button: 0, buttons: 1, clientX: 480, clientY: 270, preventDefault() {} })
    ptr.handlePointerUp({ type: 'pointerup', pointerId: 6, pointerType: 'mouse', button: 0, buttons: 0, clientX: 480, clientY: 270, preventDefault() {} })
    ptr.handlePointerDown({ type: 'pointerdown', pointerId: 7, pointerType: 'mouse', button: 2, buttons: 2, clientX: 480, clientY: 270, preventDefault() {} })
    assert.equal(blockedCtx, false, `Contextmenu allowed when UI inactive (${propKey}=${propVal})`)
    assert.equal(primaryCalls, 2, `Left-Click ignored during ${propKey}=${propVal}`)
    assert.equal(secondaryCalls, 2, `Right-Click ignored during ${propKey}=${propVal}`)
    latestProps[propKey] = prev
  }

  // Real engine also blocks primary & secondary during spawn sequence / pause
  const { engine } = createHeadlessEngine({ skipSpawnSequence: false })
  engine.setMaze(maze)
  assert.equal(engine.isSpawnSequenceActive(), true)
  assert.equal(engine.handlePrimaryAction().handled, false)
  assert.equal(engine.handleSecondaryAction().handled, false)
  engine.cancelSpawnSequence()
  engine.setPaused(true)
  assert.equal(engine.handlePrimaryAction().handled, false)
  assert.equal(engine.handleSecondaryAction().handled, false)
  ptr.detach()
  engine.dispose()

  console.log('✓ Test 2 Passed: Mouse routing, pointer lock, contextmenu, single-dispatch & lockouts verified')
}

// -----------------------------------------------------------------------------
// 3. Real Engine Gameplay Interactions (Steam Repair + Valve + Hazards + Hiding + Objects + Exit)
// -----------------------------------------------------------------------------
{
  console.log('Test 3: End-to-end engine mouse interactions across Steam, Hazards, Hiding Spots, Objects & Exit')

  const grid = [
    [W, W, W, W, W, W, W, W, W],
    [W, S, P, P, P, P, P, E, W],
    [W, W, W, W, W, W, W, W, W],
  ]
  const maze = { grid, rows: 3, cols: 9, start: { row: 1, col: 1 }, exit: { row: 1, col: 7 }, level: 3, seed: 3030 }
  const { engine } = createHeadlessEngine()
  engine.setMaze(maze)
  engine.cancelSpawnSequence()
  engine.hazardManager.clear()
  engine.syncHazardColliders({ allowPushOut: false })

  assert.equal(typeof engine.interact, 'undefined', 'MazeSceneEngine.interact() does not exist')

  // A. Steam Pipe Burst — Left-Click near rupture starts repair; Right-Click does not cancel; Left-Click near valve seals
  const steamHaz = engine.hazardManager.addHazard({
    id: 'rework-steam',
    type: HAZARD_TYPES.STEAM_PIPE_BURST,
    row: 1,
    col: 3,
    wallSide: 'north',
  })
  steamHaz.state = HAZARD_STATES.ACTIVE
  const anchor = steamHaz.getInteractionAnchor()
  engine.setPlayerWorldPosition(anchor.x, 0, anchor.z + 1.0, { immediate: true })
  engine._notifyStealthChange?.(true)
  assert.equal(engine.getNearbyInteractable()?.label, 'Apply Repair Tape')

  const repairStart = engine.handlePrimaryAction()
  assert.equal(repairStart.handled, true)
  assert.equal(repairStart.isRepairing, true)
  assert.equal(engine.handleSecondaryAction().handled, false, 'Right-click does not cancel steam repair')
  for (let i = 0; i < 28; i += 1) engine.stepFrame(0.1, { render: false })
  assert.equal(engine.steamRepairController.getStateName(), STEAM_REPAIR_STATES.REPAIRED)
  assert.equal(steamHaz.getState(), HAZARD_STATES.DISABLED)
  assert.equal(steamHaz.getMesh().userData.repairCompletedByTape, true)

  // Valve shutoff on reset
  engine.resetCombat()
  steamHaz.state = HAZARD_STATES.ACTIVE
  engine.setPlayerWorldPosition(steamHaz.valveWorldPos.x - 1.0, 0, steamHaz.valveWorldPos.z + 0.85, { immediate: true })
  engine._notifyStealthChange?.(true)
  assert.equal(engine.getNearbyInteractable()?.label, 'Seal Steam Pipe')
  const valveOut = engine.handlePrimaryAction()
  assert.equal(valveOut.handled, true)
  assert.equal(valveOut.action, 'seal_steam_pipe')
  assert.equal(steamHaz.getState(), HAZARD_STATES.DISABLED)

  // B. Hiding Spots — Left-Click enters, Left-Click inside stays hidden, Right-Click exits across multiple types
  engine.hazardManager.clear()
  engine.syncHazardColliders({ allowPushOut: false })
  for (const spotType of ALL_HIDING_SPOT_TYPES.slice(0, 4)) {
    engine.hidingSpotManager.clear()
    engine.hidingSpotManager.addHidingSpot({
      id: `rework-spot-${spotType}`,
      type: spotType,
      row: 1,
      col: 4,
      wallSide: 'north',
    })
    engine.syncHidingSpotColliders?.()
    const spot = engine.hidingSpotManager.getHidingSpots()[0]
    engine.setPlayerWorldPosition(spot.entryAnchor.x, 0, spot.entryAnchor.z, { immediate: true })
    engine._notifyStealthChange?.(true)

    const enter = engine.handlePrimaryAction()
    assert.equal(enter.handled, true, `Left-Click enters ${spotType}`)
    assert.equal(engine.hidingSpotManager.isPlayerHiding(), true)

    const leftInside = engine.handlePrimaryAction()
    assert.equal(leftInside.handled, false, `Left-Click inside ${spotType} does NOT exit hiding`)
    assert.equal(leftInside.reason, 'hiding_requires_secondary')
    assert.equal(engine.hidingSpotManager.isPlayerHiding(), true)

    const exit = engine.handleSecondaryAction()
    assert.equal(exit.handled, true, `Right-Click exits ${spotType}`)
    assert.equal(engine.hidingSpotManager.isPlayerHiding(), false)
  }
  engine.hidingSpotManager.clear()
  engine.syncHidingSpotColliders?.()

  // C. Exposed Electrical Wiring, Floor Grate, Wall Collapse -> Left-Click activates; Right-Click does nothing
  for (const [type, expectedAction, standFn] of [
    [
      HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING,
      'insulate_wiring',
      (h) => {
        const anchor = h.breakerWorldPos || h.getInteractionAnchor?.() || gridToWorld(1, 4, maze)
        return { x: anchor.x - 2.08, z: anchor.z + 0.65 }
      },
    ],
    [
      HAZARD_TYPES.COLLAPSING_FLOOR_GRATE,
      'secure_floor_opening',
      (h) => {
        const anchor = h.originWorldPos || h.getInteractionAnchor?.() || gridToWorld(1, 4, maze)
        return { x: anchor.x - 1.5, z: anchor.z }
      },
    ],
    [
      HAZARD_TYPES.WALL_COLLAPSE,
      'clear_rubble',
      (h) => {
        const anchor = h.originWorldPos || h.getInteractionAnchor?.() || gridToWorld(1, 4, maze)
        return { x: anchor.x, z: anchor.z + 1.1 }
      },
    ],
  ]) {
    engine.electricalWiringController?.reset?.()
    engine.hazardManager.clear()
    engine.syncHazardColliders({ allowPushOut: false })
    const haz = engine.hazardManager.addHazard({ id: `rework-${type}`, type, row: 1, col: 4, wallSide: 'north' })
    if (type === HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING) {
      haz.state = HAZARD_STATES.ACTIVE
    } else {
      haz.state = HAZARD_STATES.DISABLED
      haz.isPermanentlyCollapsed = true
      haz.isDisabled = true
      haz._syncColliderStates(1)
    }
    engine.syncHazardColliders({ allowPushOut: false })
    const pos = standFn(haz)
    engine.setPlayerWorldPosition(pos.x, 0, pos.z, { immediate: true })
    engine._notifyStealthChange?.(true)
    assert.equal(engine.handleSecondaryAction().handled, false, `Right-Click does not trigger ${type}`)
    const primaryRes = engine.handlePrimaryAction()
    assert.equal(primaryRes.handled, true, `Left-Click triggers ${type}`)
    assert.equal(primaryRes.action, expectedAction)
  }
  engine.electricalWiringController?.reset?.()

  // D. Ceiling Rubble, Rotten Furniture & Fallen Pipes -> Left-Click grab/pickup & Right-Click release/place
  engine.hazardManager.clear()
  const rubbleHaz = engine.hazardManager.addHazard({ id: 'rework-rubble', type: HAZARD_TYPES.CEILING_COLLAPSE, row: 1, col: 4 })
  const rCenter = gridToWorld(1, 4, maze)
  rubbleHaz.update(0.05, { playerWorldPos: rCenter, playerGridCell: { row: 1, col: 4 } })
  for (let i = 0; i < 45; i += 1) rubbleHaz.update(0.06, { playerWorldPos: { x: 0, y: 0, z: 0 }, playerGridCell: { row: 1, col: 1 } })
  engine._syncHazardColliders({ allowPushOut: false })
  const rPiece = rubbleHaz.getRubblePieces()[0]
  rPiece.mesh.updateMatrixWorld(true)
  const rPos = new THREE.Vector3()
  rPiece.mesh.getWorldPosition(rPos)
  aimAtPoint(engine, rPos.x, rPos.y + 0.08, rPos.z, rPos.x - 1.25, rPos.z)
  const rubblePick = engine.handlePrimaryAction()
  assert.equal(rubblePick.handled, true, 'Left-Click picks up ceiling rubble')
  while (engine.rubbleController.getStateName() !== RUBBLE_CONTROLLER_STATES.CARRIED) {
    engine.rubbleController.update(0.1)
  }
  assert.equal(engine.rubbleController.getStateName(), RUBBLE_CONTROLLER_STATES.CARRIED)
  const rubblePlace = engine.handleSecondaryAction()
  assert.equal(rubblePlace.handled, true, 'Right-Click places carried ceiling rubble')
  engine.rubbleController.reset()

  // Rotten furniture
  engine.hazardManager.clear()
  const furnHaz = engine.hazardManager.addHazard({ id: 'rework-furn', type: HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE, row: 1, col: 4, wallSide: 'north' })
  furnHaz.state = HAZARD_STATES.DISABLED
  furnHaz.isPermanentlyCollapsed = true
  furnHaz.isDisabled = true
  furnHaz._syncColliderStates(1)
  engine._syncHazardColliders({ allowPushOut: false })
  aimAtPoint(engine, rCenter.x, 0.4, rCenter.z, rCenter.x - 1.35, rCenter.z)
  const furnGrip = engine.handlePrimaryAction()
  assert.equal(furnGrip.handled, true, 'Left-Click grips rotten furniture')
  assert.equal(engine.furnitureController.getStateName(), FURNITURE_HANDLING_STATES.GRIPPING)
  engine.furnitureController.update(0.5)
  const furnRel = engine.handleSecondaryAction()
  assert.equal(furnRel.handled, true, 'Right-Click releases rotten furniture')
  engine.furnitureController.update(0.5)

  // Fallen pipes
  engine.hazardManager.clear()
  const pipeHaz = engine.hazardManager.addHazard({ id: 'rework-pipe', type: HAZARD_TYPES.FALLING_PIPES_FIXTURES, row: 1, col: 4, wallSide: 'north' })
  pipeHaz.state = HAZARD_STATES.DISABLED
  pipeHaz.isPermanentlyCollapsed = true
  pipeHaz.isDisabled = true
  pipeHaz._syncColliderStates(1)
  engine._syncHazardColliders({ allowPushOut: false })
  aimAtPoint(engine, rCenter.x, 0.28, rCenter.z, rCenter.x - 1.35, rCenter.z)
  const pipeGrip = engine.handlePrimaryAction()
  assert.equal(pipeGrip.handled, true, 'Left-Click grips fallen pipes')
  assert.equal(engine.pipesController.getStateName(), PIPES_HANDLING_STATES.GRIPPING)
  engine.pipesController.update(0.5)
  const pipeRel = engine.handleSecondaryAction()
  assert.equal(pipeRel.handled, true, 'Right-Click releases fallen pipes')

  // E. Exit Gate (Left-Click locked/extract, Right-Click ignored)
  engine.hazardManager.clear()
  const exitW = gridToWorld(1, 7, maze)
  const nbW = gridToWorld(1, 6, maze)
  engine.setPlayerWorldPosition((exitW.x + nbW.x) * 0.5, 0, exitW.z, { yaw: -Math.PI * 0.5, immediate: true })
  engine.setExitLocked(true, { animate: false })
  assert.equal(engine.handleSecondaryAction().handled, false, 'Right-Click does not activate exit')
  assert.equal(engine.handlePrimaryAction().action, 'locked_exit', 'Left-Click triggers locked exit cue')
  engine.setExitLocked(false, { animate: false })
  assert.equal(engine.handlePrimaryAction().action, 'extract', 'Left-Click triggers unlocked exit extraction')

  engine.dispose()
  console.log('✓ Test 3 Passed: All mouse primary/secondary gameplay interactions verified')
}

// -----------------------------------------------------------------------------
// 4. Mounted UI Integration (App + SettingsView + MazeViewport3D + TouchControls3D + HowToPlay)
// -----------------------------------------------------------------------------
{
  console.log('Test 4: Mounted UI integration (F-key dead, Left-Click/Right-Click prompt, TouchControls3D, HowToPlay)')

  const domEnv = createSpecDomEnv()
  const prevGlobals = new Map()
  const install = (k, v) => {
    prevGlobals.set(k, Object.getOwnPropertyDescriptor(globalThis, k))
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  }
  install('IS_REACT_ACT_ENVIRONMENT', true)
  install('window', domEnv.window)
  install('document', domEnv.document)
  install('Node', domEnv.Node)
  install('Element', domEnv.Element)
  install('HTMLElement', domEnv.HTMLElement)
  install('HTMLCanvasElement', domEnv.HTMLCanvasElement)
  install('ResizeObserver', domEnv.ResizeObserver)
  install('localStorage', domEnv.window.localStorage)

  const viteServer = await createServer({
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  })

  try {
    const { default: HowToPlayContent } = await viteServer.ssrLoadModule('/src/components/game/HowToPlayContent.jsx')
    const { default: TouchControls3D } = await viteServer.ssrLoadModule('/src/components/game/TouchControls3D.jsx')
    const { default: MazeViewport3D } = await viteServer.ssrLoadModule('/src/components/game/MazeViewport3D.jsx')
    const { default: SettingsView } = await viteServer.ssrLoadModule('/src/components/settings/SettingsView.jsx')

    // 4a. HowToPlayContent documents Left-Click / Right-Click and contains zero Press F instructions
    const htpHost = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(htpHost)
    const htpRoot = createRoot(htpHost)
    await act(async () => {
      htpRoot.render(createElement(HowToPlayContent, {}))
    })
    const htpText = htpHost.textContent
    assert.equal(/press\s+f\b|\(f\)/i.test(htpText), false, 'HowToPlayContent has zero Press F instructions')
    assert.ok(htpText.includes('Left-Click') && htpText.includes('Right-Click'), 'HowToPlayContent documents Left-Click and Right-Click')
    await act(async () => htpRoot.unmount())

    // 4b. SettingsView omits [data-keybind-action="interact"]
    resetAllSettings()
    const initialAll = loadAllSettings()
    const setHost = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(setHost)
    const setRoot = createRoot(setHost)
    await act(async () => {
      setRoot.render(
        createElement(SettingsView, {
          initialCategory: 'controls',
          audioSettings: initialAll.audio,
          controlSettings: initialAll.controls,
          graphicsSettings: initialAll.graphics,
          gameplaySettings: initialAll.gameplay,
          onBack: () => {},
        })
      )
    })
    assert.equal(setHost.querySelector('[data-keybind-action="interact"]'), null, 'SettingsView hides Interact keybind')
    assert.equal(setHost.querySelectorAll('[data-keybind-action]').length, 13, 'SettingsView renders exact 13 keybinds')
    await act(async () => setRoot.unmount())

    // 4c. TouchControls3D preserves Hide / Exit labels without (F) in aria-label
    let touchClicks = 0
    const touchHost = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(touchHost)
    const touchRoot = createRoot(touchHost)
    await act(async () => {
      touchRoot.render(
        createElement(TouchControls3D, {
          stealthState: { canInteract: true, isHiding: false, nearbyInteractableShortLabel: 'Hide' },
          onTriggerInteract: () => { touchClicks += 1 },
        })
      )
    })
    const touchBtnOut = touchHost.querySelector('[data-touch-action="interact"]')
    assert.ok(touchBtnOut, 'TouchControls3D renders interact button on touch devices')
    assert.equal(touchBtnOut.getAttribute('aria-label').includes('(F)'), false, 'Touch interact aria-label drops (F)')
    await act(async () => {
      touchBtnOut.dispatchEvent({ type: 'pointerdown', pointerId: 1, button: 0, preventDefault() {} })
      touchBtnOut.dispatchEvent({ type: 'pointerup', pointerId: 1, button: 0, preventDefault() {} })
    })
    assert.equal(touchClicks, 1)

    await act(async () => {
      touchRoot.render(
        createElement(TouchControls3D, {
          stealthState: { canInteract: true, isHiding: true, nearbyInteractableShortLabel: 'Exit' },
          onTriggerInteract: () => { touchClicks += 1 },
        })
      )
    })
    const touchBtnHide = touchHost.querySelector('[data-touch-action="interact"]')
    assert.equal(touchBtnHide.textContent.trim(), 'Exit')
    assert.equal(touchBtnHide.getAttribute('aria-label'), 'Exit hiding spot')
    await act(async () => touchRoot.unmount())

    // 4d. MazeViewport3D renders Left-Click / Right-Click prompt badges and F key does nothing even with legacy interact: 'f'
    saveAllSettings({
      ...loadAllSettings(),
      controls: {
        ...loadAllSettings().controls,
        keyBindings: { ...DEFAULT_KEY_BINDINGS, interact: 'f' },
      },
    })
    const vpHost = domEnv.document.createElement('div')
    domEnv.document.body.appendChild(vpHost)
    const vpRoot = createRoot(vpHost)
    let engineRef = null
    const baseVpProps = {
      maze: { grid: [[W, W, W], [W, S, W], [W, E, W]], rows: 3, cols: 3, start: { row: 1, col: 1 }, exit: { row: 2, col: 1 }, level: 1, seed: 10 },
      level: 1,
      controlsEnabled: true,
      hasWon: false,
      isGameOver: false,
      isArrivalLocked: false,
      keyBindings: loadAllSettings().controls.keyBindings,
      engineFactory: (_c, cfg) => {
        const fake = {
          config: cfg,
          isDisposed: false,
          primaryCalls: 0,
          secondaryCalls: 0,
          setMaze() {},
          setConfig() {},
          setPaused() {},
          setHasWon() {},
          setIsGameOver() {},
          setLevelTransitionState() {},
          setExitLocked() {},
          setStealthState() {},
          setPlayerWorldPosition() {},
          setLookDirection() {},
          setInput() {},
          stepFrame() {},
          unlockAudio() {},
          toggleFlashlight() {},
          triggerWayfinderBeacon() {},
          cycleThirdPersonDistance() {},
          isExtractionSequenceActive: () => false,
          isSpawnSequenceActive: () => false,
          isLevelTransitionActive: () => false,
          getNearbyInteractable: () => ({ id: 'spot-1', kind: 'hiding_spot', label: 'Hide in Metal Locker', shortLabel: 'Hide' }),
          getStealthState: () => ({ canInteract: true, isHiding: false, noiseLevel: 0, exposureLevel: 0 }),
          getRubbleInteractionState: () => ({ canPickup: false, isCarrying: false }),
          getFurnitureInteractionState: () => ({ canGrip: false, isHandling: false }),
          getPipesInteractionState: () => ({ canGrip: false, isHandling: false }),
          getSteamRepairInteractionState: () => ({ canRepair: false, isRepairing: false }),
          handlePrimaryAction: () => {
            fake.primaryCalls += 1
            return { handled: true }
          },
          handleSecondaryAction: () => {
            fake.secondaryCalls += 1
            return { handled: true }
          },
          dispose() {
            fake.isDisposed = true
          },
        }
        engineRef = fake
        return fake
      },
    }

    await act(async () => {
      vpRoot.render(createElement(MazeViewport3D, baseVpProps))
    })
    assert.ok(engineRef, 'MazeViewport3D initialized engine')
    assert.equal(vpHost.querySelector('.maze-interact-prompt__key')?.textContent?.trim(), 'Left-Click')

    // Pressing F / KeyF must NEVER trigger primary or secondary action!
    await act(async () => {
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'f', code: 'KeyF', target: domEnv.document.body })
      domEnv.window.dispatchEvent({ type: 'keydown', key: 'F', code: 'KeyF', target: domEnv.document.body })
    })
    assert.equal(engineRef.primaryCalls, 0, 'F key does NOT call handlePrimaryAction in MazeViewport3D')
    assert.equal(engineRef.secondaryCalls, 0, 'F key does NOT call handleSecondaryAction in MazeViewport3D')

    await act(async () => vpRoot.unmount())
  } finally {
    await viteServer.close()
    for (const [k, desc] of prevGlobals.entries()) {
      if (desc) Object.defineProperty(globalThis, k, desc)
      else delete globalThis[k]
    }
  }

  console.log('✓ Test 4 Passed: Mounted UI components, F-key dead check, Left/Right-Click badges & TouchControls3D verified')
}

// -----------------------------------------------------------------------------
// 5. Static Source Audit: Zero Obsolete F-Key Interaction Prompts/Bindings in Production Src
// -----------------------------------------------------------------------------
{
  console.log('Test 5: Production source audit for zero remaining F-key gameplay bindings or prompts')
  const prodFiles = [
    'src/game/three/threeConfig.js',
    'src/hooks/useContinuousInput.js',
    'src/game/three/MazeSceneEngine.js',
    'src/game/three/viewportPointerCapture.js',
    'src/game/three/HazardAgent.js',
    'src/components/game/MazeViewport3D.jsx',
    'src/components/game/TouchControls3D.jsx',
    'src/components/game/HowToPlayContent.jsx',
    'src/components/settings/SettingsView.jsx',
    'src/components/settings/settingsConfig.js',
  ]
  for (const rel of prodFiles) {
    const src = fs.readFileSync(path.resolve(rel), 'utf8')
    assert.equal(/press\s+f\b|f-key|interactKeyLabel/i.test(src), false, `${rel} contains zero F-key prompt/wording`)
    assert.equal(/bindings\.interact|DEFAULT_KEY_BINDINGS\.interact|data-keybind-action="interact"/i.test(src), false, `${rel} contains zero interact keybinding references`)
  }
  console.log('✓ Test 5 Passed: Production source files clean of F-key gameplay interaction bindings & prompts')
}

console.log('\n=============================================================')
console.log('ALL 5 MAZE-INPUT-REWORK-001 VERIFICATION SUITES PASSED!')
console.log('=============================================================')
