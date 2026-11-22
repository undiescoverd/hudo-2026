'use client'

import { Button } from '@/components/ui/button'
import { isQuotaMessage } from '@/lib/upload-client'

interface UploadProgressProps {
  fileName: string
  percent: number
  isMultipart?: boolean
  error: string | null
  onRetry: () => void
}

export function UploadProgress({
  fileName,
  percent,
  isMultipart,
  error,
  onRetry,
}: UploadProgressProps) {
  const isComplete = percent === 100 && !error
  const isQuotaError = isQuotaMessage(error)

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-gray-900">
          <svg
            aria-hidden="true"
            className="h-[18px] w-[18px]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.75}
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="m10 9.5 4.5 2.5-4.5 2.5z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{fileName}</p>
          {!error && (
            <p className="font-mono text-xs text-faint">
              {isComplete
                ? 'Upload complete'
                : isMultipart
                  ? `Uploading (multipart) — ${percent}%`
                  : `Uploading — ${percent}%`}
            </p>
          )}
        </div>
        {isComplete && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-status-approved-bg">
            <svg
              aria-hidden="true"
              className="h-4 w-4 text-status-approved-fg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </span>
        )}
      </div>

      {!error && (
        <div className="mt-3.5 h-1.5 w-full overflow-hidden rounded-[3px] bg-surface-2">
          <div
            className={`h-full rounded-[3px] transition-all duration-300 ease-out ${
              isComplete ? 'bg-status-approved-fg' : 'bg-gray-900'
            }`}
            style={{ width: `${percent}%` }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}

      {!error && isMultipart && !isComplete && (
        <p className="mt-2.5 text-xs text-gray-600">Keep this tab open until it finishes</p>
      )}

      {error && (
        <div role="alert" className="mt-3 flex gap-3 rounded-lg bg-status-changes-bg p-3">
          {isQuotaError ? (
            <div>
              <p className="text-sm font-semibold text-status-changes-fg">Storage quota exceeded</p>
              <p className="mt-1 text-xs text-gray-700">
                You have reached your storage limit. Please upgrade your plan or delete existing
                videos.
              </p>
            </div>
          ) : (
            <div className="flex w-full items-center justify-between gap-3">
              <p className="text-sm text-status-changes-fg">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
