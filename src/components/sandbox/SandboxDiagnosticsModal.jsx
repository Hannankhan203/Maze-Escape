import { useState, useMemo, useEffect } from 'react'
import Button from '../common/Button.jsx'
import {
  generateLiveVerificationReport,
  extractLiveEntitiesFromEngine,
} from '../../game/sandbox/sandboxDiagnostics.js'
import { SANDBOX_CATEGORIES } from '../../game/sandbox/sandboxConfig.js'

export default function SandboxDiagnosticsModal({
  isOpen = true,
  engine = null,
  maze = null,
  sandboxConfig = null,
  onClose = null,
  onRestartSameSeed = null,
  onRestartNewSeed = null,
  onOpenManualEditor = null,
  onReturnToSandbox = null,
}) {
  const [activeTab, setActiveTab] = useState('summary')
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedEntityId, setSelectedEntityId] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)

  // Generate live report
  const report = useMemo(() => {
    return generateLiveVerificationReport(engine, maze, sandboxConfig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, maze, sandboxConfig, refreshTick])

  const liveData = useMemo(() => {
    return extractLiveEntitiesFromEngine(engine, maze)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, maze, refreshTick])

  // Periodic refresh when modal is open to track player distance
  useEffect(() => {
    if (!isOpen) return undefined
    const interval = setInterval(() => {
      setRefreshTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [isOpen])

  // ESC key closes modal
  useEffect(() => {
    if (!isOpen) return undefined
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const { status, ruleChecks, genReport, mazeMeta } = report
  const statusColor =
    status === 'PASS'
      ? 'var(--color-emerald-400, #34d399)'
      : status === 'WARNING'
        ? 'var(--color-amber-400, #fbbf24)'
        : 'var(--color-rose-400, #f87171)'

  const statusBg =
    status === 'PASS'
      ? 'rgba(52, 211, 153, 0.15)'
      : status === 'WARNING'
        ? 'rgba(251, 191, 36, 0.15)'
        : 'rgba(248, 113, 113, 0.15)'

  // Filtered comparison items
  const comparisonItems = []
  if (genReport?.itemsReport) {
    for (const [catId, catObj] of Object.entries(genReport.itemsReport)) {
      for (const [itemId, itemReport] of Object.entries(catObj)) {
        if (categoryFilter !== 'all' && catId !== categoryFilter) continue
        if (
          searchQuery &&
          !itemId.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !catId.toLowerCase().includes(searchQuery.toLowerCase())
        ) {
          continue
        }
        comparisonItems.push(itemReport)
      }
    }
  }

  // Filtered live entities
  const filteredEntities = liveData.entities.filter((ent) => {
    if (categoryFilter !== 'all' && ent.category !== categoryFilter) return false
    if (!searchQuery) return true
    return (
      ent.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ent.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ent.type.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })

  const selectedEntity = liveData.entities.find((e) => e.id === selectedEntityId) || null

  return (
    <div
      className="lv-diagnostics-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostics-modal-title"
      data-testid="sandbox-diagnostics-modal"
    >
      <div className="lv-diagnostics-modal">
        {/* Header */}
        <header className="lv-diagnostics-header">
          <div className="lv-diagnostics-header__left">
            <div className="lv-diagnostics-header__title-row">
              <span className="lv-diagnostics-badge-tech">RUNTIME DIAGNOSTICS</span>
              <h2 id="diagnostics-modal-title" className="lv-diagnostics-title">
                Developer Sandbox Inspector
              </h2>
              <div
                className="lv-diagnostics-status-pill"
                data-testid="diagnostics-status-badge"
                style={{ color: statusColor, backgroundColor: statusBg, borderColor: statusColor }}
              >
                STATUS: {status}
              </div>
            </div>
            <p className="lv-diagnostics-meta">
              Seed: <code>{mazeMeta.seed}</code> · Dimensions: <code>{mazeMeta.dimensions}</code> · Live Entities: <code>{liveData.totalEntities}</code> · Player Cell: <code>({liveData.player.gridCell.row}, {liveData.player.gridCell.col})</code>
            </p>
          </div>
          <button
            type="button"
            className="lv-diagnostics-close-btn"
            onClick={onClose}
            aria-label="Close Diagnostics"
            data-testid="diagnostics-close-btn"
          >
            ✕
          </button>
        </header>

        {/* Navigation Tabs */}
        <nav className="lv-diagnostics-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'summary'}
            className={`lv-diagnostics-tab ${activeTab === 'summary' ? 'active' : ''}`}
            data-testid="diagnostics-tab-summary"
            onClick={() => setActiveTab('summary')}
          >
            Generation Summary
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'comparison'}
            className={`lv-diagnostics-tab ${activeTab === 'comparison' ? 'active' : ''}`}
            data-testid="diagnostics-tab-comparison"
            onClick={() => setActiveTab('comparison')}
          >
            Requested vs Actual ({comparisonItems.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'verification'}
            className={`lv-diagnostics-tab ${activeTab === 'verification' ? 'active' : ''}`}
            data-testid="diagnostics-tab-verification"
            onClick={() => setActiveTab('verification')}
          >
            Rule Verification ({ruleChecks.filter((r) => r.passed).length}/{ruleChecks.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'inspector'}
            className={`lv-diagnostics-tab ${activeTab === 'inspector' ? 'active' : ''}`}
            data-testid="diagnostics-tab-inspector"
            onClick={() => setActiveTab('inspector')}
          >
            Live Entity Inspector ({filteredEntities.length})
          </button>
        </nav>

        {/* Tab 1: Generation Summary */}
        {activeTab === 'summary' && (
          <div className="lv-diagnostics-body" data-testid="diagnostics-panel-summary">
            <div className="lv-diagnostics-metrics-grid">
              <div className="lv-diagnostics-metric-card">
                <span className="lv-diagnostics-metric-label">Total Requested</span>
                <span className="lv-diagnostics-metric-val">{genReport?.totalRequested ?? 0}</span>
                <span className="lv-diagnostics-metric-sub">Across all spawnable categories</span>
              </div>
              <div className="lv-diagnostics-metric-card">
                <span className="lv-diagnostics-metric-label">Total Placed</span>
                <span className="lv-diagnostics-metric-val" style={{ color: '#34d399' }}>
                  {genReport?.totalPlaced ?? 0}
                </span>
                <span className="lv-diagnostics-metric-sub">
                  Fulfillment: {genReport?.totalRequested ? Math.round(((genReport.totalPlaced || 0) / genReport.totalRequested) * 100) : 100}%
                </span>
              </div>
              <div className="lv-diagnostics-metric-card">
                <span className="lv-diagnostics-metric-label">Shortfalls / Failed</span>
                <span
                  className="lv-diagnostics-metric-val"
                  style={{ color: genReport?.totalFailed ? '#f87171' : '#9ca3af' }}
                >
                  {genReport?.totalFailed ?? 0}
                </span>
                <span className="lv-diagnostics-metric-sub">
                  Manual: {genReport?.totalManualFailed ?? 0} missed
                </span>
              </div>
              <div className="lv-diagnostics-metric-card">
                <span className="lv-diagnostics-metric-label">Preference Fallbacks</span>
                <span
                  className="lv-diagnostics-metric-val"
                  style={{ color: genReport?.anyFallbackUsed ? '#fbbf24' : '#34d399' }}
                >
                  {genReport?.anyFallbackUsed ? 'Used' : 'None'}
                </span>
                <span className="lv-diagnostics-metric-sub">
                  Strict Mode: {genReport?.allowPreferenceFallback ? 'Fallback Allowed' : 'Strict Enforcement'}
                </span>
              </div>
            </div>

            {/* Category Breakdown Cards */}
            <h3 className="lv-diagnostics-subheading">Category Breakdown</h3>
            <div className="lv-diagnostics-categories-grid">
              {SANDBOX_CATEGORIES.map((cat) => {
                const catItems = genReport?.itemsReport?.[cat.id] || {}
                const itemsList = Object.values(catItems)
                const req = itemsList.reduce((acc, it) => acc + (it.requestedQuantity || 0), 0)
                const plc = itemsList.reduce((acc, it) => acc + (it.placedQuantity || 0), 0)
                const fld = itemsList.reduce((acc, it) => acc + (it.failedQuantity || 0), 0)
                const man = itemsList.reduce((acc, it) => acc + (it.manualPlaced || 0), 0)
                return (
                  <div key={cat.id} className="lv-diagnostics-category-card">
                    <div className="lv-diagnostics-category-card__header">
                      <span className="lv-diagnostics-cat-name">{cat.label}</span>
                      <span className={`lv-diagnostics-cat-status ${fld === 0 ? 'good' : 'bad'}`}>
                        {fld === 0 ? 'PASS' : `${fld} FAILED`}
                      </span>
                    </div>
                    <div className="lv-diagnostics-cat-counts">
                      <span>Placed: <strong>{plc} / {req}</strong></span>
                      {man > 0 && <span>Manual: <strong>{man}</strong></span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Tab 2: Comparison Table */}
        {activeTab === 'comparison' && (
          <div className="lv-diagnostics-body" data-testid="diagnostics-panel-comparison">
            <div className="lv-diagnostics-filter-bar">
              <input
                type="text"
                className="lv-diagnostics-search"
                placeholder="Search item or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="diagnostics-search-input"
              />
              <select
                className="lv-diagnostics-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                data-testid="diagnostics-category-select"
              >
                <option value="all">All Categories</option>
                {SANDBOX_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="lv-diagnostics-table-wrap">
              <table className="lv-diagnostics-table" data-testid="diagnostics-comparison-table">
                <thead>
                  <tr>
                    <th>Item ID</th>
                    <th>Category</th>
                    <th>Mode</th>
                    <th>Requested</th>
                    <th>Placed</th>
                    <th>Manual (Plc/Req)</th>
                    <th>Status</th>
                    <th>Failure Diagnostics</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonItems.map((it) => {
                    const isManual = it.manualRequested > 0
                    const isPref = it.placementPreferenceRequested && it.placementPreferenceRequested !== 'auto'
                    const modeLabel = isManual ? 'Manual' : isPref ? `Pref: ${it.placementPreferenceRequested}` : 'Auto'
                    const isMatched = it.failedQuantity === 0
                    const statusClass = isMatched
                      ? (it.fallbackPlacementUsed ? 'warning' : 'pass')
                      : 'fail'

                    return (
                      <tr key={`${it.categoryId}:${it.itemId}`} data-testid={`comparison-row-${it.itemId}`}>
                        <td><code>{it.itemId}</code></td>
                        <td>{it.categoryId}</td>
                        <td><span className="lv-diagnostics-mode-tag">{modeLabel}</span></td>
                        <td>{it.requestedQuantity}</td>
                        <td><strong>{it.placedQuantity}</strong></td>
                        <td>{it.manualPlaced} / {it.manualRequested}</td>
                        <td>
                          <span className={`lv-diagnostics-status-tag ${statusClass}`}>
                            {isMatched ? (it.fallbackPlacementUsed ? 'FALLBACK' : 'MATCH') : 'SHORTFALL'}
                          </span>
                        </td>
                        <td>
                          {it.failureReasons?.length > 0 ? (
                            <span className="lv-diagnostics-reasons">{it.failureReasons.join(', ')}</span>
                          ) : (
                            <span className="lv-diagnostics-no-errors">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {comparisonItems.length === 0 && (
                    <tr>
                      <td colSpan={8} className="lv-diagnostics-empty">No items match current filter.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Rule Verification */}
        {activeTab === 'verification' && (
          <div className="lv-diagnostics-body" data-testid="diagnostics-panel-verification">
            <h3 className="lv-diagnostics-subheading">Runtime Integrity Rules</h3>
            <div className="lv-diagnostics-rules-list">
              {ruleChecks.map((rule) => (
                <div
                  key={rule.id}
                  className={`lv-diagnostics-rule-card ${rule.passed ? 'passed' : 'failed'}`}
                  data-testid={`rule-check-${rule.id}`}
                >
                  <div className="lv-diagnostics-rule-header">
                    <span className="lv-diagnostics-rule-icon">{rule.passed ? '✓' : '✗'}</span>
                    <span className="lv-diagnostics-rule-title">{rule.label}</span>
                    <span className={`lv-diagnostics-rule-pill ${rule.passed ? 'pass' : 'fail'}`}>
                      {rule.passed ? 'VERIFIED' : 'VIOLATION'}
                    </span>
                  </div>
                  <p className="lv-diagnostics-rule-desc">{rule.description}</p>
                  {rule.violations.length > 0 && (
                    <ul className="lv-diagnostics-violations-list">
                      {rule.violations.map((v, idx) => (
                        <li key={idx}><code>{v}</code></li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            {/* Manual Placements Coordinate Verification Table */}
            {genReport?.manualCoordinateVerifications?.length > 0 && (
              <div className="lv-diagnostics-manual-verif-section">
                <h3 className="lv-diagnostics-subheading">Manual Placement Coordinate Verification</h3>
                <div className="lv-diagnostics-table-wrap">
                  <table className="lv-diagnostics-table" data-testid="manual-verification-table">
                    <thead>
                      <tr>
                        <th>Item ID</th>
                        <th>Category</th>
                        <th>Coordinates</th>
                        <th>Coordinate Match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {genReport.manualCoordinateVerifications.map((mv, idx) => (
                        <tr key={idx} data-testid={`manual-verif-row-${idx}`}>
                          <td><code>{mv.itemId}</code></td>
                          <td>{mv.categoryId}</td>
                          <td><code>({mv.row}, {mv.col})</code></td>
                          <td>
                            <span className={`lv-diagnostics-status-tag ${mv.verified ? 'pass' : 'fail'}`}>
                              {mv.verified ? 'VERIFIED AT CELL' : 'FAILED / MISSED'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Live Entity Inspector */}
        {activeTab === 'inspector' && (
          <div className="lv-diagnostics-body lv-diagnostics-inspector-layout" data-testid="diagnostics-panel-inspector">
            <div className="lv-diagnostics-inspector-list">
              <div className="lv-diagnostics-filter-bar compact">
                <input
                  type="text"
                  className="lv-diagnostics-search"
                  placeholder="Filter active entities..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <select
                  className="lv-diagnostics-select"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  {SANDBOX_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.shortLabel}</option>
                  ))}
                </select>
              </div>

              <div className="lv-diagnostics-entity-scroll">
                {filteredEntities.map((ent) => {
                  const isSelected = ent.id === selectedEntityId
                  return (
                    <button
                      key={ent.id}
                      type="button"
                      className={`lv-diagnostics-entity-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedEntityId(ent.id)}
                      data-testid={`entity-item-${ent.id}`}
                    >
                      <div className="lv-diagnostics-entity-row1">
                        <span className="lv-diagnostics-ent-label">{ent.label}</span>
                        <span className="lv-diagnostics-ent-dist">
                          {ent.distanceToPlayer.toFixed(1)}m away
                        </span>
                      </div>
                      <div className="lv-diagnostics-entity-row2">
                        <span className="lv-diagnostics-ent-meta">
                          Cell ({ent.gridCoord.row}, {ent.gridCoord.col}) · {ent.origin}
                        </span>
                        <span className="lv-diagnostics-ent-status">{ent.status}</span>
                      </div>
                    </button>
                  )
                })}
                {filteredEntities.length === 0 && (
                  <div className="lv-diagnostics-empty">No entities found.</div>
                )}
              </div>
            </div>

            {/* Entity Inspector Details Panel */}
            <div className="lv-diagnostics-inspector-details" data-testid="entity-inspector-details">
              {selectedEntity ? (
                <div className="lv-diagnostics-detail-card">
                  <header className="lv-diagnostics-detail-header">
                    <div>
                      <span className="lv-diagnostics-badge-tech">{selectedEntity.categoryLabel}</span>
                      <h4 className="lv-diagnostics-detail-title">{selectedEntity.label}</h4>
                      <code className="lv-diagnostics-detail-id">{selectedEntity.id}</code>
                    </div>
                    <span className="lv-diagnostics-ent-status large">{selectedEntity.status}</span>
                  </header>

                  <div className="lv-diagnostics-detail-specs">
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Grid Coordinate:</span>
                      <span className="lv-diagnostics-spec-v">
                        Row <strong>{selectedEntity.gridCoord.row}</strong>, Col <strong>{selectedEntity.gridCoord.col}</strong>
                      </span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">World Position:</span>
                      <span className="lv-diagnostics-spec-v">
                        X: <strong>{selectedEntity.worldPos.x.toFixed(2)}</strong>, Y: <strong>{selectedEntity.worldPos.y.toFixed(2)}</strong>, Z: <strong>{selectedEntity.worldPos.z.toFixed(2)}</strong>
                      </span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Distance to Player:</span>
                      <span className="lv-diagnostics-spec-v">
                        <strong>{selectedEntity.distanceToPlayer.toFixed(2)}m</strong> ({selectedEntity.gridDistance} tiles Manhattan)
                      </span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Placement Origin:</span>
                      <span className="lv-diagnostics-spec-v capitalize">
                        <strong>{selectedEntity.origin}</strong>
                      </span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Placement Preference:</span>
                      <span className="lv-diagnostics-spec-v">
                        <code>{selectedEntity.preference}</code>
                      </span>
                    </div>
                  </div>

                  <div className="lv-diagnostics-detail-player">
                    <span>Active Player Position:</span>
                    <code>
                      Cell ({liveData.player.gridCell.row}, {liveData.player.gridCell.col}) ·
                      World ({liveData.player.worldPos.x.toFixed(1)}, {liveData.player.worldPos.y.toFixed(1)}, {liveData.player.worldPos.z.toFixed(1)})
                    </code>
                  </div>
                </div>
              ) : (
                <div className="lv-diagnostics-detail-placeholder">
                  <p>Select any entity from the list to inspect world coordinates, grid cell, and real-time distance to player.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Quick Action Bar */}
        <footer className="lv-diagnostics-footer">
          <div className="lv-diagnostics-footer__left">
            {typeof onRestartSameSeed === 'function' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onRestartSameSeed}
                data-testid="diagnostics-restart-same-seed-btn"
              >
                Restart (Same Seed)
              </Button>
            )}
            {typeof onRestartNewSeed === 'function' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onRestartNewSeed}
                data-testid="diagnostics-restart-new-seed-btn"
              >
                Restart (New Seed)
              </Button>
            )}
            {typeof onOpenManualEditor === 'function' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenManualEditor}
                data-testid="diagnostics-open-manual-editor-btn"
              >
                Manual Grid Editor
              </Button>
            )}
            {typeof onReturnToSandbox === 'function' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onReturnToSandbox}
                data-testid="diagnostics-return-sandbox-btn"
              >
                Sandbox Config
              </Button>
            )}
          </div>
          <div className="lv-diagnostics-footer__right">
            <Button
              variant="primary"
              size="md"
              onClick={onClose}
              data-testid="diagnostics-close-footer-btn"
            >
              Close Diagnostics
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
