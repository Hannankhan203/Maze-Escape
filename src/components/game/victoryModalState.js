import { getNextLevel, normalizeLevel } from '../../game/mechanics/levelProgression.js'

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

  const isOpen = Boolean(isPlaying && hasWon && !isGameOver && !hasMissingObjectives)
  const completedLevel = normalizeLevel(
    state?.completedLevel ?? state?.currentLevel ?? state?.maze?.level ?? 1
  )
  const nextLevel = getNextLevel(completedLevel)

  return {
    isOpen,
    completedLevel,
    nextLevel,
    levelsCompleted: Math.max(0, Number(state?.levelsCompleted) || 0),
    mazeRows: state?.maze?.rows ?? 0,
    mazeCols: state?.maze?.cols ?? 0,
    mazeSeed: state?.maze?.seed ?? '',
    victorySummary: isOpen ? victorySummary : null,
    formattedTime,
    shardsCollected: state?.shardsCollected ?? 0,
    totalShards: state?.totalShards ?? 0,
  }
}
