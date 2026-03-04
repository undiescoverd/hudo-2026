'use client'

import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ALLOWED_EXTENSIONS } from '@/lib/upload-validation'

export interface UploadZoneProps {
  onFile: (file: File) => void
  error?: string
  disabled?: boolean
}

function getExtension(file: File): string {
  return file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
}

function isAllowedFile(file: File): boolean {
  return ALLOWED_EXTENSIONS.includes(getExtension(file) as (typeof ALLOWED_EXTENSIONS)[number])
}

export function UploadZone({ onFile, error, disabled }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [typeError, setTypeError] = useState<string | null>(null)

  const errorId = 'upload-zone-error'
  const displayError = error ?? typeError ?? null

  function handleFile(file: File) {
    if (!isAllowedFile(file)) {
      setTypeError(`Only .mp4 and .mov files are allowed. Got: ${getExtension(file)}`)
      return
    }
    setTypeError(null)
    onFile(file)
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!disabled) setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleChange() {
    const file = inputRef.current?.files?.[0]
    if (file) handleFile(file)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      inputRef.current?.click()
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-describedby={displayError ? errorId : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onKeyDown={handleKeyDown}
        onClick={() => !disabled && inputRef.current?.click()}
        className={[
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-primary hover:bg-primary/5',
        ].join(' ')}
      >
        <svg
          className="mb-3 h-10 w-10 text-muted-foreground"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="text-sm font-medium">Drag and drop your video here</p>
        <p className="mt-1 text-xs text-muted-foreground">or click to select a file</p>
        <p className="mt-1 text-xs text-muted-foreground">MP4 or MOV, up to 10 GB</p>
        {/* Mobile: accept="video/*" opens camera roll; desktop: restricted to mp4/mov */}
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          disabled={disabled}
          onChange={handleChange}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
      {displayError && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-destructive">
          {displayError}
        </p>
      )}
    </div>
  )
}
