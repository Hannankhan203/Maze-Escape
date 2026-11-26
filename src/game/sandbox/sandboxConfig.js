import { HAZARD_TYPES, STANDARD_HAZARD_TYPES } from '../generation/hazardTypes.js'
import { PROP_TYPES } from '../generation/environmentalPropPlacement.js'
import { ENEMY_ARCHETYPES, ENEMY_TYPES } from '../generation/enemyPlacement.js'
import {
  ALL_COLLECTIBLE_CATEGORIES,
  COLLECTIBLE_CONFIG,
  KEYCARD_COLLECTIBLE_TYPE,
  PERMANENT_COLLECTIBLE_CATEGORIES,
} from '../mechanics/collectiblesConfig.js'
import {
  ALL_HIDING_SPOT_TYPES,
  HIDING_SPOT_CONFIG,
  HIDING_SPOT_TYPES,
} from '../mechanics/hidingConfig.js'

export const SANDBOX_CONFIG_VERSION = 1
export const SANDBOX_STORAGE_KEY = 'maze-escape:dev-sandbox:v1'

export const SANDBOX_CATEGORY_IDS = Object.freeze({
  HAZARDS: 'hazards',
  COLLECTIBLES: 'collectibles',
  HIDING_SPOTS: 'hidingSpots',
  ENEMIES: 'enemies',
  ENVIRONMENTAL_OBJECTS: 'environmentalObjects',
})

export const PLACEMENT_MODES = Object.freeze({
  AUTO: 'auto',
  MANUAL: 'manual',
})

const HAZARD_LABELS = Object.freeze({
  [HAZARD_TYPES.CEILING_COLLAPSE]: {
    label: 'Ceiling Collapse',
    description: 'Overhead precast concrete soffit collapses onto the corridor floor.',
  },
  [HAZARD_TYPES.ROTTEN_FURNITURE_COLLAPSE]: {
    label: 'Rotten Furniture Collapse',
    description: 'Unstable stacked facility furniture topples when disturbed.',
  },
  [HAZARD_TYPES.FALLING_PIPES_FIXTURES]: {
    label: 'Falling Pipes & Fixtures',
    description: 'Corroded overhead pipe assemblies drop across narrow passages.',
  },
  [HAZARD_TYPES.STEAM_PIPE_BURST]: {
    label: 'Steam Pipe Burst',
    description: 'Pressurized steam line ruptures with scalding directional discharge.',
  },
  [HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING]: {
    label: 'Exposed Electrical Wiring',
    description: 'Live conduit junction arcs across damp corridor surfaces.',
  },
  [HAZARD_TYPES.COLLAPSING_FLOOR_GRATE]: {
    label: 'Collapsing Floor Grate',
    description: 'Weakened metal maintenance grate gives way over a floor pit.',
  },
  [HAZARD_TYPES.WALL_COLLAPSE]: {
    label: 'Wall Collapse',
    description: 'Fractured concrete wall bay shears inward into the walkway.',
  },
  [HAZARD_TYPES.FALLING_WATER_TANK]: {
    label: 'Falling Water Tank',
    description: 'Suspended overhead tank breaks free from rusted ceiling brackets.',
  },
  [HAZARD_TYPES.FALLING_SUSPENDED_MACHINERY]: {
    label: 'Falling Suspended Machinery',
    description: 'Heavy hoist-mounted industrial unit plunges down to floor level.',
  },
  [HAZARD_TYPES.VENTILATION_DUCT_COLLAPSE]: {
    label: 'Ventilation Duct Collapse',
    description: 'Overhead sheet-metal air trunk buckles and crashes down.',
  },
})

const HIDING_SPOT_DISPLAY_LABELS = Object.freeze({
  [HIDING_SPOT_TYPES.METAL_CUPBOARD]: 'Metal Cupboard',
  [HIDING_SPOT_TYPES.ELEVATED_PLATFORM]: 'Elevated Platform',
  [HIDING_SPOT_TYPES.PIPE_CRAWLSPACE]: 'Pipe Crawlspace',
  [HIDING_SPOT_TYPES.MACHINERY_HIDING]: 'Machinery Hiding',
  [HIDING_SPOT_TYPES.WALL_ALCOVE]: 'Wall Alcove',
  [HIDING_SPOT_TYPES.HEAVY_INDUSTRIAL_CURTAINS]: 'Heavy Industrial Curtains',
  [HIDING_SPOT_TYPES.FLOOR_HATCH]: 'Floor Hatch',
  [HIDING_SPOT_TYPES.STORAGE_SHELVES]: 'Storage Shelves',
})

