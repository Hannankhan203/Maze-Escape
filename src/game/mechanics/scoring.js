export const MAX_SAFE_SCORE = Number.MAX_SAFE_INTEGER

export const STANDARD_PAR_PACING = Object.freeze({
  msPerMove: 1250,
  baseBufferMs: 11000,
  msPerKey: 14000,
  fallbackMoves: 46,
  msPerDimensionSqrt: 360,
  msPerEnemy: 2500,
  msPerHazard: 450,
  maxHazardAllowanceMs: 18000,
  maxHighLevelAllowanceMs: 14000,
  minParTimeMs: 15000,
})

export const STANDARD_SCORE_WEIGHTS = Object.freeze({
  baseScore: 1500,
  maxTimeBonus: 1400,
  maxHealthBonus: 700,
  perKeyBonus: 300,
  perShardBonus: 125,
  perCollectibleBonus: 100,
  damagePenaltyPerHp: 4,
  damagePenaltyPerHit: 50,
  maxDamagePenaltyRatio: 0.45,
})

export const STAR_THRESHOLDS = Object.freeze({
  THREE_STARS: 0.72,
  TWO_STARS: 0.42,
  ONE_STAR: 0.14,
  threeStar: 0.72,
  twoStar: 0.42,
  oneStar: 0.14,
})

export const PROGRESSIVE_SCORE_CONFIG = Object.freeze({
  parPacing: STANDARD_PAR_PACING,
  weights: STANDARD_SCORE_WEIGHTS,
  starThresholds: STAR_THRESHOLDS,
  baseCompletionScore: STANDARD_SCORE_WEIGHTS.baseScore,
  timeBonusMax: STANDARD_SCORE_WEIGHTS.maxTimeBonus,
  healthBonusMax: STANDARD_SCORE_WEIGHTS.maxHealthBonus,
  keycardBonusEach: STANDARD_SCORE_WEIGHTS.perKeyBonus,
  shardBonusEach: STANDARD_SCORE_WEIGHTS.perShardBonus,
  collectibleBonusEach: STANDARD_SCORE_WEIGHTS.perCollectibleBonus,
  levelScaling: Object.freeze({
    linearRatePerLevel: 0.12,
    linearTierMaxLevel: 26,
    logRatePostTier: 0.25,
    timeBonusLinearRate: 0.08,
    timeBonusLogRate: 0.18,
    maxLevelMultiplier: 12,
  }),
  maxSafeScore: MAX_SAFE_SCORE,
})

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * Clamps any score or bonus value to a finite non-negative safe integer in [0, Number.MAX_SAFE_INTEGER].
 */
export function clampSafeScore(value) {
  const num = Number(value)
  if (num === Number.POSITIVE_INFINITY) {
    return MAX_SAFE_SCORE
  }
  if (!Number.isFinite(num) || num <= 0) {
    return 0
  }
  if (num >= MAX_SAFE_SCORE) {
    return MAX_SAFE_SCORE
  }
  return Math.min(MAX_SAFE_SCORE, Math.max(0, Math.round(num)))
}

export function getShardBonusValue(count) {
  if (typeof count === 'number' && Number.isFinite(count)) {
    return clampSafeScore(
      Math.max(0, Math.round(count)) * STANDARD_SCORE_WEIGHTS.perShardBonus
    )
  }
  return STANDARD_SCORE_WEIGHTS.perShardBonus
}

export function getCollectibleBonusValue(count) {
  if (typeof count === 'number' && Number.isFinite(count)) {
    return clampSafeScore(
      Math.max(0, Math.round(count)) * STANDARD_SCORE_WEIGHTS.perCollectibleBonus
    )
  }
  return STANDARD_SCORE_WEIGHTS.perCollectibleBonus
}

export function getKeycardBonusValue(count, objectivesEnabled = true) {
  if (typeof count === 'number' && Number.isFinite(count)) {
    if (!objectivesEnabled) return 0
    return clampSafeScore(
      Math.max(0, Math.round(count)) * STANDARD_SCORE_WEIGHTS.perKeyBonus
    )
  }
  return STANDARD_SCORE_WEIGHTS.perKeyBonus
}

function normalizePositiveLevel(rawLevel) {
  const num = Number(rawLevel)
  if (!Number.isFinite(num) || num < 1) {
    return 1
  }
  return Math.min(MAX_SAFE_SCORE, Math.floor(num))
}

