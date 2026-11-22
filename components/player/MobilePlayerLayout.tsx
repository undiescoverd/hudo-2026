'use client'
import type { ReactNode } from 'react'

interface MobilePlayerLayoutProps {
  player: ReactNode
  panel?: ReactNode
  input?: ReactNode
}

export function MobilePlayerLayout({ player, panel, input }: MobilePlayerLayoutProps) {
  return (
    <div className="flex h-full flex-col overflow-x-hidden md:grid md:grid-cols-[1fr_384px]">
      <div className="min-w-0 shrink-0 p-5">{player}</div>
      {panel && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line bg-surface md:border-l md:border-t-0">
          {panel}
        </div>
      )}
      {input && <div className="sticky bottom-0 md:hidden">{input}</div>}
    </div>
  )
}
