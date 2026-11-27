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
  PREFERENCE: 'preference',
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

export const SANDBOX_GLOBAL_LIMITS = Object.freeze({
  maxTotalSpawnableEntities: 200,
  categoryCaps: Object.freeze({
    [SANDBOX_CATEGORY_IDS.HAZARDS]: 40,
    [SANDBOX_CATEGORY_IDS.COLLECTIBLES]: 70,
    [SANDBOX_CATEGORY_IDS.HIDING_SPOTS]: 32,
    [SANDBOX_CATEGORY_IDS.ENEMIES]: 24,
    [SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS]: 120,
  }),
})

export const SANDBOX_ITEM_QUANTITY_LIMITS = Object.freeze({
  defaultByCategory: Object.freeze({
    [SANDBOX_CATEGORY_IDS.HAZARDS]: Object.freeze({ min: 0, max: 12 }),
    [SANDBOX_CATEGORY_IDS.COLLECTIBLES]: Object.freeze({ min: 0, max: 12 }),
    [SANDBOX_CATEGORY_IDS.HIDING_SPOTS]: Object.freeze({ min: 0, max: 10 }),
    [SANDBOX_CATEGORY_IDS.ENEMIES]: Object.freeze({ min: 0, max: 12 }),
    [SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS]: Object.freeze({ min: 0, max: 25 }),
  }),
  byItemId: Object.freeze({
    [KEYCARD_COLLECTIBLE_TYPE]: Object.freeze({ min: 0, max: 8 }),
    soul_shards: Object.freeze({ min: 0, max: 30 }),
    [ENVIRONMENTAL_OBJECT_TYPES.HAZARD_DECOYS]: Object.freeze({ min: 0, max: 20 }),
  }),
})

export const QUANTITY_INELIGIBLE_ENVIRONMENTAL_TYPES = Object.freeze({
  [ENVIRONMENTAL_OBJECT_TYPES.BROKEN_START_ELEVATOR]:
    'Singleton infrastructure (player start point)',
  [ENVIRONMENTAL_OBJECT_TYPES.EXTRACTION_ELEVATOR]:
    'Singleton infrastructure (extraction exit gate)',
  [ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK]:
    'Singleton mechanism (security exit lock door)',
  [ENVIRONMENTAL_OBJECT_TYPES.CEILING_LIGHTS]:
    'Architectural fixture layer (corridor ceiling lighting)',
  [ENVIRONMENTAL_OBJECT_TYPES.CEILING_VENTS]:
    'Architectural duct layer (corridor ventilation vents)',
  [ENVIRONMENTAL_OBJECT_TYPES.CEILING_ELECTRICAL]:
    'Architectural conduit layer (overhead wiring conduits)',
  [ENVIRONMENTAL_OBJECT_TYPES.STRUCTURAL_DETERIORATION]:
    'Architectural deterioration layer (distressed wall geometry)',
  [ENVIRONMENTAL_OBJECT_TYPES.ELEVATOR_SHAFTS]:
    'Subterranean interior structures (vertical shaft depths)',
  [ENVIRONMENTAL_OBJECT_TYPES.SURFACE_IMPERFECTIONS_GRAFFITI]:
    'Surface decal layer (weathering and graffiti markings)',
})

export const PLACEMENT_PREFERENCES = Object.freeze([
  Object.freeze({ id: 'auto', label: 'Automatic / Balanced' }),
  Object.freeze({ id: 'near_start', label: 'Near Player Start' }),
  Object.freeze({ id: 'far_start', label: 'Far From Player Start' }),
  Object.freeze({ id: 'corridors', label: 'Near Corridors' }),
  Object.freeze({ id: 'dead_ends', label: 'Dead Ends' }),
  Object.freeze({ id: 'central', label: 'Central Area' }),
  Object.freeze({ id: 'spread', label: 'Spread Out' }),
  Object.freeze({ id: 'clustered', label: 'Clustered' }),
  Object.freeze({ id: 'isolated', label: 'Isolated' }),
])

const VALID_PLACEMENT_PREFERENCE_SET = new Set(PLACEMENT_PREFERENCES.map((p) => p.id))

export function isItemQuantityEligible(categoryId, itemId) {
  if (categoryId === SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS) {
    return !Object.prototype.hasOwnProperty.call(
      QUANTITY_INELIGIBLE_ENVIRONMENTAL_TYPES,
      itemId
    )
  }
  return true
}

export function getItemQuantityLimits(categoryId, itemId, mazeDimensions = null) {
  if (!isItemQuantityEligible(categoryId, itemId)) {
    return {
      eligible: false,
      min: 0,
      max: 0,
      categoryMax: 0,
      globalMax: SANDBOX_GLOBAL_LIMITS.maxTotalSpawnableEntities,
    }
  }

  const base =
    SANDBOX_ITEM_QUANTITY_LIMITS.byItemId[itemId] ||
    SANDBOX_ITEM_QUANTITY_LIMITS.defaultByCategory[categoryId] ||
    { min: 0, max: 12 }

  const categoryCap =
    SANDBOX_GLOBAL_LIMITS.categoryCaps[categoryId] ??
    SANDBOX_GLOBAL_LIMITS.maxTotalSpawnableEntities

  let effectiveMax = base.max
  let effectiveCategoryMax = categoryCap
  if (
    mazeDimensions &&
    Number.isFinite(mazeDimensions.walkableCount) &&
    mazeDimensions.walkableCount > 0
  ) {
    const walkable = Math.floor(mazeDimensions.walkableCount)
    effectiveMax = Math.min(effectiveMax, Math.max(1, Math.floor(walkable * 0.25)))
    effectiveCategoryMax = Math.min(
      effectiveCategoryMax,
      Math.max(2, Math.floor(walkable * 0.4))
    )
  }

  return {
    eligible: true,
    min: base.min,
    max: effectiveMax,
    categoryMax: effectiveCategoryMax,
    globalMax: SANDBOX_GLOBAL_LIMITS.maxTotalSpawnableEntities,
  }
}

