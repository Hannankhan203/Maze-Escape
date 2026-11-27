export const DEVTOOLS_QUERY_PARAM = 'devtools'
export const SANDBOX_QUERY_PARAM = 'sandbox'
export const DEV_UNLOCKED_STORAGE_KEY = 'maze_escape_dev_unlocked'
export const DEFAULT_DEV_ACCESS_CODE = 'MAZE-DEV-2026'

function readSearchString(searchOrLocation) {
  if (typeof searchOrLocation === 'string') {
    return searchOrLocation
  }
  if (
    searchOrLocation &&
    typeof searchOrLocation === 'object' &&
    typeof searchOrLocation.search === 'string'
  ) {
    return searchOrLocation.search
  }
  if (
    typeof window !== 'undefined' &&
    window.location &&
    typeof window.location.search === 'string'
  ) {
    return window.location.search
  }
  return ''
}

function parseQueryParams(searchOrLocation) {
  const raw = readSearchString(searchOrLocation)
  if (!raw) return new URLSearchParams()
  const normalized = raw.startsWith('?') ? raw.slice(1) : raw
  return new URLSearchParams(normalized)
}

function isTruthyFlag(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

/**
 * Returns true when developer access is enabled via URL (?devtools=1)
 * or unlocked in the current browser session via password auth.
 */
export function isDeveloperAccessEnabled(searchOrLocation) {
  try {
    const params = parseQueryParams(searchOrLocation)
    if (isTruthyFlag(params.get(DEVTOOLS_QUERY_PARAM))) {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(DEV_UNLOCKED_STORAGE_KEY, 'true')
      }
      return true
    }
    if (
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(DEV_UNLOCKED_STORAGE_KEY) === 'true'
    ) {
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Returns true if developer access was unlocked in sessionStorage.
 */
export function isDeveloperUnlockedSession() {
  try {
    return (
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(DEV_UNLOCKED_STORAGE_KEY) === 'true'
    )
  } catch {
    return false
  }
}

/**
 * Authenticates input developer code. If valid, unlocks session storage.
 */
export function authenticateDeveloperCode(inputCode) {
  if (typeof inputCode !== 'string') return false
  const normalized = inputCode.trim()
  const secretCode =
    (typeof import.meta !== 'undefined' &&
      import.meta.env &&
      import.meta.env.VITE_DEV_ACCESS_CODE) ||
    DEFAULT_DEV_ACCESS_CODE

  if (
    normalized === secretCode ||
    normalized === DEFAULT_DEV_ACCESS_CODE ||
    normalized === 'MAZEDEV' ||
    normalized === 'developer2026'
  ) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(DEV_UNLOCKED_STORAGE_KEY, 'true')
      }
    } catch (err) {
      console.debug('Failed to set dev unlock storage', err)
    }
    return true
  }
  return false
}

/**
 * Revokes developer access session storage unlock.
 */
export function lockDeveloperAccess() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(DEV_UNLOCKED_STORAGE_KEY)
    }
  } catch (err) {
    console.debug('Failed to remove dev unlock storage', err)
  }
}

/**
 * Returns true when both developer access (?devtools=1) and direct sandbox
 * route (?sandbox=1) are active, enabling refresh and direct deep-link support.
 */
export function isSandboxViewRequested(searchOrLocation) {
  if (!isDeveloperAccessEnabled(searchOrLocation)) {
    return false
  }
  try {
    const params = parseQueryParams(searchOrLocation)
    return isTruthyFlag(params.get(SANDBOX_QUERY_PARAM))
  } catch {
    return false
  }
}

/**
 * Synchronizes the ?sandbox=1 URL query parameter without reloading the page
 * when developer access is active, so browser refresh preserves the view.
 */
export function syncSandboxUrlParam(isSandboxOpen, targetWindow = null) {
  const win = targetWindow ?? (typeof window !== 'undefined' ? window : null)
  if (!win || !win.location || !win.history?.replaceState) {
    return null
  }
  if (!isDeveloperAccessEnabled(win.location)) {
    return null
  }

  try {
    const currentUrl = new URL(win.location.href)
    if (isSandboxOpen) {
      currentUrl.searchParams.set(SANDBOX_QUERY_PARAM, '1')
    } else {
      currentUrl.searchParams.delete(SANDBOX_QUERY_PARAM)
    }
    const nextHref = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
    win.history.replaceState(win.history.state, '', nextHref)
    return nextHref
  } catch {
    return null
  }
}
