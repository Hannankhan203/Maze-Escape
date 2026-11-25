import { useEffect, useState } from 'react'
import Button from '../common/Button'
import SettingsView from '../settings/SettingsView.jsx'
import AboutContent from './AboutContent.jsx'
import HowToPlayContent from './HowToPlayContent.jsx'
import bgImage from '../../assets/images/start_screen_background_1795627907701.jpg'

const START_PAGE_META = {
  settings: {
    pageTestId: 'start-settings-view',
    title: 'SETTINGS',
    subtitle: 'Vault Configuration & Sensory Calibration',
    headerBackTestId: 'settings-header-back-btn',
  },
  'how-to-play': {
    pageTestId: 'start-how-to-play-view',
    title: 'HOW TO PLAY',
    subtitle: 'Surviving the Abandoned Underground Facility',
    headerBackTestId: 'how-to-play-header-back-btn',
  },
  about: {
    pageTestId: 'start-about-view',
    title: 'ABOUT / CREDITS',
    subtitle: 'Maze Escape — Abandoned Underground Facility',
    headerBackTestId: 'about-header-back-btn',
  },
}

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

  const pageMeta = START_PAGE_META[activeView] || null
  const isSubView = Boolean(pageMeta)
  const regionLabel = pageMeta ? pageMeta.title : 'Main Menu'

  return (
    <div
      className={[
        'lv-start-screen',
        isSubView ? 'lv-start-screen--page' : '',
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

      {pageMeta ? (
        <div className="lv-start-page" data-testid={pageMeta.pageTestId}>
          <div className="lv-start-page__inner">
            <header className="lv-start-page__header">
              <div className="lv-start-page__heading">
                <h1 className="lv-start-page__title">{pageMeta.title}</h1>
                <p className="lv-start-page__subtitle">{pageMeta.subtitle}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setActiveView('menu')}
                data-testid={pageMeta.headerBackTestId}
              >
                Back
              </Button>
            </header>

            <div className="lv-start-page__body">
              {activeView === 'settings' ? (
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
                  showHeader={false}
                  showFooterBack={false}
                  isEmbedded={true}
                />
              ) : (
                <div
                  className="lv-start-page__content"
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
              )}
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