export function getSupportedPlacementPreferences(categoryId, itemId) {
  if (!isItemQuantityEligible(categoryId, itemId)) {
    return []
  }

  // Wall-anchored items & hiding spots strictly require an adjacent wall,
  // which still supports all spatial/topological preferences (candidates without
  // adjacent walls are filtered out before scoring), except wall_collapse /
  // electrical_panel / hiding spots stay clearly labeled and valid.
  // For single-goal items like resonance_keycard, keep all strategic placements available.
  if (categoryId === SANDBOX_CATEGORY_IDS.ENEMIES) {
    // Hostiles support all tactical placement modes (including near_start with strict LOS/buffer safety).
    return [...PLACEMENT_PREFERENCES]
  }
  return [...PLACEMENT_PREFERENCES]
}

function getDefaultItemLimitMax(categoryId, itemId) {
  return getItemQuantityLimits(categoryId, itemId).max
}

function createDefaultItemEntry(defaultEnabled = true) {
  return {
    enabled: Boolean(defaultEnabled),
    quantity: null,
    placementMode: PLACEMENT_MODES.AUTO,
    placementPreference: 'auto',
    manualPlacements: [],
    customConfig: null,
  }
}

function sanitizeItemEntry(rawEntry, defaultEnabled = true, categoryId = null, itemId = null) {
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
    return createDefaultItemEntry(defaultEnabled)
  }

  const enabled =
    typeof rawEntry.enabled === 'boolean' ? rawEntry.enabled : Boolean(defaultEnabled)

  const eligible =
    categoryId && itemId ? isItemQuantityEligible(categoryId, itemId) : true

  let quantity = null
  if (eligible && rawEntry.quantity !== null && rawEntry.quantity !== undefined && rawEntry.quantity !== '') {
    const num = Number(rawEntry.quantity)
    if (Number.isFinite(num)) {
      const maxAllowed =
        categoryId && itemId ? getDefaultItemLimitMax(categoryId, itemId) : 30
      quantity = Math.max(0, Math.min(maxAllowed, Math.floor(num)))
    }
  }

  const placementMode =
    rawEntry.placementMode === PLACEMENT_MODES.MANUAL
      ? PLACEMENT_MODES.MANUAL
      : rawEntry.placementMode === PLACEMENT_MODES.PREFERENCE
        ? PLACEMENT_MODES.PREFERENCE
        : PLACEMENT_MODES.AUTO

  let placementPreference = 'auto'
  if (
    eligible &&
    typeof rawEntry.placementPreference === 'string' &&
    rawEntry.placementPreference.trim()
  ) {
    const trimmed = rawEntry.placementPreference.trim()
    if (VALID_PLACEMENT_PREFERENCE_SET.has(trimmed)) {
      const supported =
        categoryId && itemId
          ? getSupportedPlacementPreferences(categoryId, itemId)
          : PLACEMENT_PREFERENCES
      if (supported.some((p) => p.id === trimmed)) {
        placementPreference = trimmed
      }
    }
  }

  let manualPlacements = []
  if (Array.isArray(rawEntry.manualPlacements)) {
    manualPlacements = rawEntry.manualPlacements
      .filter((p) => p && Number.isInteger(p.row) && Number.isInteger(p.col))
      .map((p) => ({
        row: Math.floor(p.row),
        col: Math.floor(p.col),
        ...(typeof p.id === 'string' && p.id.trim() ? { id: p.id.trim() } : {}),
      }))
  }

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
    manualPlacements,
    customConfig,
  }
}

export function setItemPlacementMode(config, categoryId, itemId, placementMode) {
  const { config: base } = normalizeSandboxConfig(config)
  const targetCategory = base.categories?.[categoryId]
  if (!targetCategory || !targetCategory.items?.[itemId]) {
    return { config: base, notices: [] }
  }
  const mode =
    placementMode === PLACEMENT_MODES.MANUAL
      ? PLACEMENT_MODES.MANUAL
      : placementMode === PLACEMENT_MODES.PREFERENCE
        ? PLACEMENT_MODES.PREFERENCE
        : PLACEMENT_MODES.AUTO

  const draft = {
    ...base,
    customModified: true,
    categories: {
      ...base.categories,
      [categoryId]: {
        items: {
          ...targetCategory.items,
          [itemId]: {
            ...targetCategory.items[itemId],
            placementMode: mode,
          },
        },
      },
    },
  }
  return normalizeSandboxConfig(draft)
}

export function setManualPlacements(config, categoryId, itemId, manualPlacements) {
  const { config: base } = normalizeSandboxConfig(config)
  const targetCategory = base.categories?.[categoryId]
  if (!targetCategory || !targetCategory.items?.[itemId]) {
    return { config: base, notices: [] }
  }
  const cleaned = Array.isArray(manualPlacements)
    ? manualPlacements
        .filter((p) => p && Number.isInteger(p.row) && Number.isInteger(p.col))
        .map((p) => ({
          row: Math.floor(p.row),
          col: Math.floor(p.col),
          ...(typeof p.id === 'string' && p.id.trim() ? { id: p.id.trim() } : {}),
        }))
    : []

  const draft = {
    ...base,
    customModified: true,
    categories: {
      ...base.categories,
      [categoryId]: {
        items: {
          ...targetCategory.items,
          [itemId]: {
            ...targetCategory.items[itemId],
            manualPlacements: cleaned,
          },
        },
      },
    },
  }
  return normalizeSandboxConfig(draft)
}

