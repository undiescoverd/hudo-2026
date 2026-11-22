import type { ReactNode } from 'react'

/**
 * Shared v3 auth layout (S4-DESIGN-006, layout A): form column on the left,
 * product preview panel on the right (hidden below `lg`). Purely presentational;
 * used by sign-in, register, forgot/reset password and invite pages.
 */

const PREVIEW_COMMENTS = [
  {
    initials: 'MR',
    name: 'Marcus Reid',
    time: '0:06',
    body: 'Open on the Hollyoaks scene, not the stills.',
    active: false,
  },
  {
    initials: 'PS',
    name: 'Priya Shah',
    time: '1:00',
    body: 'Strongest beat in the reel, consider ending on it.',
    active: true,
  },
  {
    initials: 'TO',
    name: 'Tom Okafor',
    time: '1:47',
    body: 'Add a name card and Spotlight PIN to the end frame.',
    active: false,
  },
]

function ProductPreview() {
  return (
    <div
      aria-hidden="true"
      className="mt-10 overflow-hidden rounded-xl border border-line bg-surface shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm">
        <span className="font-semibold">Showreel 2026</span>
        <span className="font-mono text-xs text-faint">v3 · 2:11</span>
        <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
          In review
        </span>
      </div>
      <div className="grid grid-cols-5">
        <div className="col-span-3 space-y-3 p-4">
          <div className="flex aspect-video items-center justify-center rounded-lg bg-stage">
            <span className="h-10 w-10 rounded-full bg-surface/90" />
          </div>
          <div className="relative h-1 rounded-full bg-surface-2">
            <span className="absolute left-[45%] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-coral" />
            <span className="absolute left-[72%] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-coral" />
          </div>
        </div>
        <ul className="col-span-2 divide-y divide-line border-l border-line">
          {PREVIEW_COMMENTS.map((c) => (
            <li key={c.initials} className={c.active ? 'bg-coral-soft p-3' : 'p-3'}>
              <p className="text-xs font-semibold">
                {c.name} <span className="font-mono font-normal text-coral-text">{c.time}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function AuthSplitLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col bg-surface p-6 sm:p-10">
        <span className="font-display text-[22px] font-semibold tracking-[-0.02em]">hudo</span>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <aside className="hidden border-l border-line bg-surface-2 p-12 lg:block">
        <h2 className="max-w-md text-3xl font-semibold tracking-tight">
          Every comment, on the exact frame.
        </h2>
        <p className="mt-3 max-w-md text-muted-foreground">
          Upload a cut, collect timestamped feedback, resolve it and get sign-off, all in one place.
        </p>
        <ProductPreview />
      </aside>
    </main>
  )
}
