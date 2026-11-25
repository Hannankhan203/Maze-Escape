const STANDARD_PAR_PACING = {
  msPerMove: 1250,
  baseBufferMs: 11000,
  msPerKey: 14000,
  fallbackMoves: 46,
}

const STANDARD_SCORE_WEIGHTS = {
  baseScore: 1500,
  maxTimeBonus: 1400,
  maxHealthBonus: 700,
  perKeyBonus: 300,
  perShardBonus: 125,
}

export const STAR_THRESHOLDS = {
  THREE_STARS: 0.72,
  TWO_STARS: 0.42,
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function getShardBonusValue() {
  return STANDARD_SCORE_WEIGHTS.perShardBonus
}

export function calculateParTimeMs(input = {}) {
  const pacing = STANDARD_PAR_PACING

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
  const weights = STANDARD_SCORE_WEIGHTS

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

  const shardsCollected = Math.max(
    0,
    Math.round(
      Number(params?.shardsCollected) ||
        (Array.isArray(params?.itemsCollectedList)
          ? params.itemsCollectedList.filter((i) => i.type === 'soul_shards').length
          : 0)
    )
  )
  const totalShards = Math.max(
    0,
    Math.round(
      Number(params?.totalShards) ||
        (Array.isArray(params?.maze?.collectibles?.items)
          ? params.maze.collectibles.items.filter((i) => i.type === 'soul_shards').length
          : 0)
    )
  )

  const perShardBonus = weights.perShardBonus || 125
  const shardBonus = shardsCollected * perShardBonus
  const maxShardBonus = totalShards * perShardBonus

  const baseScore = weights.baseScore
  const score = baseScore + timeBonus + healthBonus + keycardBonus + shardBonus
  const maxPossibleScore =
    baseScore +
    weights.maxTimeBonus +
    weights.maxHealthBonus +
    maxKeycardBonus +
    maxShardBonus

  const earnedSkillScore = timeBonus + healthBonus
  const maxSkillScore = weights.maxTimeBonus + weights.maxHealthBonus
  const baseSkillRatio = maxSkillScore > 0 ? earnedSkillScore / maxSkillScore : 1
  const keyCompletionFactor =
    objectivesEnabled && totalKeys > 0 ? keysCollected / totalKeys : 1
  const performanceRatio = clamp(baseSkillRatio * keyCompletionFactor, 0, 1)
  const stars = calculateStarRating(performanceRatio)

  return {
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
      shardBonus,
    },
    stats: {
      health,
      maxHealth,
      keysCollected,
      totalKeys,
      shardsCollected,
      totalShards,
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
  const objectivesEnabled = Boolean(params?.objectivesEnabled)
  const totalKeys = objectivesEnabled
    ? Math.max(0, Math.round(Number(params?.totalKeys) || 0))
    : 0
  const keysCollected = objectivesEnabled
    ? clamp(Math.round(Number(params?.keysCollected) || 0), 0, totalKeys)
    : 0

  const shardsCollected = Math.max(0, Math.round(Number(params?.shardsCollected) || 0))
  const totalShards = Math.max(0, Math.round(Number(params?.totalShards) || 0))

  return {
    runId: params?.runId ?? null,
    keysCollected,
    totalKeys,
    shardsCollected,
    totalShards,
    objectivesEnabled,
  }
}