export function addManualPlacement(config, categoryId, itemId, row, col, placementId = null) {
  const { config: base } = normalizeSandboxConfig(config)
  const entry = base.categories?.[categoryId]?.items?.[itemId]
  if (!entry || !Number.isInteger(row) || !Number.isInteger(col)) {
    return { config: base, notices: [] }
  }
  const existing = Array.isArray(entry.manualPlacements) ? [...entry.manualPlacements] : []
  const r = Math.floor(row)
  const c = Math.floor(col)
  const idx = existing.findIndex((p) => p.row === r && p.col === c)
  if (idx !== -1) {
    existing.splice(idx, 1)
  } else {
    existing.push({
      row: r,
      col: c,
      ...(typeof placementId === 'string' && placementId.trim() ? { id: placementId.trim() } : {}),
    })
  }
  return setManualPlacements(base, categoryId, itemId, existing)
}

export function updateManualPlacement(config, categoryId, itemId, targetIndexOrCoord, nextCoord) {
  const { config: base } = normalizeSandboxConfig(config)
  const entry = base.categories?.[categoryId]?.items?.[itemId]
  if (!entry || !Array.isArray(entry.manualPlacements) || !nextCoord) {
    return { config: base, notices: [] }
  }
  if (!Number.isInteger(nextCoord.row) || !Number.isInteger(nextCoord.col)) {
    return { config: base, notices: ['Ignored invalid manual coordinate update.'] }
  }
  const existing = [...entry.manualPlacements]
  const idx =
    typeof targetIndexOrCoord === 'number'
      ? targetIndexOrCoord
      : existing.findIndex(
          (p) => p.row === targetIndexOrCoord?.row && p.col === targetIndexOrCoord?.col
        )
  if (idx < 0 || idx >= existing.length) {
    return { config: base, notices: [] }
  }
  existing[idx] = {
    row: Math.floor(nextCoord.row),
    col: Math.floor(nextCoord.col),
    ...(typeof nextCoord.id === 'string' && nextCoord.id.trim()
      ? { id: nextCoord.id.trim() }
      : existing[idx].id
        ? { id: existing[idx].id }
        : {}),
  }
  return setManualPlacements(base, categoryId, itemId, existing)
}

export function removeManualPlacement(config, categoryId, itemId, row, col) {
  const { config: base } = normalizeSandboxConfig(config)
  const entry = base.categories?.[categoryId]?.items?.[itemId]
  if (!entry || !Array.isArray(entry.manualPlacements)) {
    return { config: base, notices: [] }
  }
  const filtered = entry.manualPlacements.filter((p) => p.row !== row || p.col !== col)
  return setManualPlacements(base, categoryId, itemId, filtered)
}

export function clearManualPlacements(config, categoryId, itemId) {
  return setManualPlacements(config, categoryId, itemId, [])
}

export function setSandboxSeed(config, seed) {
  const { config: base, notices } = normalizeSandboxConfig(config)
  let nextSeed = null
  if (seed !== null && seed !== undefined && String(seed).trim() !== '') {
    const parsed = Number(seed)
    if (Number.isInteger(parsed) && parsed > 0) {
      nextSeed = Math.floor(parsed)
    } else {
      return {
        config: base,
        notices: ['Ignored invalid seed; expected a positive integer.'],
      }
    }
  }
  return {
    config: {
      ...base,
      seed: nextSeed,
      customModified: true,
    },
    notices,
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
    activePreset: 'default',
    customModified: false,
    allowPreferenceFallback: false,
    categories,
  }
}

export function cloneSandboxConfig(config) {
  return normalizeSandboxConfig(config).config
}

function getCategoryAndGlobalTotals(categories) {
  const categoryTotals = {}
  let totalExplicit = 0
  for (const cat of SANDBOX_CATEGORIES) {
    const itemsMap = categories[cat.id]?.items || {}
    let catSum = 0
    for (const item of cat.items) {
      if (!isItemQuantityEligible(cat.id, item.id)) continue
      const entry = itemsMap[item.id]
      if (!entry?.enabled) continue
      if (entry.quantity !== null && entry.quantity !== undefined) {
        catSum += Math.max(0, Math.floor(entry.quantity))
      }
    }
    categoryTotals[cat.id] = catSum
    totalExplicit += catSum
  }
  return { categoryTotals, totalExplicit }
}

