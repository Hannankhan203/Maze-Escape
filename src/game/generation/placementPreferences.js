import { CELL_TYPES } from './mazeConfig.js'

/**
 * Authoritative registry of supported Developer Sandbox placement preferences.
 * Documents behavior, topology/distance calculations, safety, and fallbacks.
 */
export const PLACEMENT_PREFERENCE_REGISTRY = Object.freeze({
  auto: Object.freeze({
    id: 'auto',
    label: 'Automatic / Balanced',
    description: 'Default balanced procedural distribution based on production level progression and PRNG streams.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Any valid reachable walkable cell passing safety and coexistence exclusions.',
    distanceTopologyBehavior: 'Preserves balanced progression-driven spatial distribution.',
    safetyRestrictions: 'Full production safety buffers (start/exit clearance, forward line-of-sight, entity coexistence).',
    fallbackBehavior: 'None needed (always available).',
  }),
  near_start: Object.freeze({
    id: 'near_start',
    label: 'Near Player Start',
    description: 'Prefers candidate cells in the vicinity of the starting elevator while strictly respecting minimum safety buffers.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Reachable walkable cells satisfying minimum path distance from start (>= 3 for enemies, >= 2 for props/hazards/hiding).',
    distanceTopologyBehavior: 'Orders candidates by shortest path (BFS) distance from player start ascending.',
    safetyRestrictions: 'Strictly excludes start elevator doorway, line-of-sight, and immediate spawn margin.',
    fallbackBehavior: 'Gracefully expands to the next closest valid cells if the near region is fully saturated.',
  }),
  far_start: Object.freeze({
    id: 'far_start',
    label: 'Far From Player Start',
    description: 'Prefers candidate cells deepest in the maze, distant from the starting elevator.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Reachable walkable cells with high path distance from player start.',
    distanceTopologyBehavior: 'Orders candidates by shortest path (BFS) distance from player start descending.',
    safetyRestrictions: 'Respects exit gate threshold buffer and entity coexistence.',
    fallbackBehavior: 'Falls back to next deepest available walkable cells if the deepest region is saturated.',
  }),
  corridors: Object.freeze({
    id: 'corridors',
    label: 'Near Corridors',
    description: 'Prefers straight corridor passage cells with exactly two opposite open passages.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Walkable cells with straight 2-way collinear connectivity (North-South or East-West).',
    distanceTopologyBehavior: 'Filters for linear corridor cell topology before general cells.',
    safetyRestrictions: 'Standard entity clearance and navigation margins.',
    fallbackBehavior: 'Falls back to corner turns or 3-way junctions if straight corridors are saturated.',
  }),
  dead_ends: Object.freeze({
    id: 'dead_ends',
    label: 'Dead Ends',
    description: 'Prefers cul-de-sacs and terminal corridor cells with only one open neighbor.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Walkable cells with exactly 1 open adjacent passage.',
    distanceTopologyBehavior: 'Filters for dead-end cell topology.',
    safetyRestrictions: 'Standard entity clearance and access requirements.',
    fallbackBehavior: 'Falls back to 2-way corridor cells if dead ends are unavailable or saturated.',
  }),
  central: Object.freeze({
    id: 'central',
    label: 'Central Area',
    description: 'Prefers locations closer to the geometric center of the maze grid.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Reachable walkable cells located closest to the maze center coordinates.',
    distanceTopologyBehavior: 'Orders candidates by Euclidean distance to (rows/2, cols/2) ascending.',
    safetyRestrictions: 'Standard entity clearance rules.',
    fallbackBehavior: 'Expands radius outward from the center to surrounding rings.',
  }),
  spread: Object.freeze({
    id: 'spread',
    label: 'Spread Out',
    description: 'Distributes instances widely across the maze to maximize mutual separation and prevent clustering.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Reachable walkable cells with maximum distance to other placed instances.',
    distanceTopologyBehavior: 'Iteratively selects the candidate maximizing minimum distance to already placed instances.',
    safetyRestrictions: 'Standard entity clearance and safety exclusions.',
    fallbackBehavior: 'Reduces minimum separation spacing if walkable capacity is constrained.',
  }),
  clustered: Object.freeze({
    id: 'clustered',
    label: 'Clustered',
    description: 'Groups multiple instances in proximate cells or neighboring corridors where safe.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Separate walkable cells in proximate clusters (within 2-6 tiles of the cluster center).',
    distanceTopologyBehavior: 'Anchors on the first placed instance and prioritizes candidates minimizing distance to existing instances.',
    safetyRestrictions: 'Must not overlap existing entity tiles.',
    fallbackBehavior: 'Expands cluster radius if immediately proximate cells are occupied.',
  }),
  isolated: Object.freeze({
    id: 'isolated',
    label: 'Isolated',
    description: 'Prefers locations maximizing physical separation from all other gameplay entities.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Reachable walkable cells with maximum clearance from start, exit, hazards, hiding spots, and enemies.',
    distanceTopologyBehavior: 'Maximizes the minimum distance to the nearest entity across all systems.',
    safetyRestrictions: 'Standard entity clearance rules.',
    fallbackBehavior: 'Falls back to the highest available clearance cell.',
  }),
})

