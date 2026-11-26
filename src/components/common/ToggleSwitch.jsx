import { useId } from 'react'

function ToggleSwitch({
  checked = false,
  onChange,
  label,
  description = '',
  disabled = false,
  testId = undefined,
}) {
  const labelId = useId()
  const descId = useId()

  return (
    <div className="lv-toggle">
      <div className="lv-toggle__copy">
        <span id={labelId} className="lv-toggle__label">
          {label}
        </span>
        {description ? (
          <span id={descId} className="lv-toggle__description">
            {description}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        className="lv-toggle__track"
        disabled={disabled}
        data-testid={testId}
        onClick={() => onChange?.(!checked)}
      >
        <span className="lv-toggle__thumb" aria-hidden="true" />
      </button>
    </div>
  )
}

export default ToggleSwitch
