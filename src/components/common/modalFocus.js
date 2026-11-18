const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function safeFocus(element) {
  if (!element || typeof element.focus !== 'function') {
    return false
  }
  try {
    element.focus({ preventScroll: true })
  } catch {
    element.focus()
  }
  return true
}

function isElementFocusable(element) {
  if (!element) return false
  if (element.disabled === true) return false
  if (element.hidden === true) return false
  if (element.hasAttribute?.('disabled')) return false
  if (element.getAttribute?.('aria-hidden') === 'true') return false
  if (element.style?.display === 'none' || element.style?.visibility === 'hidden') {
    return false
  }

  const tabIndexAttr = element.getAttribute?.('tabindex')
  if (tabIndexAttr === '-1') return false

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const computed = window.getComputedStyle(element)
      if (computed.display === 'none' || computed.visibility === 'hidden') {
        return false
      }
    } catch {
      // Ignore synthetic nodes not attached to a real Document
    }
  }

  return true
}

export function getFocusableElements(container) {
  if (!container || typeof container.querySelectorAll !== 'function') {
    return []
  }

  const candidates = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
  return candidates.filter(isElementFocusable)
}

export function isElementInside(container, target) {
  if (!container || !target) return false
  if (container === target) return true
  if (typeof container.contains === 'function') {
    return container.contains(target)
  }
  return false
}

export function focusModalInitialElement(dialogEl, doc = typeof document !== 'undefined' ? document : null) {
  if (!dialogEl) return null

  const activeEl = doc?.activeElement || null
  if (activeEl && isElementInside(dialogEl, activeEl) && activeEl !== dialogEl) {
    return activeEl
  }

  const focusables = getFocusableElements(dialogEl)
  const target = focusables.length > 0 ? focusables[0] : dialogEl
  return safeFocus(target) ? target : null
}

export function handleModalTabKey(
  event,
  dialogEl,
  activeElement = typeof document !== 'undefined' ? document.activeElement : null
) {
  if (!event || event.key !== 'Tab' || !dialogEl) {
    return false
  }

  const focusables = getFocusableElements(dialogEl)
  if (focusables.length === 0) {
    event.preventDefault?.()
    safeFocus(dialogEl)
    return true
  }

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const insideDialog = isElementInside(dialogEl, activeElement)

  if (!insideDialog) {
    event.preventDefault?.()
    safeFocus(event.shiftKey ? last : first)
    return true
  }

  if (event.shiftKey) {
    if (activeElement === first || activeElement === dialogEl) {
      event.preventDefault?.()
      safeFocus(last)
      return true
    }
    return false
  }

  if (activeElement === last) {
    event.preventDefault?.()
    safeFocus(first)
    return true
  }

  return false
}

export function restoreModalTriggerFocus(
  triggerElement,
  doc = typeof document !== 'undefined' ? document : null
) {
  if (!triggerElement || typeof triggerElement.focus !== 'function') {
    return false
  }
  if (doc?.body && triggerElement === doc.body) {
    return false
  }
  if (typeof doc?.contains === 'function' && !doc.contains(triggerElement)) {
    return false
  }

  return safeFocus(triggerElement)
}