const ENVIRONMENTAL_PROP_LABELS = Object.freeze({
  [PROP_TYPES.DESK_BROKEN]: {
    label: 'Broken Desk',
    description: 'Damaged facility office desk anchored along corridor walls.',
  },
  [PROP_TYPES.CHAIR_BROKEN]: {
    label: 'Broken Chair',
    description: 'Collapsed office chair prop placed along room and hall edges.',
  },
  [PROP_TYPES.CHAIR_OVERTURNED]: {
    label: 'Overturned Chair',
    description: 'Toppled facility chair angled beside desks or debris.',
  },
  [PROP_TYPES.FILING_CABINET]: {
    label: 'Filing Cabinet',
    description: 'Upright steel filing cabinet with solid collision footprint.',
  },
  [PROP_TYPES.FILING_CABINET_OVERTURNED]: {
    label: 'Overturned Filing Cabinet',
    description: 'Fallen metal cabinet blocking wall-side margins.',
  },
  [PROP_TYPES.STORAGE_LOCKER]: {
    label: 'Storage Locker',
    description: 'Environmental steel locker unit (non-hiding prop variant).',
  },
  [PROP_TYPES.STORAGE_SHELF]: {
    label: 'Storage Shelf',
    description: 'Industrial shelving rack prop along corridor walls.',
  },
  [PROP_TYPES.INDUSTRIAL_BARREL]: {
    label: 'Industrial Barrel',
    description: 'Cylindrical steel drum with circular collision bounds.',
  },
  [PROP_TYPES.WOODEN_CRATE]: {
    label: 'Wooden Crate',
    description: 'Weathered timber shipping crate placed in clusters.',
  },
  [PROP_TYPES.TOOLBOX]: {
    label: 'Toolbox',
    description: 'Compact maintenance toolbox placed beside machinery or shelves.',
  },
  [PROP_TYPES.ELECTRICAL_PANEL]: {
    label: 'Wall Electrical Panel',
    description: 'Wall-mounted breaker box prop (non-blocking corridor profile).',
  },
  [PROP_TYPES.DEBRIS_PILE]: {
    label: 'Debris Pile',
    description: 'Non-blocking concrete rubble and scattered floor debris.',
  },
})

export const ENVIRONMENTAL_OBJECT_TYPES = Object.freeze({
  BROKEN_START_ELEVATOR: 'broken_start_elevator',
  EXTRACTION_ELEVATOR: 'extraction_elevator',
  KEYCARD_EXIT_LOCK: 'keycard_exit_lock',
  HAZARD_DECOYS: 'hazard_decoys',
  ...PROP_TYPES,
  CEILING_LIGHTS: 'ceiling_lights',
  CEILING_VENTS: 'ceiling_vents',
  CEILING_ELECTRICAL: 'ceiling_electrical',
  STRUCTURAL_DETERIORATION: 'structural_deterioration',
  ELEVATOR_SHAFTS: 'elevator_shafts',
  SURFACE_IMPERFECTIONS_GRAFFITI: 'surface_imperfections_graffiti',
})

const INTERACTIVE_ELEMENTS_META = Object.freeze([
  {
    id: ENVIRONMENTAL_OBJECT_TYPES.BROKEN_START_ELEVATOR,
    label: 'Broken Start Elevator',
    subGroup: 'Interactive Elements',
    description: 'Spawn arrival elevator cab, descent sequence, and start platform.',
  },
  {
    id: ENVIRONMENTAL_OBJECT_TYPES.EXTRACTION_ELEVATOR,
    label: 'Emergency Extraction Elevator',
    subGroup: 'Interactive Elements',
    description: 'Exit gate extraction cabin, status beacons, and escape sequence.',
  },
  {
    id: ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK,
    label: 'Keycard Exit Gate Lock',
    subGroup: 'Interactive Elements',
    description: 'Locks the extraction elevator until all Resonance Keycards are collected.',
    requires: ['collectibles:resonance_keycard', 'environmentalObjects:extraction_elevator'],
  },
  {
    id: ENVIRONMENTAL_OBJECT_TYPES.HAZARD_DECOYS,
    label: 'Safe Hazard Decoy Fixtures',
    subGroup: 'Interactive Elements',
    description: 'Non-lethal visual decoys mirroring floor grates, pipes, ducts, tanks, and wiring.',
  },
])

