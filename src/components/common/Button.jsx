function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  icon = null,
  className = '',
  type = 'button',
  children,
  ...rest
}) {
  const classes = [
    'lv-btn',
    `lv-btn--${variant}`,
    `lv-btn--${size}`,
    fullWidth ? 'lv-btn--full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...rest}>
      {icon ? (
        <span className="lv-btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </button>
  )
}

export default Button
