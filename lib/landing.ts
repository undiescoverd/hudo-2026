/**
 * Role-based landing: every role lands on its Dashboard at /dashboard.
 * Pure + dependency-free so pages, middleware-free redirects and tests share one rule.
 * Least privilege: anything that is not an agent-plus role gets the talent view.
 */
import { isAgentPlusRole } from '@/lib/roles'

export const HOME_PATH = '/dashboard'

export function dashboardViewFor(role: string | null | undefined): 'agent' | 'talent' {
  return isAgentPlusRole(role) ? 'agent' : 'talent'
}

/** Talent-view roles have no agency-wide /videos list; send them home. Agents stay. */
export function videosListRedirectFor(role: string | null | undefined): string | null {
  return dashboardViewFor(role) === 'talent' ? HOME_PATH : null
}
