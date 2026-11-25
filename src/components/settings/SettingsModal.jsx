import Modal from '../common/Modal'
import {
  SettingsContent,
  SettingsFooter,
  SettingsTabs,
  SettingsView,
} from './SettingsView.jsx'
import { useSettingsViewController } from './useSettingsViewController.js'

function SettingsModalBody({
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
    onBack: onClose,
  })

  return (
    <Modal
      isOpen={true}
      onClose={controller.handleBack}
      title="Settings"
      subtitle="Vault Configuration & Sensory Calibration"
      size="lg"
      className="lv-modal--settings"
      footer={
        <SettingsFooter
          isConfirmingReset={controller.isConfirmingReset}
          onStartReset={() => controller.setIsConfirmingReset(true)}
          onCancelReset={() => controller.setIsConfirmingReset(false)}
          onConfirmReset={controller.handleConfirmRestoreDefaults}
          onBack={controller.handleBack}
        />
      }
    >
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
    </Modal>
  )
}

export default function SettingsModal(props) {
  if (!props.isOpen) return null
  return <SettingsModalBody {...props} />
}

export { SettingsView }