/**
 * Bounded progressive level completion score multiplier:
 * - Level 1: 1.00 (baseScore = 1500)
 * - Levels 2..26: linear growth (+12% per level up to 4.00x at Level 26)
 * - Levels 27..5000+: logarithmic growth capped safely at maxLevelMultiplier (12x)
 */
export function getLevelScoreMultiplier(level = 1) {
  const normLevel = normalizePositiveLevel(level)
  if (normLevel <= 1) {
    return 1
  }
  const scaling = PROGRESSIVE_SCORE_CONFIG.levelScaling
  const linearSteps = Math.min(normLevel - 1, scaling.linearTierMaxLevel - 1)
  const logSteps = Math.max(0, normLevel - scaling.linearTierMaxLevel)
  const multiplier =
    1 +
    linearSteps * scaling.linearRatePerLevel +
    Math.log1p(logSteps) * scaling.logRatePostTier
  return Math.min(scaling.maxLevelMultiplier, multiplier)
}

/**
 * Bounded progressive time-bonus ceiling multiplier across levels.
 */
export function getLevelTimeBonusMultiplier(level = 1) {
  const normLevel = normalizePositiveLevel(level)
  if (normLevel <= 1) {
    return 1
  }
  const scaling = PROGRESSIVE_SCORE_CONFIG.levelScaling
  const linearSteps = Math.min(normLevel - 1, scaling.linearTierMaxLevel - 1)
  const logSteps = Math.max(0, normLevel - scaling.linearTierMaxLevel)
  const multiplier =
    1 +
    linearSteps * scaling.timeBonusLinearRate +
    Math.log1p(logSteps) * scaling.timeBonusLogRate
  return Math.min(scaling.maxLevelMultiplier, multiplier)
}

/**
 * Calculates progressive level Par Time in milliseconds based on maze dimensions,
 * shortest path moves, required keycards/objectives, enemy count & AI difficulty,
 * hazard count & complexity, and level progression tier.
 */