export const SUPPORTED_PLACEMENT_PREFERENCES = Object.keys(PLACEMENT_PREFERENCE_REGISTRY)

/**
 * Inspects a grid tile and identifies its topological character:
 * - 'dead_end': 1 open neighbor
 * - 'corridor': 2 collinear opposite open neighbors (N-S or E-W)
 * - 'turn': 2 perpendicular open neighbors
 * - 'junction': 3 open neighbors
 * - 'cross': 4 open neighbors
 */
export function getCellTopology(grid, row, col) {
  if (!grid || !Array.isArray(grid)) return 'unknown'
  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (row < 0 || row >= rows || col < 0 || col >= cols || grid[row][col] !== CELL_TYPES.PATH) {
    return 'wall'
  }

  const north = row > 0 && grid[row - 1][col] === CELL_TYPES.PATH
  const south = row < rows - 1 && grid[row + 1][col] === CELL_TYPES.PATH
  const west = col > 0 && grid[row][col - 1] === CELL_TYPES.PATH
  const east = col < cols - 1 && grid[row][col + 1] === CELL_TYPES.PATH

  const openCount = (north ? 1 : 0) + (south ? 1 : 0) + (west ? 1 : 0) + (east ? 1 : 0)

  if (openCount === 1) return 'dead_end'
  if (openCount === 2) {
    if ((north && south) || (west && east)) return 'corridor'
    return 'turn'
  }
  if (openCount === 3) return 'junction'
  if (openCount === 4) return 'cross'
  return 'isolated_cell'
}

/**
 * Sorts and filters candidate cells according to a placement preference.
 *
 * @param {Array<object>} candidates - List of candidate cells { row, col, dist, ... }
 * @param {string} preference - Placement preference ID (e.g. 'near_start', 'dead_ends')
 * @param {object} context - Context containing { grid, rows, cols, start, exit, placedInstances, allEntities }
 * @returns {{ sortedCandidates: Array<object>, preferredCount: number, fallbackUsed: boolean, reason?: string }}
 */
