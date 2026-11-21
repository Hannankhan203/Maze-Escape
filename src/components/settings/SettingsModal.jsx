import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  DEFAULT_KEY_BINDINGS,
  formatKeyTokenLabel,
  isValidCustomKeyToken,
  normalizeKeyBindings,
  resolveInputKeyToken,
} from '../../game/three/threeConfig.js'
import Button from '../common/Button'
import Modal from '../common/Modal'
import ToggleSwitch from '../common/ToggleSwitch'
import {
  SETTINGS_CATEGORIES,
  SETTINGS_SCHEMA,
  getDefaultSettingsState,
} from './settingsConfig.js'

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
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.75" />
      <polygon
        points="10,5.5 12,9 14.5,10 12,11 10,14.5 8,11 5.5,10 8,9"
        fill="currentColor"
      />
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

const MODIFIER_ONLY_TOKENS = new Set([
  'shift',
  'shiftleft',
  'shiftright',
  'control',
  'ctrl',
  'alt',
  'meta',
  'os',
  'super',
])

function SettingKeybinds({ item, keyBindings = null, onChange = null }) {
  const [listeningActionId, setListeningActionId] = useState(null)
  const [keybindError, setKeybindError] = useState('')
  const normalizedBindings = normalizeKeyBindings(keyBindings)

  useEffect(() => {
    if (!listeningActionId || typeof window === 'undefined') {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (!event || event.repeat) return
      const rawToken = resolveInputKeyToken(event)
      if (!rawToken) return

      if (MODIFIER_ONLY_TOKENS.has(rawToken)) {
        event.preventDefault?.()
        return
      }

      event.preventDefault?.()
      event.stopPropagation?.()

      if (event.key === 'Escape' || rawToken === 'escape' || rawToken === 'esc') {
        setListeningActionId(null)
        setKeybindError('')
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        setKeybindError('Choose a single key without Ctrl, Alt, or Meta.')
        return
      }

      if (!isValidCustomKeyToken(rawToken)) {
        setKeybindError(
          `Key "${formatKeyTokenLabel(rawToken)}" is reserved for another control. Choose another key.`
        )
        return
      }

      const nextBindings = {
        ...normalizedBindings,
        [listeningActionId]: rawToken,
      }
      setListeningActionId(null)
      setKeybindError('')
      onChange?.('keyBindings', nextBindings)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [listeningActionId, normalizedBindings, onChange])

  return (
    <div className="lv-setting-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div className="lv-setting-row__copy">
        <span className="lv-setting-row__label">{item.label}</span>
        {item.description ? (
          <span className="lv-setting-row__description">
            {item.description}
          </span>
        ) : null}
      </div>
      <div className="lv-keybind-grid" role="list" aria-label="Key bindings reference">
        {item.bindings.map((binding) => {
          if (binding.customizable && binding.id) {
            const defaultToken =
              binding.defaultKey || DEFAULT_KEY_BINDINGS[binding.id] || 'c'
            const currentToken = normalizedBindings[binding.id] || defaultToken
            const currentLabel = formatKeyTokenLabel(currentToken)
            const isListening = listeningActionId === binding.id
            const isCustomized = currentToken !== defaultToken

            return (
              <div key={binding.action} className="lv-keybind-item" role="listitem">
                <span className="lv-keybind-item__action">{binding.action}</span>
                <div className="lv-keybind-item__keys">
                  <button
                    type="button"
                    className={[
                      'lv-keybind-btn',
                      isListening ? 'lv-keybind-btn--listening' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    data-keybind-action={binding.id}
                    data-keybind-listening={String(isListening)}
                    aria-pressed={isListening}
                    aria-label={
                      isListening
                        ? `Press a key for ${binding.action}, or Escape to cancel`
                        : `Rebind ${binding.action}, current key ${currentLabel}`
                    }
                    onClick={() => {
                      setKeybindError('')
                      setListeningActionId((prev) =>
                        prev === binding.id ? null : binding.id
                      )
                    }}
                  >
                    {isListening ? 'Press key...' : currentLabel}
                  </button>
                  {isCustomized && !isListening ? (
                    <button
                      type="button"
                      className="lv-keybind-reset"
                      aria-label={`Reset ${binding.action} to default ${formatKeyTokenLabel(defaultToken)}`}
                      onClick={() => {
                        setKeybindError('')
                        onChange?.('keyBindings', {
                          ...normalizedBindings,
                          [binding.id]: defaultToken,
                        })
                      }}
                    >
                      Reset
                    </button>
                  ) : null}
                </div>
              </div>
            )
          }

          return (
            <div key={binding.action} className="lv-keybind-item" role="listitem">
              <span className="lv-keybind-item__action">{binding.action}</span>
              <div className="lv-keybind-item__keys">
                {binding.keys.map((k) => (
                  <kbd key={k} className="lv-keybind-badge">
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {keybindError ? (
        <p className="lv-keybind-feedback" role="alert">
          {keybindError}
        </p>
      ) : null}
    </div>
  )
}

export default function SettingsModal({
  isOpen,
  onClose,
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
}) {
  const [activeCategory, setActiveCategory] = useState(initialCategory)
  const [settingsState, setSettingsState] = useState(getDefaultSettingsState)
  const [isConfirmingReset, setIsConfirmingReset] = useState(false)
  const tabListRef = useRef(null)

  const handleClose = useCallback(() => {
    setIsConfirmingReset(false)
    onClose?.()
  }, [onClose])

  const handleConfirmRestoreDefaults = useCallback(() => {
    setIsConfirmingReset(false)
    if (typeof onRestoreDefaults === 'function') {
      onRestoreDefaults()
    }
    setSettingsState(getDefaultSettingsState())
  }, [onRestoreDefaults])

  const handleSettingChange = useCallback(
    (id, val) => {
      if (activeCategory === 'audio' && typeof onAudioSettingChange === 'function') {
        onAudioSettingChange(id, val)
        return
      }
      if (activeCategory === 'controls' && typeof onControlSettingChange === 'function') {
        onControlSettingChange(id, val)
        return
      }
      if (activeCategory === 'graphics' && typeof onGraphicsSettingChange === 'function') {
        onGraphicsSettingChange(id, val)
        return
      }
      if (activeCategory === 'gameplay' && typeof onGameplaySettingChange === 'function') {
        onGameplaySettingChange(id, val)
        return
      }
      setSettingsState((prev) => ({
        ...prev,
        [id]: val,
      }))
    },
    [
      activeCategory,
      onAudioSettingChange,
      onControlSettingChange,
      onGraphicsSettingChange,
      onGameplaySettingChange,
    ]
  )

  const handleTabKeyDown = useCallback(
    (event, currentIndex) => {
      const tabs = SETTINGS_CATEGORIES
      let nextIndex = null

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        nextIndex = (currentIndex + 1) % tabs.length
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
      } else if (event.key === 'Home') {
        event.preventDefault()
        nextIndex = 0
      } else if (event.key === 'End') {
        event.preventDefault()
        nextIndex = tabs.length - 1
      }

      if (nextIndex !== null) {
        const nextCat = tabs[nextIndex]
        setActiveCategory(nextCat.id)
        const targetBtn = tabListRef.current?.querySelector(
          `#settings-tab-${nextCat.id}`
        )
        targetBtn?.focus()
      }
    },
    []
  )

  const activeCategoryMeta =
    SETTINGS_CATEGORIES.find((cat) => cat.id === activeCategory) ||
    SETTINGS_CATEGORIES[0]

  const currentGroups = SETTINGS_SCHEMA[activeCategory] || []
  const resolvedValues =
    activeCategory === 'audio' && audioSettings
      ? { ...settingsState, ...audioSettings }
      : activeCategory === 'controls' && controlSettings
        ? { ...settingsState, ...controlSettings }
        : activeCategory === 'graphics' && graphicsSettings
          ? { ...settingsState, ...graphicsSettings }
          : activeCategory === 'gameplay' && gameplaySettings
            ? { ...settingsState, ...gameplaySettings }
            : settingsState

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Settings"
      subtitle="Vault Configuration & Sensory Calibration"
      size="lg"
      className="lv-modal--settings"
      footer={
        isConfirmingReset ? (
          <div
            className="lv-settings-reset-confirm"
            role="alertdialog"
            aria-label="Confirm restore default settings"
          >
            <span className="lv-settings-reset-confirm__text">
              Restore all Audio, Controls, Graphics, and Gameplay settings to defaults?
            </span>
            <div className="lv-settings-reset-confirm__actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsConfirmingReset(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmRestoreDefaults}
              >
                Confirm Restore
              </Button>
            </div>
          </div>
        ) : (
          <div className="lv-settings-footer">
            <Button
              variant="secondary"
              onClick={() => setIsConfirmingReset(true)}
            >
              Restore Defaults
            </Button>
            <Button variant="primary" onClick={handleClose}>
              Back
            </Button>
          </div>
        )
      }
    >
      {/* Category Tab Bar */}
      <div
        ref={tabListRef}
        role="tablist"
        aria-label="Settings categories"
        className="lv-settings-tabs"
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
              onClick={() => setActiveCategory(cat.id)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
            >
              <CategoryIcon id={cat.id} />
              <span>{cat.label}</span>
            </button>
          )
        })}
      </div>

      {/* Active Tab Panel */}
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
                      onChange={handleSettingChange}
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
                      onChange={(checked) =>
                        handleSettingChange(item.id, checked)
                      }
                    />
                  )
                }

                if (item.type === 'segmented') {
                  return (
                    <SettingSegmented
                      key={item.id}
                      item={item}
                      value={resolvedValues[item.id]}
                      onChange={handleSettingChange}
                    />
                  )
                }

                if (item.type === 'keybindTable') {
                  return (
                    <SettingKeybinds
                      key={item.id}
                      item={item}
                      keyBindings={resolvedValues.keyBindings}
                      onChange={handleSettingChange}
                    />
                  )
                }

                return null
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
