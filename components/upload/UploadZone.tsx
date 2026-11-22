'use client'

import { useCallback, useRef, useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { ALLOWED_CONTENT_TYPES, ALLOWED_EXTENSIONS } from '@/lib/upload-validation'

interface UploadZoneProps {
  onFileSelected: (file: File) => void
  disabled?: boolean
  /** New-version mode (/upload?videoId=): copy says "version". */
  isNewVersion?: boolean
}

export function UploadZone({ onFileSelected, disabled, isNewVersion }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const validate = useCallback((file: File): string | null => {
    const type = file.type
    const name = file.name.toLowerCase()
    const ext = name.slice(name.lastIndexOf('.'))
    const validMime =
      !type || ALLOWED_CONTENT_TYPES.includes(type as (typeof ALLOWED_CONTENT_TYPES)[number])
    const validExt = ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])
    if (!validMime || !validExt) {
      return `Only MP4 and MOV files are supported. "${file.name}" is not allowed.`
    }
    return null
  }, [])

  const handleFile = useCallback(
    (file: File) => {
      const err = validate(file)
      if (err) {
        setError(err)
        return
      }
      setError(null)
      onFileSelected(file)
    },
    [validate, onFileSelected]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (disabled) return
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [disabled, handleFile]
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback(() => setDragOver(false), [])

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      // Reset input so same file can be re-selected
      e.target.value = ''
    },
    [handleFile]
  )

  return (
    <div>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (!disabled) inputRef.current?.click()
          }
        }}
        className={[
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-[1.5px] bg-surface px-6 py-11 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900',
          dragOver && !disabled
            ? 'border-solid border-coral bg-coral-soft'
            : 'border-dashed border-line hover:border-gray-300',
          disabled ? 'cursor-not-allowed opacity-50' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-disabled={disabled}
      >
        <span
          className={[
            'mb-3 grid h-11 w-11 place-items-center rounded-xl',
            dragOver && !disabled ? 'bg-coral text-coral-on' : 'bg-surface-2 text-gray-900',
          ].join(' ')}
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </span>
        <h3
          className={[
            'text-base font-semibold',
            dragOver && !disabled ? 'text-coral-text' : 'text-gray-900',
          ].join(' ')}
        >
          {dragOver && !disabled
            ? `Drop to upload${isNewVersion ? ' as a new version' : ''}`
            : `Drag your ${isNewVersion ? 'new version' : 'video'} here`}
        </h3>
        <p className="mb-3.5 mt-1 text-[13px] text-gray-600">
          {dragOver && !disabled ? 'One file at a time' : 'or'}
        </p>
        {!(dragOver && !disabled) && (
          <span className={buttonVariants({ variant: 'primary' })}>Choose a file</span>
        )}
        <p className="mt-3 text-xs text-faint">MP4 or MOV · up to 10 GB · one file</p>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,.mp4,.mov,video/*"
          onChange={onInputChange}
          className="sr-only"
          disabled={disabled}
          aria-label="Select video file"
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-status-changes-fg">
          {error}
        </p>
      )}
    </div>
  )
}
