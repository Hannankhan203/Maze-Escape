import Modal from '../common/Modal'
import SettingsView from './SettingsView.jsx'

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
  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      subtitle="Vault Configuration & Sensory Calibration"
      size="lg"
      className="lv-modal--settings"
      footer={null}
    >
      <SettingsView
        initialCategory={initialCategory}
        audioSettings={audioSettings}
        onAudioSettingChange={onAudioSettingChange}
        controlSettings={controlSettings}
        onControlSettingChange={onControlSettingChange}
        graphicsSettings={graphicsSettings}
        onGraphicsSettingChange={onGraphicsSettingChange}
        gameplaySettings={gameplaySettings}
        onGameplaySettingChange={onGameplaySettingChange}
        onRestoreDefaults={onRestoreDefaults}
        onBack={onClose}
        showHeader={false}
      />
    </Modal>
  )
}

export { SettingsView }
