function GameShell({
  highContrast = false,
  reducedMotion = false,
  layout = 'scroll',
  className = '',
  children,
}) {
  const shellClasses = [
    'game-shell',
    layout === 'viewport' ? 'game-shell--viewport' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={shellClasses}
      data-high-contrast={highContrast ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      <div className="game-shell__ambient" aria-hidden="true" />
      <div className="game-shell__inner">{children}</div>
    </div>
  )
}

export default GameShell
