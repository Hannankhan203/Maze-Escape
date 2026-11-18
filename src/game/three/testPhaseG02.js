import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { handleModalEscapeKey } from '../../components/common/modalEscape.js'
import {
  focusModalInitialElement,
  getFocusableElements,
  handleModalTabKey,
  restoreModalTriggerFocus,
} from '../../components/common/modalFocus.js'
import {
  applyFlashlightClick,
  applyFlashlightKeyDown,
  applyFlashlightPointerDown,
  applyFlashlightPointerEnd,
  clearFlashlightResetTimer,
  createFlashlightPointerState,
} from '../../components/game/flashlightButtonState.js'

console.log('--- Running Phase G Prompt 02 Accessibility, Modal Focus & Mobile Polish Suite ---')

// ---------------------------------------------------------------------------
// 1. Modal Focus Entry, Tab/Shift+Tab Trapping, Restoration & Escape Safety
// ---------------------------------------------------------------------------
{
  console.log('Test 1: Modal focus entry, Tab/Shift+Tab wrap, restoration & Escape safety')

  function createMockFocusNode(name, props = {}) {
    const attrs = { ...(props.attrs || {}) }
    const node = {
      name,
      disabled: Boolean(props.disabled),
      hidden: Boolean(props.hidden),
      style: props.style || {},
      focusCalls: 0,
      hasAttribute(attr) {
        return attr in attrs
      },
      getAttribute(attr) {
        return attr in attrs ? attrs[attr] : null
      },
      focus() {
        node.focusCalls += 1
        if (props.onFocus) props.onFocus(node)
      },
    }
    return node
  }

  let currentActive = null
  const setActive = (node) => {
    currentActive = node
  }

  const triggerBtn = createMockFocusNode('triggerBtn', { onFocus: setActive })
  const disabledBtn = createMockFocusNode('disabledBtn', {
    disabled: true,
    onFocus: setActive,
  })
  const ariaHiddenBtn = createMockFocusNode('ariaHiddenBtn', {
    attrs: { 'aria-hidden': 'true' },
    onFocus: setActive,
  })
  const negTabBtn = createMockFocusNode('negTabBtn', {
    attrs: { tabindex: '-1' },
    onFocus: setActive,
  })
  const closeBtn = createMockFocusNode('closeBtn', { onFocus: setActive })
  const middleInput = createMockFocusNode('middleInput', { onFocus: setActive })
  const confirmBtn = createMockFocusNode('confirmBtn', { onFocus: setActive })

  const allChildren = [
    disabledBtn,
    ariaHiddenBtn,
    negTabBtn,
    closeBtn,
    middleInput,
    confirmBtn,
  ]

  const dialogEl = createMockFocusNode('dialog', { onFocus: setActive })
  dialogEl.contains = (target) => target === dialogEl || allChildren.includes(target)
  dialogEl.querySelectorAll = () => allChildren

  const mockDoc = {
    body: createMockFocusNode('body', { onFocus: setActive }),
    get activeElement() {
      return currentActive
    },
    contains(node) {
      return node === triggerBtn || node === dialogEl || allChildren.includes(node)
    },
  }

  // Trigger currently holds focus
  currentActive = triggerBtn
  const focusables = getFocusableElements(dialogEl)
  assert.deepEqual(
    focusables.map((n) => n.name),
    ['closeBtn', 'middleInput', 'confirmBtn'],
    'Only enabled, visible, tabbable elements are collected'
  )

  // Focus moves into first focusable modal control on open
  const initialFocused = focusModalInitialElement(dialogEl, mockDoc)
  assert.equal(initialFocused, closeBtn)
  assert.equal(currentActive, closeBtn)

  // Shift+Tab from first element wraps to last element
  let defaultPrevented = false
  assert.equal(
    handleModalTabKey(
      { key: 'Tab', shiftKey: true, preventDefault: () => { defaultPrevented = true } },
      dialogEl,
      currentActive
    ),
    true
  )
  assert.equal(defaultPrevented, true)
  assert.equal(currentActive, confirmBtn)

  // Tab from last element wraps to first element
  defaultPrevented = false
  assert.equal(
    handleModalTabKey(
      { key: 'Tab', shiftKey: false, preventDefault: () => { defaultPrevented = true } },
      dialogEl,
      currentActive
    ),
    true
  )
  assert.equal(defaultPrevented, true)
  assert.equal(currentActive, closeBtn)

  // Tab from middle/non-boundary element allows native focus advance
  currentActive = middleInput
  defaultPrevented = false
  assert.equal(
    handleModalTabKey(
      { key: 'Tab', shiftKey: false, preventDefault: () => { defaultPrevented = true } },
      dialogEl,
      currentActive
    ),
    false
  )
  assert.equal(defaultPrevented, false)

  // Focus escaped outside dialog -> Tab pulls back into dialog
  currentActive = triggerBtn
  defaultPrevented = false
  assert.equal(
    handleModalTabKey(
      { key: 'Tab', shiftKey: false, preventDefault: () => { defaultPrevented = true } },
      dialogEl,
      currentActive
    ),
    true
  )
  assert.equal(defaultPrevented, true)
  assert.equal(currentActive, closeBtn)

  // Dialog with zero focusable controls falls back to dialog container and traps Tab
  const emptyDialog = createMockFocusNode('emptyDialog', { onFocus: setActive })
  emptyDialog.contains = (t) => t === emptyDialog
  emptyDialog.querySelectorAll = () => []
  assert.equal(focusModalInitialElement(emptyDialog, { activeElement: triggerBtn }), emptyDialog)
  assert.equal(currentActive, emptyDialog)
  defaultPrevented = false
  assert.equal(
    handleModalTabKey(
      { key: 'Tab', shiftKey: false, preventDefault: () => { defaultPrevented = true } },
      emptyDialog,
      currentActive
    ),
    true
  )
  assert.equal(defaultPrevented, true)
  assert.equal(currentActive, emptyDialog)

  // Restore focus to trigger on close (skipping detached nodes / body)
  assert.equal(restoreModalTriggerFocus(triggerBtn, mockDoc), true)
  assert.equal(currentActive, triggerBtn)
  assert.equal(restoreModalTriggerFocus(mockDoc.body, mockDoc), false)
  const detachedBtn = createMockFocusNode('detached')
  assert.equal(restoreModalTriggerFocus(detachedBtn, mockDoc), false)

  // Escape safety preserved for Victory/Game Over vs dismissible modals
  let escapeClosed = 0
  assert.equal(
    handleModalEscapeKey(
      { key: 'Escape' },
      { closeOnEscape: false, onClose: () => { escapeClosed += 1 } }
    ),
    false
  )
  assert.equal(escapeClosed, 0)
  assert.equal(
    handleModalEscapeKey(
      { key: 'Escape' },
      { closeOnEscape: true, onClose: () => { escapeClosed += 1 } }
    ),
    true
  )
  assert.equal(escapeClosed, 1)

  const modalSrc = fs.readFileSync(path.resolve('src/components/common/Modal.jsx'), 'utf8')
  assert.ok(
    modalSrc.includes('focusModalInitialElement') &&
      modalSrc.includes('handleModalTabKey') &&
      modalSrc.includes('restoreModalTriggerFocus') &&
      modalSrc.includes('tabIndex={-1}') &&
      modalSrc.includes('onCloseRef'),
    'Modal.jsx wires focus entry, Tab trap, trigger restoration, and ref-stable callbacks'
  )

  console.log('✓ Modal focus management and Escape behavior verified')
}