const FACILITY_ARCHITECTURE_META = Object.freeze([
  {
    id: ENVIRONMENTAL_OBJECT_TYPES.CEILING_LIGHTS,
    label: 'Ceiling Lights',
    subGroup: 'Facility Architecture',
    description: 'Working, flickering, and burned-out overhead industrial light fixtures.',
  },
  {
    id: ENVIRONMENTAL_OBJECT_TYPES.CEILING_VENTS,
    label: 'Ceiling Ventilation Ducts & Grilles',
    subGroup: 'Facility Architecture',
    description: 'Overhead galvanized air trunking and ceiling grille assemblies.',
  },
  {
    id: ENVIRONMENTAL_OBJECT_TYPES.CEILING_ELECTRICAL,
    label: 'Ceiling Conduit & Junction Boxes',
    subGroup: 'Facility Architecture',
    description: 'Overhead EMT conduit runs, cable trays, and junction boxes.',
  },
  {
    id: ENVIRONMENTAL_OBJECT_TYPES.STRUCTURAL_DETERIORATION,
    label: 'Structural Concrete Deterioration',
    subGroup: 'Facility Architecture',
    description: 'Localized wall cracks, spalling, cavities, and exposed rebar fractures.',
  },
  {
    id: ENVIRONMENTAL_OBJECT_TYPES.ELEVATOR_SHAFTS,
    label: 'Vertical Elevator Shaft Interiors',
    subGroup: 'Facility Architecture',
    description: 'Vertical shaft openings and subterranean shaft structures above start/exit.',
  },
  {
    id: ENVIRONMENTAL_OBJECT_TYPES.SURFACE_IMPERFECTIONS_GRAFFITI,
    label: 'Surface Imperfections & Facility Graffiti',
    subGroup: 'Facility Architecture',
    description: 'Floor/wall surface weathering decals and selective facility markings.',
  },
])

function buildHazardItems() {
  return STANDARD_HAZARD_TYPES.map((type) => ({
    id: type,
    categoryId: SANDBOX_CATEGORY_IDS.HAZARDS,
    label: HAZARD_LABELS[type]?.label || type,
    subGroup: 'Facility Hazards',
    description: HAZARD_LABELS[type]?.description || '',
    defaultEnabled: true,
    sourceKey: type,
  }))
}

function buildCollectibleItems() {
  const permanentSet = new Set(PERMANENT_COLLECTIBLE_CATEGORIES)
  return ALL_COLLECTIBLE_CATEGORIES.map((type) => {
    const isPermanent = permanentSet.has(type)
    if (type === KEYCARD_COLLECTIBLE_TYPE) {
      return {
        id: type,
        categoryId: SANDBOX_CATEGORY_IDS.COLLECTIBLES,
        label: 'Resonance Keycard',
        subGroup: 'Mandatory / Progression',
        description: 'Objective security keycard required to unlock the extraction elevator gate.',
        defaultEnabled: true,
        sourceKey: type,
      }
    }
    const cfg = COLLECTIBLE_CONFIG[type]
    const shortcutHint = cfg?.shortcut ? ` [Key: ${cfg.shortcut}]` : ''
    return {
      id: type,
      categoryId: SANDBOX_CATEGORY_IDS.COLLECTIBLES,
      label: `${cfg?.label || type}${shortcutHint}`,
      subGroup: isPermanent ? 'Mandatory / Progression' : 'Optional / Abilities',
      description: cfg?.description || '',
      defaultEnabled: true,
      sourceKey: type,
    }
  })
}

