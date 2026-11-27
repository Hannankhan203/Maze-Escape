import { useState } from 'react'
import Button from '../common/Button.jsx'
import ToggleSwitch from '../common/ToggleSwitch.jsx'
import ManualGridEditorModal from './ManualGridEditorModal.jsx'
import {
  QUANTITY_INELIGIBLE_ENVIRONMENTAL_TYPES,
  SANDBOX_CATEGORIES,
  SANDBOX_CATEGORY_IDS,
  SANDBOX_GLOBAL_LIMITS,
  SANDBOX_PRESETS,
  applySandboxPreset,
  createDefaultSandboxConfig,
  exportSandboxConfigJson,
  getItemQuantityLimits,
  getSandboxConfigSummary,
  getSupportedPlacementPreferences,
  importSandboxConfigJson,
  isItemQuantityEligible,
  isSandboxItemEnabled,
  resetSandboxConfig,
  setCategoryAllEnabled,
  setItemPlacementPreference,
  setItemQuantity,
  setSandboxAllowFallback,
  toggleSandboxItem,
  validateSandboxConfig,
} from '../../game/sandbox/sandboxConfig.js'

function groupItemsBySubGroup(items = []) {
  const order = []
  const grouped = new Map()
  for (const item of items) {
    const key = item.subGroup || 'General'
    if (!grouped.has(key)) {
      grouped.set(key, [])
      order.push(key)
    }
    grouped.get(key).push(item)
  }
  return order.map((title) => ({
    title,
    items: grouped.get(title),
  }))
}

function createRandomSandboxSeed() {
  return Math.floor(Math.random() * 900000) + 100000
}