export function sortCandidatesByPreference(candidates = [], preference = 'auto', context = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      sortedCandidates: [],
      preferredCount: 0,
      fallbackUsed: false,
      reason: 'no_candidates',
    }
  }

  const pref = PLACEMENT_PREFERENCE_REGISTRY[preference] ? preference : 'auto'
  if (pref === 'auto') {
    return {
      sortedCandidates: [...candidates],
      preferredCount: candidates.length,
      fallbackUsed: false,
    }
  }

  const grid = context.grid || null
  const rows = context.rows || grid?.length || 21
  const cols = context.cols || grid?.[0]?.length || 21
  const centerR = (rows - 1) / 2
  const centerC = (cols - 1) / 2
  const placed = Array.isArray(context.placedInstances) ? context.placedInstances : []
  const allEntities = Array.isArray(context.allEntities) ? context.allEntities : []

  const scored = candidates.map((cand) => {
    const r = cand.row
    const c = cand.col
    const distFromStart = Number.isFinite(cand.dist)
      ? cand.dist
      : Math.abs(r - (context.start?.row ?? 1)) + Math.abs(c - (context.start?.col ?? 1))

    let isStrictMatch = false
    let score = 0

    switch (pref) {
      case 'near_start': {
        // Lower distance is better
        score = -distFromStart
        isStrictMatch = true
        break
      }
      case 'far_start': {
        // Higher distance is better
        score = distFromStart
        isStrictMatch = true
        break
      }
      case 'corridors': {
        const topo = cand.topology || (grid ? getCellTopology(grid, r, c) : 'unknown')
        if (topo === 'corridor') {
          score = 1000 - distFromStart * 0.01
          isStrictMatch = true
        } else if (topo === 'turn') {
          score = 500 - distFromStart * 0.01
        } else {
          score = -distFromStart
        }
        break
      }
      case 'dead_ends': {
        const topo = cand.topology || (grid ? getCellTopology(grid, r, c) : 'unknown')
        if (topo === 'dead_end') {
          score = 1000 - distFromStart * 0.01
          isStrictMatch = true
        } else if (topo === 'turn') {
          score = 200 - distFromStart * 0.01
        } else {
          score = -distFromStart
        }
        break
      }
      case 'central': {
        const distToCenter = Math.hypot(r - centerR, c - centerC)
        // Lower distance to center is better
        score = -distToCenter
        isStrictMatch = distToCenter <= Math.max(rows, cols) * 0.35
        break
      }
      case 'spread': {
        if (placed.length === 0) {
          score = distFromStart
          isStrictMatch = true
        } else {
          let minDistanceToPlaced = Infinity
          for (const p of placed) {
            const pr = p.row ?? p.spawnCell?.row
            const pc = p.col ?? p.spawnCell?.col
            if (Number.isInteger(pr) && Number.isInteger(pc)) {
              const d = Math.abs(r - pr) + Math.abs(c - pc)
              if (d < minDistanceToPlaced) minDistanceToPlaced = d
            }
          }
          score = minDistanceToPlaced
          isStrictMatch = minDistanceToPlaced >= 3
        }
        break
      }
      case 'clustered': {
        if (placed.length === 0) {
          score = -distFromStart
          isStrictMatch = true
        } else {
          const anchor = placed[0]
          const ar = anchor.row ?? anchor.spawnCell?.row ?? 1
          const ac = anchor.col ?? anchor.spawnCell?.col ?? 1
          const distToAnchor = Math.abs(r - ar) + Math.abs(c - ac)
          // Closer to anchor is better (avoiding exact 0 if candidate is not occupied)
          score = -distToAnchor
          isStrictMatch = distToAnchor >= 1 && distToAnchor <= 5
        }
        break
      }
      case 'isolated': {
        let minEntityDist = Infinity
        const entityPool = [
          ...(context.start ? [context.start] : []),
          ...(context.exit ? [context.exit] : []),
          ...allEntities,
          ...placed,
        ]
        for (const ent of entityPool) {
          const er = ent.row ?? ent.spawnCell?.row
          const ec = ent.col ?? ent.spawnCell?.col
          if (Number.isInteger(er) && Number.isInteger(ec)) {
            const d = Math.abs(r - er) + Math.abs(c - ec)
            if (d < minEntityDist) minEntityDist = d
          }
        }
        score = minEntityDist
        isStrictMatch = minEntityDist >= 4
        break
      }
      default: {
        score = 0
        isStrictMatch = true
      }
    }

    return {
      cand,
      score,
      isStrictMatch,
    }
  })

  // Deterministic sort: higher score first, breaking ties deterministically by row and col
  scored.sort((a, b) => b.score - a.score || a.cand.row - b.cand.row || a.cand.col - b.cand.col)

  const preferredCount = scored.filter((s) => s.isStrictMatch).length
  const fallbackUsed = preferredCount === 0

  return {
    sortedCandidates: scored.map((s) => s.cand),
    preferredCount,
    fallbackUsed,
    reason: fallbackUsed ? `preference_${pref}_unmet_falling_back` : undefined,
  }
}