function buildHidingSpotItems() {
  return ALL_HIDING_SPOT_TYPES.map((type) => {
    const cfg = HIDING_SPOT_CONFIG[type]
    const displayLabel = HIDING_SPOT_DISPLAY_LABELS[type] || cfg?.label || type
    const enclosureTag = cfg?.enclosure ? `Enclosure: ${cfg.enclosure.replace('_', ' ')}` : ''
    const durationTag = cfg?.maxDurationSec ? `Max ${cfg.maxDurationSec}s` : ''
    const extraMeta = [enclosureTag, durationTag].filter(Boolean).join(' · ')
    return {
      id: type,
      categoryId: SANDBOX_CATEGORY_IDS.HIDING_SPOTS,
      label: displayLabel,
      subGroup: 'Stealth Hiding Spots',
      description: `${cfg?.interactPrompt || displayLabel}${extraMeta ? ` (${extraMeta})` : ''}.`,
      defaultEnabled: true,
      sourceKey: type,
    }
  })
}

function buildEnemyItems() {
  return [ENEMY_TYPES.STALKER, ENEMY_TYPES.HUNTER, ENEMY_TYPES.BRUTE].map((type) => {
    const arch = ENEMY_ARCHETYPES[type]
    return {
      id: type,
      categoryId: SANDBOX_CATEGORY_IDS.ENEMIES,
      label: arch?.label || type,
      subGroup: 'Hostile Entities',
      description: `Patrol ${arch.patrolSpeed} · Chase ${arch.chaseSpeed} · Vision ${arch.visionRange}m · Damage ${arch.attackDamage}`,
      defaultEnabled: true,
      sourceKey: type,
    }
  })
}

function buildEnvironmentalItems() {
  const interactive = INTERACTIVE_ELEMENTS_META.map((item) => ({
    ...item,
    categoryId: SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
    defaultEnabled: true,
    sourceKey: item.id,
  }))
  const props = Object.values(PROP_TYPES).map((type) => ({
    id: type,
    categoryId: SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
    label: ENVIRONMENTAL_PROP_LABELS[type]?.label || type,
    subGroup: 'Environmental Props',
    description: ENVIRONMENTAL_PROP_LABELS[type]?.description || '',
    defaultEnabled: true,
    sourceKey: type,
  }))
  const architecture = FACILITY_ARCHITECTURE_META.map((item) => ({
    ...item,
    categoryId: SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
    defaultEnabled: true,
    sourceKey: item.id,
  }))
  return [...interactive, ...props, ...architecture]
}

export const SANDBOX_ITEMS_BY_CATEGORY = Object.freeze({
  [SANDBOX_CATEGORY_IDS.HAZARDS]: Object.freeze(buildHazardItems()),
  [SANDBOX_CATEGORY_IDS.COLLECTIBLES]: Object.freeze(buildCollectibleItems()),
  [SANDBOX_CATEGORY_IDS.HIDING_SPOTS]: Object.freeze(buildHidingSpotItems()),
  [SANDBOX_CATEGORY_IDS.ENEMIES]: Object.freeze(buildEnemyItems()),
  [SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS]: Object.freeze(buildEnvironmentalItems()),
})

export const SANDBOX_CATEGORIES = Object.freeze([
  Object.freeze({
    id: SANDBOX_CATEGORY_IDS.HAZARDS,
    label: 'Hazards',
    shortLabel: 'Hazards',
    description:
      'Configure which of the 10 facility hazard types can be included in the test level.',
    items: SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.HAZARDS],
  }),
  Object.freeze({
    id: SANDBOX_CATEGORY_IDS.COLLECTIBLES,
    label: 'Collectibles',
    shortLabel: 'Collectibles',
    description:
      'Toggle mandatory progression collectibles and optional utility/ability pickups.',
    items: SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.COLLECTIBLES],
  }),
  Object.freeze({
    id: SANDBOX_CATEGORY_IDS.HIDING_SPOTS,
    label: 'Hiding Spots',
    shortLabel: 'Hiding Spots',
    description:
      'Enable or disable any of the 8 stealth hiding spot installations.',
    items: SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.HIDING_SPOTS],
  }),
  Object.freeze({
    id: SANDBOX_CATEGORY_IDS.ENEMIES,
    label: 'Enemies',
    shortLabel: 'Enemies',
    description:
      'Choose which hostile entity archetypes are permitted to spawn in the test level.',
    items: SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.ENEMIES],
  }),
  Object.freeze({
    id: SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
    label: 'Environmental Objects & Interactive Elements',
    shortLabel: 'Environment',
    description:
      'Configure interactive facility mechanisms, environmental props, and architectural layers.',
    items: SANDBOX_ITEMS_BY_CATEGORY[SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS],
  }),
])

