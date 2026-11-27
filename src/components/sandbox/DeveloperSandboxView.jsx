import { useState } from 'react'
import Button from '../common/Button.jsx'
import ToggleSwitch from '../common/ToggleSwitch.jsx'
import {
  PLACEMENT_PREFERENCES,
  QUANTITY_INELIGIBLE_ENVIRONMENTAL_TYPES,
  SANDBOX_CATEGORIES,
  SANDBOX_CATEGORY_IDS,
  SANDBOX_PRESETS,
  applySandboxPreset,
  createDefaultSandboxConfig,
  getSandboxConfigSummary,
  isItemQuantityEligible,
  isSandboxItemEnabled,
  resetSandboxConfig,
  setCategoryAllEnabled,
  setItemQuantity,
  setItemPlacementPreference,
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

export default function DeveloperSandboxView({
  sandboxConfig = null,
  onChangeConfig = null,
  onResetConfig = null,
  onStartTestLevel = null,
  onBack = null,
  initialCategory = SANDBOX_CATEGORY_IDS.HAZARDS,
}) {
  const [internalConfig, setInternalConfig] = useState(() =>
    createDefaultSandboxConfig()
  )
  const [activeCategory, setActiveCategory] = useState(() => {
    const valid = SANDBOX_CATEGORIES.some((c) => c.id === initialCategory)
    return valid ? initialCategory : SANDBOX_CATEGORY_IDS.HAZARDS
  })
  const [statusNotices, setStatusNotices] = useState([])

  const effectiveConfig = sandboxConfig || internalConfig
  const validation = validateSandboxConfig(effectiveConfig)
  const normalizedConfig = validation.config
  const summary = getSandboxConfigSummary(normalizedConfig)

  const activeCategoryMeta =
    SANDBOX_CATEGORIES.find((cat) => cat.id === activeCategory) ||
    SANDBOX_CATEGORIES[0]
  const activeSummary = summary.byCategory[activeCategoryMeta.id]
  const itemGroups = groupItemsBySubGroup(activeCategoryMeta.items)

  const commitConfigResult = (result) => {
    if (!sandboxConfig) {
      setInternalConfig(result.config)
    }
    setStatusNotices(result.notices || [])
    onChangeConfig?.(result.config, result.notices || [])
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
      rawVal === '' ? null : Number(rawVal)
    )
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
    if (typeof onResetConfig === 'function') {
      onResetConfig(result.config)
    } else {
      onChangeConfig?.(result.config, [])
    }
  }

  const handleStartTest = () => {
    if (!validation.valid) return
    onStartTestLevel?.(normalizedConfig)
  }

  const handleApplyPreset = (presetId) => {
    const result = applySandboxPreset(normalizedConfig, presetId)
    commitConfigResult(result)
  }

  return (
    <div className="lv-sandbox-view" data-testid="developer-sandbox-view">
      {/* Quick Presets Bar */}
      <div className="lv-sandbox-presets-bar" data-testid="sandbox-presets-bar">
        <span className="lv-sandbox-presets-label">Testing Presets:</span>
        <div className="lv-sandbox-presets-buttons">
          {SANDBOX_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="lv-sandbox-preset-btn"
              data-testid={`sandbox-preset-${preset.id}`}
              title={preset.description}
              onClick={() => handleApplyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
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
              {activeCategoryMeta.description}
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
                      {enabled ? (() => {
                        const isEligible = isItemQuantityEligible(
                          activeCategoryMeta.id,
                          item.id
                        )
                        const itemEntry =
                          normalizedConfig?.categories?.[activeCategoryMeta.id]?.items?.[
                            item.id
                          ] || {}

                        if (!isEligible) {
                          const reason =
                            QUANTITY_INELIGIBLE_ENVIRONMENTAL_TYPES[item.id] ||
                            'Fixed architectural layer'
                          return (
                            <div
                              className="lv-sandbox-item-ineligible-note"
                              data-testid={`sandbox-ineligible-${activeCategoryMeta.id}-${item.id}`}
                            >
                              <span className="lv-sandbox-ineligible-tag">Fixed System</span>
                              <span className="lv-sandbox-ineligible-desc">{reason}</span>
                            </div>
                          )
                        }

                        return (
                          <div
                            className="lv-sandbox-item-controls"
                            data-testid={`sandbox-controls-${activeCategoryMeta.id}-${item.id}`}
                          >
                            <div className="lv-sandbox-qty-control">
                              <label htmlFor={`qty-${item.id}`}>Qty:</label>
                              <input
                                id={`qty-${item.id}`}
                                type="number"
                                min="0"
                                max="20"
                                value={
                                  itemEntry.quantity !== null &&
                                  itemEntry.quantity !== undefined
                                    ? itemEntry.quantity
                                    : ''
                                }
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
                            </div>
                            <div className="lv-sandbox-pref-control">
                              <label htmlFor={`pref-${item.id}`}>Placement:</label>
                              <select
                                id={`pref-${item.id}`}
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
                                {PLACEMENT_PREFERENCES.map((pref) => (
                                  <option key={pref.id} value={pref.id}>
                                    {pref.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )
                      })() : null}
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
            {summary.totalEnabled} / {summary.totalItems} Enabled · Exit Gate:{' '}
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
