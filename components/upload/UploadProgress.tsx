'use client'

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
  const isQuotaError = error?.toLowerCase().includes('quota')

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {fileName}
          </p>
          {!error && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isComplete
                ? 'Upload complete'
                : isMultipart
                  ? `Uploading (multipart) — ${percent}%`
                  : `Uploading — ${percent}%`}
            </p>
          )}
        </div>
        {isComplete && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
            <svg
              aria-hidden="true"
              className="h-4 w-4 text-green-600 dark:text-green-400"
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
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-300 ease-out dark:bg-blue-500"
            style={{ width: `${percent}%` }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-lg bg-red-50 p-3 dark:bg-red-950/40">
          {isQuotaError ? (
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Storage quota exceeded
              </p>
              <p className="mt-1 text-xs text-red-600 dark:text-red-500">
                You have reached your storage limit. Please upgrade your plan or delete existing
                videos.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 rounded-md bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
