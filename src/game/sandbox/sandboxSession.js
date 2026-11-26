import {
  getSandboxConfigSummary,
  normalizeSandboxConfig,
} from './sandboxConfig.js'

export const GAME_MODES = Object.freeze({
  STANDARD: 'standard',
  SANDBOX: 'sandbox',
})

/**
 * Builds the runtime initialization payload passed from the sandbox configuration UI
 * through gameReducer, mazeGenerator, MazeViewport3D, and MazeSceneEngine.
 */
export function buildSandboxRuntimePayload(sandboxConfig) {
  const { config } = normalizeSandboxConfig(sandboxConfig)
  const summary = getSandboxConfigSummary(config)

  return {
    mode: GAME_MODES.SANDBOX,
    isSandbox: true,
    config,
    summary,
    enabledByCategory: summary.enabledByCategory,
    objectivesEnabled: summary.objectivesEnabled,
  }
}
