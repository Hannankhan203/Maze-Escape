import { useEffect, useState } from 'react'
import Button from '../common/Button'
import SettingsView from '../settings/SettingsView.jsx'
import AboutContent from './AboutContent.jsx'
import HowToPlayContent from './HowToPlayContent.jsx'
import AbilitiesContent from './AbilitiesContent.jsx'
import bgImage from '../../assets/images/start_screen_background_1795627907701.jpg'

const PAUSE_PAGE_META = {
  abilities: {
    pageTestId: 'pause-abilities-view',
    title: 'ABILITIES & COLLECTIBLES',
    subtitle: 'Inventory, Status & Power-Up Capacities',
    headerBackTestId: 'abilities-header-back-btn',
  },
  settings: {
    pageTestId: 'pause-settings-view',
    title: 'SETTINGS',
    subtitle: 'Vault Configuration & Sensory Calibration',
    headerBackTestId: 'settings-header-back-btn',
  },
  'how-to-play': {
    pageTestId: 'pause-how-to-play-view',
    title: 'HOW TO PLAY',
    subtitle: 'Surviving the Abandoned Underground Facility',
    headerBackTestId: 'how-to-play-header-back-btn',
  },
  about: {
    pageTestId: 'pause-about-view',
    title: 'ABOUT / CREDITS',
    subtitle: 'Maze Escape — Abandoned Underground Facility',
    headerBackTestId: 'about-header-back-btn',
  },
}

export default function PauseScreen({
  isOpen,
  onResume,
  onRestart,
  audioSettings = null,
  onAudioSettingChange = null,
  controlSettings = null,
  onControlSettingChange = null,
  graphicsSettings = null,
  onGraphicsSettingChange = null,
  gameplaySettings = null,
  onGameplaySettingChange = null,
  onRestoreDefaults = null,
  shardsCollected = 0,
  totalShards = 0,
  shardBonus = 0,
  keysCollected = 0,
  totalKeys = 0,
  isExitLocked = false,
  objectivesEnabled = false,
  inventory = null,
  activeEffects = null,
  keyBindings = null,
  initialView = 'menu',
  isSandbox = false,
  onReturnToSandbox = null,
  onMainMenu = null,
  onRestartNewSeed = null,
}) {
  const [activeView, setActiveView] = useState(initialView)

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

  if (!isOpen) return null

  const pageMeta = PAUSE_PAGE_META[activeView] || null
  const isSubView = Boolean(pageMeta)
  const regionLabel = pageMeta ? pageMeta.title : 'Game Paused'

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
              ) : activeView === 'abilities' ? (
                <div className="lv-start-page__content" data-testid="abilities-scroll-container">
                  <AbilitiesContent
                    shardsCollected={shardsCollected}
                    totalShards={totalShards}
                    shardBonus={shardBonus}
                    keysCollected={keysCollected}
                    totalKeys={totalKeys}
                    isExitLocked={isExitLocked}
                    objectivesEnabled={objectivesEnabled}
                    inventory={inventory}
                    activeEffects={activeEffects}
                    keyBindings={keyBindings}
                  />
                </div>
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
        <div className="lv-start-container" data-testid="pause-actions">
          <div className="lv-start-header">
            <h1 className="lv-start-title">GAME PAUSED</h1>
            <p className="lv-start-subtitle">Labyrinth Paused</p>
          </div>

          <div className="lv-start-actions" role="group" aria-label="Pause menu actions">
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setActiveView('abilities')}
              data-testid="pause-abilities-btn"
            >
              Abilities
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setActiveView('settings')}
              data-testid="pause-settings-btn"
            >
              Settings
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setActiveView('how-to-play')}
              data-testid="pause-how-to-play-btn"
            >
              How to Play
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setActiveView('about')}
              data-testid="pause-about-btn"
            >
              About / Credits
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onRestart}
              data-testid="pause-restart-btn"
            >
              {isSandbox ? 'Restart (Same Seed)' : 'Restart'}
            </Button>
            {isSandbox && typeof onRestartNewSeed === 'function' ? (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={onRestartNewSeed}
                data-testid="pause-restart-new-seed-btn"
              >
                Restart (New Seed)
              </Button>
            ) : null}
            {isSandbox && typeof onReturnToSandbox === 'function' ? (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={onReturnToSandbox}
                data-testid="pause-return-sandbox-btn"
              >
                Sandbox Config
              </Button>
            ) : null}
            {isSandbox && typeof onMainMenu === 'function' ? (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={onMainMenu}
                data-testid="pause-main-menu-btn"
              >
                Main Menu
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={onResume}
              data-testid="pause-resume-btn"
            >
              Resume
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
