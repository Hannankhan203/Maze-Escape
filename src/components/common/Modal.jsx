import { useEffect, useId, useRef } from 'react'
import { handleModalEscapeKey } from './modalEscape.js'
import {
  focusModalInitialElement,
  handleModalTabKey,
  restoreModalTriggerFocus,
} from './modalFocus.js'

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
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const closeOnEscapeRef = useRef(closeOnEscape)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    closeOnEscapeRef.current = closeOnEscape
  }, [closeOnEscape])

  useEffect(() => {
    if (!isOpen) return undefined

    const triggerElement = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    focusModalInitialElement(dialogRef.current, document)

    const handleKeyDown = (event) => {
      if (
        handleModalEscapeKey(event, {
          closeOnEscape: closeOnEscapeRef.current,
          onClose: onCloseRef.current,
        })
      ) {
        return
      }
      handleModalTabKey(event, dialogRef.current, document.activeElement)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      restoreModalTriggerFocus(triggerElement, document)
    }
  }, [isOpen])

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
        ref={dialogRef}
        tabIndex={-1}
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