function createDefaultItemEntry(defaultEnabled = true) {
  return {
    enabled: Boolean(defaultEnabled),
    // Reserved extensibility fields for Stage 2+ (spawn quantities, placement preferences, manual/auto)
    quantity: null,
    placementMode: PLACEMENT_MODES.AUTO,
    placementPreference: 'auto',
    customConfig: null,
  }
}

function sanitizeItemEntry(rawEntry, defaultEnabled = true) {
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
    return createDefaultItemEntry(defaultEnabled)
  }

  const enabled =
    typeof rawEntry.enabled === 'boolean' ? rawEntry.enabled : Boolean(defaultEnabled)

  let quantity = null
  if (rawEntry.quantity !== null && rawEntry.quantity !== undefined) {
    const num = Number(rawEntry.quantity)
    if (Number.isFinite(num) && num >= 0) {
      quantity = Math.min(99, Math.floor(num))
    }
  }

  const placementMode =
    rawEntry.placementMode === PLACEMENT_MODES.MANUAL
      ? PLACEMENT_MODES.MANUAL
      : PLACEMENT_MODES.AUTO

  const placementPreference =
    typeof rawEntry.placementPreference === 'string' && rawEntry.placementPreference.trim()
      ? rawEntry.placementPreference.trim()
      : 'auto'

  const customConfig =
    rawEntry.customConfig &&
    typeof rawEntry.customConfig === 'object' &&
    !Array.isArray(rawEntry.customConfig)
      ? { ...rawEntry.customConfig }
      : null

  return {
    enabled,
    quantity,
    placementMode,
    placementPreference,
    customConfig,
  }
}

export function createDefaultSandboxConfig() {
  const categories = {}
  for (const cat of SANDBOX_CATEGORIES) {
    const items = {}
    for (const item of cat.items) {
      items[item.id] = createDefaultItemEntry(item.defaultEnabled)
    }
    categories[cat.id] = { items }
  }

  return {
    version: SANDBOX_CONFIG_VERSION,
    mode: 'sandbox',
    seed: null,
    categories,
  }
}

export function cloneSandboxConfig(config) {
  return normalizeSandboxConfig(config).config
}

/**
 * Normalizes any raw/partial sandbox configuration against the authoritative catalog
 * and prevents contradictory cross-category states (e.g. locking the exit with
 * keycards when Resonance Keycards or the Extraction Elevator are disabled).
 */
export function normalizeSandboxConfig(rawConfig, options = {}) {
  const defaults = createDefaultSandboxConfig()
  const source =
    rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
      ? rawConfig
      : {}
  const rawCategories =
    source.categories && typeof source.categories === 'object' && !Array.isArray(source.categories)
      ? source.categories
      : {}

  const categories = {}
  for (const cat of SANDBOX_CATEGORIES) {
    const rawCat =
      rawCategories[cat.id] &&
      typeof rawCategories[cat.id] === 'object' &&
      !Array.isArray(rawCategories[cat.id])
        ? rawCategories[cat.id]
        : {}
    const rawItems =
      rawCat.items && typeof rawCat.items === 'object' && !Array.isArray(rawCat.items)
        ? rawCat.items
        : rawCat

    const items = {}
    for (const item of cat.items) {
      const candidate =
        rawItems && Object.prototype.hasOwnProperty.call(rawItems, item.id)
          ? rawItems[item.id]
          : null
      items[item.id] =
        typeof candidate === 'boolean'
          ? createDefaultItemEntry(candidate)
          : sanitizeItemEntry(candidate, defaults.categories[cat.id].items[item.id].enabled)
    }
    categories[cat.id] = { items }
  }

  let seed = null
  if (source.seed !== null && source.seed !== undefined && source.seed !== '') {
    const numSeed = Number(source.seed)
    if (Number.isInteger(numSeed) && numSeed > 0) {
      seed = numSeed
    }
  }

  const normalized = {
    version: SANDBOX_CONFIG_VERSION,
    mode: 'sandbox',
    seed,
    categories,
  }

  const notices = []
  const keycardEntry =
    normalized.categories[SANDBOX_CATEGORY_IDS.COLLECTIBLES].items[KEYCARD_COLLECTIBLE_TYPE]
  const extractionEntry =
    normalized.categories[SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS].items[
      ENVIRONMENTAL_OBJECT_TYPES.EXTRACTION_ELEVATOR
    ]
  const exitLockEntry =
    normalized.categories[SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS].items[
      ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK
    ]

  if (options?.preferExitLockDependencies && exitLockEntry.enabled) {
    if (!keycardEntry.enabled) {
      keycardEntry.enabled = true
      notices.push(
        'Resonance Keycard was automatically enabled because Keycard Exit Gate Lock requires keycards.'
      )
    }
    if (!extractionEntry.enabled) {
      extractionEntry.enabled = true
      notices.push(
        'Emergency Extraction Elevator was automatically enabled because Keycard Exit Gate Lock requires an exit gate.'
      )
    }
  } else if (exitLockEntry.enabled && (!keycardEntry.enabled || !extractionEntry.enabled)) {
    exitLockEntry.enabled = false
    const missing = !keycardEntry.enabled && !extractionEntry.enabled
      ? 'Resonance Keycard and Emergency Extraction Elevator are disabled'
      : !keycardEntry.enabled
        ? 'Resonance Keycard is disabled'
        : 'Emergency Extraction Elevator is disabled'
    notices.push(
      `Keycard Exit Gate Lock was automatically disabled because ${missing}.`
    )
  }

  return {
    config: normalized,
    notices,
  }
}

