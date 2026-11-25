export type InvalidCopy = {
  title: string
  body: string
  icon: 'clock' | 'blocked' | 'lock' | 'help'
}

const COPY: Record<string, InvalidCopy> = {
  expired: {
    title: 'This link has expired',
    body: 'Ask the person who shared it for a new one.',
    icon: 'clock',
  },
  revoked: {
    title: 'This link is no longer available',
    body: 'The person who shared it has turned it off. Ask them for a new link.',
    icon: 'blocked',
  },
  subscription: {
    title: "This link isn't available right now",
    body: 'Ask the person who sent it to check with their team.',
    icon: 'lock',
  },
  'not-found': {
    title: "We can't find that link",
    body: 'Check the address, or ask the person who sent it for a new link.',
    icon: 'help',
  },
}

/** Unknown or missing reason → not-found copy. Never echoes the input. */
export function copyForReason(reason: unknown): InvalidCopy {
  return typeof reason === 'string' && Object.hasOwn(COPY, reason)
    ? COPY[reason]
    : COPY['not-found']
}