export default function DeveloperSandboxView({
  sandboxConfig = null,
  onChangeConfig = null,
  onResetConfig = null,
  onStartTestLevel = null,
  onBack = null,
  initialCategory = SANDBOX_CATEGORY_IDS.HAZARDS,
  initialShowManualEditor = false,
  initialFocusCoord = null,
  onConsumeInitialFocus = null,
}) {
  const [internalConfig, setInternalConfig] = useState(() =>
    createDefaultSandboxConfig()
  )
  const [activeCategory, setActiveCategory] = useState(() => {
    if (
      initialFocusCoord?.categoryId &&
      SANDBOX_CATEGORIES.some((c) => c.id === initialFocusCoord.categoryId)
    ) {
      return initialFocusCoord.categoryId
    }
    const valid = SANDBOX_CATEGORIES.some((c) => c.id === initialCategory)
    return valid ? initialCategory : SANDBOX_CATEGORY_IDS.HAZARDS
  })
  const [statusNotices, setStatusNotices] = useState([])
  const [showManualEditor, setShowManualEditor] = useState(false)
  const [manualFocusCoord, setManualFocusCoord] = useState(null)
  const [showJsonPanel, setShowJsonPanel] = useState(false)
  const [jsonInputText, setJsonInputText] = useState('')
  const [jsonError, setJsonError] = useState(null)

  const isManualEditorOpen =
    showManualEditor || Boolean(initialShowManualEditor) || Boolean(initialFocusCoord)
  const activeFocusCoord = manualFocusCoord || initialFocusCoord || null

  const effectiveConfig = sandboxConfig || internalConfig
  const validation = validateSandboxConfig(effectiveConfig)
  const normalizedConfig = validation.config
  const summary = getSandboxConfigSummary(normalizedConfig)

  const activeCategoryMeta =
    SANDBOX_CATEGORIES.find((cat) => cat.id === activeCategory) ||
    SANDBOX_CATEGORIES[0]
  const activeSummary = summary.byCategory[activeCategoryMeta.id]
  const itemGroups = groupItemsBySubGroup(activeCategoryMeta.items)
  const activeCategoryCap =
    SANDBOX_GLOBAL_LIMITS.categoryCaps[activeCategoryMeta.id] ??
    SANDBOX_GLOBAL_LIMITS.maxTotalSpawnableEntities

  const commitConfigResult = (result) => {
    const nextConfig = result?.config || result
    const notices = Array.isArray(result?.notices) ? result.notices : []
    if (!sandboxConfig) {
      setInternalConfig(nextConfig)
    }
    setStatusNotices(notices)
    onChangeConfig?.(nextConfig, notices)
  }

  const handleToggleItem = (categoryId, itemId, nextChecked) => {
    const result = toggleSandboxItem(
      normalizedConfig,
      categoryId,
      itemId,
      nextChecked
    )
    commitConfigResult(result)
  }

  const handleQuantityChange = (categoryId, itemId, rawVal) => {
    const result = setItemQuantity(
      normalizedConfig,
      categoryId,
      itemId,
      rawVal === '' || rawVal === null || rawVal === undefined ? null : Number(rawVal)
    )
    commitConfigResult(result)
  }

  const handleQuantityStep = (categoryId, itemId, currentQty, delta, limits) => {
    let nextQty
    if (currentQty === null || currentQty === undefined) {
      nextQty = delta > 0 ? Math.min(limits.max, Math.max(limits.min, 1)) : 0
    } else {
      nextQty = Math.max(limits.min, Math.min(limits.max, currentQty + delta))
    }
    const result = setItemQuantity(normalizedConfig, categoryId, itemId, nextQty)
    commitConfigResult(result)
  }

  const handlePreferenceChange = (categoryId, itemId, nextPref) => {
    const result = setItemPlacementPreference(
      normalizedConfig,
      categoryId,
      itemId,
      nextPref
    )
    commitConfigResult(result)
  }

  const handleToggleAllowFallback = (nextChecked) => {
    const result = setSandboxAllowFallback(normalizedConfig, nextChecked)
    commitConfigResult(result)
  }



  const handleSelectAllCategory = () => {
    const result = setCategoryAllEnabled(
      normalizedConfig,
      activeCategoryMeta.id,
      true
    )
    commitConfigResult(result)
  }

  const handleClearAllCategory = () => {
    const result = setCategoryAllEnabled(
      normalizedConfig,
      activeCategoryMeta.id,
      false
    )
    commitConfigResult(result)
  }

  const handleResetConfiguration = () => {
    const result = resetSandboxConfig()
    if (!sandboxConfig) {
      setInternalConfig(result.config)
    }
    setStatusNotices([])
    setJsonError(null)
    if (typeof onResetConfig === 'function') {
      onResetConfig(result.config)
    } else {
      onChangeConfig?.(result.config, [])
    }
  }

  const handleStartTest = () => {
    if (!validation.valid) return
    const testConfig = {
      ...normalizedConfig,
      seed: createRandomSandboxSeed(),
    }
    onStartTestLevel?.(testConfig)
  }

  const handleApplyPreset = (presetId) => {
    const result = applySandboxPreset(normalizedConfig, presetId)
    commitConfigResult(result)
  }

  const handleExportJson = () => {
    const exported = exportSandboxConfigJson(normalizedConfig)
    setJsonInputText(exported)
    setJsonError(null)
    setShowJsonPanel(true)
    setStatusNotices(['Exported current sandbox configuration JSON.'])
  }

  const handleImportJson = () => {
    const imported = importSandboxConfigJson(jsonInputText, normalizedConfig)
    if (!imported.success) {
      setJsonError(
        imported.error ||
          imported.errors?.join(' ') ||
          'Invalid sandbox configuration JSON.'
      )
      return
    }
    setJsonError(null)
    commitConfigResult({
      config: imported.config,
      notices: imported.notices?.length
        ? imported.notices
        : ['Imported sandbox configuration JSON.'],
    })
  }

  if (isManualEditorOpen) {
    const focusKey = activeFocusCoord
      ? `${activeFocusCoord.row ?? 'x'}-${activeFocusCoord.col ?? 'x'}-${activeFocusCoord.itemId || ''}`
      : 'default'
    return (
      <ManualGridEditorModal
        key={focusKey}
        sandboxConfig={normalizedConfig}
        initialFocusCoord={activeFocusCoord}
        onChangeConfig={(nextConfig, notices) =>
          commitConfigResult({
            config: nextConfig,
            notices: Array.isArray(notices) ? notices : [],
          })
        }
        onStartTestLevel={onStartTestLevel}
        onBack={() => {
          setShowManualEditor(false)
          setManualFocusCoord(null)
          onConsumeInitialFocus?.()
        }}
      />
    )
  }

  return (
    <div className="lv-sandbox-view" data-testid="developer-sandbox-view">
      {/* Quick Presets & Seed Bar */}
      <div className="lv-sandbox-top-controls">
        <div className="lv-sandbox-presets-bar" data-testid="sandbox-presets-bar">
          <span className="lv-sandbox-presets-label">
            Testing Presets
            {normalizedConfig.activePreset
              ? ` (${normalizedConfig.activePreset}${
                  normalizedConfig.customModified ? ' · Modified' : ''
                })`
              : ''}
            :
          </span>
          <div className="lv-sandbox-presets-buttons">
            {SANDBOX_PRESETS.map((preset) => {
              const isActive =
                normalizedConfig.activePreset === preset.id &&
                !normalizedConfig.customModified
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={[
                    'lv-sandbox-preset-btn',
                    isActive ? 'active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-testid={`sandbox-preset-${preset.id}`}
                  aria-pressed={isActive}
                  title={preset.description}
                  onClick={() => handleApplyPreset(preset.id)}
                >
                  {preset.label}
                </button>
              )
            })}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setManualFocusCoord(null)
                setShowManualEditor(true)
              }}
              data-testid="open-manual-grid-editor-btn"
            >
              Open Manual Grid Editor
            </Button>
          </div>
        </div>

        <div className="lv-sandbox-seed-bar" data-testid="sandbox-seed-bar" style={{ justifyContent: 'flex-end' }}>

          <div className="lv-sandbox-json-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportJson}
              data-testid="sandbox-export-json-btn"
            >
              Export JSON
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowJsonPanel((prev) => !prev)
                setJsonError(null)
              }}
              data-testid="sandbox-toggle-json-btn"
            >
              {showJsonPanel ? 'Hide JSON' : 'Import JSON'}
            </Button>
          </div>
        </div>

        {showJsonPanel ? (
          <div className="lv-sandbox-json-panel" data-testid="sandbox-json-panel">
            <textarea
              value={jsonInputText}
              onChange={(e) => setJsonInputText(e.target.value)}
              placeholder="Paste exported sandbox JSON configuration here..."
              rows={5}
              data-testid="sandbox-json-textarea"
            />
            {jsonError ? (
              <div
                className="lv-sandbox-alert lv-sandbox-alert--error"
                role="alert"
                data-testid="sandbox-json-error"
              >
                <span>{jsonError}</span>
              </div>
            ) : null}
            <div className="lv-sandbox-json-panel__actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleImportJson}
                data-testid="sandbox-import-json-btn"
              >
                Apply JSON Config
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowJsonPanel(false)
                  setJsonError(null)
                }}
              >
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Distribution Strictness / Fallback Option */}
      <div className="lv-sandbox-options-bar" data-testid="sandbox-allow-fallback-row">
        <ToggleSwitch
          label="Allow Preference Fallback"
          description="When off (default), strict placement preferences fail transparently rather than placing instances on non-matching cells."
          checked={Boolean(normalizedConfig.allowPreferenceFallback)}
          testId="sandbox-allow-fallback-toggle"
          onChange={handleToggleAllowFallback}
        />
      </div>

      {/* Category Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Sandbox configuration categories"
        className="lv-sandbox-tabs"
        data-testid="sandbox-category-tabs"
      >
        {SANDBOX_CATEGORIES.map((cat) => {
          const isSelected = cat.id === activeCategoryMeta.id
          const catSummary = summary.byCategory[cat.id]
          return (
            <button
              key={cat.id}
              id={`sandbox-tab-${cat.id}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`sandbox-panel-${cat.id}`}
              className="lv-sandbox-tab"
              data-testid={`sandbox-tab-${cat.id}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              <span>{cat.shortLabel}</span>
              <span
                className="lv-sandbox-tab__count"
                data-testid={`sandbox-tab-count-${cat.id}`}
              >
                {catSummary.enabledCount}/{catSummary.totalCount}
              </span>
            </button>
          )
        })}
      </div>

      {/* Active Category Panel */}
      <section
        id={`sandbox-panel-${activeCategoryMeta.id}`}
        role="tabpanel"
        aria-labelledby={`sandbox-tab-${activeCategoryMeta.id}`}
        className="lv-sandbox-groups"
        data-testid={`sandbox-panel-${activeCategoryMeta.id}`}
      >
        <div className="lv-sandbox-section-bar">
          <div className="lv-sandbox-section-bar__copy">
            <h2 className="lv-sandbox-section-bar__title">
              {activeCategoryMeta.label}
            </h2>
            <p className="lv-sandbox-section-bar__desc">
              {activeCategoryMeta.description} (Explicit spawns:{' '}
              {activeSummary.explicitSpawnTotal} / {activeCategoryCap} cap · Manual:{' '}
              {activeSummary.manualSpawnTotal || 0})
            </p>
          </div>
          <div className="lv-sandbox-section-bar__actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={activeSummary.allSelected}
              onClick={handleSelectAllCategory}
              data-testid="sandbox-select-all-btn"
            >
              Select All
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={activeSummary.noneSelected}
              onClick={handleClearAllCategory}
              data-testid="sandbox-clear-all-btn"
            >
              Clear All
            </Button>
          </div>
        </div>

        {itemGroups.map((group) => {
          const enabledInGroup = group.items.filter((item) =>
            isSandboxItemEnabled(
              normalizedConfig,
              activeCategoryMeta.id,
              item.id
            )
          ).length

          return (
            <div key={group.title} className="lv-sandbox-group">
              <div className="lv-sandbox-group__header">
                <h3 className="lv-sandbox-group__title">{group.title}</h3>
                <span className="lv-sandbox-group__count">
                  {enabledInGroup}/{group.items.length} enabled
                </span>
              </div>
              <div className="lv-sandbox-items-grid">
                {group.items.map((item) => {
                  const enabled = isSandboxItemEnabled(
                    normalizedConfig,
                    activeCategoryMeta.id,
                    item.id
                  )
                  const isEligible = isItemQuantityEligible(
                    activeCategoryMeta.id,
                    item.id
                  )
                  const itemEntry =
                    normalizedConfig?.categories?.[activeCategoryMeta.id]?.items?.[
                      item.id
                    ] || {}
                  const limits = isEligible
                    ? getItemQuantityLimits(activeCategoryMeta.id, item.id)
                    : null
                  const supportedPrefs = isEligible
                    ? getSupportedPlacementPreferences(activeCategoryMeta.id, item.id)
                    : []
                  const hasExplicitQty =
                    itemEntry.quantity !== null && itemEntry.quantity !== undefined
                  const isZeroQuantity = hasExplicitQty && itemEntry.quantity === 0
                  const manualCount = Array.isArray(itemEntry.manualPlacements)
                    ? itemEntry.manualPlacements.length
                    : 0

                  return (
                    <div
                      key={item.id}
                      className={[
                        'lv-sandbox-item-card',
                        !enabled ? 'lv-sandbox-item-card--disabled' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-sandbox-item-id={item.id}
                    >
                      <ToggleSwitch
                        label={item.label}
                        description={item.description}
                        checked={enabled}
                        testId={`sandbox-toggle-${activeCategoryMeta.id}-${item.id}`}
                        onChange={(checked) =>
                          handleToggleItem(
                            activeCategoryMeta.id,
                            item.id,
                            checked
                          )
                        }
                      />
                      {enabled ? (
                        !isEligible ? (
                          <div
                            className="lv-sandbox-item-ineligible-note"
                            data-testid={`sandbox-ineligible-${activeCategoryMeta.id}-${item.id}`}
                          >
                            <span className="lv-sandbox-ineligible-tag">Fixed System</span>
                            <span className="lv-sandbox-ineligible-desc">
                              {QUANTITY_INELIGIBLE_ENVIRONMENTAL_TYPES[item.id] ||
                                'Fixed architectural layer'}
                            </span>
                          </div>
                        ) : (
                          <div
                            className="lv-sandbox-item-controls"
                            data-testid={`sandbox-controls-${activeCategoryMeta.id}-${item.id}`}
                          >
                            <div className="lv-sandbox-qty-control">
                              <label htmlFor={`qty-${activeCategoryMeta.id}-${item.id}`}>
                                Qty:
                              </label>
                              <div className="lv-sandbox-qty-stepper">
                                <button
                                  type="button"
                                  className="lv-sandbox-step-btn"
                                  aria-label={`Decrease quantity for ${item.label}`}
                                  disabled={hasExplicitQty && itemEntry.quantity <= limits.min}
                                  data-testid={`sandbox-qty-dec-${activeCategoryMeta.id}-${item.id}`}
                                  onClick={() =>
                                    handleQuantityStep(
                                      activeCategoryMeta.id,
                                      item.id,
                                      itemEntry.quantity,
                                      -1,
                                      limits
                                    )
                                  }
                                >
                                  -
                                </button>
                                <input
                                  id={`qty-${activeCategoryMeta.id}-${item.id}`}
                                  type="number"
                                  min={limits.min}
                                  max={limits.max}
                                  value={hasExplicitQty ? itemEntry.quantity : ''}
                                  placeholder="Auto"
                                  data-testid={`sandbox-qty-${activeCategoryMeta.id}-${item.id}`}
                                  onChange={(e) =>
                                    handleQuantityChange(
                                      activeCategoryMeta.id,
                                      item.id,
                                      e.target.value
                                    )
                                  }
                                />
                                <button
                                  type="button"
                                  className="lv-sandbox-step-btn"
                                  aria-label={`Increase quantity for ${item.label}`}
                                  disabled={hasExplicitQty && itemEntry.quantity >= limits.max}
                                  data-testid={`sandbox-qty-inc-${activeCategoryMeta.id}-${item.id}`}
                                  onClick={() =>
                                    handleQuantityStep(
                                      activeCategoryMeta.id,
                                      item.id,
                                      itemEntry.quantity,
                                      1,
                                      limits
                                    )
                                  }
                                >
                                  +
                                </button>
                                {hasExplicitQty ? (
                                  <button
                                    type="button"
                                    className="lv-sandbox-auto-btn"
                                    title="Reset quantity to procedural Auto"
                                    data-testid={`sandbox-qty-auto-${activeCategoryMeta.id}-${item.id}`}
                                    onClick={() =>
                                      handleQuantityChange(
                                        activeCategoryMeta.id,
                                        item.id,
                                        null
                                      )
                                    }
                                  >
                                    Auto
                                  </button>
                                ) : null}
                              </div>
                              <span className="lv-sandbox-qty-limit">
                                {limits.min}-{limits.max}
                              </span>
                              {isZeroQuantity ? (
                                <span
                                  className="lv-sandbox-qty-zero-badge"
                                  data-testid={`sandbox-qty-zero-${activeCategoryMeta.id}-${item.id}`}
                                >
                                  Disabled (0)
                                </span>
                              ) : null}
                              {manualCount > 0 ? (
                                <span
                                  className="lv-sandbox-manual-badge"
                                  data-testid={`sandbox-manual-count-${activeCategoryMeta.id}-${item.id}`}
                                  style={{
                                    fontSize: '10px',
                                    fontFamily: 'var(--font-mono)',
                                    color: '#fbbf24',
                                    border: '1px solid rgba(251, 191, 36, 0.35)',
                                    background: 'rgba(251, 191, 36, 0.1)',
                                    borderRadius: '4px',
                                    padding: '1px 5px',
                                  }}
                                >
                                  Manual: {manualCount}
                                </span>
                              ) : null}
                            </div>

                            <div className="lv-sandbox-pref-control">
                              <label htmlFor={`pref-${activeCategoryMeta.id}-${item.id}`}>
                                Placement:
                              </label>
                              <select
                                id={`pref-${activeCategoryMeta.id}-${item.id}`}
                                value={itemEntry.placementPreference || 'auto'}
                                data-testid={`sandbox-pref-${activeCategoryMeta.id}-${item.id}`}
                                onChange={(e) =>
                                  handlePreferenceChange(
                                    activeCategoryMeta.id,
                                    item.id,
                                    e.target.value
                                  )
                                }
                              >
                                {supportedPrefs.map((pref) => (
                                  <option key={pref.id} value={pref.id}>
                                    {pref.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </section>

      {/* Dependency / Validation Notices */}
      {statusNotices.length > 0 ? (
        <div
          className="lv-sandbox-alert lv-sandbox-alert--notice"
          role="status"
          data-testid="sandbox-dependency-notices"
        >
          {statusNotices.map((notice, idx) => (
            <span key={idx}>{notice}</span>
          ))}
        </div>
      ) : null}

      {validation.warnings.length > 0 ? (
        <div
          className="lv-sandbox-alert lv-sandbox-alert--warning"
          role="status"
          data-testid="sandbox-validation-warnings"
        >
          {validation.warnings.map((warning, idx) => (
            <span key={idx}>{warning}</span>
          ))}
        </div>
      ) : null}

      {validation.errors.length > 0 ? (
        <div
          className="lv-sandbox-alert lv-sandbox-alert--error"
          role="alert"
          data-testid="sandbox-validation-errors"
        >
          {validation.errors.map((err, idx) => (
            <span key={idx}>{err}</span>
          ))}
        </div>
      ) : null}

      {/* Current Configuration Summary */}
      <section
        className="lv-sandbox-summary"
        aria-label="Current Sandbox Configuration Summary"
        data-testid="sandbox-config-summary"
      >
        <div className="lv-sandbox-summary__header">
          <h3 className="lv-sandbox-summary__title">
            Active Sandbox Configuration
          </h3>
          <span
            className="lv-sandbox-summary__meta"
            data-testid="sandbox-summary-total"
          >
            {summary.totalEnabled} / {summary.totalItems} Enabled · Explicit Spawns:{' '}
            {summary.totalConfiguredSpawnCount} / {summary.globalSpawnLimit} · Manual:{' '}
            {summary.manualPlacementCount || 0} · Exit Gate:{' '}
            {summary.objectivesEnabled ? 'Keycard Locked' : 'Unlocked'}
          </span>
        </div>

        <div className="lv-sandbox-summary__grid">
          {SANDBOX_CATEGORIES.map((cat) => {
            const catSummary = summary.byCategory[cat.id]
            return (
              <div
                key={cat.id}
                className="lv-sandbox-summary__stat"
                data-testid={`sandbox-summary-${cat.id}`}
              >
                <span className="lv-sandbox-summary__stat-label">
                  {cat.shortLabel}
                </span>
                <span className="lv-sandbox-summary__stat-value">
                  {catSummary.enabledCount} / {catSummary.totalCount}
                </span>
                <span className="lv-sandbox-summary__stat-sub">
                  {catSummary.customQuantityCount} qty ({catSummary.explicitSpawnTotal}{' '}
                  spawns) · {catSummary.manualSpawnTotal || 0} manual
                </span>
              </div>
            )
          })}
        </div>

        <div className="lv-sandbox-footer">
          <div className="lv-sandbox-footer__left">
            <Button
              variant="secondary"
              size="md"
              onClick={handleResetConfiguration}
              data-testid="sandbox-reset-btn"
            >
              Reset Configuration
            </Button>
            {typeof onBack === 'function' ? (
              <Button
                variant="ghost"
                size="md"
                onClick={onBack}
                data-testid="sandbox-footer-back-btn"
              >
                Back to Main Menu
              </Button>
            ) : null}
          </div>
          <div className="lv-sandbox-footer__right">
            <Button
              variant="primary"
              size="lg"
              disabled={!validation.valid}
              onClick={handleStartTest}
              data-testid="sandbox-start-test-btn"
            >
              Start Test Level
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
