export const VIEW_MODES = {
  MODE_2D: '2d',
  MODE_3D: '3d',
}

export function readViewModeFromSearch(search) {
  if (typeof search !== 'string' || !search) {
    return VIEW_MODES.MODE_2D
  }
  const params = new URLSearchParams(search)
  const rawView = params.get('view')
  return rawView && rawView.toLowerCase() === VIEW_MODES.MODE_3D
    ? VIEW_MODES.MODE_3D
    : VIEW_MODES.MODE_2D
}

export function getWindowViewMode(win = typeof window !== 'undefined' ? window : null) {
  if (!win || !win.location) {
    return VIEW_MODES.MODE_2D
  }
  return readViewModeFromSearch(win.location.search)
}

export function syncViewQueryParam(
  nextMode,
  win = typeof window !== 'undefined' ? window : null
) {
  if (
    !win ||
    !win.location ||
    typeof win.history?.replaceState !== 'function'
  ) {
    return false
  }

  try {
    const url = new URL(win.location.href)
    if (nextMode === VIEW_MODES.MODE_3D) {
      url.searchParams.set('view', VIEW_MODES.MODE_3D)
    } else {
      url.searchParams.delete('view')
    }
    win.history.replaceState(win.history.state, '', url.toString())
    return true
  } catch {
    // Ignore history API restrictions in synthetic test environments
    return false
  }
}
