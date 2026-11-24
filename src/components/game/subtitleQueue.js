export const SUBTITLE_MAX_ENTRIES = 6
export const SUBTITLE_LIFETIME_MS = 4500

function getEntryPriority(entry) {
  const value = Number(entry?.priority)
  return Number.isFinite(value) ? value : 0
}

/**
 * Pure priority-aware queue insertion for audio subtitles.
 * - Keeps chronological order with newest entries at the bottom (end of array).
 * - Never exceeds `maxEntries` (default 6).
 * - When full, evicts the oldest entry with the lowest priority, provided the
 *   incoming entry has priority >= that lowest existing priority.
 * - If every existing entry has strictly higher priority than the incoming entry,
 *   the incoming entry is dropped so high-priority hazard/attack/damage alerts survive.
 */
export function enqueueSubtitleEntry(prevEntries, incoming, maxEntries = SUBTITLE_MAX_ENTRIES) {
  const list = Array.isArray(prevEntries) ? prevEntries : []
  if (!incoming || incoming.id === undefined || incoming.id === null) {
    return { next: list, evicted: [], accepted: false }
  }

  const limit = Math.max(1, Number(maxEntries) || SUBTITLE_MAX_ENTRIES)
  const existingIdx = list.findIndex((item) => item.id === incoming.id)
  const base = existingIdx >= 0 ? list.filter((item) => item.id !== incoming.id) : list

  if (base.length < limit) {
    return {
      next: [...base, incoming],
      evicted: [],
      accepted: true,
    }
  }

  let evictIdx = 0
  let lowestPriority = getEntryPriority(base[0])
  for (let i = 1; i < base.length; i += 1) {
    const p = getEntryPriority(base[i])
    if (p < lowestPriority) {
      lowestPriority = p
      evictIdx = i
    }
  }

  const incomingPriority = getEntryPriority(incoming)
  if (incomingPriority < lowestPriority) {
    return {
      next: list,
      evicted: [incoming],
      accepted: false,
    }
  }

  const evictedEntry = base[evictIdx]
  const next = base.slice(0, evictIdx).concat(base.slice(evictIdx + 1), [incoming])
  return {
    next,
    evicted: [evictedEntry],
    accepted: true,
  }
}

/**
 * Manages active subtitle entries and their independent expiration timeout handles.
 */
export function createSubtitleQueueController({
  timersMap = new Map(),
  onChange,
  lifetimeMs = SUBTITLE_LIFETIME_MS,
  maxEntries = SUBTITLE_MAX_ENTRIES,
  scheduleTimeout = (fn, ms) => setTimeout(fn, ms),
  cancelTimeout = (id) => clearTimeout(id),
} = {}) {
  let entries = []
  let disposed = false

  const emitChange = (nextEntries) => {
    entries = nextEntries
    if (!disposed && typeof onChange === 'function') {
      onChange(entries)
    }
  }

  const cancelEntryTimer = (entryId) => {
    const existingTimer = timersMap.get(entryId)
    if (existingTimer !== undefined) {
      cancelTimeout(existingTimer)
      timersMap.delete(entryId)
    }
  }

  const clearAllTimers = () => {
    for (const timerId of timersMap.values()) {
      cancelTimeout(timerId)
    }
    timersMap.clear()
  }

  const push = (entry) => {
    if (disposed || !entry) return false
    const { next, evicted, accepted } = enqueueSubtitleEntry(entries, entry, maxEntries)
    if (!accepted) {
      return false
    }

    for (let i = 0; i < evicted.length; i += 1) {
      cancelEntryTimer(evicted[i].id)
    }

    cancelEntryTimer(entry.id)
    const timerId = scheduleTimeout(() => {
      timersMap.delete(entry.id)
      if (disposed) return
      const filtered = entries.filter((item) => item.id !== entry.id)
      if (filtered.length !== entries.length) {
        emitChange(filtered)
      }
    }, lifetimeMs)
    timersMap.set(entry.id, timerId)

    emitChange(next)
    return true
  }

  const clear = ({ notify = true } = {}) => {
    clearAllTimers()
    if (entries.length === 0) return
    entries = []
    if (notify && !disposed && typeof onChange === 'function') {
      onChange(entries)
    }
  }

  const dispose = () => {
    disposed = true
    clearAllTimers()
    entries = []
  }

  const getEntries = () => entries

  return {
    push,
    clear,
    dispose,
    getEntries,
    timersMap,
  }
}
