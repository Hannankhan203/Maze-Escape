function StarRating({ rating = 0, max = 3, size = 'md', label }) {
  const clamped = Math.max(0, Math.min(rating, max))
  const ariaLabel = label || `${clamped} out of ${max} stars`

  return (
    <div
      className={`lv-stars lv-stars--${size}`}
      role="img"
      aria-label={ariaLabel}
    >
      {Array.from({ length: max }, (_, index) => {
        const isFilled = index < clamped
        return (
          <svg
            key={index}
            className={`lv-stars__icon ${
              isFilled ? 'lv-stars__icon--filled' : 'lv-stars__icon--empty'
            }`}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2.4l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.3l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95L12 2.4Z" />
          </svg>
        )
      })}
    </div>
  )
}

export default StarRating
