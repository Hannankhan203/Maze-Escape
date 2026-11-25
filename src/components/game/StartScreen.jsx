import { useEffect, useState } from 'react'
import Button from '../common/Button'
import SettingsView from '../settings/SettingsView.jsx'
import bgImage from '../../assets/images/start_screen_background_1795627907701.jpg'

export default function StartScreen({
  onStartGame,
  onOpenHowToPlay,
  onOpenAbout,
  audioSettings = null,
  onAudioSettingChange = null,
  controlSettings = null,
  onControlSettingChange = null,
  graphicsSettings = null,
  onGraphicsSettingChange = null,
  gameplaySettings = null,
  onGameplaySettingChange = null,
  onRestoreDefaults = null,
  initialShowSettings = false,
}) {
  const [showSettings, setShowSettings] = useState(Boolean(initialShowSettings))

  useEffect(() => {
    if (!showSettings || typeof window === 'undefined') {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (
        !event ||
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key !== 'Escape'
      ) {
        return
      }
      setShowSettings(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showSettings])

  return (
    <div
      className={[
        'lv-start-screen',
        showSettings ? 'lv-start-screen--settings' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="region"
      aria-label={showSettings ? 'Settings' : 'Main Menu'}
      style={{
        backgroundImage: `linear-gradient(rgba(5, 7, 11, 0.76), rgba(5, 7, 11, 0.90)), url(${bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="lv-start-backdrop" aria-hidden="true" />

      {showSettings ? (
        <div
          className="lv-start-settings-panel"
          data-testid="start-settings-view"
        >
          <SettingsView
            audioSettings={audioSettings}
            onAudioSettingChange={onAudioSettingChange}
            controlSettings={controlSettings}
            onControlSettingChange={onControlSettingChange}
            graphicsSettings={graphicsSettings}
            onGraphicsSettingChange={onGraphicsSettingChange}
            gameplaySettings={gameplaySettings}
            onGameplaySettingChange={onGameplaySettingChange}
            onRestoreDefaults={onRestoreDefaults}
            onBack={() => setShowSettings(false)}
            showHeader={true}
            isEmbedded={true}
          />
        </div>
      ) : (
        <div className="lv-start-container">
          <div className="lv-start-header">
            <h1 className="lv-start-title">MAZE ESCAPE</h1>
            <p className="lv-start-subtitle">You were never meant to leave.</p>
          </div>

          <div className="lv-start-actions" role="group" aria-label="Main menu options">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={onStartGame}
              data-testid="start-game-btn"
            >
              Start Game
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setShowSettings(true)}
              data-testid="start-settings-btn"
            >
              Settings
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onOpenHowToPlay}
              data-testid="start-how-to-play-btn"
            >
              How to Play
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onOpenAbout}
              data-testid="start-about-btn"
            >
              About / Credits
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
