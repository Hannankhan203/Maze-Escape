import { CELL_TYPES } from './mazeConfig.js'

const QUANTITY_INELIGIBLE_ENVIRONMENTAL_IDS = new Set([
  'broken_start_elevator',
  'extraction_elevator',
  'keycard_exit_lock',
  'ceiling_lights',
  'ceiling_vents',
  'ceiling_electrical',
  'structural_deterioration',
  'elevator_shafts',
  'surface_imperfections_graffiti',
])

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
    validCellRequirements: 'Reachable walkable cells within the near-start zone (BFS distance <= max(7, 45% of max BFS depth)) satisfying safety margins.',
    distanceTopologyBehavior: 'Orders candidates by shortest path (BFS) distance from player start ascending.',
    safetyRestrictions: 'Strictly excludes start elevator doorway, line-of-sight, and immediate spawn margin.',
    fallbackBehavior: 'Strict by default; when Allow Preference Fallback is enabled, expands to next closest valid cells.',
  }),
  far_start: Object.freeze({
    id: 'far_start',
    label: 'Far From Player Start',
    description: 'Prefers candidate cells deepest in the maze, distant from the starting elevator.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Reachable walkable cells with high path distance from player start (>= 50% of max BFS depth).',
    distanceTopologyBehavior: 'Orders candidates by shortest path (BFS) distance from player start descending.',
    safetyRestrictions: 'Respects exit gate threshold buffer and entity coexistence.',
    fallbackBehavior: 'Strict by default; when Allow Preference Fallback is enabled, expands to next deepest cells.',
  }),
  corridors: Object.freeze({
    id: 'corridors',
    label: 'Near Corridors',
    description: 'Prefers straight corridor passage cells with exactly two opposite open passages.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Walkable cells with straight 2-way collinear connectivity (North-South or East-West).',
    distanceTopologyBehavior: 'Filters for linear corridor cell topology before general cells.',
    safetyRestrictions: 'Standard entity clearance and navigation margins.',
    fallbackBehavior: 'Strict by default; when Allow Preference Fallback is enabled, falls back to turns/junctions.',
  }),
  dead_ends: Object.freeze({
    id: 'dead_ends',
    label: 'Dead Ends',
    description: 'Prefers cul-de-sacs and terminal corridor cells with only one open neighbor.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Walkable cells with exactly 1 open adjacent passage.',
    distanceTopologyBehavior: 'Filters for dead-end cell topology.',
    safetyRestrictions: 'Standard entity clearance and access requirements.',
    fallbackBehavior: 'Strict by default; when Allow Preference Fallback is enabled, falls back to 2-way cells.',
  }),
  central: Object.freeze({
    id: 'central',
    label: 'Central Area',
    description: 'Prefers locations closer to the geometric center of the maze grid.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Reachable walkable cells located within central radius (<= max(4, 35% of maze span)).',
    distanceTopologyBehavior: 'Orders candidates by Euclidean distance to grid center ascending.',
    safetyRestrictions: 'Standard entity clearance rules.',
    fallbackBehavior: 'Strict by default; when Allow Preference Fallback is enabled, expands outward.',
  }),
  spread: Object.freeze({
    id: 'spread',
    label: 'Spread Out',
    description: 'Distributes instances widely across the maze to maximize mutual separation and prevent clustering.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Reachable walkable cells separated by >= 3 path steps from previously placed instances.',
    distanceTopologyBehavior: 'Iteratively selects the candidate maximizing shortest-path (BFS) distance to placed instances.',
    safetyRestrictions: 'Standard entity clearance and safety exclusions.',
    fallbackBehavior: 'Strict by default; when Allow Preference Fallback is enabled, reduces separation spacing.',
  }),
  clustered: Object.freeze({
    id: 'clustered',
    label: 'Clustered',
    description: 'Groups multiple instances in proximate cells or neighboring corridors where safe.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Separate walkable cells within 1-5 steps of the first placed cluster anchor.',
    distanceTopologyBehavior: 'Anchors on the first placed instance and prioritizes candidates minimizing path distance to it.',
    safetyRestrictions: 'Must not overlap existing entity tiles.',
    fallbackBehavior: 'Strict by default; when Allow Preference Fallback is enabled, expands cluster radius.',
  }),
  isolated: Object.freeze({
    id: 'isolated',
    label: 'Isolated',
    description: 'Prefers locations maximizing physical separation from all other gameplay entities.',
    supportedCategories: ['hazards', 'collectibles', 'hidingSpots', 'enemies', 'environmentalObjects'],
    validCellRequirements: 'Reachable walkable cells with >= 4 steps clearance from start, exit, hazards, hiding spots, and enemies.',
    distanceTopologyBehavior: 'Maximizes the shortest-path (BFS) distance to the nearest entity across all systems.',
    safetyRestrictions: 'Standard entity clearance rules.',
    fallbackBehavior: 'Strict by default; when Allow Preference Fallback is enabled, chooses highest available clearance.',
  }),
})