export function calculateParTimeMs(input = {}) {
  const pacing = STANDARD_PAR_PACING
  const rawLevel =
    input?.level ??
    input?.currentLevel ??
    input?.maze?.level ??
    input?.maze?.currentLevel ??
    input?.levelConfig?.level
  const level = normalizePositiveLevel(rawLevel)
  const hasExplicitLevelOrConfig =
    rawLevel !== undefined || Boolean(input?.levelConfig)

  const inferredDim = hasExplicitLevelOrConfig
    ? Math.min(51, 11 + 2 * Math.floor(Math.pow(level - 1, 0.75)))
    : 11
  const rows = Math.max(
    5,
    Math.floor(
      Number(
        input?.rows ??
          input?.maze?.rows ??
          input?.levelConfig?.rows ??
          inferredDim
      ) || inferredDim
    )
  )
  const cols = Math.max(
    5,
    Math.floor(
      Number(
        input?.cols ??
          input?.maze?.cols ??
          input?.levelConfig?.cols ??
          rows
      ) || rows
    )
  )

  const rawParMoves = Number(input?.parMoves ?? input?.maze?.parMoves)
  const hasDimensionContext =
    hasExplicitLevelOrConfig ||
    input?.rows !== undefined ||
    input?.cols !== undefined ||
    Boolean(input?.maze)
  const parMoves =
    Number.isFinite(rawParMoves) && rawParMoves > 0
      ? rawParMoves
      : hasDimensionContext
        ? Math.max(18, Math.round((rows + cols - 2) * 1.65))
        : pacing.fallbackMoves

  const objectivesEnabled =
    input?.objectivesEnabled !== undefined
      ? Boolean(input.objectivesEnabled)
      : Boolean(
          input?.totalKeys !== undefined ||
            Array.isArray(input?.keycards) ||
            Array.isArray(input?.maze?.keycards) ||
            input?.levelConfig?.keycardAllocation
        )

  const inferredKeysForLevel = hasExplicitLevelOrConfig
    ? level >= 50
      ? 5
      : level >= 20
        ? 4
        : level >= 10
          ? 3
          : 2
    : 0
  const totalKeys = objectivesEnabled
    ? Math.max(
        0,
        Math.round(
          Number(input?.totalKeys) ||
            (Array.isArray(input?.keycards) ? input.keycards.length : 0) ||
            (Array.isArray(input?.maze?.keycards) ? input.maze.keycards.length : 0) ||
            Number(input?.levelConfig?.keycardAllocation?.allocatedCount) ||
            inferredKeysForLevel
        )
      )
    : 0

  const isLegacyPresetOnly = Boolean(input?.difficulty) && rawLevel === undefined

  const hasDimensionAllowanceContext =
    !isLegacyPresetOnly &&
    (input?.rows !== undefined ||
      input?.cols !== undefined ||
      Boolean(input?.levelConfig) ||
      Boolean(input?.maze) ||
      level > 1)
  const extraArea = hasDimensionAllowanceContext
    ? Math.max(0, rows * cols - 121)
    : 0
  const dimensionAllowanceMs =
    extraArea > 0
      ? Math.round(Math.sqrt(extraArea) * pacing.msPerDimensionSqrt)
      : 0

  const hasExplicitEnemyInput =
    input?.enemyCount !== undefined || Array.isArray(input?.enemies)
  const inferredEnemyCount =
    level >= 35 ? 5 : level >= 18 ? 4 : level >= 9 ? 3 : level >= 3 ? 2 : 1
  const rawEnemyCount =
    input?.enemyCount ??
    (Array.isArray(input?.enemies) ? input.enemies.length : undefined) ??
    (Array.isArray(input?.maze?.enemies) ? input.maze.enemies.length : undefined) ??
    input?.levelConfig?.enemyAllocation?.targetCount ??
    (hasExplicitLevelOrConfig ? inferredEnemyCount : 1)
  const enemyCount = Math.max(0, Math.floor(Number(rawEnemyCount) || 0))
  const effectiveEnemyUnits = hasExplicitEnemyInput
    ? enemyCount
    : !isLegacyPresetOnly &&
        (level > 1 || Boolean(input?.levelConfig) || Boolean(input?.maze))
      ? Math.max(0, enemyCount - 1)
      : 0
  const explicitAiMultiplier = Number(input?.aiDifficultyMultiplier)
  const aiDifficultyMultiplier =
    Number.isFinite(explicitAiMultiplier) && explicitAiMultiplier > 0
      ? explicitAiMultiplier
      : 1 + 0.45 * ((level - 1) / (level - 1 + 20))
  const enemyAllowanceMs = Math.round(
    effectiveEnemyUnits * pacing.msPerEnemy * aiDifficultyMultiplier
  )

  const hasExplicitHazardInput =
    input?.hazardCount !== undefined || Array.isArray(input?.hazards)
  const inferredHazardCount = Math.min(40, 10 + Math.floor((level - 1) * 1.15))
  const rawHazardCount =
    input?.hazardCount ??
    (Array.isArray(input?.hazards) ? input.hazards.length : undefined) ??
    (Array.isArray(input?.maze?.hazards) ? input.maze.hazards.length : undefined) ??
    input?.levelConfig?.hazardHidingCapacityPlan?.hazardCoordinatedTotal ??
    (hasExplicitLevelOrConfig ? inferredHazardCount : 10)
  const hazardCount = Math.max(0, Math.floor(Number(rawHazardCount) || 0))
  const effectiveHazardUnits = hasExplicitHazardInput
    ? hazardCount
    : !isLegacyPresetOnly &&
        (level > 1 || Boolean(input?.levelConfig) || Boolean(input?.maze))
      ? Math.max(0, hazardCount - 10)
      : 0
  const hazardAllowanceMs = Math.min(
    pacing.maxHazardAllowanceMs,
    Math.round(effectiveHazardUnits * pacing.msPerHazard)
  )

  const highLevelAllowanceMs =
    !isLegacyPresetOnly && level > 1
      ? Math.round(
          pacing.maxHighLevelAllowanceMs * ((level - 1) / (level - 1 + 35))
        )
      : 0

  const computedMs =
    parMoves * pacing.msPerMove +
    pacing.baseBufferMs +
    totalKeys * pacing.msPerKey +
    dimensionAllowanceMs +
    enemyAllowanceMs +
    hazardAllowanceMs +
    highLevelAllowanceMs

  return Math.max(pacing.minParTimeMs, clampSafeScore(computedMs))
}

/**
 * Evaluates a performance ratio on a 0–3 star scale:
 * - 3 stars: >= 0.72 (excellent performance)
 * - 2 stars: >= 0.42 (good performance)
 * - 1 star:  modest successful completion (0 <= ratio < 0.42)
 * - 0 stars: very poor completion (ratio < 0, or ratio < ONE_STAR when allowZeroStars is enabled)
 */
