import { useEffect, useState } from 'react'
import Button from '../common/Button'
import SettingsView from '../settings/SettingsView.jsx'
import { AboutContent } from './AboutModal.jsx'
import { HowToPlayContent } from './HowToPlayModal.jsx'
import bgImage from '../../assets/images/start_screen_background_1795627907701.jpg'

export default function StartScreen({
  onStartGame,
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
  initialView = 'menu',
}) {
  const [activeView, setActiveView] = useState(
    initialShowSettings ? 'settings' : initialView
  )

  useEffect(() => {
    if (activeView === 'menu' || typeof window === 'undefined') {
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
      setActiveView('menu')
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeView])

  const isSubView = activeView !== 'menu'
  const regionLabel =
    activeView === 'settings'
      ? 'Settings'
      : activeView === 'how-to-play'
        ? 'How to Play'
        : activeView === 'about'
          ? 'About / Credits'
          : 'Main Menu'

  return (
    <div
      className={[
        'lv-start-screen',
        isSubView ? 'lv-start-screen--settings' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="region"
      aria-label={regionLabel}
      style={{
        backgroundImage: `linear-gradient(rgba(5, 7, 11, 0.76), rgba(5, 7, 11, 0.90)), url(${bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="lv-start-backdrop" aria-hidden="true" />

      {activeView === 'settings' ? (
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
            onBack={() => setActiveView('menu')}
            showHeader={true}
            isEmbedded={true}
          />
        </div>
      ) : activeView === 'how-to-play' || activeView === 'about' ? (
        <div
          className="lv-start-settings-panel lv-start-settings-panel--info"
          data-testid={
            activeView === 'how-to-play'
              ? 'start-how-to-play-view'
              : 'start-about-view'
          }
        >
          <div className="lv-settings-view lv-settings-view--embedded">
            <div className="lv-start-settings-header">
              <div>
                <h2 className="lv-start-settings-title">
                  {activeView === 'how-to-play' ? 'HOW TO PLAY' : 'ABOUT / CREDITS'}
                </h2>
                <p className="lv-start-settings-subtitle">
                  {activeView === 'how-to-play'
                    ? 'Surviving the Abandoned Underground Facility'
                    : 'Maze Escape — Abandoned Underground Facility'}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setActiveView('menu')}
                data-testid={
                  activeView === 'how-to-play'
                    ? 'how-to-play-header-back-btn'
                    : 'about-header-back-btn'
                }
              >
                Back
              </Button>
            </div>

            <div
              className="lv-settings-content"
              data-testid={
                activeView === 'how-to-play'
                  ? 'how-to-play-scroll-container'
                  : 'about-scroll-container'
              }
            >
              {activeView === 'how-to-play' ? (
                <HowToPlayContent />
              ) : (
                <AboutContent />
              )}
            </div>

            <div className="lv-settings-footer-wrapper">
              <div className="lv-start-info-footer">
                <Button
                  variant="primary"
                  onClick={() => setActiveView('menu')}
                  data-testid={
                    activeView === 'how-to-play'
                      ? 'how-to-play-back-btn'
                      : 'about-back-btn'
                  }
                >
                  Back
                </Button>
              </div>
            </div>
          </div>
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
              onClick={() => setActiveView('settings')}
              data-testid="start-settings-btn"
            >
              Settings
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setActiveView('how-to-play')}
              data-testid="start-how-to-play-btn"
            >
              How to Play
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setActiveView('about')}
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
