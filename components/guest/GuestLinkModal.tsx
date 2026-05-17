'use client'

import { useState } from 'react'

interface GuestLinkModalProps {
  videoId: string
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

interface GuestLinkResponse {
  id: string
  token: string
  url: string
  expires_at: string | null
  created_at: string
}

export function GuestLinkModal({ videoId, isOpen, onClose, onCreated }: GuestLinkModalProps) {
  const [state, setStateValue] = useState<'form' | 'success'>('form')
  const [expiresAt, setExpiresAt] = useState('')
  const [generatedUrl, setGeneratedUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  const handleGenerateLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const body: { expires_at?: string } = {}
      if (expiresAt) {
        body.expires_at = new Date(expiresAt).toISOString()
      }

      const res = await fetch(`/api/videos/${videoId}/guest-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.message || `Failed to generate link (${res.status})`)
      }

      const data = (await res.json()) as GuestLinkResponse
      setGeneratedUrl(data.url)
      setStateValue('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate link')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(generatedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      setError('Failed to copy URL')
    }
  }

  const handleAcknowledge = () => {
    setStateValue('form')
    setExpiresAt('')
    setGeneratedUrl('')
    setError(null)
    setCopied(false)
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full">
        {state === 'form' ? (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Generate Guest Link</h2>
            <form onSubmit={handleGenerateLink} className="space-y-4">
              <div>
                <label
                  htmlFor="expires_at"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Expires at (optional)
                </label>
                <input
                  id="expires_at"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                >
                  {loading ? 'Generating…' : 'Generate link'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Guest Link Created</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
                  Share this link
                </label>
                <input
                  id="url"
                  type="text"
                  readOnly
                  value={generatedUrl}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 bg-gray-50"
                />
              </div>
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-sm text-yellow-800">
                  <strong>Important:</strong> This link will not be shown again. Copy it now.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={handleAcknowledge}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  I&apos;ve copied it
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
