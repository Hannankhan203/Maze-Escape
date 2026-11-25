import { useEffect, useId, useState } from 'react'
import {
  DEFAULT_KEY_BINDINGS,
  KEY_BINDING_ACTION_LABELS,
  MODIFIER_ONLY_TOKENS,
  RESERVED_FIXED_KEY_TOKENS,
  applyKeyBindingChange,
  formatKeyTokenLabel,
  normalizeBindingKeyToken,
  normalizeKeyBindings,
  resolveInputKeyToken,
} from '../../game/three/threeConfig.js'
import Button from '../common/Button'
import ToggleSwitch from '../common/ToggleSwitch'
import { SETTINGS_CATEGORIES } from './settingsConfig.js'
import { useSettingsViewController } from './useSettingsViewController.js'

function CategoryIcon({ id }) {
  if (id === 'audio') {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="lv-settings-tab__icon"
      >
        <path
          d="M3 7.5h3.5L11 4v12l-4.5-3.5H3v-5Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 6.5a5 5 0 0 1 0 7M16.5 4a8.5 8.5 0 0 1 0 12"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (id === 'controls') {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="lv-settings-tab__icon"
      >
        <rect
          x="2.5"
          y="4.5"
          width="15"
          height="11"
          rx="3.5"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <path
          d="M6.5 10h4M8.5 8v4M13.5 9h.01M15 11h.01"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (id === 'graphics') {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="lv-settings-tab__icon"
      >
        <rect
          x="2.5"
          y="3.5"
          width="15"
          height="10"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <path
          d="M7 16.5h6M10 13.5v3"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="lv-settings-tab__icon"
    >
      <circle
        cx="10"
        cy="10"
        r="6.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M10 6.5v4l2.5 1.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="1" fill="currentColor" />
    </svg>
  )
}

function SettingSlider({ item, value, onChange }) {
  const inputId = useId()
  const displayVal = typeof value === 'number' ? value : item.defaultValue

  return (
    <div className="lv-setting-row">
      <div className="lv-setting-row__copy">
        <label htmlFor={inputId} className="lv-setting-row__label">
          {item.label}
        </label>
        {item.description ? (
          <span className="lv-setting-row__description">
            {item.description}
          </span>
        ) : null}
      </div>
      <div className="lv-setting-row__control">
        <div className="lv-setting-slider">
          <input
            id={inputId}
            type="range"
            min={item.min}
            max={item.max}
            step={item.step}
            value={displayVal}
            aria-label={`${item.label} slider`}
            className="lv-setting-slider__input"
            onChange={(e) => onChange(item.id, Number(e.target.value))}
          />
          <span className="lv-setting-slider__value" aria-live="polite">
            {displayVal}
            {item.unit || ''}
          </span>
        </div>
      </div>
    </div>
  )
}

function SettingSegmented({ item, value, onChange }) {
  const currentVal = value ?? item.defaultValue

  return (
    <div className="lv-setting-row">
      <div className="lv-setting-row__copy">
        <span className="lv-setting-row__label">{item.label}</span>
        {item.description ? (
          <span className="lv-setting-row__description">
            {item.description}
          </span>
        ) : null}
      </div>
      <div className="lv-setting-row__control">
        <div
          className="lv-setting-segmented"
          role="group"
          aria-label={item.label}
        >
          {item.options.map((option) => {
            const isSelected = currentVal === option.value
            return (
              <button
                key={option.value}
                type="button"
                className="lv-setting-segmented__btn"
                aria-pressed={isSelected}
                onClick={() => onChange(item.id, option.value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function groupBindingsByCategory(bindings = []) {
  const categoryOrder = []
  const grouped = new Map()
  for (const binding of bindings) {
    const category = binding.category || 'General'
    if (!grouped.has(category)) {
      grouped.set(category, [])
      categoryOrder.push(category)
    }
    grouped.get(category).push(binding)
  }
  return categoryOrder.map((category) => ({
    title: category,
    bindings: grouped.get(category),
  }))
}

function SettingKeybinds({ item, keyBindings = null, onChange = null }) {
  const [listeningActionId, setListeningActionId] = useState(null)
  const [keybindError, setKeybindError] = useState('')
  const [pendingConflict, setPendingConflict] = useState(null)
  const [isConfirmingKeyReset, setIsConfirmingKeyReset] = useState(false)
  const normalizedBindings = normalizeKeyBindings(keyBindings)
  const bindingsList = item.bindings || []
  const bindingSections = groupBindingsByCategory(bindingsList)

  const hasCustomBindings = bindingsList.some((binding) => {
    const defaultToken = binding.defaultKey || DEFAULT_KEY_BINDINGS[binding.id]
    return defaultToken && normalizedBindings[binding.id] !== defaultToken
  })

  useEffect(() => {
    if (!listeningActionId || typeof window === 'undefined') {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (!event || event.repeat) return
      const rawToken = resolveInputKeyToken(event)
      if (!rawToken) return

      event.preventDefault?.()
      event.stopPropagation?.()

      const normalizedToken = normalizeBindingKeyToken(rawToken)

      if (
        event.key === 'Escape' ||
        normalizedToken === 'escape' ||
        normalizedToken === 'esc'
      ) {
        setListeningActionId(null)
        setPendingConflict(null)
        setKeybindError('')
        return
      }

      if (MODIFIER_ONLY_TOKENS.has(normalizedToken) || MODIFIER_ONLY_TOKENS.has(rawToken)) {
        setPendingConflict(null)
        setKeybindError(
          'Modifier keys (Ctrl, Alt, Meta) cannot be bound. Press a standard key or Escape to cancel.'
        )
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        setPendingConflict(null)
        setKeybindError(
          'Single keys only — shortcuts with Ctrl, Alt, or Meta cannot be bound.'
        )
        return
      }

      if (normalizedToken === 'c') {
        setPendingConflict(null)
        setKeybindError(
          'The "C" key is permanently reserved for perspective camera switching.'
        )
        return
      }

      if (RESERVED_FIXED_KEY_TOKENS.has(normalizedToken)) {
        setPendingConflict(null)
        setKeybindError(
          `The "${formatKeyTokenLabel(normalizedToken) || normalizedToken}" key is reserved by the browser or system and cannot be bound.`
        )
        return
      }

      const targetAction = listeningActionId
      const targetActionLabel =
        KEY_BINDING_ACTION_LABELS[targetAction] || targetAction
      const currentToken = normalizedBindings[targetAction]

      if (normalizedToken === currentToken) {
        setListeningActionId(null)
        setPendingConflict(null)
        setKeybindError('')
        return
      }

      const applyResult = applyKeyBindingChange(
        normalizedBindings,
        targetAction,
        normalizedToken,
        { resolution: 'reject' }
      )

      if (!applyResult.ok) {
        if (applyResult.reason === 'conflict' && applyResult.conflict) {
          const conflictingActionId = applyResult.conflict.actionId
          const conflictingActionLabel =
            applyResult.conflict.actionLabel ||
            KEY_BINDING_ACTION_LABELS[conflictingActionId] ||
            conflictingActionId
          const conflictKeyToken = applyResult.conflict.key || normalizedToken
          setKeybindError('')
          setPendingConflict({
            actionId: targetAction,
            actionLabel: targetActionLabel,
            keyToken: conflictKeyToken,
            keyLabel: formatKeyTokenLabel(conflictKeyToken),
            conflictingActionId,
            conflictingActionLabel,
          })
          return
        }

        setPendingConflict(null)
        setKeybindError(
          'Invalid key selection. Please press a standard keyboard key.'
        )
        return
      }

      setListeningActionId(null)
      setPendingConflict(null)
      setKeybindError('')
      onChange?.('keyBindings', applyResult.bindings)
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [listeningActionId, normalizedBindings, onChange])

  const handleResolveConflictSwap = () => {
    if (!pendingConflict) return
    const result = applyKeyBindingChange(
      normalizedBindings,
      pendingConflict.actionId,
      pendingConflict.keyToken,
      { resolution: 'swap' }
    )
    setListeningActionId(null)
    setPendingConflict(null)
    setKeybindError('')
    if (result.ok) {
      onChange?.('keyBindings', result.bindings)
    }
  }

  const handleResolveConflictCancel = () => {
    setListeningActionId(null)
    setPendingConflict(null)
    setKeybindError('')
  }

  const handleRestoreAllKeys = () => {
    setIsConfirmingKeyReset(false)
    setListeningActionId(null)
    setPendingConflict(null)
    setKeybindError('')
    onChange?.('keyBindings', { ...DEFAULT_KEY_BINDINGS })
  }

  return (
    <div className="lv-setting-row lv-setting-row--keybinds">
      <div className="lv-keybind-header">
        <div className="lv-setting-row__copy">
          <span className="lv-setting-row__label">{item.label}</span>
          {item.description ? (
            <span className="lv-setting-row__description">
              {item.description}
            </span>
          ) : null}
        </div>
        <div className="lv-keybind-header__actions">
          <button
            type="button"
            className="lv-keybind-restore-btn"
            disabled={!hasCustomBindings}
            onClick={() => setIsConfirmingKeyReset(true)}
            data-keybind-restore-defaults="true"
            data-testid="restore-default-keys-btn"
          >
            Restore Default Keys
          </button>
        </div>
      </div>

      {isConfirmingKeyReset ? (
        <div
          className="lv-keybind-reset-confirm"
          role="alertdialog"
          aria-label="Confirm reset key bindings"
          data-keybind-reset-confirm="true"
        >
          <span className="lv-keybind-reset-confirm__text">
            Reset all key bindings back to their original factory defaults?
          </span>
          <div className="lv-keybind-reset-confirm__actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsConfirmingKeyReset(false)}
              data-keybind-cancel-reset="true"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleRestoreAllKeys}
              data-keybind-confirm-reset="true"
            >
              Reset Keys
            </Button>
          </div>
        </div>
      ) : null}

      {keybindError ? (
        <div className="lv-keybind-feedback" role="alert">
          <span className="lv-keybind-feedback__message">{keybindError}</span>
        </div>
      ) : null}

      {pendingConflict ? (
        <div
          className="lv-keybind-feedback"
          role="alertdialog"
          aria-label="Key binding conflict detected"
        >
          <span className="lv-keybind-feedback__message">
            <strong>Key already in use:</strong> &ldquo;{pendingConflict.keyLabel}&rdquo; is currently assigned to <em>{pendingConflict.conflictingActionLabel}</em>.
          </span>
          <div className="lv-keybind-feedback__actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleResolveConflictCancel}
              data-keybind-cancel-conflict="true"
              data-testid="keybind-conflict-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleResolveConflictSwap}
              data-keybind-swap="true"
              data-testid="keybind-conflict-swap"
            >
              Swap Keys
            </Button>
          </div>
        </div>
      ) : null}

      <div className="lv-keybind-sections" aria-label="Key bindings">
        {bindingSections.map((section) => (
          <div key={section.title} className="lv-keybind-section">
            <h4 className="lv-keybind-section__title">{section.title}</h4>
            <div className="lv-keybind-grid">
              {section.bindings.map((binding) => {
                const currentToken = normalizedBindings[binding.id]
                const defaultToken =
                  binding.defaultKey || DEFAULT_KEY_BINDINGS[binding.id]
                const isCustomized =
                  Boolean(defaultToken) && currentToken !== defaultToken
                const isListening = listeningActionId === binding.id

                return (
                  <div
                    key={binding.id}
                    className={[
                      'lv-keybind-item',
                      isListening ? 'lv-keybind-item--listening' : '',
                      isCustomized ? 'lv-keybind-item--customized' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="lv-keybind-item__action">
                      {binding.action}
                    </span>

                    <div className="lv-keybind-item__keys">
                      <button
                        type="button"
                        className={[
                          'lv-keybind-btn',
                          isListening ? 'lv-keybind-btn--listening' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-label={`Key for ${binding.action}: ${formatKeyTokenLabel(currentToken)}. Click to rebind.`}
                        aria-pressed={isListening}
                        data-keybind-action={binding.id}
                        data-keybind-listening={String(isListening)}
                        data-keybind-token={currentToken}
                        onClick={() => {
                          setKeybindError('')
                          setPendingConflict(null)
                          setListeningActionId(isListening ? null : binding.id)
                        }}
                      >
                        {isListening
                          ? 'Press key...'
                          : formatKeyTokenLabel(currentToken)}
                      </button>

                      {isListening ? (
                        <button
                          type="button"
                          className="lv-keybind-reset"
                          data-keybind-cancel={binding.id}
                          aria-label={`Cancel rebinding ${binding.action}`}
                          onClick={() => {
                            setListeningActionId(null)
                            setPendingConflict(null)
                            setKeybindError('')
                          }}
                        >
                          Cancel
                        </button>
                      ) : isCustomized ? (
                        <button
                          type="button"
                          className="lv-keybind-reset"
                          data-keybind-reset-action={binding.id}
                          aria-label={`Reset ${binding.action} to default ${formatKeyTokenLabel(defaultToken)}`}
                          onClick={() => {
                            setListeningActionId(null)
                            setPendingConflict(null)
                            setKeybindError('')
                            const resetResult = applyKeyBindingChange(
                              normalizedBindings,
                              binding.id,
                              defaultToken,
                              { resolution: 'swap' }
                            )
                            if (resetResult.ok) {
                              onChange?.('keyBindings', resetResult.bindings)
                            }
                          }}
                        >
                          Reset
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsTabs({
  activeCategory,
  tabListRef,
  onSelectCategory,
  onTabKeyDown,
}) {
  return (
    <div
      ref={tabListRef}
      role="tablist"
      aria-label="Settings categories"
      className="lv-settings-tabs"
      data-testid="settings-nav"
    >
      {SETTINGS_CATEGORIES.map((cat, idx) => {
        const isSelected = activeCategory === cat.id
        return (
          <button
            key={cat.id}
            id={`settings-tab-${cat.id}`}
            role="tab"
            type="button"
            tabIndex={isSelected ? 0 : -1}
            aria-selected={isSelected}
            aria-controls={`settings-panel-${cat.id}`}
            className="lv-settings-tab"
            onClick={() => onSelectCategory(cat.id)}
            onKeyDown={(e) => onTabKeyDown(e, idx)}
          >
            <CategoryIcon id={cat.id} />
            <span>{cat.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SettingsContent({
  activeCategory,
  activeCategoryMeta,
  currentGroups,
  resolvedValues,
  scrollContainerRef,
  onSettingChange,
}) {
  return (
    <div
      ref={scrollContainerRef}
      className="lv-settings-content"
      data-testid="settings-scroll-container"
    >
      <div
        id={`settings-panel-${activeCategory}`}
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`settings-tab-${activeCategory}`}
        className="lv-settings-panel"
      >
        <div className="lv-settings-panel__header">
          <p className="lv-settings-panel__description">
            {activeCategoryMeta.description}
          </p>
        </div>

        {currentGroups.map((group) => (
          <div key={group.group} className="lv-settings-group">
            <h3 className="lv-settings-group__title">{group.group}</h3>
            <div className="lv-settings-group__items">
              {group.items.map((item) => {
                if (item.type === 'slider') {
                  return (
                    <SettingSlider
                      key={item.id}
                      item={item}
                      value={resolvedValues[item.id]}
                      onChange={onSettingChange}
                    />
                  )
                }

                if (item.type === 'toggle') {
                  return (
                    <ToggleSwitch
                      key={item.id}
                      label={item.label}
                      description={item.description}
                      checked={Boolean(resolvedValues[item.id])}
                      onChange={(checked) => onSettingChange(item.id, checked)}
                    />
                  )
                }

                if (item.type === 'segmented') {
                  return (
                    <SettingSegmented
                      key={item.id}
                      item={item}
                      value={resolvedValues[item.id]}
                      onChange={onSettingChange}
                    />
                  )
                }

                if (item.type === 'keybindTable') {
                  return (
                    <SettingKeybinds
                      key={item.id}
                      item={item}
                      keyBindings={resolvedValues.keyBindings}
                      onChange={onSettingChange}
                    />
                  )
                }

                return null
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsFooter({
  isConfirmingReset,
  onStartReset,
  onCancelReset,
  onConfirmReset,
  onBack,
}) {
  if (isConfirmingReset) {
    return (
      <div
        className="lv-settings-reset-confirm"
        role="alertdialog"
        aria-label="Confirm restore default settings"
      >
        <span className="lv-settings-reset-confirm__text">
          Restore all Audio, Controls, Graphics, and Gameplay settings to defaults?
        </span>
        <div className="lv-settings-reset-confirm__actions">
          <Button variant="secondary" size="sm" onClick={onCancelReset}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirmReset}>
            Confirm Restore
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="lv-settings-footer">
      <Button variant="secondary" onClick={onStartReset}>
        Restore Defaults
      </Button>
      <Button variant="primary" onClick={onBack}>
        Back
      </Button>
    </div>
  )
}

export default function SettingsView({
  initialCategory = 'audio',
  audioSettings = null,
  onAudioSettingChange = null,
  controlSettings = null,
  onControlSettingChange = null,
  graphicsSettings = null,
  onGraphicsSettingChange = null,
  gameplaySettings = null,
  onGameplaySettingChange = null,
  onRestoreDefaults = null,
  onBack = null,
  showHeader = false,
  isEmbedded = false,
  className = '',
}) {
  const controller = useSettingsViewController({
    initialCategory,
    audioSettings,
    onAudioSettingChange,
    controlSettings,
    onControlSettingChange,
    graphicsSettings,
    onGraphicsSettingChange,
    gameplaySettings,
    onGameplaySettingChange,
    onRestoreDefaults,
    onBack,
  })

  return (
    <div
      className={[
        'lv-settings-view',
        isEmbedded ? 'lv-settings-view--embedded' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showHeader ? (
        <div className="lv-start-settings-header">
          <div>
            <h2 className="lv-start-settings-title">SETTINGS</h2>
            <p className="lv-start-settings-subtitle">
              Vault Configuration &amp; Sensory Calibration
            </p>
          </div>
          {onBack ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={controller.handleBack}
              data-testid="settings-header-back-btn"
            >
              Back
            </Button>
          ) : null}
        </div>
      ) : null}

      <SettingsTabs
        activeCategory={controller.activeCategory}
        tabListRef={controller.tabListRef}
        onSelectCategory={controller.handleSelectCategory}
        onTabKeyDown={controller.handleTabKeyDown}
      />

      <SettingsContent
        activeCategory={controller.activeCategory}
        activeCategoryMeta={controller.activeCategoryMeta}
        currentGroups={controller.currentGroups}
        resolvedValues={controller.resolvedValues}
        scrollContainerRef={controller.scrollContainerRef}
        onSettingChange={controller.handleSettingChange}
      />

      <div className="lv-settings-footer-wrapper">
        <SettingsFooter
          isConfirmingReset={controller.isConfirmingReset}
          onStartReset={() => controller.setIsConfirmingReset(true)}
          onCancelReset={() => controller.setIsConfirmingReset(false)}
          onConfirmReset={controller.handleConfirmRestoreDefaults}
          onBack={controller.handleBack}
        />
      </div>
    </div>
  )
}

export { SettingsView }
