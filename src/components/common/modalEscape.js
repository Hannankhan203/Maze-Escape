export function handleModalEscapeKey(event, { closeOnEscape = true, onClose } = {}) {
  if (!closeOnEscape || !event || event.key !== 'Escape') {
    return false
  }
  onClose?.()
  return true
}
