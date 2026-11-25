/**
 * /settings/team — invite teammates + read-only pending invitations.
 *
 * Server component. Agency/role come from `memberships` (RLS-respecting client);
 * pending invitations come from `invitations` under the invitations_select policy
 * (agents+ of the agency). no token column is ever selected. Resend/revoke: Sprint 5.
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  canInvite,
  filterPendingInvitations,
  type PendingInvitation,
} from '@/lib/invite-permissions'
import { canGrantBillingAccess, isBillingGrantTarget } from '@/lib/billing-access'
import { isBillingEnabled } from '@/lib/feature-flags'
import { BillingAccessList, type BillingAccessRow } from '@/components/settings/BillingAccessToggle'
import { InviteForm } from '@/components/settings/InviteForm'
import { PendingInvitations } from '@/components/settings/PendingInvitations'

export default async function TeamSettingsPage() {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  // Deterministic: first (oldest) membership whose role can invite.
  const { data: memberships } = await supabase
    .from('memberships')
    .select('agency_id, role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  const membership = (memberships ?? []).find((m) => canInvite(m.role))
  if (!membership) redirect('/videos')

  const { data: rows, error } = await supabase
    .from('invitations')
    .select('id, email, role, expires_at, accepted_at')
    .eq('agency_id', membership.agency_id)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (error) console.error('[settings/team] invitations query failed:', error.message)

  const pending = filterPendingInvitations((rows ?? []) as PendingInvitation[])

  // Owner only: one billing-access switch per admin agent (RLS client; memberships and
  // users are readable by agency members). Never offered for any other role.
  const showBillingAccess = isBillingEnabled() && canGrantBillingAccess(membership.role)
  let billingAdmins: BillingAccessRow[] = []
  if (showBillingAccess) {
    const { data: members } = await supabase
      .from('memberships')
      .select('user_id, role, can_manage_billing')
      .eq('agency_id', membership.agency_id)
      .order('created_at', { ascending: true })
    const admins = (members ?? []).filter((m) => isBillingGrantTarget(m.role))
    const { data: people } = admins.length
      ? await supabase
          .from('users')
          .select('id, full_name, email')
          .in(
            'id',
            admins.map((m) => m.user_id)
          )
      : { data: [] }
    billingAdmins = admins.map((m) => {
      const p = (people ?? []).find((u) => u.id === m.user_id)
      return {
        userId: m.user_id,
        name: p?.full_name || p?.email || 'Admin agent',
        enabled: m.can_manage_billing === true,
      }
    })
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Members</h1>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Invite a teammate</h2>
        <InviteForm agencyId={membership.agency_id} inviterRole={membership.role} />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Pending invitations</h2>
        {error ? (
          <p className="text-sm text-destructive">Unable to load pending invitations.</p>
        ) : (
          <PendingInvitations invitations={pending} />
        )}
      </section>
      {showBillingAccess && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Billing access</h2>
          <p className="text-sm text-muted-foreground">
            Admin agents you tick can see the plan and invoices and update the payment method.
            Changing or cancelling the plan stays with you.
          </p>
          <BillingAccessList agencyId={membership.agency_id} admins={billingAdmins} />
        </section>
      )}
    </div>
  )
}
