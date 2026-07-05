/**
 * DashboardError — shared inline error UI for the (dashboard) route group.
 *
 * Convention: the `/dashboard` server component page catches its own
 * data-fetch errors (on both the agent and talent branches) and renders
 * this in place of the client dashboard, instead of forwarding an `error`
 * prop into the client component. This keeps both branches on one error
 * convention and one visual treatment.
 */

type Props = {
  message?: string
}

const DEFAULT_MESSAGE = 'Unable to load videos right now. Please try again later.'

export function DashboardError({ message = DEFAULT_MESSAGE }: Props) {
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  )
}
