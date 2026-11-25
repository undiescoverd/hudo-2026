import { canInvite } from '@/lib/invite-permissions'
import { getBillingAccess } from '@/lib/billing-access'

export type SettingsNavItem = { label: string; href: string }

/**
 * Settings side-nav entries for a role (v3 layout A).
 * Members: roles that can invite. Billing: owner, or an admin agent with billing access
 * (`can_manage_billing`), only while billing is enabled (the page re-checks).
 * Notifications + Account: everyone.
 */
export function settingsNavItems(
  role: string,
  billingEnabled: boolean,
  canManageBilling = false
): SettingsNavItem[] {
  const items: SettingsNavItem[] = []
  if (canInvite(role)) items.push({ label: 'Members', href: '/settings/team' })
  if (billingEnabled && getBillingAccess({ role, can_manage_billing: canManageBilling }))
    items.push({ label: 'Billing', href: '/settings/billing' })
  items.push({ label: 'Notifications', href: '/settings/notifications' })
  items.push({ label: 'Account', href: '/settings/account' })
  return items
}