export function isSandboxItemEnabled(config, categoryId, itemId) {
  const entry = config?.categories?.[categoryId]?.items?.[itemId]
  return Boolean(entry?.enabled)
}

export function toggleSandboxItem(config, categoryId, itemId, explicitEnabled = undefined) {
  const { config: base } = normalizeSandboxConfig(config)
  const targetCategory = base.categories?.[categoryId]
  if (!targetCategory || !targetCategory.items?.[itemId]) {
    return { config: base, notices: [] }
  }

  const nextEnabled =
    typeof explicitEnabled === 'boolean'
      ? explicitEnabled
      : !targetCategory.items[itemId].enabled

  const draft = {
    ...base,
    categories: {
      ...base.categories,
      [categoryId]: {
        items: {
          ...targetCategory.items,
          [itemId]: {
            ...targetCategory.items[itemId],
            enabled: nextEnabled,
          },
        },
      },
    },
  }

  const preferExitLockDependencies =
    categoryId === SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS &&
    itemId === ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK &&
    nextEnabled

  return normalizeSandboxConfig(draft, { preferExitLockDependencies })
}

export function setCategoryAllEnabled(config, categoryId, enabled) {
  const { config: base } = normalizeSandboxConfig(config)
  const categoryMeta = SANDBOX_CATEGORIES.find((cat) => cat.id === categoryId)
  if (!categoryMeta) {
    return { config: base, notices: [] }
  }

  const nextItems = {}
  const prevItems = base.categories[categoryId]?.items || {}
  for (const item of categoryMeta.items) {
    nextItems[item.id] = {
      ...(prevItems[item.id] || createDefaultItemEntry(item.defaultEnabled)),
      enabled: Boolean(enabled),
    }
  }

  const draft = {
    ...base,
    categories: {
      ...base.categories,
      [categoryId]: {
        items: nextItems,
      },
    },
  }

  const preferExitLockDependencies =
    categoryId === SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS && Boolean(enabled)

  return normalizeSandboxConfig(draft, { preferExitLockDependencies })
}

export function resetSandboxConfig() {
  return {
    config: createDefaultSandboxConfig(),
    notices: [],
  }
}

