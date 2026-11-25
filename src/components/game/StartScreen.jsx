import Button from '../common/Button'

export default function StartScreen({
  onStartGame,
  onOpenSettings,
  onOpenHowToPlay,
  onOpenAbout,
}) {
  return (
    <div className="lv-start-screen" role="region" aria-label="Main Menu">
      <div className="lv-start-backdrop" aria-hidden="true" />
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
            onClick={onOpenSettings}
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
    </div>
  )
}
