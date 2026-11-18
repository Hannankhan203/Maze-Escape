function ScreenHeader({
  title,
  eyebrow = '',
  leftAction = null,
  rightActions = null,
}) {
  return (
    <header className="screen-header">
      <div className="screen-header__left">
        {leftAction}
        <div className="screen-header__titles">
          {eyebrow ? (
            <span className="screen-header__eyebrow">{eyebrow}</span>
          ) : null}
          <h2 className="screen-header__title">{title}</h2>
        </div>
      </div>

      {rightActions ? (
        <div className="screen-header__actions">{rightActions}</div>
      ) : null}
    </header>
  )
}

export default ScreenHeader