export function calculateStarRating(performanceRatio, options = {}) {
  if (performanceRatio && typeof performanceRatio === 'object') {
    return calculateStarRating(
      performanceRatio.performanceRatio,
      performanceRatio
    )
  }
  if (options?.objectivesComplete === false) return 0
  const ratio = Number.isFinite(performanceRatio) ? performanceRatio : 0
  if (ratio >= STAR_THRESHOLDS.THREE_STARS) return 3
  if (ratio >= STAR_THRESHOLDS.TWO_STARS) return 2
  if (ratio < 0) return 0
  if (options?.allowZeroStars && ratio < STAR_THRESHOLDS.ONE_STAR) return 0
  return 1
}

/**
 * Calculates a complete progressive level score breakdown and 0–3 star rating.
 */
export function calculateRunScore(params = {}) {
  const weights = STANDARD_SCORE_WEIGHTS
  const rawLevel =
    params?.level ??
    params?.currentLevel ??
    params?.maze?.level ??
    params?.maze?.currentLevel
  const isLegacyPresetOnly = Boolean(params?.difficulty) && rawLevel === undefined
  const level = isLegacyPresetOnly ? 1 : normalizePositiveLevel(rawLevel)

  const objectivesEnabled = Boolean(params?.objectivesEnabled)
  const totalKeys = objectivesEnabled
    ? Math.max(
        0,
        Math.round(
          Number(params?.totalKeys) ||
            (Array.isArray(params?.maze?.keycards)
              ? params.maze.keycards.length
              : 0)
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
      : isLegacyPresetOnly
        ? calculateParTimeMs({
            difficulty: params.difficulty,
            parMoves: params?.parMoves ?? params?.maze?.parMoves,
            objectivesEnabled,
            totalKeys,
          })
        : calculateParTimeMs({
            level,
            maze: params?.maze,
            levelConfig: params?.levelConfig,
            rows: params?.rows ?? params?.maze?.rows,
            cols: params?.cols ?? params?.maze?.cols,
            parMoves: params?.parMoves ?? params?.maze?.parMoves,
            enemyCount: params?.enemyCount,
            enemies: params?.enemies ?? params?.maze?.enemies,
            hazardCount: params?.hazardCount,
            hazards: params?.hazards ?? params?.maze?.hazards,
            objectivesEnabled,
            totalKeys,
          })

  const completionTimeMs = Math.max(
    0,
    Number.isFinite(Number(params?.completionTimeMs))
      ? Math.round(Number(params.completionTimeMs))
      : 0
  )

  const maxHealth = Math.max(1, Number(params?.maxHealth) || 100)
  const health = clamp(
    Number.isFinite(Number(params?.health)) ? Number(params.health) : maxHealth,
    0,
    maxHealth
  )

  const timeRatio = parTimeMs > 0 ? completionTimeMs / parTimeMs : 0
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

  const levelMultiplier = getLevelScoreMultiplier(level)
  const timeBonusMultiplier = getLevelTimeBonusMultiplier(level)
  const maxTimeBonusForLevel = clampSafeScore(
    Math.round(weights.maxTimeBonus * timeBonusMultiplier)
  )
  const timeBonus = clampSafeScore(Math.round(maxTimeBonusForLevel * timeFactor))

  const healthRatio = clamp(health / maxHealth, 0, 1)
  const healthBonus = clampSafeScore(
    Math.round(weights.maxHealthBonus * healthRatio)
  )

  const keycardBonus =
    objectivesEnabled && totalKeys > 0
      ? clampSafeScore(keysCollected * weights.perKeyBonus)
      : 0
  const maxKeycardBonus =
    objectivesEnabled && totalKeys > 0
      ? clampSafeScore(totalKeys * weights.perKeyBonus)
      : 0

  const shardsCollected = Math.max(
    0,
    Math.round(
      Number(params?.shardsCollected) ||
        (Array.isArray(params?.itemsCollectedList)
          ? params.itemsCollectedList.filter((i) => i?.type === 'soul_shards').length
          : 0)
    )
  )
  const totalShards = Math.max(
    shardsCollected,
    Math.round(
      Number(params?.totalShards) ||
        (Array.isArray(params?.maze?.collectibles?.items)
          ? params.maze.collectibles.items.filter((i) => i?.type === 'soul_shards')
              .length
          : 0)
    )
  )

  const perShardBonus = weights.perShardBonus || 125
  const shardBonus = clampSafeScore(shardsCollected * perShardBonus)
  const maxShardBonus = clampSafeScore(totalShards * perShardBonus)

  const rawNonShardCollectibles =
    params?.nonShardCollectiblesCollected ??
    params?.otherCollectiblesCollected ??
    params?.collectiblesCollected ??
    (Array.isArray(params?.itemsCollectedList)
      ? params.itemsCollectedList.filter(
          (i) => i?.type && i.type !== 'soul_shards'
        ).length
      : 0)
  const nonShardCollectiblesCollected = Math.max(
    0,
    Math.round(Number(rawNonShardCollectibles) || 0)
  )
  const mazeNonShardItemsCount = Array.isArray(params?.maze?.collectibles?.items)
    ? params.maze.collectibles.items.filter(
        (i) => i?.type && i.type !== 'soul_shards'
      ).length
    : 0
  const totalNonShardCollectibles = Math.max(
    nonShardCollectiblesCollected,
    Math.round(
      Number(
        params?.totalNonShardCollectibles ?? params?.totalOtherCollectibles
      ) || mazeNonShardItemsCount
    )
  )

  const perCollectibleBonus = weights.perCollectibleBonus || 100
  const collectibleBonus = Number.isFinite(Number(params?.collectibleBonus))
    ? clampSafeScore(params.collectibleBonus)
    : clampSafeScore(nonShardCollectiblesCollected * perCollectibleBonus)
  const maxCollectibleBonus = clampSafeScore(
    totalNonShardCollectibles * perCollectibleBonus
  )

  const damageTaken = Math.max(0, Math.round(Number(params?.damageTaken) || 0))
  const hitsTaken = Math.max(0, Math.round(Number(params?.hitsTaken) || 0))
  const flawlessSurvival =
    damageTaken === 0 && hitsTaken === 0 && health >= maxHealth

  const baseScore = clampSafeScore(Math.round(weights.baseScore * levelMultiplier))
  const grossScore = clampSafeScore(
    baseScore +
      timeBonus +
      healthBonus +
      keycardBonus +
      shardBonus +
      collectibleBonus
  )

  const rawDamagePenalty = clampSafeScore(
    damageTaken * weights.damagePenaltyPerHp +
      hitsTaken * weights.damagePenaltyPerHit
  )
  const maxAllowedPenalty = clampSafeScore(
    Math.round(grossScore * weights.maxDamagePenaltyRatio)
  )
  const damagePenalty = Math.min(rawDamagePenalty, maxAllowedPenalty)

  const score = clampSafeScore(Math.max(0, grossScore - damagePenalty))
  const maxPossibleScore = clampSafeScore(
    baseScore +
      maxTimeBonusForLevel +
      weights.maxHealthBonus +
      maxKeycardBonus +
      maxShardBonus +
      maxCollectibleBonus
  )

  const earnedSkillScore = timeBonus + healthBonus - damagePenalty
  const maxSkillScore = maxTimeBonusForLevel + weights.maxHealthBonus
  const baseSkillRatio = maxSkillScore > 0 ? earnedSkillScore / maxSkillScore : 1
  const keyCompletionFactor =
    objectivesEnabled && totalKeys > 0 ? keysCollected / totalKeys : 1
  const rawSignedPerformanceRatio = baseSkillRatio * keyCompletionFactor
  const performanceRatio = clamp(rawSignedPerformanceRatio, 0, 1)

  const isVeryPoorPerformance =
    rawSignedPerformanceRatio < 0 ||
    (objectivesEnabled && totalKeys > 0 && keysCollected < totalKeys) ||
    ((damageTaken > 0 || hitsTaken > 0) &&
      performanceRatio < STAR_THRESHOLDS.ONE_STAR &&
      timeRatio >= 2.75)

  const stars = isVeryPoorPerformance
    ? 0
    : calculateStarRating(performanceRatio)
  const beatPar = completionTimeMs <= parTimeMs

  return {
    level,
    score,
    maxPossibleScore,
    stars,
    completionTimeMs,
    parTimeMs,
    timeDeltaMs: parTimeMs - completionTimeMs,
    beatPar,
    isUnderPar: beatPar,
    performanceRatio,
    baseScore,
    levelCompletionScore: baseScore,
    timeBonus,
    timeBonusCap: maxTimeBonusForLevel,
    healthBonus,
    survivalBonus: healthBonus,
    keycardBonus,
    objectiveBonus: keycardBonus,
    shardBonus,
    collectibleBonus,
    damagePenalty,
    penalty: damagePenalty,
    flawlessSurvival,
    breakdown: {
      baseScore,
      levelCompletionScore: baseScore,
      timeBonus,
      timeBonusCap: maxTimeBonusForLevel,
      healthBonus,
      survivalBonus: healthBonus,
      keycardBonus,
      objectiveBonus: keycardBonus,
      shardBonus,
      collectibleBonus,
      damagePenalty,
      penalty: damagePenalty,
    },
    stats: {
      level,
      health,
      maxHealth,
      damageTaken,
      hitsTaken,
      flawlessSurvival,
      keysCollected,
      totalKeys,
      shardsCollected,
      totalShards,
      nonShardCollectiblesCollected,
      totalNonShardCollectibles,
      objectivesEnabled,
    },
  }
}

/**
 * Computes the in-progress earned collectible and objective score for the current level
 * during active gameplay (or the finalized level score once `hasWon` is true).
 */
export function calculateLiveLevelScore(state = null) {
  if (!state || typeof state !== 'object') {
    return 0
  }
  if (
    state.hasWon &&
    state.lastLevelScoreSummary &&
    Number.isFinite(state.lastLevelScoreSummary.score)
  ) {
    return clampSafeScore(state.lastLevelScoreSummary.score)
  }

  const shardBonus = Number.isFinite(Number(state.shardBonus))
    ? clampSafeScore(state.shardBonus)
    : clampSafeScore(
        (Number(state.shardsCollected) || 0) * STANDARD_SCORE_WEIGHTS.perShardBonus
      )
  const collectibleBonus = Number.isFinite(Number(state.collectibleBonus))
    ? clampSafeScore(state.collectibleBonus)
    : clampSafeScore(
        (Number(state.nonShardCollectiblesCollected) || 0) *
          STANDARD_SCORE_WEIGHTS.perCollectibleBonus
      )
  const objectivesActive = state.objectivesEnabled !== false
  const keycardBonus = objectivesActive
    ? clampSafeScore(
        (Number(state.keysCollected) || 0) * STANDARD_SCORE_WEIGHTS.perKeyBonus
      )
    : 0

  return clampSafeScore(shardBonus + collectibleBonus + keycardBonus)
}

/**
 * Resolves the authoritative cumulative run score to display in the gameplay HUD
 * so HUD and VictoryModal remain 100% synchronized.
 */
export function resolveAuthoritativeHudScore({
  state = null,
  cumulativeScore = null,
  levelBaseCumulativeScore = null,
  liveLevelScore = null,
  victorySummary = null,
} = {}) {
  if (state?.hasWon) {
    if (
      victorySummary &&
      (victorySummary.runId === undefined ||
        state.runId === undefined ||
        victorySummary.runId === state.runId) &&
      Number.isFinite(Number(victorySummary.cumulativeScore))
    ) {
      return clampSafeScore(victorySummary.cumulativeScore)
    }
    if (Number.isFinite(Number(state?.cumulativeScore))) {
      return clampSafeScore(state.cumulativeScore)
    }
  }

  const baseScore = Number.isFinite(
    Number(state?.levelBaseCumulativeScore ?? levelBaseCumulativeScore)
  )
    ? clampSafeScore(state?.levelBaseCumulativeScore ?? levelBaseCumulativeScore)
    : clampSafeScore(state?.cumulativeScore ?? cumulativeScore ?? 0)

  const currentLevelEarned = state
    ? calculateLiveLevelScore(state)
    : clampSafeScore(liveLevelScore ?? 0)

  if (state?.hasWon) {
    return clampSafeScore(baseScore + currentLevelEarned)
  }

  return clampSafeScore(baseScore + currentLevelEarned)
}

export function resolveVictorySummary(
  victorySummary,
  runId,
  hasWon = true,
  fallbackSummary = null
) {
  if (!hasWon) {
    return null
  }
  const candidate =
    victorySummary &&
    victorySummary.runId === runId &&
    Number.isFinite(victorySummary.completionTimeMs)
      ? victorySummary
      : fallbackSummary &&
          (fallbackSummary.runId === runId || fallbackSummary.runId === undefined) &&
          Number.isFinite(fallbackSummary.completionTimeMs)
        ? fallbackSummary
        : null
  return candidate
}

export function buildGameOverSummary(params = {}) {
  const objectivesEnabled = Boolean(params?.objectivesEnabled)
  const totalKeys = objectivesEnabled
    ? Math.max(0, Math.round(Number(params?.totalKeys) || 0))
    : 0
  const keysCollected = objectivesEnabled
    ? clamp(Math.round(Number(params?.keysCollected) || 0), 0, totalKeys)
    : 0

  const shardsCollected = Math.max(
    0,
    Math.round(Number(params?.shardsCollected) || 0)
  )
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

