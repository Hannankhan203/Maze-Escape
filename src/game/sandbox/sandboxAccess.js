export const DEVTOOLS_QUERY_PARAM = 'devtools'
export const SANDBOX_QUERY_PARAM = 'sandbox'

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
 * Returns true only when developer-only URL access (?devtools=1 or ?devtools=true)
 * is explicitly enabled. Ordinary players never see developer controls.
 */
export function isDeveloperAccessEnabled(searchOrLocation) {
  try {
    const params = parseQueryParams(searchOrLocation)
    return isTruthyFlag(params.get(DEVTOOLS_QUERY_PARAM))
  } catch {
    return false
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
