/**
 * Deterministic seed hashing and Mulberry32 PRNG utilities.
 * Zero external dependencies.
 */

export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return (seed >>> 0) || 1
  }

  const text = String(seed ?? '')
  if (!text) {
    return ((Math.random() * 0xffffffff) >>> 0) || 1
  }

  // FNV-1a 32-bit hash
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) || 1
}

export function normalizeSeed(seed) {
  if (seed === undefined || seed === null || seed === '') {
    return Math.floor(Math.random() * 900000) + 100000
  }
  return seed
}

export function createRng(seed) {
  let state = hashSeed(seed)

  return function next() {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffleWithRng(items, rng) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
