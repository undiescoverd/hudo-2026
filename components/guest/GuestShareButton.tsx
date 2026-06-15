'use client'

import { useState } from 'react'
import { GuestLinkModal } from './GuestLinkModal'
import { GuestLinkList } from './GuestLinkList'

interface GuestShareButtonProps {
  videoId: string
}

export function GuestShareButton({ videoId }: GuestShareButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const handleCreated = () => {
    setRefreshTrigger((prev) => prev + 1)
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
      >
        Share
      </button>

      {isExpanded && (
        <div className="border border-gray-200 rounded-lg p-4 bg-white space-y-4">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="w-full px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50 transition-colors"
          >
            + Generate link
          </button>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Active links</h3>
            <GuestLinkList videoId={videoId} refreshTrigger={refreshTrigger} />
          </div>
        </div>
      )}

      <GuestLinkModal
        videoId={videoId}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  )
}