// ---------------------------------------------------------------------------
// 2. Reduced Motion Prop Wiring & Global Styles
// ---------------------------------------------------------------------------
{
  console.log('Test 2: Reduced Motion GameShell wiring & CSS coverage')

  const appSrc = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')
  assert.ok(
    appSrc.includes('reducedMotion={Boolean(horrorConfig.reducedMotion)}'),
    'App.jsx passes horrorConfig.reducedMotion into GameShell'
  )

  const shellSrc = fs.readFileSync(path.resolve('src/components/layout/GameShell.jsx'), 'utf8')
  assert.ok(
    shellSrc.includes("data-reduced-motion={reducedMotion ? 'true' : 'false'}"),
    'GameShell emits data-reduced-motion attribute wrapping both 2D and 3D views'
  )

  const globalCss = fs.readFileSync(path.resolve('src/styles/global.css'), 'utf8')
  assert.ok(
    globalCss.includes("[data-reduced-motion='true'] *") &&
      globalCss.includes('@media (prefers-reduced-motion: reduce)'),
    'global.css enforces reduced-motion animations/transitions globally'
  )

  console.log('✓ Reduced motion wiring across 2D and 3D shell verified')
}

// ---------------------------------------------------------------------------
// 3. Flashlight Pointer Cancellation, Outside Release & Keyboard Activation
// ---------------------------------------------------------------------------
{
  console.log('Test 3: Flashlight pointer outside-release, cancel, duplicate guard & Enter/Space')

  const buttonEl = {
    getBoundingClientRect: () => ({ left: 100, right: 160, top: 200, bottom: 260, width: 60, height: 60 }),
  }

  let toggles = 0
  const toggleFn = () => {
    toggles += 1
  }

  // Case A: Standard tap inside button (pointerdown -> pointerup inside -> click) toggles once
  const state = createFlashlightPointerState()
  const pId1 = applyFlashlightPointerDown(state, { pointerId: 1, button: 0 }, { enabled: true })
  assert.equal(pId1, 1)
  toggleFn()
  assert.equal(toggles, 1)

  const endInside = applyFlashlightPointerEnd(
    state,
    { type: 'pointerup', pointerId: 1, clientX: 130, clientY: 230 },
    { element: buttonEl }
  )
  assert.equal(endInside.ended, true)
  assert.equal(endInside.clearedImmediately, false)

  // Browser click right after pointerup must NOT double toggle
  assert.equal(applyFlashlightClick(state, { enabled: true }), false)
  assert.equal(toggles, 1, 'Duplicate click after pointerdown+pointerup suppressed')

  // Case B: Pointer pressed inside, released OUTSIDE button (no click event fires) -> clears immediately
  const pId2 = applyFlashlightPointerDown(state, { pointerId: 2, button: 0 }, { enabled: true })
  assert.equal(pId2, 2)
  toggleFn()
  assert.equal(toggles, 2)

  const endOutside = applyFlashlightPointerEnd(
    state,
    { type: 'pointerup', pointerId: 2, clientX: 300, clientY: 400 },
    { element: buttonEl }
  )
  assert.equal(endOutside.ended, true)
  assert.equal(endOutside.clearedImmediately, true)
  assert.equal(state.pointerTriggered, false, 'pointerTriggered must not stick after outside release')

  // Subsequent Enter and Space keyboard activations must always work
  applyFlashlightKeyDown(state, { key: 'Enter' })
  assert.equal(applyFlashlightClick(state, { enabled: true }), true)
  toggleFn()
  assert.equal(toggles, 3, 'Enter key activation works after outside pointer release')

  applyFlashlightKeyDown(state, { key: ' ' })
  assert.equal(applyFlashlightClick(state, { enabled: true }), true)
  toggleFn()
  assert.equal(toggles, 4, 'Space key activation works cleanly')

  // Case C: pointercancel clears pointerTriggered immediately
  applyFlashlightPointerDown(state, { pointerId: 3, button: 0 }, { enabled: true })
  toggleFn()
  assert.equal(toggles, 5)
  const endCancel = applyFlashlightPointerEnd(
    state,
    { type: 'pointercancel', pointerId: 3 },
    { element: buttonEl }
  )
  assert.equal(endCancel.clearedImmediately, true)
  assert.equal(state.pointerTriggered, false)

  // Case D: pointerup inside when browser suppresses click -> deferred timer resets pointerTriggered
  applyFlashlightPointerDown(state, { pointerId: 4, button: 0 }, { enabled: true })
  toggleFn()
  assert.equal(toggles, 6)
  applyFlashlightPointerEnd(
    state,
    { type: 'pointerup', pointerId: 4, clientX: 120, clientY: 220 },
    { element: buttonEl }
  )
  assert.equal(state.pointerTriggered, true)
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal(
    state.pointerTriggered,
    false,
    'Deferred cleanup clears pointerTriggered when no click event arrives'
  )

  // Case E: Enter key clears pending timer/flag immediately even before deferred timeout fires
  applyFlashlightPointerDown(state, { pointerId: 5, button: 0 }, { enabled: true })
  applyFlashlightPointerEnd(
    state,
    { type: 'pointerup', pointerId: 5, clientX: 120, clientY: 220 },
    { element: buttonEl }
  )
  assert.equal(applyFlashlightKeyDown(state, { key: 'Enter' }), true)
  assert.equal(state.pointerTriggered, false)
  assert.equal(applyFlashlightClick(state, { enabled: true }), true)

  // Case F: Disabled state rejects pointerdown and click
  assert.equal(applyFlashlightPointerDown(state, { pointerId: 6, button: 0 }, { enabled: false }), false)
  assert.equal(applyFlashlightClick(state, { enabled: false }), false)
  clearFlashlightResetTimer(state)

  const touchControlsSrc = fs.readFileSync(
    path.resolve('src/components/game/TouchControls3D.jsx'),
    'utf8'
  )
  assert.ok(
    touchControlsSrc.includes('handleFlashlightKeyDown') &&
      touchControlsSrc.includes('onKeyDown={handleFlashlightKeyDown}'),
    'TouchControls3D binds handleFlashlightKeyDown on Light button'
  )

  console.log('✓ Flashlight outside-release, cancel, keyboard Enter/Space, and dedupe verified')
}

