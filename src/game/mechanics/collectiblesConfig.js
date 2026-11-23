
export const COLLECTIBLE_TYPES = {
  HEALTH_CAPSULE: 'health_capsule',
  SOUL_SHARDS: 'soul_shards',
  SPECTRAL_COMPASS: 'spectral_compass',
  PHANTOM_VEIL: 'phantom_veil',
  ENERGY_CELL: 'energy_cell',
  WARDING_CHARM: 'warding_charm',
  TIME_FRAGMENT: 'time_fragment',
  WATCHERS_EYE: 'watchers_eye',
  ECHO_PULSE: 'echo_pulse',
  SPIRIT_LANTERN: 'spirit_lantern',
  ECHO_REVEAL: 'echo_reveal',
}

export const COLLECTIBLE_CONFIG = {
  [COLLECTIBLE_TYPES.HEALTH_CAPSULE]: {
    type: COLLECTIBLE_TYPES.HEALTH_CAPSULE,
    label: 'Health Capsule',
    shortLabel: 'Health',
    category: 'consumable',
    shortcut: '',
    description: 'Restores vital integrity within the vault.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.SOUL_SHARDS]: {
    type: COLLECTIBLE_TYPES.SOUL_SHARDS,
    label: 'Soul Shards',
    shortLabel: 'Shards',
    category: 'relic',
    shortcut: '',
    description: 'Resonance fragment pulsing with dormant energy.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.SPECTRAL_COMPASS]: {
    type: COLLECTIBLE_TYPES.SPECTRAL_COMPASS,
    label: 'Spectral Compass',
    shortLabel: 'Compass',
    category: 'artifact',
    shortcut: '',
    description: 'Points toward anomalous spatial distortions.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.PHANTOM_VEIL]: {
    type: COLLECTIBLE_TYPES.PHANTOM_VEIL,
    label: 'Phantom Veil',
    shortLabel: 'Veil',
    category: 'artifact',
    shortcut: '',
    description: 'Damps thermal and visual signature temporarily.',
    durationMs: 5000,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.ENERGY_CELL]: {
    type: COLLECTIBLE_TYPES.ENERGY_CELL,
    label: 'Energy Cell',
    shortLabel: 'Battery',
    category: 'consumable',
    shortcut: '',
    description: 'Recharges flashlight and luminescent apparatus.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.WARDING_CHARM]: {
    type: COLLECTIBLE_TYPES.WARDING_CHARM,
    label: 'Warding Charm',
    shortLabel: 'Warden',
    category: 'relic',
    shortcut: '',
    description: 'Repels residual psychic pressure.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.TIME_FRAGMENT]: {
    type: COLLECTIBLE_TYPES.TIME_FRAGMENT,
    label: 'Time Fragment',
    shortLabel: 'Clock',
    category: 'relic',
    shortcut: '',
    description: 'Distorts temporal dilation within the maze.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.WATCHERS_EYE]: {
    type: COLLECTIBLE_TYPES.WATCHERS_EYE,
    label: "Watcher's Eye",
    shortLabel: 'Eye',
    category: 'artifact',
    shortcut: '',
    description: 'Reveals concealed paths and boundary anomalies.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.ECHO_PULSE]: {
    type: COLLECTIBLE_TYPES.ECHO_PULSE,
    label: 'Echo Pulse',
    shortLabel: 'Pulse',
    category: 'consumable',
    shortcut: '',
    description: 'Emits a localized echolocation sweep.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.SPIRIT_LANTERN]: {
    type: COLLECTIBLE_TYPES.SPIRIT_LANTERN,
    label: 'Spirit Lantern',
    shortLabel: 'Lantern',
    category: 'artifact',
    shortcut: '',
    description: 'Burns with spectral spectral luminescence.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.ECHO_REVEAL]: {
    type: COLLECTIBLE_TYPES.ECHO_REVEAL,
    label: 'Echo Reveal',
    shortLabel: 'Echo',
    category: 'ability',
    shortcut: 'E',
    description: 'Reveals the BFS shortest route to the exit gate.',
    durationMs: 4500,
    stackable: true,
  },
}

// For backward compatibility / alias during migration
export const POWERUP_TYPES = {
  ECHO_REVEAL: COLLECTIBLE_TYPES.ECHO_REVEAL,
}

export const POWERUP_CONFIG = {
  [COLLECTIBLE_TYPES.ECHO_REVEAL]: COLLECTIBLE_CONFIG[COLLECTIBLE_TYPES.ECHO_REVEAL],
}

export function createInitialInventory() {
  const inv = {}
  for (const t of Object.values(COLLECTIBLE_TYPES)) {
    inv[t] = 0
  }
  return inv
}

export function createInitialActiveEffects() {
  return {
    echoRevealRemainingMs: 0,
    phantomVeilRemainingMs: 0,
  }
}
