'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface MetadataFormProps {
  videoId: string
  defaultTitle: string
  onSaved: (videoId: string) => void
  onSkip: (videoId: string) => void
}

export function MetadataForm({ videoId, defaultTitle, onSaved, onSkip }: MetadataFormProps) {
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Failed to save metadata (${res.status})`)
      }

      onSaved(videoId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save metadata')
    } finally {
      setSubmitting(false)
    }
  }

  const fieldClass =
    'w-full rounded-lg border border-line bg-surface px-3 text-sm text-gray-900 placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-gray-900'
  return (
    <div className="rounded-[14px] border border-line bg-surface p-5">
      <h2 className="mb-4 text-base font-semibold text-gray-900">Add video details</h2>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label
            htmlFor="metadata-title"
            className="mb-1.5 block text-[12.5px] font-medium text-gray-600"
          >
            Title <span className="text-status-changes-fg">*</span>
          </label>
          <input
            id="metadata-title"
            type="text"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`${fieldClass} h-10`}
          />
        </div>

        <div>
          <label
            htmlFor="metadata-description"
            className="mb-1.5 block text-[12.5px] font-medium text-gray-600"
          >
            Description <span className="font-normal text-faint">(optional)</span>
          </label>
          <textarea
            id="metadata-description"
            rows={4}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${fieldClass} resize-none py-2`}
            placeholder="Add a description..."
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-status-changes-fg">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button type="submit" disabled={submitting || title.trim().length === 0}>
            {submitting ? 'Saving...' : 'Save & continue'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onSkip(videoId)}
          >
            Skip
          </Button>
        </div>
      </form>
    </div>
  )
}
