/**
 * Calm "video couldn't load" state shared by the authed and guest players
 * (Paper: "Guest · Video failed to load"). Presentational only.
 */
import type { ReactNode } from 'react'

interface PlayerLoadErrorProps {
  title: string
  detail: string
  onRetry: () => void
  /** Extra actions under Retry, e.g. version switch buttons. */
  children?: ReactNode
  className?: string
}

export function PlayerLoadError({
  title,
  detail,
  onRetry,
  children,
  className = '',
}: PlayerLoadErrorProps) {
  return (
    <div
      role="alert"
      className={`flex aspect-video w-full flex-col items-center justify-center gap-1.5 bg-stage px-4 text-center ${className}`}
    >
      <p className="text-[15px] font-medium text-white">{title}</p>
      <p className="text-[13.5px] text-white/70">{detail}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3.5 h-9 rounded-md bg-white px-4 text-[13.5px] font-medium text-gray-900 hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        Retry
      </button>
      {children}
    </div>
  )
}