export const SUPPORTED_PLACEMENT_PREFERENCES = Object.keys(PLACEMENT_PREFERENCE_REGISTRY)

const BFS_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

/**
 * Computes multi-source BFS path distance across walkable cells.
 * Returns { dists: Int32Array, maxDist: number, cols: number }.
 */
export function computeBfsDistanceMap(grid, origins = []) {
  if (!grid || !Array.isArray(grid) || grid.length === 0) return null
  const rows = grid.length
  const cols = grid[0]?.length || 0
  if (cols === 0) return null

  const originList = Array.isArray(origins) ? origins : origins ? [origins] : []
  if (originList.length === 0) return null

  const dists = new Int32Array(rows * cols)
  dists.fill(-1)

  const queueR = new Int32Array(rows * cols)
  const queueC = new Int32Array(rows * cols)
  let head = 0
  let tail = 0

  for (const origin of originList) {
    const r = origin?.row ?? origin?.spawnCell?.row
    const c = origin?.col ?? origin?.spawnCell?.col
    if (
      Number.isInteger(r) &&
      Number.isInteger(c) &&
      r >= 0 &&
      r < rows &&
      c >= 0 &&
      c < cols &&
      grid[r][c] === CELL_TYPES.PATH
    ) {
      const idx = r * cols + c
      if (dists[idx] === -1) {
        dists[idx] = 0
        queueR[tail] = r
        queueC[tail] = c
        tail += 1
      }
    }
  }

  if (tail === 0) return null

  let maxDist = 0
  while (head < tail) {
    const r = queueR[head]
    const c = queueC[head]
    head += 1
    const baseDist = dists[r * cols + c]
    if (baseDist > maxDist) maxDist = baseDist

    for (let d = 0; d < 4; d += 1) {
      const nr = r + BFS_DIRS[d][0]
      const nc = c + BFS_DIRS[d][1]
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === CELL_TYPES.PATH) {
        const nIdx = nr * cols + nc
        if (dists[nIdx] === -1) {
          dists[nIdx] = baseDist + 1
          queueR[tail] = nr
          queueC[tail] = nc
          tail += 1
        }
      }
    }
  }

  return { dists, maxDist, rows, cols }
}

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
 * When `context.allowFallback === false` (default strict mode), candidates that do not
 * satisfy the preference are withheld (`sortedCandidates` only contains strict matches;
 * if none qualify, `sortedCandidates` is `[]` and `preferenceImpossible` is `true`).
 * When `context.allowFallback === true`, fallback candidates are ordered after strict matches
 * and `fallbackUsed` indicates whether strict matches were exhausted.
 */