/**
 * Normalizes any raw/partial sandbox configuration against the authoritative catalog
 * and prevents contradictory cross-category states (e.g. locking the exit with
 * keycards when Resonance Keycards or the Extraction Elevator are disabled or qty 0).
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
          : sanitizeItemEntry(
              candidate,
              defaults.categories[cat.id].items[item.id].enabled,
              cat.id,
              item.id
            )
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

  const allowPreferenceFallback = Boolean(source.allowPreferenceFallback)
  const activePreset =
    typeof source.activePreset === 'string' && source.activePreset.trim()
      ? source.activePreset.trim()
      : 'default'
  const customModified = Boolean(source.customModified)

  const normalized = {
    version: SANDBOX_CONFIG_VERSION,
    mode: 'sandbox',
    seed,
    activePreset,
    customModified,
    allowPreferenceFallback,
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

  const hasSpawningKeycards = keycardEntry.enabled && keycardEntry.quantity !== 0

  if (options?.preferExitLockDependencies && exitLockEntry.enabled) {
    if (!keycardEntry.enabled) {
      keycardEntry.enabled = true
      notices.push(
        'Resonance Keycard was automatically enabled because Keycard Exit Gate Lock requires keycards.'
      )
    }
    if (keycardEntry.quantity === 0) {
      keycardEntry.quantity = null
      notices.push(
        'Resonance Keycard quantity was reset to Auto because Keycard Exit Gate Lock requires at least 1 keycard.'
      )
    }
    if (!extractionEntry.enabled) {
      extractionEntry.enabled = true
      notices.push(
        'Emergency Extraction Elevator was automatically enabled because Keycard Exit Gate Lock requires an exit gate.'
      )
    }
  } else if (exitLockEntry.enabled && (!hasSpawningKeycards || !extractionEntry.enabled)) {
    exitLockEntry.enabled = false
    const missing =
      !hasSpawningKeycards && !extractionEntry.enabled
        ? 'Resonance Keycard has 0 spawns and Emergency Extraction Elevator is disabled'
        : !keycardEntry.enabled
          ? 'Resonance Keycard is disabled'
          : keycardEntry.quantity === 0
            ? 'Resonance Keycard quantity is set to 0'
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
    customModified: true,
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
    customModified: true,
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

export function setSandboxAllowFallback(config, allowFallback) {
  const { config: base, notices } = normalizeSandboxConfig(config)
  return {
    config: {
      ...base,
      customModified: true,
      allowPreferenceFallback: Boolean(allowFallback),
    },
    notices,
  }
}

export function setItemQuantity(config, categoryId, itemId, quantity) {
  const { config: base } = normalizeSandboxConfig(config)
  const targetCategory = base.categories?.[categoryId]
  if (!targetCategory || !targetCategory.items?.[itemId]) {
    return { config: base, notices: [] }
  }

  if (!isItemQuantityEligible(categoryId, itemId)) {
    return {
      config: base,
      notices: ['This architectural or singleton element does not support custom spawn quantities.'],
    }
  }

  const notices = []
  const limits = getItemQuantityLimits(categoryId, itemId)
  const currentQty = targetCategory.items[itemId].quantity

  let parsedQty = null
  if (quantity !== null && quantity !== undefined && quantity !== '') {
    const num = Number(quantity)
    if (!Number.isFinite(num)) {
      return {
        config: base,
        notices: ['Ignored invalid non-numeric spawn quantity.'],
      }
    }
    const floored = Math.floor(num)
    if (floored < limits.min) {
      parsedQty = limits.min
      notices.push(`Clamped quantity for ${itemId} to minimum (${limits.min}).`)
    } else if (floored > limits.max) {
      parsedQty = limits.max
      notices.push(`Clamped quantity for ${itemId} to per-item limit (${limits.max}).`)
    } else {
      parsedQty = floored
    }

    // Enforce category and global safe caps
    if (targetCategory.items[itemId].enabled && parsedQty > 0) {
      const { categoryTotals, totalExplicit } = getCategoryAndGlobalTotals(base.categories)
      const prevContrib =
        currentQty !== null && currentQty !== undefined ? currentQty : 0
      const otherInCategory = Math.max(0, (categoryTotals[categoryId] || 0) - prevContrib)
      const otherGlobal = Math.max(0, totalExplicit - prevContrib)

      const categoryHeadroom = Math.max(0, limits.categoryMax - otherInCategory)
      const globalHeadroom = Math.max(0, limits.globalMax - otherGlobal)
      const effectiveSafeCap = Math.min(categoryHeadroom, globalHeadroom)

      if (parsedQty > effectiveSafeCap) {
        parsedQty = effectiveSafeCap
        notices.push(
          `Clamped quantity for ${itemId} to ${effectiveSafeCap} to respect safe category/global placement limits (${limits.categoryMax} category / ${limits.globalMax} global).`
        )
      }
    }
  }

  const draft = {
    ...base,
    customModified: true,
    categories: {
      ...base.categories,
      [categoryId]: {
        items: {
          ...targetCategory.items,
          [itemId]: {
            ...targetCategory.items[itemId],
            quantity: parsedQty,
          },
        },
      },
    },
  }
  const normalizedResult = normalizeSandboxConfig(draft)
  return {
    config: normalizedResult.config,
    notices: [...notices, ...normalizedResult.notices],
  }
}

export function setItemPlacementPreference(
  config,
  categoryId,
  itemId,
  placementPreference
) {
  const { config: base } = normalizeSandboxConfig(config)
  const targetCategory = base.categories?.[categoryId]
  if (!targetCategory || !targetCategory.items?.[itemId]) {
    return { config: base, notices: [] }
  }

  if (!isItemQuantityEligible(categoryId, itemId)) {
    return {
      config: base,
      notices: ['This architectural or singleton element does not support placement preferences.'],
    }
  }

  const rawPref =
    typeof placementPreference === 'string' && placementPreference.trim()
      ? placementPreference.trim()
      : 'auto'

  const supported = getSupportedPlacementPreferences(categoryId, itemId)
  const isSupported = supported.some((p) => p.id === rawPref)
  const pref = isSupported ? rawPref : 'auto'
  const notices = []
  if (!isSupported && rawPref !== 'auto') {
    notices.push(`Placement preference '${rawPref}' is not supported for ${itemId}; using Automatic / Balanced.`)
  }

  const draft = {
    ...base,
    customModified: true,
    categories: {
      ...base.categories,
      [categoryId]: {
        items: {
          ...targetCategory.items,
          [itemId]: {
            ...targetCategory.items[itemId],
            placementPreference: pref,
          },
        },
      },
    },
  }
  const normalizedResult = normalizeSandboxConfig(draft)
  return {
    config: normalizedResult.config,
    notices: [...notices, ...normalizedResult.notices],
  }
}

export function validateSandboxConfig(config) {
  const { config: normalized, notices } = normalizeSandboxConfig(config)
  const errors = []
  const warnings = []

  const keycardEntry =
    normalized.categories?.[SANDBOX_CATEGORY_IDS.COLLECTIBLES]?.items?.[
      KEYCARD_COLLECTIBLE_TYPE
    ]
  const keycardEnabled = Boolean(keycardEntry?.enabled) && keycardEntry?.quantity !== 0
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
      'Keycard Exit Gate Lock requires spawning Resonance Keycards and an enabled Emergency Extraction Elevator.'
    )
  }

  const compassEntry =
    normalized.categories?.[SANDBOX_CATEGORY_IDS.COLLECTIBLES]?.items?.spectral_compass
  const shardsEntry =
    normalized.categories?.[SANDBOX_CATEGORY_IDS.COLLECTIBLES]?.items?.soul_shards
  const spectralCompassActive = Boolean(compassEntry?.enabled) && compassEntry?.quantity !== 0
  const soulShardsActive = Boolean(shardsEntry?.enabled) && shardsEntry?.quantity !== 0
  if (spectralCompassActive && !soulShardsActive) {
    warnings.push(
      'Spectral Compass is enabled while Soul Shards are disabled or set to 0 (compass attraction will have no shard targets).'
    )
  }

  const { categoryTotals, totalExplicit } = getCategoryAndGlobalTotals(normalized.categories)
  for (const cat of SANDBOX_CATEGORIES) {
    const cap = SANDBOX_GLOBAL_LIMITS.categoryCaps[cat.id]
    if (cap && (categoryTotals[cat.id] || 0) > cap) {
      errors.push(
        `${cat.label} explicit spawn total (${categoryTotals[cat.id]}) exceeds safe category limit (${cap}).`
      )
    }
  }
  if (totalExplicit > SANDBOX_GLOBAL_LIMITS.maxTotalSpawnableEntities) {
    errors.push(
      `Total configured spawn count (${totalExplicit}) exceeds safe global limit (${SANDBOX_GLOBAL_LIMITS.maxTotalSpawnableEntities}).`
    )
  }

  // Validate manual placements vs configured quantity and overlapping manual cells
  const manualCellsMap = new Map()
  for (const cat of SANDBOX_CATEGORIES) {
    const catItems = normalized.categories?.[cat.id]?.items || {}
    for (const [itemId, itemEntry] of Object.entries(catItems)) {
      if (itemEntry?.enabled && Array.isArray(itemEntry.manualPlacements)) {
        if (
          itemEntry.quantity !== null &&
          itemEntry.quantity !== undefined &&
          itemEntry.manualPlacements.length > itemEntry.quantity
        ) {
          warnings.push(
            `${itemId} has ${itemEntry.manualPlacements.length} manual placement(s) exceeding configured quantity cap (${itemEntry.quantity}).`
          )
        }
        for (const coord of itemEntry.manualPlacements) {
          if (coord && Number.isInteger(coord.row) && Number.isInteger(coord.col)) {
            const key = `${coord.row},${coord.col}`
            if (manualCellsMap.has(key)) {
              const prev = manualCellsMap.get(key)
              warnings.push(
                `Manual placement overlap at (${coord.row}, ${coord.col}): ${itemId} and ${prev.itemId}.`
              )
            } else {
              manualCellsMap.set(key, { categoryId: cat.id, itemId })
            }
          }
        }
      }
    }
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
      customQuantityCount: 0,
      zeroQuantityCount: 0,
      explicitSpawnTotal: 0,
      customPreferenceCount: 0,
    }
  }

  const itemsMap = config?.categories?.[categoryId]?.items || {}
  const enabledIds = []
  let customQuantityCount = 0
  let zeroQuantityCount = 0
  let explicitSpawnTotal = 0
  let customPreferenceCount = 0

  for (const item of categoryMeta.items) {
    const entry = itemsMap[item.id]
    if (entry?.enabled) {
      enabledIds.push(item.id)
      if (isItemQuantityEligible(categoryId, item.id)) {
        if (entry.quantity !== null && entry.quantity !== undefined) {
          customQuantityCount += 1
          explicitSpawnTotal += entry.quantity
          if (entry.quantity === 0) {
            zeroQuantityCount += 1
          }
        }
        if (entry.placementPreference && entry.placementPreference !== 'auto') {
          customPreferenceCount += 1
        }
      }
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
    customQuantityCount,
    zeroQuantityCount,
    explicitSpawnTotal,
    customPreferenceCount,
  }
}

export function getSandboxConfigSummary(config) {
  const { config: normalized } = normalizeSandboxConfig(config)
  const byCategory = {}
  const enabledByCategory = {}
  let totalEnabled = 0
  let totalItems = 0
  let customQuantityCount = 0
  let zeroQuantityCount = 0
  let totalConfiguredSpawnCount = 0
  let customPreferenceCount = 0

  for (const cat of SANDBOX_CATEGORIES) {
    const summary = getSandboxCategorySummary(normalized, cat.id)
    byCategory[cat.id] = summary
    enabledByCategory[cat.id] = summary.enabledIds
    totalEnabled += summary.enabledCount
    totalItems += summary.totalCount
    customQuantityCount += summary.customQuantityCount
    zeroQuantityCount += summary.zeroQuantityCount
    totalConfiguredSpawnCount += summary.explicitSpawnTotal
    customPreferenceCount += summary.customPreferenceCount
  }

  const keycardEntry =
    normalized.categories?.[SANDBOX_CATEGORY_IDS.COLLECTIBLES]?.items?.[
      KEYCARD_COLLECTIBLE_TYPE
    ]
  const objectivesEnabled =
    isSandboxItemEnabled(
      normalized,
      SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      ENVIRONMENTAL_OBJECT_TYPES.KEYCARD_EXIT_LOCK
    ) &&
    isSandboxItemEnabled(
      normalized,
      SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS,
      ENVIRONMENTAL_OBJECT_TYPES.EXTRACTION_ELEVATOR
    ) &&
    Boolean(keycardEntry?.enabled) &&
    keycardEntry?.quantity !== 0

  return {
    mode: 'sandbox',
    totalEnabled,
    totalItems,
    customQuantityCount,
    zeroQuantityCount,
    totalConfiguredSpawnCount,
    customPreferenceCount,
    globalSpawnLimit: SANDBOX_GLOBAL_LIMITS.maxTotalSpawnableEntities,
    allowPreferenceFallback: Boolean(normalized.allowPreferenceFallback),
    byCategory,
    enabledByCategory,
    objectivesEnabled,
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

export const SANDBOX_PRESETS = Object.freeze([
  Object.freeze({
    id: 'default',
    label: 'Default Sandbox',
    description: 'Standard balanced baseline configuration matching procedural defaults.',
  }),
  Object.freeze({
    id: 'chaotic_survival',
    label: 'Chaotic Survival',
    description: 'High enemy counts (4 Stalker, 4 Hunter, 2 Brute), dense hazards (2 of each), and minimal hiding spots.',
  }),
  Object.freeze({
    id: 'dense_collectibles',
    label: 'Dense Collectibles',
    description: 'High recovery capsules, energy cells, and shards with standard hazards for resource testing.',
  }),
  Object.freeze({
    id: 'minimal_hazards',
    label: 'Minimal Hazards',
    description: 'Minimal hazards (1 ceiling collapse, 0 others) and no hostiles for calm exploration and inspection.',
  }),
  Object.freeze({
    id: 'enemy_stress_test',
    label: 'Enemy Stress Test',
    description: 'Maximum allowed enemies of all archetypes (4 Stalker, 4 Hunter, 2 Brute).',
  }),
  Object.freeze({
    id: 'hazard_stress_test',
    label: 'Hazard Stress Test',
    description: 'High hazard density (3 instances of all 10 hazard types along corridors).',
  }),
  Object.freeze({
    id: 'manual_placement_test',
    label: 'Manual Placement Test',
    description: 'Sample pre-configured manual coordinate layout with exact hazard and enemy placements.',
  }),
  Object.freeze({
    id: 'single_entity_test',
    label: 'Single Entity Test',
    description: 'Exactly 1 instance of a single entity (Ceiling Collapse) with all other hazards and enemies disabled.',
  }),
  // Backward compatibility presets
  Object.freeze({
    id: 'single_instance',
    label: 'Single Instance Test',
    description: 'Sets every enabled spawnable item to exactly 1 instance for isolated verification.',
  }),
  Object.freeze({
    id: 'dense_test',
    label: 'Dense Test',
    description: 'Sets enabled spawnable hazards, collectibles, hiding spots, and enemies to high clustered density.',
  }),
  Object.freeze({
    id: 'spread_test',
    label: 'Spread Test',
    description: 'Configures spread-out distribution preference for all spawnable entities.',
  }),
])

export function applySandboxPreset(config, presetId) {
  const { config: base } = normalizeSandboxConfig(config)
  const isAdditivePreset =
    presetId === 'single_instance' || presetId === 'dense_test' || presetId === 'spread_test'
  let draft = isAdditivePreset
    ? JSON.parse(JSON.stringify(base))
    : createDefaultSandboxConfig()
  if (!isAdditivePreset && base.seed !== null && base.seed !== undefined) {
    draft.seed = base.seed
  }
  const notices = []

  switch (presetId) {
    case 'default': {
      draft = createDefaultSandboxConfig()
      if (base.seed !== null && base.seed !== undefined) {
        draft.seed = base.seed
      }
      notices.push('Applied Default Sandbox preset (balanced baseline configuration).')
      break
    }
    case 'chaotic_survival': {
      // 4 Stalkers, 4 Hunters, 2 Brutes
      const enemies = draft.categories[SANDBOX_CATEGORY_IDS.ENEMIES]?.items || {}
      if (enemies.stalker) {
        enemies.stalker.enabled = true
        enemies.stalker.quantity = 4
        enemies.stalker.placementPreference = 'spread'
      }
      if (enemies.hunter) {
        enemies.hunter.enabled = true
        enemies.hunter.quantity = 4
        enemies.hunter.placementPreference = 'spread'
      }
      if (enemies.brute) {
        enemies.brute.enabled = true
        enemies.brute.quantity = 2
        enemies.brute.placementPreference = 'far_start'
      }

      // 2 instances of each hazard
      const hazards = draft.categories[SANDBOX_CATEGORY_IDS.HAZARDS]?.items || {}
      for (const entry of Object.values(hazards)) {
        entry.enabled = true
        entry.quantity = 2
        entry.placementPreference = 'auto'
      }

      // Minimal hiding spots: only 1 metal cupboard and 1 wall alcove
      const hiding = draft.categories[SANDBOX_CATEGORY_IDS.HIDING_SPOTS]?.items || {}
      for (const [key, entry] of Object.entries(hiding)) {
        if (key === HIDING_SPOT_TYPES.METAL_CUPBOARD || key === HIDING_SPOT_TYPES.WALL_ALCOVE) {
          entry.enabled = true
          entry.quantity = 1
        } else {
          entry.enabled = false
          entry.quantity = 0
        }
      }
      notices.push('Applied Chaotic Survival preset (dense hostiles, high hazards, sparse hiding).')
      break
    }
    case 'dense_collectibles': {
      const colItems = draft.categories[SANDBOX_CATEGORY_IDS.COLLECTIBLES]?.items || {}
      if (colItems.health_capsule) {
        colItems.health_capsule.enabled = true
        colItems.health_capsule.quantity = 3
      }
      if (colItems.energy_cell) {
        colItems.energy_cell.enabled = true
        colItems.energy_cell.quantity = 3
      }
      if (colItems.soul_shards) {
        colItems.soul_shards.enabled = true
        colItems.soul_shards.quantity = 15
      }
      if (colItems.phantom_veil) {
        colItems.phantom_veil.enabled = true
        colItems.phantom_veil.quantity = 3
      }
      if (colItems.warding_charm) {
        colItems.warding_charm.enabled = true
        colItems.warding_charm.quantity = 2
      }
      if (colItems.spectral_compass) {
        colItems.spectral_compass.enabled = true
        colItems.spectral_compass.quantity = 2
      }
      notices.push('Applied Dense Collectibles preset (high utility and shard allocations).')
      break
    }
    case 'minimal_hazards': {
      const hazards = draft.categories[SANDBOX_CATEGORY_IDS.HAZARDS]?.items || {}
      for (const [key, entry] of Object.entries(hazards)) {
        if (key === HAZARD_TYPES.CEILING_COLLAPSE) {
          entry.enabled = true
          entry.quantity = 1
        } else {
          entry.enabled = false
          entry.quantity = 0
        }
      }
      const enemies = draft.categories[SANDBOX_CATEGORY_IDS.ENEMIES]?.items || {}
      for (const entry of Object.values(enemies)) {
        entry.enabled = false
        entry.quantity = 0
      }
      notices.push('Applied Minimal Hazards preset (1 ceiling collapse, no hostiles).')
      break
    }
    case 'enemy_stress_test': {
      const enemyItems = draft.categories[SANDBOX_CATEGORY_IDS.ENEMIES]?.items || {}
      if (enemyItems.stalker) {
        enemyItems.stalker.enabled = true
        enemyItems.stalker.quantity = 4
        enemyItems.stalker.placementPreference = 'spread'
      }
      if (enemyItems.hunter) {
        enemyItems.hunter.enabled = true
        enemyItems.hunter.quantity = 4
        enemyItems.hunter.placementPreference = 'spread'
      }
      if (enemyItems.brute) {
        enemyItems.brute.enabled = true
        enemyItems.brute.quantity = 2
        enemyItems.brute.placementPreference = 'far_start'
      }
      notices.push('Applied Enemy Stress Test preset (4 Stalkers, 4 Hunters, 2 Brutes).')
      break
    }
    case 'hazard_stress_test': {
      const hazardItems = draft.categories[SANDBOX_CATEGORY_IDS.HAZARDS]?.items || {}
      for (const entry of Object.values(hazardItems)) {
        entry.enabled = true
        entry.quantity = 3
        entry.placementPreference = 'corridors'
      }
      notices.push('Applied Hazard Stress Test preset (3 instances of all 10 hazard types along corridors).')
      break
    }
    case 'manual_placement_test': {
      // Configure clean specific manual test points without stray state from previous presets
      const hazards = draft.categories[SANDBOX_CATEGORY_IDS.HAZARDS]?.items || {}
      if (hazards[HAZARD_TYPES.CEILING_COLLAPSE]) {
        hazards[HAZARD_TYPES.CEILING_COLLAPSE].enabled = true
        hazards[HAZARD_TYPES.CEILING_COLLAPSE].placementMode = PLACEMENT_MODES.MANUAL
        hazards[HAZARD_TYPES.CEILING_COLLAPSE].manualPlacements = [{ row: 1, col: 3 }]
        hazards[HAZARD_TYPES.CEILING_COLLAPSE].quantity = 1
      }
      if (hazards[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING]) {
        hazards[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING].enabled = true
        hazards[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING].placementMode = PLACEMENT_MODES.MANUAL
        hazards[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING].manualPlacements = [{ row: 3, col: 5 }]
        hazards[HAZARD_TYPES.EXPOSED_ELECTRICAL_WIRING].quantity = 1
      }
      const enemies = draft.categories[SANDBOX_CATEGORY_IDS.ENEMIES]?.items || {}
      if (enemies.stalker) {
        enemies.stalker.enabled = true
        enemies.stalker.placementMode = PLACEMENT_MODES.MANUAL
        enemies.stalker.manualPlacements = [{ row: 5, col: 5 }]
        enemies.stalker.quantity = 1
      }
      notices.push('Applied Manual Placement Test preset (exact coordinates configured).')
      break
    }
    case 'single_entity_test': {
      // Only 1 Ceiling Collapse enabled, all others zeroed
      for (const catId of Object.values(SANDBOX_CATEGORY_IDS)) {
        const catItems = draft.categories[catId]?.items || {}
        for (const [itemId, entry] of Object.entries(catItems)) {
          if (catId === SANDBOX_CATEGORY_IDS.HAZARDS && itemId === HAZARD_TYPES.CEILING_COLLAPSE) {
            entry.enabled = true
            entry.quantity = 1
          } else if (catId === SANDBOX_CATEGORY_IDS.COLLECTIBLES && itemId === KEYCARD_COLLECTIBLE_TYPE) {
            entry.enabled = true
            entry.quantity = 1
          } else if (catId === SANDBOX_CATEGORY_IDS.ENVIRONMENTAL_OBJECTS && itemId === ENVIRONMENTAL_OBJECT_TYPES.EXTRACTION_ELEVATOR) {
            entry.enabled = true
          } else {
            entry.enabled = false
            if (isItemQuantityEligible(catId, itemId)) {
              entry.quantity = 0
            }
          }
        }
      }
      notices.push('Applied Single Entity Test preset (isolated 1 Ceiling Collapse instance).')
      break
    }
    case 'single_instance': {
      for (const catId of Object.values(SANDBOX_CATEGORY_IDS)) {
        const catItems = draft.categories[catId]?.items || {}
        for (const [itemId, entry] of Object.entries(catItems)) {
          if (entry.enabled && isItemQuantityEligible(catId, itemId)) {
            entry.quantity = 1
          }
        }
      }
      notices.push('Applied Single Instance Test preset (1 instance per enabled spawnable item).')
      break
    }
    case 'dense_test': {
      let remainingGlobal = SANDBOX_GLOBAL_LIMITS.maxTotalSpawnableEntities
      for (const catId of Object.values(SANDBOX_CATEGORY_IDS)) {
        const catItems = draft.categories[catId]?.items || {}
        const catCap = Math.min(
          SANDBOX_GLOBAL_LIMITS.categoryCaps[catId] || 40,
          remainingGlobal
        )
        const eligibleIds = Object.keys(catItems).filter(
          (id) => catItems[id].enabled && isItemQuantityEligible(catId, id)
        )
        const targetPerItem = eligibleIds.length > 0
          ? Math.max(0, Math.min(4, Math.floor(catCap / eligibleIds.length)))
          : 0
        for (const itemId of eligibleIds) {
          const qty = Math.min(getDefaultItemLimitMax(catId, itemId), targetPerItem)
          catItems[itemId].quantity = qty
          catItems[itemId].placementPreference = 'clustered'
          remainingGlobal = Math.max(0, remainingGlobal - qty)
        }
      }
      draft.allowPreferenceFallback = true
      notices.push('Applied Dense Test preset (high clustered density within safe global limits).')
      break
    }
    case 'spread_test': {
      for (const catId of Object.values(SANDBOX_CATEGORY_IDS)) {
        const catItems = draft.categories[catId]?.items || {}
        for (const [itemId, entry] of Object.entries(catItems)) {
          if (entry.enabled && isItemQuantityEligible(catId, itemId)) {
            entry.placementPreference = 'spread'
          }
        }
      }
      notices.push('Applied Spread Test preset (spread-out distribution for all items).')
      break
    }
    default:
      return { config: base, notices: [] }
  }

  draft.activePreset = presetId
  draft.customModified = false

  const normalized = normalizeSandboxConfig(draft)
  return {
    config: normalized.config,
    notices: [...notices, ...normalized.notices],
  }
}

/**
 * Exports sandbox configuration as pretty-printed versioned JSON string.
 */
