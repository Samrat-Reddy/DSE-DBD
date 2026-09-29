import { Link } from 'react-router-dom'
import './Button.css'

/**
 * Generic button. Presentational only — callers own the behaviour.
 *
 * Pass `to` to render a router `<Link>` styled identically, so navigation
 * actions and form actions stay visually consistent.
 */
const Button = ({
  children,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  to,
  onClick,
  ...rest
}) => {
  const className = [
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    fullWidth ? 'ui-button--block' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (to && !disabled) {
    return (
      <Link to={to} className={className} {...rest}>
        {children}
      </Link>
    )
  }

  return (
    <button
      type={type}
      className={className}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  )
}

export default Button