export function sortCandidatesByPreference(candidates = [], preference = 'auto', context = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      sortedCandidates: [],
      preferredCount: 0,
      fallbackUsed: false,
      preferenceImpossible: preference !== 'auto',
      reason: 'no_candidates',
    }
  }

  const pref = PLACEMENT_PREFERENCE_REGISTRY[preference] ? preference : 'auto'
  if (pref === 'auto') {
    return {
      sortedCandidates: [...candidates],
      preferredCount: candidates.length,
      fallbackUsed: false,
      preferenceImpossible: false,
    }
  }

  const allowFallback = context?.allowFallback === true
  const grid = context.grid || null
  const rows = context.rows || grid?.length || 21
  const cols = context.cols || grid?.[0]?.length || 21
  const centerR = (rows - 1) / 2
  const centerC = (cols - 1) / 2
  const placed = Array.isArray(context.placedInstances) ? context.placedInstances : []
  const allEntities = Array.isArray(context.allEntities) ? context.allEntities : []

  const startBfs =
    grid && context.start ? computeBfsDistanceMap(grid, context.start) : null
  const placedBfs =
    pref === 'spread' && grid && placed.length > 0
      ? computeBfsDistanceMap(grid, placed)
      : null
  const anchorBfs =
    pref === 'clustered' && grid && placed.length > 0
      ? computeBfsDistanceMap(grid, placed[0])
      : null

  const isolatedEntityPool =
    pref === 'isolated'
      ? [
          ...(context.start ? [context.start] : []),
          ...(context.exit ? [context.exit] : []),
          ...allEntities,
          ...placed,
        ]
      : []
  const isolatedBfs =
    pref === 'isolated' && grid && isolatedEntityPool.length > 0
      ? computeBfsDistanceMap(grid, isolatedEntityPool)
      : null

  const startDistances = candidates.map((cand) => {
    if (Number.isFinite(cand.dist)) return cand.dist
    if (startBfs) {
      const d = startBfs.dists[cand.row * startBfs.cols + cand.col]
      if (d >= 0) return d
    }
    return Math.abs(cand.row - (context.start?.row ?? 1)) + Math.abs(cand.col - (context.start?.col ?? 1))
  })

  let maxObservedDist = Number.isFinite(context.maxDistance) ? context.maxDistance : startBfs?.maxDist || 0
  if (maxObservedDist <= 0) {
    for (const d of startDistances) {
      if (d > maxObservedDist) maxObservedDist = d
    }
  }

  const nearThreshold = Math.max(7, Math.ceil(maxObservedDist * 0.45))
  const farThreshold = Math.min(
    Math.max(4, Math.floor(maxObservedDist * 0.5)),
    Math.max(0, maxObservedDist - 2)
  )

  const scored = candidates.map((cand, index) => {
    const r = cand.row
    const c = cand.col
    const distFromStart = startDistances[index]

    let isStrictMatch = false
    let score

    switch (pref) {
      case 'near_start': {
        score = -distFromStart
        isStrictMatch = distFromStart <= nearThreshold
        break
      }
      case 'far_start': {
        score = distFromStart
        isStrictMatch = distFromStart >= farThreshold
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
        score = -distToCenter
        isStrictMatch = distToCenter <= Math.max(4, Math.max(rows, cols) * 0.35)
        break
      }
      case 'spread': {
        if (placed.length === 0) {
          score = distFromStart
          isStrictMatch = true
        } else {
          let minDistanceToPlaced = Infinity
          if (placedBfs) {
            const d = placedBfs.dists[r * placedBfs.cols + c]
            if (d >= 0) minDistanceToPlaced = d
          }
          if (!Number.isFinite(minDistanceToPlaced)) {
            for (const p of placed) {
              const pr = p.row ?? p.spawnCell?.row
              const pc = p.col ?? p.spawnCell?.col
              if (Number.isInteger(pr) && Number.isInteger(pc)) {
                const d = Math.abs(r - pr) + Math.abs(c - pc)
                if (d < minDistanceToPlaced) minDistanceToPlaced = d
              }
            }
          }
          score = minDistanceToPlaced
          isStrictMatch = minDistanceToPlaced >= 3
        }
        break
      }
      case 'clustered': {
        if (placed.length === 0) {
          let nearbyCount = 0
          for (let k = 0; k < candidates.length; k += 1) {
            if (k === index) continue
            const other = candidates[k]
            if (Math.abs(other.row - r) + Math.abs(other.col - c) <= 4) {
              nearbyCount += 1
            }
          }
          score = nearbyCount * 10 - distFromStart * 0.01
          isStrictMatch = true
        } else {
          const anchor = placed[0]
          const ar = anchor.row ?? anchor.spawnCell?.row ?? 1
          const ac = anchor.col ?? anchor.spawnCell?.col ?? 1
          let distToAnchor =
            anchorBfs && anchorBfs.dists[r * anchorBfs.cols + c] >= 0
              ? anchorBfs.dists[r * anchorBfs.cols + c]
              : Math.abs(r - ar) + Math.abs(c - ac)
          score = -distToAnchor
          isStrictMatch = distToAnchor >= 1 && distToAnchor <= 5
        }
        break
      }
      case 'isolated': {
        let minEntityDist = Infinity
        if (isolatedBfs) {
          const d = isolatedBfs.dists[r * isolatedBfs.cols + c]
          if (d >= 0) minEntityDist = d
        } else if (isolatedEntityPool.length > 0) {
          for (const ent of isolatedEntityPool) {
            const er = ent.row ?? ent.spawnCell?.row
            const ec = ent.col ?? ent.spawnCell?.col
            if (Number.isInteger(er) && Number.isInteger(ec)) {
              const d = Math.abs(r - er) + Math.abs(c - ec)
              if (d < minEntityDist) minEntityDist = d
            }
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

  const strictMatches = scored
    .filter((s) => s.isStrictMatch)
    .sort((a, b) => b.score - a.score || a.cand.row - b.cand.row || a.cand.col - b.cand.col)
  const fallbackMatches = scored
    .filter((s) => !s.isStrictMatch)
    .sort((a, b) => b.score - a.score || a.cand.row - b.cand.row || a.cand.col - b.cand.col)

  const preferredCount = strictMatches.length

  if (!allowFallback) {
    if (preferredCount === 0) {
      return {
        sortedCandidates: [],
        preferredCount: 0,
        fallbackUsed: false,
        preferenceImpossible: true,
        reason: `strict_preference_${pref}_unavailable`,
      }
    }
    return {
      sortedCandidates: strictMatches.map((s) => s.cand),
      preferredCount,
      fallbackUsed: false,
      preferenceImpossible: false,
    }
  }

  const fallbackUsed = preferredCount === 0
  return {
    sortedCandidates: [...strictMatches, ...fallbackMatches].map((s) => s.cand),
    preferredCount,
    fallbackUsed,
    preferenceImpossible: false,
    reason: fallbackUsed ? `preference_${pref}_unmet_falling_back` : undefined,
  }
}

/**
 * Builds a comprehensive generation validation report for a sandbox session.
 * Compares requested vs placed quantities from actual generator reports, reports
 * exact placement preference achievement vs fallbacks, and records failure reasons.
 */
export function buildSandboxGenerationValidationReport({
  sandboxConfig = null,
  hazardsReport = null,
  collectiblesReport = null,
  hidingSpotsReport = null,
  enemiesReport = null,
  propsReport = null,
  decoysReport = null,
  hazards = [],
  collectibles = null,
  hidingSpots = [],
  enemies = [],
  props = [],
  hazardDecoys = null,
} = {}) {
  const itemsReport = {}
  const architectureAndSingletons = {}
  let totalRequested = 0
  let totalPlaced = 0
  let totalFailed = 0
  let allPreferencesAchieved = true
  let anyFallbackUsed = false

  const categories = sandboxConfig?.categories || {}

  for (const [catId, catObj] of Object.entries(categories)) {
    const catItems = catObj?.items || {}
    itemsReport[catId] = {}

    for (const [itemId, itemEntry] of Object.entries(catItems)) {
      if (catId === 'environmentalObjects' && QUANTITY_INELIGIBLE_ENVIRONMENTAL_IDS.has(itemId)) {
        architectureAndSingletons[itemId] = {
          itemId,
          enabled: Boolean(itemEntry?.enabled),
          type: 'architecture_or_singleton',
        }
        continue
      }

      if (!itemEntry?.enabled) continue

      const hasExplicitQty = itemEntry.quantity !== null && itemEntry.quantity !== undefined
      const explicitQty = hasExplicitQty
        ? Math.max(0, Math.floor(Number(itemEntry.quantity) || 0))
        : null
      const prefRequested = itemEntry.placementPreference || 'auto'

      let requestedQty = explicitQty
      let placedCount = 0
      let actualLocations = []
      let genPrefMeta = null
      let genFailureReasons = []

      if (catId === 'hazards') {
        const matches = hazards.filter((h) => h.type === itemId)
        placedCount = matches.length
        actualLocations = matches.map((h) => ({ row: h.row, col: h.col }))
        if (requestedQty === null) {
          requestedQty = hazardsReport?.requestedByType?.[itemId] ?? placedCount
        }
        genPrefMeta = hazardsReport?.preferencesByType?.[itemId] || null
        if (Array.isArray(hazardsReport?.failures)) {
          genFailureReasons = hazardsReport.failures
            .filter((f) => f.type === itemId)
            .map((f) => f.reason)
        }
      } else if (catId === 'collectibles') {
        if (itemId === 'resonance_keycard') {
          const keycards = collectibles?.keycards || []
          placedCount = keycards.length
          actualLocations = keycards.map((k) => ({ row: k.row, col: k.col }))
          if (requestedQty === null) {
            requestedQty =
              collectiblesReport?.keycardTarget ??
              collectiblesReport?.keycardReport?.keycardTarget ??
              collectiblesReport?.requestedByCategory?.resonance_keycard ??
              placedCount
          }
          genPrefMeta =
            collectiblesReport?.preferencesByCategory?.resonance_keycard ||
            collectiblesReport?.keycardReport?.preferencesByCategory?.resonance_keycard ||
            null
          const kcFailReason =
            collectiblesReport?.keycardFailureReason ||
            collectiblesReport?.keycardReport?.keycardFailureReason
          if (kcFailReason) {
            genFailureReasons = [kcFailReason]
          }
        } else {
          const items = (collectibles?.items || []).filter(
            (it) => it.type === itemId || it.category === itemId
          )
          placedCount = items.length
          actualLocations = items.map((it) => ({ row: it.row, col: it.col }))
          if (requestedQty === null) {
            requestedQty =
              collectiblesReport?.allocatedByCategory?.[itemId] ??
              collectiblesReport?.itemReport?.allocatedByCategory?.[itemId] ??
              collectiblesReport?.requestedByCategory?.[itemId] ??
              placedCount
          }
          genPrefMeta =
            collectiblesReport?.preferencesByCategory?.[itemId] ||
            collectiblesReport?.itemReport?.preferencesByCategory?.[itemId] ||
            null
          if (Array.isArray(collectiblesReport?.failures)) {
            genFailureReasons = collectiblesReport.failures
              .filter((f) => f.category === itemId)
              .map((f) => f.reason)
          }
        }
      } else if (catId === 'hidingSpots') {
        const matches = hidingSpots.filter((s) => s.type === itemId)
        placedCount = matches.length
        actualLocations = matches.map((s) => ({ row: s.row, col: s.col }))
        if (requestedQty === null) {
          requestedQty = hidingSpotsReport?.requestedByType?.[itemId] ?? placedCount
        }
        genPrefMeta = hidingSpotsReport?.preferencesByType?.[itemId] || null
        if (Array.isArray(hidingSpotsReport?.failures)) {
          genFailureReasons = hidingSpotsReport.failures
            .filter((f) => f.type === itemId)
            .map((f) => f.reason)
        }
      } else if (catId === 'enemies') {
        const matches = enemies.filter((e) => e.type === itemId)
        placedCount = matches.length
        actualLocations = matches.map((e) => ({
          row: e.spawnCell?.row,
          col: e.spawnCell?.col,
        }))
        if (requestedQty === null) {
          requestedQty = enemiesReport?.requestedByType?.[itemId] ?? placedCount
        }
        genPrefMeta = enemiesReport?.preferences?.[itemId] || null
        if (Array.isArray(enemiesReport?.failures)) {
          genFailureReasons = enemiesReport.failures
            .filter((f) => f.type === itemId || f.archetype === itemId)
            .map((f) => f.reason)
        }
      } else if (catId === 'environmentalObjects') {
        if (itemId === 'hazard_decoys') {
          const flatDecoys = Array.isArray(hazardDecoys?.decoys) ? hazardDecoys.decoys : []
          placedCount = flatDecoys.length
          actualLocations = flatDecoys.map((d) => ({ row: d.row, col: d.col }))
          if (requestedQty === null) {
            requestedQty = decoysReport?.requestedCount ?? placedCount
          }
          genPrefMeta = decoysReport?.preferenceReport || null
          if (Array.isArray(decoysReport?.failures)) {
            genFailureReasons = [...decoysReport.failures]
          }
        } else {
          const matches = props.filter((p) => p.type === itemId)
          placedCount = matches.length
          actualLocations = matches.map((p) => ({ row: p.row, col: p.col }))
          if (requestedQty === null) {
            requestedQty = propsReport?.requestedByType?.[itemId] ?? placedCount
          }
          genPrefMeta = propsReport?.preferencesByType?.[itemId] || null
          if (Array.isArray(propsReport?.failures)) {
            genFailureReasons = propsReport.failures
              .filter((f) => f.type === itemId)
              .map((f) => f.reason)
          }
        }
      }

      if (requestedQty === null) requestedQty = placedCount

      const failedCount = Math.max(0, requestedQty - placedCount)
      const fallbackUsed = Boolean(genPrefMeta?.fallbackUsed || (genPrefMeta?.fallbackCount || 0) > 0)
      if (fallbackUsed) anyFallbackUsed = true

      const prefAchieved =
        requestedQty === 0
          ? true
          : prefRequested === 'auto'
            ? placedCount > 0
            : genPrefMeta
              ? typeof genPrefMeta.achieved === 'boolean'
                ? genPrefMeta.achieved
                : failedCount === 0 && !fallbackUsed
              : placedCount === requestedQty

      if (requestedQty > 0 && !prefAchieved) {
        allPreferencesAchieved = false
      }

      const manualPlacements = Array.isArray(itemEntry?.manualPlacements)
        ? itemEntry.manualPlacements
        : []
      const manualRequested = manualPlacements.length
      let manualPlaced = 0
      const coordVerifications = []

      for (const mp of manualPlacements) {
        if (mp && Number.isInteger(mp.row) && Number.isInteger(mp.col)) {
          const matched = actualLocations.some(
            (loc) => loc.row === mp.row && loc.col === mp.col
          )
          if (matched) {
            manualPlaced += 1
          }
          coordVerifications.push({
            categoryId: catId,
            itemId,
            row: mp.row,
            col: mp.col,
            verified: matched,
          })
        }
      }
      const manualFailed = Math.max(0, manualRequested - manualPlaced)
      const autoRequested = Math.max(0, requestedQty - manualRequested)
      const autoPlaced = Math.max(0, placedCount - manualPlaced)
      const autoFailed = Math.max(0, autoRequested - autoPlaced)

      if (manualFailed > 0) {
        genFailureReasons.push(`manual_placement_unmet (${manualFailed}/${manualRequested} missed)`)
      }

      const uniqueReasons = Array.from(
        new Set(
          genFailureReasons.length > 0
            ? genFailureReasons
            : failedCount > 0
              ? [prefRequested !== 'auto' ? `preference_${prefRequested}_or_capacity_unmet` : 'insufficient_valid_capacity']
              : []
        )
      )

      totalRequested += requestedQty
      totalPlaced += placedCount
      totalFailed += failedCount

      itemsReport[catId][itemId] = {
        itemId,
        categoryId: catId,
        requestedQuantity: requestedQty,
        placedQuantity: placedCount,
        failedQuantity: failedCount,
        manualRequested,
        manualPlaced,
        manualFailed,
        automaticRequested: autoRequested,
        automaticPlaced: autoPlaced,
        automaticFailed: autoFailed,
        manualCoordinateVerifications: coordVerifications,
        placementPreferenceRequested: prefRequested,
        placementPreferenceAchieved: prefAchieved,
        fallbackPlacementUsed: fallbackUsed,
        achievedCount: genPrefMeta?.achievedCount ?? (prefAchieved ? placedCount : 0),
        fallbackCount: genPrefMeta?.fallbackCount ?? (fallbackUsed ? placedCount : 0),
        failureReasons: uniqueReasons,
        locations: actualLocations,
      }
    }
  }

  // Aggregate all manual coordinate verifications
  const allManualVerifications = []
  let totalManualReq = 0
  let totalManualPlc = 0
  for (const catObj of Object.values(itemsReport)) {
    for (const itemObj of Object.values(catObj)) {
      if (Array.isArray(itemObj.manualCoordinateVerifications)) {
        allManualVerifications.push(...itemObj.manualCoordinateVerifications)
      }
      totalManualReq += itemObj.manualRequested || 0
      totalManualPlc += itemObj.manualPlaced || 0
    }
  }
  const allManualCoordinatesVerified =
    allManualVerifications.length === 0 ||
    allManualVerifications.every((v) => v.verified)

  const validationStatus =
    totalFailed > 0 || !allManualCoordinatesVerified
      ? 'FAIL'
      : anyFallbackUsed
        ? 'WARNING'
        : 'PASS'

  return {
    status: validationStatus,
    validationStatus,
    fullySatisfied: totalFailed === 0 && allManualCoordinatesVerified,
    allPreferencesAchieved,
    anyFallbackUsed,
    allManualCoordinatesVerified,
    allowPreferenceFallback: Boolean(sandboxConfig?.allowPreferenceFallback),
    totalRequested,
    totalPlaced,
    totalFailed,
    totalManualRequested: totalManualReq,
    totalManualPlaced: totalManualPlc,
    totalManualFailed: Math.max(0, totalManualReq - totalManualPlc),
    manualCoordinateVerifications: allManualVerifications,
    itemsReport,
    architectureAndSingletons,
    hazardsReport,
    collectiblesReport,
    hidingSpotsReport,
    enemiesReport,
    propsReport,
    decoysReport,
  }
}