export function exportSandboxConfigJson(config) {
  const { config: normalized } = normalizeSandboxConfig(config)
  const summary = getSandboxConfigSummary(normalized)
  const payload = {
    app: 'Maze Escape',
    schemaVersion: SANDBOX_CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    config: normalized,
    summary: {
      totalEnabled: summary.totalEnabled,
      totalConfiguredSpawnCount: summary.totalConfiguredSpawnCount,
      customQuantityCount: summary.customQuantityCount,
      customPreferenceCount: summary.customPreferenceCount,
    },
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * Imports sandbox configuration from a JSON string with strict schema validation
 * and preserves `existingConfig` safely if the import payload is invalid.
 */
export function importSandboxConfigJson(jsonString, existingConfig = null) {
  const preservedConfig = existingConfig
    ? normalizeSandboxConfig(existingConfig).config
    : createDefaultSandboxConfig()
  const fail = (errorMsg, noticeMsg) => ({
    success: false,
    imported: false,
    error: errorMsg,
    errors: [errorMsg],
    config: preservedConfig,
    notices: [noticeMsg],
  })

  const notices = []
  if (typeof jsonString !== 'string' || !jsonString.trim()) {
    return fail(
      'Empty or invalid JSON configuration provided.',
      'Empty JSON input; preserved previous configuration.'
    )
  }

  let parsed
  try {
    parsed = JSON.parse(jsonString)
  } catch (err) {
    return fail(
      `JSON parsing error: ${err.message}`,
      'Failed to parse JSON; preserved previous configuration.'
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail(
      'Invalid sandbox schema: root payload must be a JSON object.',
      'Rejected invalid schema root; preserved previous configuration.'
    )
  }

  if (parsed.app !== undefined && parsed.app !== 'Maze Escape') {
    return fail(
      `Unsupported application signature '${String(parsed.app)}'. Expected 'Maze Escape'.`,
      'Rejected mismatched application payload; preserved previous configuration.'
    )
  }

  if (
    parsed.schemaVersion !== undefined &&
    (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion > SANDBOX_CONFIG_VERSION)
  ) {
    return fail(
      `Unsupported sandbox schemaVersion '${String(parsed.schemaVersion)}'.`,
      'Rejected unsupported schema version; preserved previous configuration.'
    )
  }

  const candidateConfig =
    parsed.config && typeof parsed.config === 'object' && !Array.isArray(parsed.config)
      ? parsed.config
      : parsed

  const validCategoryKeys = new Set(Object.values(SANDBOX_CATEGORY_IDS))
  const rawCats = candidateConfig?.categories
  const hasKnownCategory =
    rawCats &&
    typeof rawCats === 'object' &&
    !Array.isArray(rawCats) &&
    Object.keys(rawCats).some((k) => validCategoryKeys.has(k))

  if (!hasKnownCategory) {
    return fail(
      'Invalid sandbox schema: missing recognizable sandbox categories.',
      'Rejected unrecognized configuration object; preserved previous configuration.'
    )
  }

  if (
    candidateConfig.version !== undefined &&
    (!Number.isInteger(candidateConfig.version) || candidateConfig.version > SANDBOX_CONFIG_VERSION)
  ) {
    return fail(
      `Unsupported sandbox config version '${String(candidateConfig.version)}'.`,
      'Rejected unsupported config version; preserved previous configuration.'
    )
  }

  const normalized = normalizeSandboxConfig(candidateConfig)
  notices.push(...normalized.notices)
  notices.push('Configuration successfully imported.')

  return {
    success: true,
    imported: true,
    error: null,
    errors: [],
    config: normalized.config,
    notices,
  }
}
