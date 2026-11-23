import { normalizeMazeDifficulty } from '../generation/mazeConfig.js'

const DIFFICULTY_PAR_PACING = {
  easy: {
    msPerMove: 1200,
    baseBufferMs: 7000,
    msPerKey: 12000,
    fallbackMoves: 22,
  },
  medium: {
    msPerMove: 1250,
    baseBufferMs: 11000,
    msPerKey: 14000,
    fallbackMoves: 46,
  },
  hard: {
    msPerMove: 1300,
    baseBufferMs: 16000,
    msPerKey: 16000,
    fallbackMoves: 85,
  },
  hardcore: {
    msPerMove: 1350,
    baseBufferMs: 24000,
    msPerKey: 19000,
    fallbackMoves: 145,
  },
}

const DIFFICULTY_SCORE_WEIGHTS = {
  easy: {
    baseScore: 1000,
    maxTimeBonus: 1000,
    maxHealthBonus: 500,
    perKeyBonus: 250,
  },
  medium: {
    baseScore: 1500,
    maxTimeBonus: 1400,
    maxHealthBonus: 700,
    perKeyBonus: 300,
  },
  hard: {
    baseScore: 2200,
    maxTimeBonus: 1800,
    maxHealthBonus: 900,
    perKeyBonus: 350,
  },
  hardcore: {
    baseScore: 3200,
    maxTimeBonus: 2400,
    maxHealthBonus: 1200,
    perKeyBonus: 500,
  },
}

