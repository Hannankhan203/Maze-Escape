import Button from '../common/Button'
import bgImage from '../../assets/images/start_screen_background_1795627907701.jpg'

export default function StartScreen({
  onStartGame,
  onOpenSettings,
  onOpenHowToPlay,
  onOpenAbout,
}) {
  return (
    <div
      className="lv-start-screen"
      role="region"
      aria-label="Main Menu"
      style={{
        backgroundImage: `linear-gradient(rgba(5, 7, 11, 0.76), rgba(5, 7, 11, 0.90)), url(${bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
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
