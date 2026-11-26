import { getNextLevel, normalizeLevel } from '../../game/mechanics/levelProgression.js'
import { clampSafeScore } from '../../game/mechanics/scoring.js'

/**
 * Pure helper deriving progressive victory modal presentation state from
 * reducer state and gameplay launch status.
 *
 * Ensures the victory modal can only open when gameplay is active, `hasWon` is
 * strictly true, `isGameOver` is false, and exit requirements are satisfied.
 */
export function resolveVictoryModalViewModel({
  isPlaying = false,
  state = null,
  victorySummary = null,
  formattedTime = '00:00',
  isLevelTransitioning = false,
} = {}) {
  const hasWon = Boolean(state?.hasWon)
  const isGameOver = Boolean(state?.isGameOver)
  const objectivesActive = state?.objectivesEnabled !== false
  const totalKeys = Math.max(0, Number(state?.totalKeys) || 0)
  const hasMissingObjectives =
    Boolean(state?.isExitLocked) ||
    (objectivesActive &&
      totalKeys > 0 &&
      (state?.keysCollected || 0) < totalKeys)

  const isOpen = Boolean(
    isPlaying &&
      hasWon &&
      !isGameOver &&
      !hasMissingObjectives &&
      !isLevelTransitioning
  )
  const completedLevel = normalizeLevel(
    state?.completedLevel ?? state?.currentLevel ?? state?.maze?.level ?? 1
  )
  const nextLevel = getNextLevel(completedLevel)

  const rawSummary = isOpen
    ? victorySummary || state?.lastLevelScoreSummary || null
    : null
  const levelBaseCumulativeScore = clampSafeScore(
    rawSummary?.levelBaseCumulativeScore ?? state?.levelBaseCumulativeScore ?? 0
  )
  const levelScore = clampSafeScore(rawSummary?.score ?? 0)
  const cumulativeScore = clampSafeScore(
    rawSummary?.cumulativeScore ??
      (rawSummary
        ? levelBaseCumulativeScore + levelScore
        : state?.cumulativeScore ?? levelBaseCumulativeScore)
  )
  const enrichedSummary = rawSummary
    ? {
        ...rawSummary,
        level: completedLevel,
        score: levelScore,
        cumulativeScore,
        levelBaseCumulativeScore,
      }
    : null

  return {
    isOpen,
    completedLevel,
    nextLevel,
    levelsCompleted: Math.max(0, Number(state?.levelsCompleted) || 0),
    mazeRows: state?.maze?.rows ?? 0,
    mazeCols: state?.maze?.cols ?? 0,
    mazeSeed: state?.maze?.seed ?? '',
    victorySummary: enrichedSummary,
    levelScore,
    cumulativeScore,
    levelBaseCumulativeScore,
    formattedTime,
    shardsCollected: state?.shardsCollected ?? 0,
    totalShards: state?.totalShards ?? 0,
    nonShardCollectiblesCollected: state?.nonShardCollectiblesCollected ?? 0,
    totalNonShardCollectibles: state?.totalNonShardCollectibles ?? 0,
    keysCollected: state?.keysCollected ?? 0,
    totalKeys,
  }
}