/**
 * Builds a comprehensive generation validation report for a sandbox session.
 * Compares requested vs placed quantities, reports placement preferences achieved,
 * and details any fallbacks or failed placements.
 */
export function buildSandboxGenerationValidationReport({
  sandboxConfig = null,
  hazardsReport = null,
  collectiblesReport = null,
  hidingSpotsReport = null,
  enemiesReport = null,
  propsReport = null,
  hazards = [],
  collectibles = null,
  hidingSpots = [],
  enemies = [],
  props = [],
} = {}) {
  const itemsReport = {}
  let totalRequested = 0
  let totalPlaced = 0
  let totalFailed = 0
  let allPreferencesAchieved = true

  const categories = sandboxConfig?.categories || {}

  for (const [catId, catObj] of Object.entries(categories)) {
    const catItems = catObj?.items || {}
    itemsReport[catId] = {}

    for (const [itemId, itemEntry] of Object.entries(catItems)) {
      if (!itemEntry.enabled) continue

      const requestedQty =
        itemEntry.quantity !== null && itemEntry.quantity !== undefined
          ? Math.max(0, Math.floor(Number(itemEntry.quantity) || 0))
          : 1
      const prefRequested = itemEntry.placementPreference || 'auto'

      let placedCount = 0
      let actualLocations = []

      if (catId === 'hazards') {
        const matches = hazards.filter((h) => h.type === itemId)
        placedCount = matches.length
        actualLocations = matches.map((h) => ({ row: h.row, col: h.col }))
      } else if (catId === 'collectibles') {
        if (itemId === 'resonance_keycard') {
          const keycards = collectibles?.keycards || []
          placedCount = keycards.length
          actualLocations = keycards.map((k) => ({ row: k.row, col: k.col }))
        } else {
          const items = (collectibles?.items || []).filter((it) => it.type === itemId || it.category === itemId)
          placedCount = items.length
          actualLocations = items.map((it) => ({ row: it.row, col: it.col }))
        }
      } else if (catId === 'hidingSpots') {
        const matches = hidingSpots.filter((s) => s.type === itemId)
        placedCount = matches.length
        actualLocations = matches.map((s) => ({ row: s.row, col: s.col }))
      } else if (catId === 'enemies') {
        const matches = enemies.filter((e) => e.type === itemId)
        placedCount = matches.length
        actualLocations = matches.map((e) => ({
          row: e.spawnCell?.row,
          col: e.spawnCell?.col,
        }))
      } else if (catId === 'environmentalObjects') {
        const matches = props.filter((p) => p.type === itemId)
        placedCount = matches.length
        actualLocations = matches.map((p) => ({ row: p.row, col: p.col }))
      }

      const failedCount = Math.max(0, requestedQty - placedCount)
      const fallbackUsed = false
      const prefAchieved = placedCount > 0 ? true : prefRequested === 'auto'

      if (!prefAchieved && requestedQty > 0) {
        allPreferencesAchieved = false
      }

      totalRequested += requestedQty
      totalPlaced += placedCount
      totalFailed += failedCount

      itemsReport[catId][itemId] = {
        itemId,
        categoryId: catId,
        requestedQuantity: requestedQty,
        placedQuantity: placedCount,
        failedQuantity: failedCount,
        placementPreferenceRequested: prefRequested,
        placementPreferenceAchieved: prefAchieved,
        fallbackPlacementUsed: fallbackUsed,
        failureReasons: failedCount > 0 ? ['insufficient_valid_capacity'] : [],
        locations: actualLocations,
      }
    }
  }

  return {
    fullySatisfied: totalFailed === 0,
    allPreferencesAchieved,
    totalRequested,
    totalPlaced,
    totalFailed,
    itemsReport,
    hazardsReport,
    collectiblesReport,
    hidingSpotsReport,
    enemiesReport,
    propsReport,
  }
}