export function validateSandboxConfig(config) {
  const { config: normalized, notices } = normalizeSandboxConfig(config)
  const errors = []
  const warnings = []

  const keycardEnabled = isSandboxItemEnabled(
    normalized,
    SANDBOX_CATEGORY_IDS.COLLECTIBLES,
    KEYCARD_COLLECTIBLE_TYPE
  )
  const extractionEnabled = isSandboxItemEnabled(
    normalized,
    SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
    ENVIRONMENTAL_OBJECT_TYPES.EXTRACTION_ELEVATOR
  )
  const exitLockEnabled = isSandboxItemEnabled(
    normalized,
    SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
    ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK
  )
  if (exitLockEnabled && (!keycardEnabled || !extractionEnabled)) {
    errors.push(
      'Keycard Exit Gate Lock requires both Resonance Keycard and Emergency Extraction Elevator.'
    )
  }

  const spectralCompassEnabled = isSandboxItemEnabled(
    normalized,
    SANDBOX_CATEGORY_IDS.COLLECTIBLES,
    'spectral_compass'
  )
  const soulShardsEnabled = isSandboxItemEnabled(
    normalized,
    SANDBOX_CATEGORY_IDS.COLLECTIBLES,
    'soul_shards'
  )
  if (spectralCompassEnabled && !soulShardsEnabled) {
    warnings.push(
      'Spectral Compass is enabled while Soul Shards are disabled (compass attraction will have no shard targets).'
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    notices,
    config: normalized,
  }
}

export function getSandboxCategorySummary(config, categoryId) {
  const categoryMeta = SANDBOX_CATEGORIES.find((cat) => cat.id === categoryId)
  if (!categoryMeta) {
    return {
      categoryId,
      enabledCount: 0,
      totalCount: 0,
      allSelected: false,
      noneSelected: true,
      enabledIds: [],
    }
  }

  const itemsMap = config?.categories?.[categoryId]?.items || {}
  const enabledIds = []
  for (const item of categoryMeta.items) {
    if (itemsMap[item.id]?.enabled) {
      enabledIds.push(item.id)
    }
  }
  const totalCount = categoryMeta.items.length
  const enabledCount = enabledIds.length

  return {
    categoryId,
    enabledCount,
    totalCount,
    allSelected: enabledCount === totalCount,
    noneSelected: enabledCount === 0,
    enabledIds,
  }
}

export function getSandboxConfigSummary(config) {
  const { config: normalized } = normalizeSandboxConfig(config)
  const byCategory = {}
  const enabledByCategory = {}
  let totalEnabled = 0
  let totalItems = 0

  for (const cat of SANDBOX_CATEGORIES) {
    const summary = getSandboxCategorySummary(normalized, cat.id)
    byCategory[cat.id] = summary
    enabledByCategory[cat.id] = summary.enabledIds
    totalEnabled += summary.enabledCount
    totalItems += summary.totalCount
  }

  return {
    mode: 'sandbox',
    totalEnabled,
    totalItems,
    byCategory,
    enabledByCategory,
    objectivesEnabled:
      isSandboxItemEnabled(
        normalized,
        SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
        ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK
      ) &&
      isSandboxItemEnabled(
        normalized,
        SANDBOX_CATEGORY_IDS.COLLECTIBLES,
        KEYCARD_COLLECTIBLE_TYPE
      ),
  }
}

function resolveSandboxStorage(customStorage) {
  if (customStorage !== undefined) return customStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    return null
  }
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage
    }
  } catch {
    return null
  }
  return null
}

/**
 * Pure read-only loader for developer sandbox configuration.
 * Uses an isolated storage key and never modifies normal game settings or progress.
 */
export function loadSandboxConfig(storage) {
  const targetStorage = resolveSandboxStorage(storage)
  if (!targetStorage || typeof targetStorage.getItem !== 'function') {
    return createDefaultSandboxConfig()
  }
  try {
    const raw = targetStorage.getItem(SANDBOX_STORAGE_KEY)
    if (typeof raw !== 'string' || !raw.trim()) {
      return createDefaultSandboxConfig()
    }
    const parsed = JSON.parse(raw)
    return normalizeSandboxConfig(parsed).config
  } catch {
    return createDefaultSandboxConfig()
  }
}

export function saveSandboxConfig(config, storage) {
  const { config: normalized, notices } = normalizeSandboxConfig(config)
  const targetStorage = resolveSandboxStorage(storage)
  let saved = false
  if (targetStorage && typeof targetStorage.setItem === 'function') {
    try {
      targetStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(normalized))
      saved = true
    } catch {
      saved = false
    }
  }
  return {
    config: normalized,
    notices,
    saved,
  }
}

export function resetPersistedSandboxConfig(storage) {
  const defaults = createDefaultSandboxConfig()
  const targetStorage = resolveSandboxStorage(storage)
  if (targetStorage && typeof targetStorage.removeItem === 'function') {
    try {
      targetStorage.removeItem(SANDBOX_STORAGE_KEY)
    } catch {
      // Ignore storage removal errors
    }
  }
  return {
    config: defaults,
    notices: [],
  }
}
