import { useEffect, useId } from 'react'
import { handleModalEscapeKey } from './modalEscape.js'

function Modal({
  isOpen,
  onClose,
  title,
  subtitle = '',
  footer = null,
  size = 'md',
  showCloseButton = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  className = '',
  children,
}) {
  const titleId = useId()
  const subtitleId = useId()

  useEffect(() => {
    if (!isOpen) return undefined

    const handleKeyDown = (event) => {
      handleModalEscapeKey(event, { closeOnEscape, onClose })
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, closeOnEscape, onClose])

  if (!isOpen) return null

  const handleBackdropClick = (event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) {
      onClose?.()
    }
  }

  const modalClasses = ['lv-modal', `lv-modal--${size}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className="lv-modal-backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={modalClasses}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
      >
        <div className="lv-modal__header">
          <div>
            <h2 id={titleId} className="lv-modal__title">
              {title}
            </h2>
            {subtitle ? (
              <p id={subtitleId} className="lv-modal__subtitle">
                {subtitle}
              </p>
            ) : null}
          </div>
          {showCloseButton ? (
            <button
              type="button"
              className="lv-modal__close"
              onClick={onClose}
              aria-label="Close modal"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="lv-modal__body">{children}</div>

        {footer ? <div className="lv-modal__footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export default Modal
