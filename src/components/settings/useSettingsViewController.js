import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { normalizeKeyBindings } from '../../game/three/threeConfig.js'
import {
  SETTINGS_CATEGORIES,
  SETTINGS_SCHEMA,
  getDefaultSettingsState,
} from './settingsConfig.js'

export function useSettingsViewController({
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
} = {}) {
  const [activeCategory, setActiveCategory] = useState(initialCategory)
  const [settingsState, setSettingsState] = useState(getDefaultSettingsState)
  const [isConfirmingReset, setIsConfirmingReset] = useState(false)
  const tabListRef = useRef(null)
  const scrollContainerRef = useRef(null)
  const previousCategoryRef = useRef(activeCategory)

  const handleSelectCategory = useCallback(
    (nextCategoryId) => {
      if (nextCategoryId === activeCategory) {
        return
      }
      setActiveCategory(nextCategoryId)
    },
    [activeCategory]
  )

  useLayoutEffect(() => {
    if (previousCategoryRef.current === activeCategory) {
      return
    }
    previousCategoryRef.current = activeCategory
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [activeCategory])

  const handleBack = useCallback(() => {
    setIsConfirmingReset(false)
    onBack?.()
  }, [onBack])

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
        [id]: id === 'keyBindings' ? normalizeKeyBindings(val) : val,
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
        if (nextCat.id === activeCategory) {
          return
        }
        handleSelectCategory(nextCat.id)
        const targetBtn = tabListRef.current?.querySelector(
          `#settings-tab-${nextCat.id}`
        )
        targetBtn?.focus()
      }
    },
    [activeCategory, handleSelectCategory]
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

  return {
    activeCategory,
    activeCategoryMeta,
    currentGroups,
    resolvedValues,
    isConfirmingReset,
    setIsConfirmingReset,
    tabListRef,
    scrollContainerRef,
    handleSelectCategory,
    handleTabKeyDown,
    handleSettingChange,
    handleConfirmRestoreDefaults,
    handleBack,
  }
}
