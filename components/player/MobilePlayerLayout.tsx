'use client'
import type { ReactNode } from 'react'

interface MobilePlayerLayoutProps {
  player: ReactNode
  panel?: ReactNode
  input?: ReactNode
}

export function MobilePlayerLayout({ player, panel, input }: MobilePlayerLayoutProps) {
  return (
    <div className="flex h-full flex-col overflow-x-hidden md:flex-row">
      <div className="shrink-0 md:w-3/5">{player}</div>
      {panel && <div className="min-h-0 flex-1 overflow-y-auto md:w-2/5">{panel}</div>}
      {input && <div className="sticky bottom-0 md:hidden">{input}</div>}
    </div>
  )
}
