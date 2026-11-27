import { useCallback, useEffect, useState } from 'react'
import Button from '../common/Button'
import Modal from '../common/Modal.jsx'
import SettingsView from '../settings/SettingsView.jsx'
import DeveloperSandboxView from '../sandbox/DeveloperSandboxView.jsx'
import AboutContent from './AboutContent.jsx'
import HowToPlayContent from './HowToPlayContent.jsx'
import bgImage from '../../assets/images/start_screen_background_1795627907701.jpg'
import { authenticateDeveloperCode } from '../../game/sandbox/sandboxAccess.js'

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
  'dev-sandbox': {
    pageTestId: 'start-dev-sandbox-view',
    title: 'DEVELOPER SANDBOX',
    subtitle: 'Isolated Test Level Configuration & System Controls',
    headerBackTestId: 'dev-sandbox-header-back-btn',
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
  developerAccess = false,
  onDeveloperUnlocked = null,
  sandboxConfig = null,
  onSandboxConfigChange = null,
  onResetSandboxConfig = null,
  onStartSandboxTest = null,
  onSandboxViewChange = null,
  initialShowManualEditor = false,
  initialFocusCoord = null,
  onConsumeManualFocus = null,
}) {
  const [activeView, setActiveView] = useState(() => {
    if (initialShowSettings) return 'settings'
    if (initialView === 'dev-sandbox' && !developerAccess) return 'menu'
    return initialView
  })

  // Secret activation gesture state (7 clicks on title)
  const [titleClickCount, setTitleClickCount] = useState(0)
  const [titleClickTimer, setTitleClickTimer] = useState(null)
  const [isDevAccessModalOpen, setIsDevAccessModalOpen] = useState(false)
  const [devCodeInput, setDevCodeInput] = useState('')
  const [showDevCode, setShowDevCode] = useState(false)
  const [devAccessError, setDevAccessError] = useState('')
  const [devAccessSuccess, setDevAccessSuccess] = useState('')

  const navigateView = useCallback(
    (nextView) => {
      if (nextView === 'dev-sandbox' && !developerAccess) {
        return
      }
      setActiveView(nextView)
      onSandboxViewChange?.(nextView === 'dev-sandbox')
    },
    [developerAccess, onSandboxViewChange]
  )

  const effectiveView =
    activeView === 'dev-sandbox' && !developerAccess ? 'menu' : activeView

  useEffect(() => {
    if (effectiveView === 'menu' || typeof window === 'undefined') {
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
      navigateView('menu')
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [effectiveView, navigateView])

  const handleTitleClick = () => {
    if (developerAccess) return
    const nextCount = titleClickCount + 1
    setTitleClickCount(nextCount)

    if (titleClickTimer) {
      clearTimeout(titleClickTimer)
    }

    if (nextCount >= 7) {
      setTitleClickCount(0)
      setIsDevAccessModalOpen(true)
      setDevCodeInput('')
      setDevAccessError('')
      setDevAccessSuccess('')
      return
    }

    const timer = setTimeout(() => {
      setTitleClickCount(0)
    }, 3500)
    setTitleClickTimer(timer)
  }

  const handleAuthenticateDevCode = (e) => {
    e?.preventDefault()
    if (!devCodeInput.trim()) {
      setDevAccessError('Please enter the developer access code.')
      return
    }
    const success = authenticateDeveloperCode(devCodeInput)
    if (success) {
      setDevAccessSuccess('Authorization granted. Developer Sandbox unlocked!')
      setDevAccessError('')
      onDeveloperUnlocked?.()
      setTimeout(() => {
        setIsDevAccessModalOpen(false)
        navigateView('dev-sandbox')
      }, 700)
    } else {
      setDevAccessError('Invalid access code. Authorization denied.')
      setDevAccessSuccess('')
    }
  }

  const pageMeta = START_PAGE_META[effectiveView] || null
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
                onClick={() => navigateView('menu')}
                data-testid={pageMeta.headerBackTestId}
              >
                Back
              </Button>
            </header>

            <div className="lv-start-page__body">
              {effectiveView === 'settings' ? (
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
                  onBack={() => navigateView('menu')}
                  showHeader={false}
                  showFooterBack={false}
                  isEmbedded={true}
                />
              ) : effectiveView === 'dev-sandbox' && developerAccess ? (
                <DeveloperSandboxView
                  sandboxConfig={sandboxConfig}
                  onChangeConfig={onSandboxConfigChange}
                  onResetConfig={onResetSandboxConfig}
                  onStartTestLevel={onStartSandboxTest}
                  onBack={() => navigateView('menu')}
                  initialShowManualEditor={initialShowManualEditor}
                  initialFocusCoord={initialFocusCoord}
                  onConsumeInitialFocus={onConsumeManualFocus}
                />
              ) : (
                <div
                  className="lv-start-page__content"
                  data-testid={
                    effectiveView === 'how-to-play'
                      ? 'how-to-play-scroll-container'
                      : 'about-scroll-container'
                  }
                >
                  {effectiveView === 'how-to-play' ? (
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
            <h1
              className="lv-start-title"
              onClick={handleTitleClick}
              style={{ cursor: developerAccess ? 'default' : 'pointer' }}
              title={developerAccess ? 'Developer Access Active' : 'Click 7 times for Developer Access'}
              data-testid="start-title-secret"
            >
              MAZE ESCAPE
            </h1>
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
              onClick={() => navigateView('settings')}
              data-testid="start-settings-btn"
            >
              Settings
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => navigateView('how-to-play')}
              data-testid="start-how-to-play-btn"
            >
              How to Play
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => navigateView('about')}
              data-testid="start-about-btn"
            >
              About / Credits
            </Button>
            {developerAccess ? (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => navigateView('dev-sandbox')}
                data-testid="start-dev-sandbox-btn"
              >
                Developer Sandbox
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {/* Secret Developer Access Modal */}
      <Modal
        isOpen={isDevAccessModalOpen}
        onClose={() => setIsDevAccessModalOpen(false)}
        title="DEVELOPER ACCESS"
        subtitle="Facility Override Authorization"
        size="sm"
      >
        <form onSubmit={handleAuthenticateDevCode} className="lv-dev-auth-form" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', lineHeight: '1.5', margin: 0 }}>
            Enter the facility security authorization code to unlock the Developer Testing Sandbox.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label htmlFor="dev-auth-code-input" style={{ fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#cbd5e1' }}>
              Security Access Code
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="dev-auth-code-input"
                type={showDevCode ? 'text' : 'password'}
                value={devCodeInput}
                onChange={(e) => setDevCodeInput(e.target.value)}
                placeholder="Enter access code (e.g. MAZE-DEV-2026)"
                autoFocus
                data-testid="dev-auth-code-input"
                style={{
                  width: '100vw',
                  maxWidth: '100%',
                  background: '#090d16',
                  border: '1px solid #1e293b',
                  borderRadius: '6px',
                  color: '#f8fafc',
                  padding: '0.625rem 2.75rem 0.625rem 0.75rem',
                  fontSize: '0.9375rem',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowDevCode(!showDevCode)}
                aria-label={showDevCode ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: '0.5rem',
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {showDevCode ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {devAccessError ? (
            <div
              data-testid="dev-auth-error"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                color: '#fca5a5',
                padding: '0.5rem 0.75rem',
                fontSize: '0.8125rem',
              }}
            >
              {devAccessError}
            </div>
          ) : null}

          {devAccessSuccess ? (
            <div
              data-testid="dev-auth-success"
              style={{
                background: 'rgba(34, 197, 94, 0.12)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: '6px',
                color: '#86efac',
                padding: '0.5rem 0.75rem',
                fontSize: '0.8125rem',
              }}
            >
              {devAccessSuccess}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsDevAccessModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              data-testid="dev-auth-submit-btn"
            >
              Authorize
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
