function GameShell({
  highContrast = false,
  reducedMotion = false,
  className = '',
  children,
}) {
  return (
    <div
      className={`game-shell ${className}`.trim()}
      data-high-contrast={highContrast ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      <div className="game-shell__ambient" aria-hidden="true" />
      <div className="game-shell__inner">{children}</div>
    </div>
  )
}

export default GameShell
