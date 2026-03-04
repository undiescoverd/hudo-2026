'use client'

export interface UploadProgressProps {
  progress: number
  status: 'uploading' | 'error'
  error?: string
  onRetry?: () => void
}

export function UploadProgress({ progress, status, error, onRetry }: UploadProgressProps) {
  const clampedProgress = Math.min(100, Math.max(0, Math.round(progress)))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{status === 'error' ? 'Upload failed' : 'Uploading…'}</span>
        <span className="tabular-nums text-muted-foreground">{clampedProgress}%</span>
      </div>

      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          role="progressbar"
          aria-valuenow={clampedProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Upload progress"
          className={[
            'h-full rounded-full transition-all duration-300',
            status === 'error' ? 'bg-destructive' : 'bg-primary',
          ].join(' ')}
          style={{ width: `${clampedProgress}%` }}
        />
      </div>

      {status === 'error' && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {status === 'error' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retry
        </button>
      )}
    </div>
  )
}