// ---------------------------------------------------------------------------
// 4. Mobile Landscape 844x390 Layout & WCAG AA Muted Text Contrast
// ---------------------------------------------------------------------------
{
  console.log('Test 4: 844x390 landscape stage sizing & WCAG AA contrast verification')

  const mazeCss = fs.readFileSync(path.resolve('src/styles/maze.css'), 'utf8')
  const landscapeSectionIdx = mazeCss.indexOf('@media (max-height: 540px) and (orientation: landscape)')
  assert.ok(landscapeSectionIdx !== -1, 'Landscape media query exists in maze.css')
  const landscapeSection = mazeCss.slice(landscapeSectionIdx)

  assert.ok(
    landscapeSection.includes('min-height: 224px;') &&
      landscapeSection.includes('height: clamp(224px, 66dvh, 360px);') &&
      landscapeSection.includes('max-height: 74dvh;'),
    '844x390 landscape stage overrides base 260px min-height with compact non-clipping bounds'
  )

  // Verify mathematical WCAG 2.1 contrast ratio >= 4.5:1 on actual dark background tokens
  const tokensCss = fs.readFileSync(path.resolve('src/styles/tokens.css'), 'utf8')
  const readToken = (name) => {
    const match = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))
    assert.ok(match, `Token ${name} must exist as hex in tokens.css`)
    return match[1]
  }

  const srgbToLinear = (c) => {
    const norm = c / 255
    return norm <= 0.03928 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4)
  }
  const luminance = (hex) => {
    const n = Number.parseInt(hex.slice(1), 16)
    const r = (n >> 16) & 255
    const g = (n >> 8) & 255
    const b = n & 255
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  }
  const contrastRatio = (fg, bg) => {
    const l1 = luminance(fg)
    const l2 = luminance(bg)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  }

  const mutedHex = readToken('--color-text-muted')
  const surfaces = [
    '--color-bg-void',
    '--color-bg-recessed',
    '--color-bg-chamber',
    '--color-bg-elevated',
    '--color-bg-elevated-hover',
    '--color-wall-body',
  ]
  for (const surface of surfaces) {
    const bgHex = readToken(surface)
    const ratio = contrastRatio(mutedHex, bgHex)
    assert.ok(
      ratio >= 4.5,
      `--color-text-muted (${mutedHex}) on ${surface} (${bgHex}) must meet WCAG AA >= 4.5:1 (got ${ratio.toFixed(2)}:1)`
    )
  }

  console.log('✓ 844x390 landscape CSS sizing and WCAG AA >= 4.5:1 muted text contrast verified')
}

console.log('=== ALL PHASE G PROMPT 02 ACCESSIBILITY & MOBILE POLISH TESTS PASSED! ===')
