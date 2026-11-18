function Player({
  position,
  rows,
  cols,
  direction = 'down',
  blockedBump = null,
  hasWon = false,
  wallPassArmed = false,
  magnetActive = false,
}) {
  if (!position || !rows || !cols) return null

  const bumpClass = blockedBump?.direction
    ? `maze-player-spark--bump-${blockedBump.direction}`
    : ''

  return (
    <div
      className="maze-player-slot"
      style={{
        width: `${100 / cols}%`,
        height: `${100 / rows}%`,
        transform: `translate3d(${position.col * 100}%, ${position.row * 100}%, 0)`,
      }}
    >
      <div
        key={blockedBump?.id || 0}
        className={[
          'maze-player-spark',
          `maze-player-spark--facing-${direction}`,
          bumpClass,
          wallPassArmed ? 'maze-player-spark--phased' : '',
          magnetActive ? 'maze-player-spark--magnet' : '',
          hasWon ? 'maze-player-spark--won' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="img"
        aria-label={`Player at row ${position.row}, column ${position.col}`}
      >
        {magnetActive ? (
          <span className="maze-player-spark__magnet-ring" aria-hidden="true" />
        ) : null}
        <span className="maze-player-spark__halo" aria-hidden="true" />
        <span className="maze-player-spark__core" aria-hidden="true" />
      </div>
    </div>
  )
}

export default Player
