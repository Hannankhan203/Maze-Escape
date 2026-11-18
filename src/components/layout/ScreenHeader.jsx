function ScreenHeader({
  title,
  eyebrow = '',
  as: HeadingTag = 'h2',
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
          <HeadingTag className="screen-header__title">{title}</HeadingTag>
        </div>
      </div>

      {rightActions ? (
        <div className="screen-header__actions">{rightActions}</div>
      ) : null}
    </header>
  )
}

export default ScreenHeader
