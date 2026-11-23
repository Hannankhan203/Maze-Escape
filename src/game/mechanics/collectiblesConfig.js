
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
    category: 'vitality',
    shortcut: '',
    restorePercent: 25,
    description: 'Restores 25% of maximum player health. Cannot be collected when health is full.',
    durationMs: 0,
    stackable: false,
  },
  [COLLECTIBLE_TYPES.SOUL_SHARDS]: {
    type: COLLECTIBLE_TYPES.SOUL_SHARDS,
    label: 'Soul Shards',
    shortLabel: 'Shards',
    category: 'resonance',
    shortcut: '',
    scoreValue: 100,
    description: 'Resonance fragment pulsing with supernatural energy. Increases survival score.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.SPECTRAL_COMPASS]: {
    type: COLLECTIBLE_TYPES.SPECTRAL_COMPASS,
    label: 'Spectral Compass',
    shortLabel: 'Compass',
    category: 'artifact',
    shortcut: '',
    description: 'Temporarily attracts nearby Soul Shards toward the player for 6 seconds.',
    durationMs: 6000,
    stackable: false,
  },
  [COLLECTIBLE_TYPES.PHANTOM_VEIL]: {
    type: COLLECTIBLE_TYPES.PHANTOM_VEIL,
    label: 'Phantom Veil',
    shortLabel: 'Veil',
    category: 'artifact',
    shortcut: 'Q',
    description: 'Store and manually activate to conceal player from enemy detection for 4 seconds.',
    durationMs: 4000,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.ENERGY_CELL]: {
    type: COLLECTIBLE_TYPES.ENERGY_CELL,
    label: 'Energy Cell',
    shortLabel: 'Battery',
    category: 'power',
    shortcut: '',
    restorePercent: 30,
    description: 'Restores 30% of maximum flashlight battery. Cannot be collected when battery is full.',
    durationMs: 0,
    stackable: false,
  },
  [COLLECTIBLE_TYPES.WARDING_CHARM]: {
    type: COLLECTIBLE_TYPES.WARDING_CHARM,
    label: 'Warding Charm',
    shortLabel: 'Warden',
    category: 'relic',
    shortcut: '',
    description: 'Absorbs one enemy attack, granting one-hit protection.',
    durationMs: 0,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.TIME_FRAGMENT]: {
    type: COLLECTIBLE_TYPES.TIME_FRAGMENT,
    label: 'Time Fragment',
    shortLabel: 'Time',
    category: 'relic',
    shortcut: 'T',
    description: 'Store and manually activate to slow nearby enemies within 8 tiles by 50% for 5 seconds.',
    durationMs: 5000,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.WATCHERS_EYE]: {
    type: COLLECTIBLE_TYPES.WATCHERS_EYE,
    label: "Watcher's Eye",
    shortLabel: 'Eye',
    category: 'artifact',
    shortcut: 'R',
    description: 'Store and manually activate to reveal nearby enemies through walls within 10 tiles for 6 seconds.',
    durationMs: 6000,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.ECHO_PULSE]: {
    type: COLLECTIBLE_TYPES.ECHO_PULSE,
    label: 'Echo Pulse',
    shortLabel: 'Pulse',
    category: 'consumable',
    shortcut: 'E',
    description: 'Store and manually activate to emit a pulse stunning nearby enemies within 6 tiles for 2 seconds.',
    durationMs: 2000,
    stackable: true,
  },
  [COLLECTIBLE_TYPES.SPIRIT_LANTERN]: {
    type: COLLECTIBLE_TYPES.SPIRIT_LANTERN,
    label: 'Spirit Lantern',
    shortLabel: 'Lantern',
    category: 'artifact',
    shortcut: '',
    description: 'Illuminates the area and reveals nearby paths within 8 tiles for 8 seconds.',
    durationMs: 8000,
    stackable: false,
  },
  [COLLECTIBLE_TYPES.ECHO_REVEAL]: {
    type: COLLECTIBLE_TYPES.ECHO_REVEAL,
    label: 'Echo Reveal',
    shortLabel: 'Echo',
    category: 'ability',
    shortcut: '',
    description: 'Reveals the BFS shortest route to the exit gate.',
    durationMs: 4500,
    stackable: true,
  },
}

export const MANUAL_COLLECTIBLE_TYPES = Object.freeze([
  COLLECTIBLE_TYPES.PHANTOM_VEIL,
  COLLECTIBLE_TYPES.TIME_FRAGMENT,
  COLLECTIBLE_TYPES.WATCHERS_EYE,
  COLLECTIBLE_TYPES.ECHO_PULSE,
])

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
    spectralCompassRemainingMs: 0,
    wardingCharmsCount: 0,
    timeFragmentRemainingMs: 0,
    watchersEyeRemainingMs: 0,
    spiritLanternRemainingMs: 0,
  }
}
