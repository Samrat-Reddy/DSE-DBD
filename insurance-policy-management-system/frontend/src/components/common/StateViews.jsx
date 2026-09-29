import Button from './Button'
import './StateViews.css'

/**
 * The three non-content states every data view needs.
 *
 * They share one stylesheet and one layout so loading, empty and error never
 * drift apart visually.
 */

/** Skeleton placeholder shown while a service call is in flight. */
export const LoadingState = ({
  label = 'Loading',
  variant = 'card',
  rows = 3,
}) => (
  <div className="state-view state-view--loading" role="status" aria-live="polite">
    <span className="sr-only">{label}…</span>

    {variant === 'card' ? (
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <div className="skeleton skeleton--pill" />
            <div className="skeleton skeleton--title" />
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--line skeleton--short" />
            <div className="skeleton skeleton--block" />
          </div>
        ))}
      </div>
    ) : (
      <div className="skeleton-stack" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="skeleton skeleton--row" key={index} />
        ))}
      </div>
    )}
  </div>
)

/** Shown when a request succeeds but returns nothing to display. */
export const EmptyState = ({
  title = 'Nothing to display',
  description,
  action,
  icon = '◍',
}) => (
  <div className="state-view state-view--empty">
    <div className="state-view__icon" aria-hidden="true">
      {icon}
    </div>
    <h3 className="state-view__title">{title}</h3>
    {description && <p className="state-view__description">{description}</p>}
    {action && <div className="state-view__action">{action}</div>}
  </div>
)

/** Shown when a service call rejects. `onRetry` renders a retry button. */
export const ErrorState = ({
  title = 'Something went wrong',
  description,
  error,
  onRetry,
}) => {
  const message =
    description ?? error?.message ?? 'The request could not be completed.'

  return (
    <div className="state-view state-view--error" role="alert">
      <div className="state-view__icon state-view__icon--error" aria-hidden="true">
        !
      </div>
      <h3 className="state-view__title">{title}</h3>
      <p className="state-view__description">{message}</p>
      {error?.status ? (
        <p className="state-view__meta">Status code: {error.status}</p>
      ) : null}
      {onRetry && (
        <div className="state-view__action">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}
