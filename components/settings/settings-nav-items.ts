import { canInvite } from '@/lib/invite-permissions'

export type SettingsNavItem = { label: string; href: string }

/**
 * Settings side-nav entries for a role (v3 layout A).
 * Members: roles that can invite. Billing: owner, only while billing is enabled
 * (the page itself still enforces the owner check). Notifications + Account: everyone.
 */
export function settingsNavItems(role: string, billingEnabled: boolean): SettingsNavItem[] {
  const items: SettingsNavItem[] = []
  if (canInvite(role)) items.push({ label: 'Members', href: '/settings/team' })
  if (role === 'owner' && billingEnabled)
    items.push({ label: 'Billing', href: '/settings/billing' })
  items.push({ label: 'Notifications', href: '/settings/notifications' })
  items.push({ label: 'Account', href: '/settings/account' })
  return items
}
