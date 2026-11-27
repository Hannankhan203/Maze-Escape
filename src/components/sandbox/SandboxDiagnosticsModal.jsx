import { useState, useMemo, useEffect } from 'react'
import Button from '../common/Button.jsx'
import { generateLiveVerificationReport } from '../../game/sandbox/sandboxDiagnostics.js'
import { SANDBOX_CATEGORIES } from '../../game/sandbox/sandboxConfig.js'

const SUMMARY_CATEGORY_CARDS = [
  { key: 'hazards', label: 'Hazards' },
  { key: 'collectibles', label: 'Collectibles' },
  { key: 'keycards', label: 'Keycards' },
  { key: 'hidingSpots', label: 'Hiding Spots' },
  { key: 'enemies', label: 'Enemies' },
  { key: 'environmentalProps', label: 'Environmental Props' },
]

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

  const report = useMemo(() => {
    return generateLiveVerificationReport(engine, maze, sandboxConfig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, maze, sandboxConfig, refreshTick])

  useEffect(() => {
    if (!isOpen) return undefined
    const interval = setInterval(() => {
      setRefreshTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation?.()
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const {
    status,
    ruleChecks,
    manualVerificationResults,
    genReport,
    generationSummary,
    comparisonRows,
    failureDiagnostics,
    liveEntities,
    player,
    mazeMeta,
  } = report

  const manualVerifRows =
    Array.isArray(manualVerificationResults) && manualVerificationResults.length > 0
      ? manualVerificationResults
      : Array.isArray(genReport?.manualCoordinateVerifications)
        ? genReport.manualCoordinateVerifications
        : []

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

  const comparisonItems = comparisonRows.filter((row) => {
    if (categoryFilter !== 'all' && row.categoryId !== categoryFilter) return false
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      row.itemId.toLowerCase().includes(q) ||
      row.label.toLowerCase().includes(q) ||
      row.categoryId.toLowerCase().includes(q)
    )
  })

  const filteredEntities = liveEntities.filter((ent) => {
    if (categoryFilter !== 'all' && ent.category !== categoryFilter) return false
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      ent.id.toLowerCase().includes(q) ||
      ent.label.toLowerCase().includes(q) ||
      ent.type.toLowerCase().includes(q) ||
      (ent.manualId && ent.manualId.toLowerCase().includes(q))
    )
  })

  const selectedEntity = liveEntities.find((e) => e.id === selectedEntityId) || null

  return (
    <div
      className="lv-diagnostics-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostics-modal-title"
      data-testid="sandbox-diagnostics-modal"
      onClick={(e) => e.stopPropagation()}
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
              Seed: <code>{mazeMeta.seed}</code> · Mode: <code>{mazeMeta.generationMode}</code> ·
              Dimensions: <code>{mazeMeta.dimensions}</code> · Live Entities: <code>{liveEntities.length}</code> ·
              Player Cell: <code>({player.gridCell.row}, {player.gridCell.col})</code>
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
                <span className="lv-diagnostics-metric-label">Requested / Placed</span>
                <span className="lv-diagnostics-metric-val">
                  {generationSummary.totalActual} / {generationSummary.totalRequested}
                </span>
                <span className="lv-diagnostics-metric-sub">
                  Selected types: {generationSummary.selectedCount} · Excluded: {generationSummary.excludedCount}
                </span>
              </div>
              <div className="lv-diagnostics-metric-card">
                <span className="lv-diagnostics-metric-label">Manual vs Automatic</span>
                <span className="lv-diagnostics-metric-val" style={{ color: '#fbbf24' }}>
                  {generationSummary.totalManual}M / {generationSummary.totalAutomatic}A
                </span>
                <span className="lv-diagnostics-metric-sub">
                  Manual missed: {genReport?.totalManualFailed ?? 0} · Auto missed: {genReport?.totalAutomaticFailed ?? 0}
                </span>
              </div>
              <div className="lv-diagnostics-metric-card">
                <span className="lv-diagnostics-metric-label">Failed Placements</span>
                <span
                  className="lv-diagnostics-metric-val"
                  style={{ color: generationSummary.totalFailed ? '#f87171' : '#34d399' }}
                >
                  {generationSummary.totalFailed}
                </span>
                <span className="lv-diagnostics-metric-sub">
                  Constraint omissions: {generationSummary.omittedCount}
                </span>
              </div>
              <div className="lv-diagnostics-metric-card">
                <span className="lv-diagnostics-metric-label">Preferences & Fallback</span>
                <span
                  className="lv-diagnostics-metric-val"
                  style={{ color: genReport?.anyFallbackUsed ? '#fbbf24' : '#34d399' }}
                >
                  {genReport?.anyFallbackUsed ? 'Fallback Used' : 'Strict / Exact'}
                </span>
                <span className="lv-diagnostics-metric-sub">
                  Mode: {genReport?.allowPreferenceFallback ? 'Fallback Allowed' : 'Strict Mode'}
                </span>
              </div>
            </div>

            <h3 className="lv-diagnostics-subheading">Category Breakdown (Includes Keycards & Props)</h3>
            <div className="lv-diagnostics-categories-grid">
              {SUMMARY_CATEGORY_CARDS.map((card) => {
                const catStats = generationSummary.categorySummaries?.[card.key] || {
                  requested: 0,
                  manual: 0,
                  automatic: 0,
                  actual: 0,
                  failed: 0,
                }
                return (
                  <div
                    key={card.key}
                    className="lv-diagnostics-category-card"
                    data-testid={`diagnostics-cat-summary-${card.key}`}
                  >
                    <div className="lv-diagnostics-category-card__header">
                      <span className="lv-diagnostics-cat-name">{card.label}</span>
                      <span className={`lv-diagnostics-cat-status ${catStats.failed === 0 ? 'good' : 'bad'}`}>
                        {catStats.failed === 0 ? 'PASS' : `${catStats.failed} FAILED`}
                      </span>
                    </div>
                    <div className="lv-diagnostics-cat-counts">
                      <span>Req: <strong>{catStats.requested}</strong></span>
                      <span>Man: <strong>{catStats.manual}</strong></span>
                      <span>Auto: <strong>{catStats.automatic}</strong></span>
                      <span>Actual: <strong>{catStats.actual}</strong></span>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="lv-diagnostics-lists-grid">
              <div className="lv-diagnostics-panel-box" data-testid="diagnostics-warnings-errors-box">
                <h3 className="lv-diagnostics-subheading">Warnings & Blocking Errors</h3>
                {generationSummary.blockingErrors.length === 0 && generationSummary.warnings.length === 0 ? (
                  <p className="lv-diagnostics-no-errors">No generation warnings or blocking errors recorded.</p>
                ) : (
                  <ul className="lv-diagnostics-violations-list">
                    {generationSummary.blockingErrors.map((err, i) => (
                      <li key={`err-${i}`} style={{ color: '#f87171' }}>
                        [ERROR] {err}
                      </li>
                    ))}
                    {generationSummary.warnings.map((warn, i) => (
                      <li key={`warn-${i}`} style={{ color: '#fbbf24' }}>
                        [WARNING] {warn}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="lv-diagnostics-panel-box" data-testid="diagnostics-exclusions-omissions-box">
                <h3 className="lv-diagnostics-subheading">
                  Excluded ({generationSummary.excludedCount}) & Constraint Omissions ({generationSummary.omittedCount})
                </h3>
                {generationSummary.excludedEntities.length === 0 && generationSummary.omittedByConstraints.length === 0 ? (
                  <p className="lv-diagnostics-no-errors">All catalog entities active without constraint omissions.</p>
                ) : (
                  <ul className="lv-diagnostics-violations-list">
                    {generationSummary.omittedByConstraints.map((om, i) => (
                      <li key={`om-${i}`} style={{ color: '#fca5a5' }}>
                        Omitted <code>{om.itemId}</code>: {om.actual}/{om.requested} placed ({om.reasons.join(', ')})
                      </li>
                    ))}
                    {generationSummary.excludedEntities.slice(0, 12).map((ex, i) => (
                      <li key={`ex-${i}`} style={{ color: '#94a3b8' }}>
                        Excluded <code>{ex.itemId}</code> ({ex.reason})
                      </li>
                    ))}
                    {generationSummary.excludedEntities.length > 12 && (
                      <li style={{ color: '#64748b' }}>
                        +{generationSummary.excludedEntities.length - 12} more excluded entries...
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>
            {failureDiagnostics.length > 0 && (
              <div className="lv-diagnostics-panel-box" style={{ marginTop: 12 }} data-testid="diagnostics-summary-failures-box">
                <h3 className="lv-diagnostics-subheading">
                  Failed / Invalid Placements ({failureDiagnostics.length})
                </h3>
                <ul className="lv-diagnostics-violations-list">
                  {failureDiagnostics.slice(0, 8).map((f, idx) => (
                    <li
                      key={`sum-fail-${idx}`}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                    >
                      <span>
                        <code>{f.itemId || 'entity'}</code> · {f.reason}
                        {f.canNavigate ? ` @ (${f.row}, ${f.col})` : ''}
                      </span>
                      {f.canNavigate && typeof onOpenManualEditor === 'function' && (
                        <button
                          type="button"
                          className="lv-diagnostics-nav-btn"
                          data-testid={`diagnostics-goto-${idx}`}
                          onClick={() =>
                            onOpenManualEditor({
                              row: f.row,
                              col: f.col,
                              categoryId: f.categoryId,
                              itemId: f.itemId,
                            })
                          }
                        >
                          Go to ({f.row}, {f.col})
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Requested vs Actual Comparison Table */}
        {activeTab === 'comparison' && (
          <div className="lv-diagnostics-body" data-testid="diagnostics-panel-comparison">
            <div className="lv-diagnostics-filter-bar">
              <input
                type="text"
                className="lv-diagnostics-search"
                placeholder="Search entity or category..."
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
                    <th>Entity</th>
                    <th className="num">Requested</th>
                    <th className="num">Manual</th>
                    <th className="num">Automatic</th>
                    <th className="num">Actual</th>
                    <th className="num">Failed</th>
                    <th>Preference / Status</th>
                    <th>Failure Diagnostics</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonItems.map((it) => {
                    const statusClass =
                      it.status === 'PASS' ? 'pass' : it.status === 'WARNING' ? 'warning' : 'fail'
                    return (
                      <tr key={`${it.categoryId}:${it.itemId}`} data-testid={`comparison-row-${it.itemId}`}>
                        <td>
                          <code>{it.itemId}</code>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                            {it.label} · {it.categoryLabel}
                          </div>
                        </td>
                        <td className="num">{it.requested}</td>
                        <td className="num">{it.manual} ({it.manualPlaced} ok)</td>
                        <td className="num">{it.automatic} ({it.automaticPlaced} ok)</td>
                        <td className="num"><strong>{it.actual}</strong></td>
                        <td className="num" style={{ color: it.failed > 0 ? '#f87171' : '#94a3b8' }}>
                          {it.failed}
                        </td>
                        <td>
                          <span className={`lv-diagnostics-status-tag ${statusClass}`}>
                            {it.fallbackPlacementUsed ? 'FALLBACK' : it.status}
                          </span>
                          <div className="lv-diagnostics-mode-tag">{it.placementPreferenceRequested}</div>
                        </td>
                        <td>
                          {it.failureReasons.length > 0 ? (
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
                      <td colSpan={8} className="lv-diagnostics-empty">No entities match current filter.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Live Verification & Failure Diagnostics */}
        {activeTab === 'verification' && (
          <div className="lv-diagnostics-body" data-testid="diagnostics-panel-verification">
            <h3 className="lv-diagnostics-subheading">Live Runtime Verification Rules</h3>
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
                      {rule.passed ? 'PASS' : 'FAIL'}
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

            {/* Manual Coordinate, Origin & Identity Verification Table */}
            {manualVerifRows.length > 0 && (
              <div className="lv-diagnostics-manual-verif-section">
                <h3 className="lv-diagnostics-subheading">Manual Placement Coordinate & Identity Verification</h3>
                <div className="lv-diagnostics-table-wrap">
                  <table className="lv-diagnostics-table" data-testid="manual-verification-table">
                    <thead>
                      <tr>
                        <th>Entity</th>
                        <th>Identity</th>
                        <th>Coordinates</th>
                        <th>Origin</th>
                        <th>Status</th>
                        <th>Navigate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualVerifRows.map((mv, idx) => (
                        <tr key={idx} data-testid={`manual-verif-row-${idx}`}>
                          <td><code>{mv.itemId}</code></td>
                          <td><code>{mv.manualId || '—'}</code></td>
                          <td><code>({mv.row}, {mv.col})</code></td>
                          <td>{mv.manualOriginVerified ? 'manual' : 'unverified'}</td>
                          <td>
                            <span className={`lv-diagnostics-status-tag ${mv.verified && mv.identityVerified !== false ? 'pass' : 'fail'}`}>
                              {mv.verified ? 'PASS' : 'FAIL'}
                            </span>
                          </td>
                          <td>
                            {typeof onOpenManualEditor === 'function' ? (
                              <button
                                type="button"
                                className="lv-diagnostics-nav-btn"
                                onClick={() =>
                                  onOpenManualEditor({
                                    row: mv.row,
                                    col: mv.col,
                                    categoryId: mv.categoryId,
                                    itemId: mv.itemId,
                                  })
                                }
                              >
                                Go to ({mv.row}, {mv.col})
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Structured Generation Failure Diagnostics */}
            {failureDiagnostics.length > 0 && (
              <div className="lv-diagnostics-manual-verif-section" data-testid="diagnostics-failures-section">
                <h3 className="lv-diagnostics-subheading">Generation Failure Diagnostics</h3>
                <div className="lv-diagnostics-table-wrap">
                  <table className="lv-diagnostics-table" data-testid="diagnostics-failures-table">
                    <thead>
                      <tr>
                        <th>Entity</th>
                        <th>Origin</th>
                        <th>Cell</th>
                        <th>Reason</th>
                        <th>Inspect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failureDiagnostics.map((f, idx) => (
                        <tr key={idx} data-testid={`failure-diag-row-${idx}`}>
                          <td><code>{f.itemId || '—'}</code></td>
                          <td>{f.isManual ? 'manual' : 'automatic'}</td>
                          <td><code>{f.canNavigate ? `(${f.row}, ${f.col})` : '—'}</code></td>
                          <td><span className="lv-diagnostics-reasons">{f.reason}</span></td>
                          <td>
                            {f.canNavigate && typeof onOpenManualEditor === 'function' ? (
                              <button
                                type="button"
                                className="lv-diagnostics-nav-btn"
                                data-testid={`failure-nav-btn-${idx}`}
                                onClick={() =>
                                  onOpenManualEditor({
                                    row: f.row,
                                    col: f.col,
                                    categoryId: f.categoryId,
                                    itemId: f.itemId,
                                  })
                                }
                              >
                                Inspect Cell
                              </button>
                            ) : (
                              '—'
                            )}
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
                          {ent.distanceToPlayer.toFixed(1)}m
                        </span>
                      </div>
                      <div className="lv-diagnostics-entity-row2">
                        <span className="lv-diagnostics-ent-meta">
                          ({ent.gridCoord.row}, {ent.gridCoord.col}) · {ent.origin}
                        </span>
                        <span
                          className="lv-diagnostics-ent-status"
                          style={{ color: ent.validationStatus === 'FAIL' ? '#f87171' : '#34d399' }}
                        >
                          {ent.status}
                        </span>
                      </div>
                    </button>
                  )
                })}
                {filteredEntities.length === 0 && (
                  <div className="lv-diagnostics-empty">No live entities match filter.</div>
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
                      <code className="lv-diagnostics-detail-id">
                        {selectedEntity.id}
                        {selectedEntity.manualId ? ` · manualId=${selectedEntity.manualId}` : ''}
                      </code>
                    </div>
                    <span
                      className={`lv-diagnostics-status-tag ${selectedEntity.validationStatus === 'PASS' ? 'pass' : 'fail'}`}
                    >
                      {selectedEntity.validationStatus} · {selectedEntity.status}
                    </span>
                  </header>

                  <div className="lv-diagnostics-detail-specs">
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Entity Type:</span>
                      <span className="lv-diagnostics-spec-v"><code>{selectedEntity.type}</code></span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Grid Coordinate:</span>
                      <span className="lv-diagnostics-spec-v">
                        Row <strong>{selectedEntity.gridCoord.row}</strong>, Col <strong>{selectedEntity.gridCoord.col}</strong>
                      </span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">World Coordinates:</span>
                      <span className="lv-diagnostics-spec-v">
                        X: <strong>{selectedEntity.worldPos.x.toFixed(2)}</strong>, Y: <strong>{selectedEntity.worldPos.y.toFixed(2)}</strong>, Z: <strong>{selectedEntity.worldPos.z.toFixed(2)}</strong>
                      </span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Placement Origin:</span>
                      <span className="lv-diagnostics-spec-v"><strong>{selectedEntity.origin}</strong></span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Placement Preference:</span>
                      <span className="lv-diagnostics-spec-v"><code>{selectedEntity.preference}</code></span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Generation Seed:</span>
                      <span className="lv-diagnostics-spec-v"><code>{selectedEntity.seed}</code></span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Active / Interactable:</span>
                      <span className="lv-diagnostics-spec-v">
                        Active: <strong>{selectedEntity.active ? 'Yes' : 'No'}</strong> · Interactable: <strong>{selectedEntity.interactable ? 'Yes' : 'No'}</strong>
                      </span>
                    </div>
                    <div className="lv-diagnostics-spec-row">
                      <span className="lv-diagnostics-spec-k">Distance to Player:</span>
                      <span className="lv-diagnostics-spec-v">
                        <strong>{selectedEntity.distanceToPlayer.toFixed(2)}m</strong> ({selectedEntity.gridDistance} tiles Manhattan)
                      </span>
                    </div>
                    {selectedEntity.entityState &&
                      Object.entries(selectedEntity.entityState).map(([k, v]) => (
                        <div key={k} className="lv-diagnostics-spec-row">
                          <span className="lv-diagnostics-spec-k">State · {k}:</span>
                          <span className="lv-diagnostics-spec-v">
                            <code>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</code>
                          </span>
                        </div>
                      ))}
                  </div>

                  {typeof onOpenManualEditor === 'function' && (
                    <div>
                      <button
                        type="button"
                        className="lv-diagnostics-nav-btn"
                        data-testid="inspector-goto-cell-btn"
                        onClick={() =>
                          onOpenManualEditor({
                            row: selectedEntity.gridCoord.row,
                            col: selectedEntity.gridCoord.col,
                            categoryId: selectedEntity.category,
                            itemId: selectedEntity.type,
                          })
                        }
                      >
                        Inspect Coordinate ({selectedEntity.gridCoord.row}, {selectedEntity.gridCoord.col}) in Editor
                      </button>
                    </div>
                  )}

                  <div className="lv-diagnostics-detail-player">
                    <span>Active Player Position:</span>
                    <code>
                      Cell ({player.gridCell.row}, {player.gridCell.col}) · World ({player.worldPos.x.toFixed(1)}, {player.worldPos.y.toFixed(1)}, {player.worldPos.z.toFixed(1)})
                    </code>
                  </div>
                </div>
              ) : (
                <div className="lv-diagnostics-detail-placeholder">
                  <p>Select any spawned entity from the list to inspect runtime state, world coordinates, origin, and validation status.</p>
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
                onClick={() => onOpenManualEditor(null)}
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
