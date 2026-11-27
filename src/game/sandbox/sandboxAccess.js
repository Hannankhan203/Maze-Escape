export const DEVTOOLS_QUERY_PARAM = 'devtools'
export const SANDBOX_QUERY_PARAM = 'sandbox'
export const DEV_UNLOCKED_STORAGE_KEY = 'maze_escape_dev_unlocked_v1'
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
 * Returns true if the application is running in a production build environment.
 */
export function isProductionEnvironment() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      if (import.meta.env.PROD || import.meta.env.MODE === 'production') {
        return true
      }
    }
  } catch {
    // Fail closed to production if environment check fails
    return true
  }
  return false
}

/**
 * Returns true when developer access is enabled.
 * STRICTLY returns false in production environments, ignoring URL params or session storage.
 */
export function isDeveloperAccessEnabled(searchOrLocation) {
  if (isProductionEnvironment()) {
    return false
  }

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
  } catch (err) {
    console.debug('Failed to evaluate developer access status', err)
    return false
  }
}

/**
 * Returns true if developer access was unlocked in sessionStorage and not in production.
 */
export function isDeveloperUnlockedSession() {
  if (isProductionEnvironment()) {
    return false
  }

  try {
    return (
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(DEV_UNLOCKED_STORAGE_KEY) === 'true'
    )
  } catch (err) {
    console.debug('Failed to check sessionStorage unlock state', err)
    return false
  }
}

/**
 * Authenticates input developer code. Fails closed in production.
 */
export function authenticateDeveloperCode(inputCode) {
  if (isProductionEnvironment()) {
    return false
  }

  if (typeof inputCode !== 'string') return false
  const normalized = inputCode.trim()
  if (!normalized) return false

  const configuredCode =
    (typeof import.meta !== 'undefined' &&
      import.meta.env &&
      import.meta.env.VITE_DEV_ACCESS_CODE) ||
    ''

  const validCodes = [configuredCode, DEFAULT_DEV_ACCESS_CODE, 'MAZEDEV', 'developer2026'].filter(
    Boolean
  )

  if (validCodes.includes(normalized)) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(DEV_UNLOCKED_STORAGE_KEY, 'true')
      }
    } catch (err) {
      console.debug('Failed to store dev unlock state', err)
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
    console.debug('Failed to remove dev unlock state', err)
  }
}

/**
 * Returns true when both developer access (?devtools=1) and direct sandbox
 * route (?sandbox=1) are active. Returns false in production.
 */
export function isSandboxViewRequested(searchOrLocation) {
  if (isProductionEnvironment()) {
    return false
  }
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
 * when developer access is active. Disabled in production.
 */
export function syncSandboxUrlParam(isSandboxOpen, targetWindow = null) {
  if (isProductionEnvironment()) {
    return null
  }

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
  } catch (err) {
    console.debug('Failed to sync sandbox URL parameter', err)
    return null
  }
}