export const STAR_THRESHOLDS = {
  THREE_STARS: 0.72,
  TWO_STARS: 0.42,
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeDifficulty(difficulty) {
  return normalizeMazeDifficulty(difficulty)
}

export function calculateParTimeMs(input = {}) {
  const difficulty = normalizeDifficulty(input?.difficulty)
  const pacing = DIFFICULTY_PAR_PACING[difficulty]

  const rawParMoves = Number(input?.parMoves)
  const parMoves =
    Number.isFinite(rawParMoves) && rawParMoves > 0
      ? rawParMoves
      : pacing.fallbackMoves

  const objectivesEnabled = Boolean(input?.objectivesEnabled)
  const totalKeys = objectivesEnabled
    ? Math.max(
        0,
        Number(input?.totalKeys) ||
          (Array.isArray(input?.keycards) ? input.keycards.length : 0)
      )
    : 0

  const computedMs =
    parMoves * pacing.msPerMove +
    pacing.baseBufferMs +
    totalKeys * pacing.msPerKey

  return Math.max(15000, Math.round(computedMs))
}

export function calculateStarRating(performanceRatio) {
  const ratio = Number.isFinite(performanceRatio) ? performanceRatio : 0
  if (ratio >= STAR_THRESHOLDS.THREE_STARS) return 3
  if (ratio >= STAR_THRESHOLDS.TWO_STARS) return 2
  return 1
}

export function calculateRunScore(params = {}) {
  const difficulty = normalizeDifficulty(params?.difficulty || params?.maze?.difficulty)
  const weights = DIFFICULTY_SCORE_WEIGHTS[difficulty]

  const objectivesEnabled = Boolean(params?.objectivesEnabled)
  const totalKeys = objectivesEnabled
    ? Math.max(
        0,
        Math.round(
          Number(params?.totalKeys) ||
            (Array.isArray(params?.maze?.keycards) ? params.maze.keycards.length : 0)
        )
      )
    : 0
  const keysCollected = objectivesEnabled
    ? clamp(Math.round(Number(params?.keysCollected) || 0), 0, totalKeys)
    : 0

  const explicitParTimeMs = Number(params?.parTimeMs)
  const parTimeMs =
    Number.isFinite(explicitParTimeMs) && explicitParTimeMs > 0
      ? Math.round(explicitParTimeMs)
      : calculateParTimeMs({
          difficulty,
          parMoves: params?.parMoves ?? params?.maze?.parMoves,
          objectivesEnabled,
          totalKeys,
        })

  const completionTimeMs = Math.max(
    0,
    Number.isFinite(Number(params?.completionTimeMs))
      ? Number(params.completionTimeMs)
      : 0
  )

  const maxHealth = Math.max(1, Number(params?.maxHealth) || 100)
  const health = clamp(
    Number.isFinite(Number(params?.health)) ? Number(params.health) : maxHealth,
    0,
    maxHealth
  )

  const timeRatio = completionTimeMs / parTimeMs
  let timeFactor
  if (timeRatio <= 0.6) {
    timeFactor = 1
  } else if (timeRatio <= 1.0) {
    timeFactor = 1 - ((timeRatio - 0.6) / 0.4) * 0.25
  } else if (timeRatio <= 2.5) {
    timeFactor = 0.75 - ((timeRatio - 1.0) / 1.5) * 0.65
  } else {
    timeFactor = Math.max(0, 0.1 - (timeRatio - 2.5) * 0.05)
  }

  const timeBonus = Math.round(weights.maxTimeBonus * timeFactor)

  const healthRatio = clamp(health / maxHealth, 0, 1)
  const healthBonus = Math.round(weights.maxHealthBonus * healthRatio)

  const keycardBonus =
    objectivesEnabled && totalKeys > 0 ? keysCollected * weights.perKeyBonus : 0
  const maxKeycardBonus =
    objectivesEnabled && totalKeys > 0 ? totalKeys * weights.perKeyBonus : 0

  const baseScore = weights.baseScore
  const score = baseScore + timeBonus + healthBonus + keycardBonus
  const maxPossibleScore =
    baseScore +
    weights.maxTimeBonus +
    weights.maxHealthBonus +
    maxKeycardBonus

  const earnedSkillScore = timeBonus + healthBonus
  const maxSkillScore = weights.maxTimeBonus + weights.maxHealthBonus
  const baseSkillRatio = maxSkillScore > 0 ? earnedSkillScore / maxSkillScore : 1
  const keyCompletionFactor =
    objectivesEnabled && totalKeys > 0 ? keysCollected / totalKeys : 1
  const performanceRatio = clamp(baseSkillRatio * keyCompletionFactor, 0, 1)
  const stars = calculateStarRating(performanceRatio)

  return {
    difficulty,
    score,
    maxPossibleScore,
    stars,
    completionTimeMs,
    parTimeMs,
    beatPar: completionTimeMs <= parTimeMs,
    performanceRatio,
    breakdown: {
      baseScore,
      timeBonus,
      healthBonus,
      keycardBonus,
    },
    stats: {
      moves: Math.max(0, Math.round(Number(params?.moves) || 0)),
      health,
      maxHealth,
      keysCollected,
      totalKeys,
      objectivesEnabled,
    },
  }
}

export function resolveVictorySummary(victorySummary, runId, hasWon = true) {
  if (!hasWon || !victorySummary) {
    return null
  }
  if (victorySummary.runId !== runId) {
    return null
  }
  if (!Number.isFinite(victorySummary.completionTimeMs)) {
    return null
  }
  return victorySummary
}

export function buildGameOverSummary(params = {}) {
  const survivalTimeMs = Math.max(
    0,
    Number.isFinite(Number(params?.survivalTimeMs))
      ? Math.round(Number(params.survivalTimeMs))
      : 0
  )
  const moves = Math.max(0, Math.round(Number(params?.moves) || 0))
  const objectivesEnabled = Boolean(params?.objectivesEnabled)
  const totalKeys = objectivesEnabled
    ? Math.max(0, Math.round(Number(params?.totalKeys) || 0))
    : 0
  const keysCollected = objectivesEnabled
    ? clamp(Math.round(Number(params?.keysCollected) || 0), 0, totalKeys)
    : 0

  return {
    runId: params?.runId ?? null,
    survivalTimeMs,
    moves,
    keysCollected,
    totalKeys,
    objectivesEnabled,
  }
}
