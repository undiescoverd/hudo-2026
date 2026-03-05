'use client'

import { useCallback, useRef, useState } from 'react'
import { ALLOWED_CONTENT_TYPES, ALLOWED_EXTENSIONS } from '@/lib/upload-validation'

interface UploadZoneProps {
  onFileSelected: (file: File) => void
  disabled?: boolean
}

export function UploadZone({ onFileSelected, disabled }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const validate = useCallback((file: File): string | null => {
    const type = file.type
    const name = file.name.toLowerCase()
    const ext = name.slice(name.lastIndexOf('.'))
    if (
      !ALLOWED_CONTENT_TYPES.includes(type as (typeof ALLOWED_CONTENT_TYPES)[number]) &&
      !ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])
    ) {
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
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-8 py-16 text-center transition-colors',
          dragOver && !disabled
            ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30'
            : 'border-gray-300 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-500',
          disabled ? 'cursor-not-allowed opacity-50' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-disabled={disabled}
      >
        <svg
          className="h-10 w-10 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Drop a video here, or <span className="text-blue-600 dark:text-blue-400">browse</span>
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">MP4 or MOV, up to 10 GB</p>
        </div>
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
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
