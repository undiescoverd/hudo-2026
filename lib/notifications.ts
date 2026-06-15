import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendEmail as defaultSendEmail } from '@/lib/email'
import {
  renderCommentsBatchEmail,
  type CommentEntry,
  type VideoGroup,
} from '@/lib/email-templates/comments-batch'

function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[notifications] Missing Supabase env vars')
  return createClient(url, key)
}

/**
 * Inserts one notification row per agency member (excluding the comment author).
 * Errors are caught and logged; never thrown — comment creation must not fail.
 */
export async function enqueueCommentNotification({
  agencyId,
  videoId,
  commentId,
  commentAuthorId,
}: {
  agencyId: string
  videoId: string
  commentId: string
  commentAuthorId: string
}): Promise<void> {
  let admin: SupabaseClient
  try {
    admin = createAdminClient()
  } catch (err) {
    console.error('[notifications:enqueue] Config error:', err)
    return
  }

  const { data: members, error } = await admin
    .from('memberships')
    .select('user_id')
    .eq('agency_id', agencyId)
    .neq('user_id', commentAuthorId)

  if (error) {
    console.error('[notifications:enqueue] Failed to fetch members:', error)
    return
  }

  if (!members?.length) return

  const rows = members.map((m) => ({
    agency_id: agencyId,
    recipient_id: m.user_id,
    type: 'new_comment' as const,
    video_id: videoId,
    comment_id: commentId,
  }))

  const { error: insertError } = await admin.from('notifications').insert(rows)
  if (insertError) {
    console.error('[notifications:enqueue] Insert failed:', insertError)
  }
}

export type BatchSendDeps = {
  admin?: SupabaseClient
  emailSender?: typeof defaultSendEmail
}

export type BatchSendResult = { sent: number; errors: number }

/**
 * Cron-driven batch sender. Fetches all unsent new_comment notifications, groups
 * by recipient, respects each user's batch_window_minutes (default 15), and sends
 * one digest email per recipient. Sets sent_at only after a successful send.
 */
export async function batchAndSendNotifications(deps?: BatchSendDeps): Promise<BatchSendResult> {
  const admin = deps?.admin ?? createAdminClient()
  const emailSender = deps?.emailSender ?? defaultSendEmail

  const { data: unsent, error: fetchErr } = await admin
    .from('notifications')
    .select('id, recipient_id, video_id, comment_id, created_at, agency_id')
    .is('sent_at', null)
    .eq('type', 'new_comment')

  if (fetchErr) {
    console.error('[notifications:batch] Fetch failed:', fetchErr)
    return { sent: 0, errors: 1 }
  }

  if (!unsent?.length) return { sent: 0, errors: 0 }

  const recipientIds = [...new Set(unsent.map((n) => n.recipient_id))]

  const [prefsRes, recipientsRes] = await Promise.all([
    admin
      .from('notification_preferences')
      .select('user_id, email_enabled, batch_window_minutes')
      .in('user_id', recipientIds),
    admin.from('users').select('id, email, full_name').in('id', recipientIds),
  ])

  const prefs = prefsRes.data ?? []
  const recipients = recipientsRes.data ?? []
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const now = Date.now()
  let sent = 0
  let errors = 0

  for (const recipientId of recipientIds) {
    const pref = prefs.find((p) => p.user_id === recipientId)
    if (pref?.email_enabled === false) continue

    const windowMs = (pref?.batch_window_minutes ?? 15) * 60_000

    const due = unsent.filter(
      (n) => n.recipient_id === recipientId && now - new Date(n.created_at).getTime() >= windowMs
    )
    if (!due.length) continue

    const videoIds = [...new Set(due.map((n) => n.video_id).filter(Boolean))]
    const commentIds = [...new Set(due.map((n) => n.comment_id).filter(Boolean))]

    if (!videoIds.length) continue

    const [videosRes, commentsRes] = await Promise.all([
      admin.from('videos').select('id, title').in('id', videoIds),
      commentIds.length
        ? admin
            .from('comments')
            .select('id, content, timestamp_seconds, user_id')
            .in('id', commentIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    const videos = videosRes.data ?? []
    const comments = commentsRes.data ?? []
    const commenterIds = [...new Set(comments.map((c) => c.user_id))]

    const commenterMap: Record<string, string> = {}
    if (commenterIds.length) {
      const { data: commenters } = await admin
        .from('users')
        .select('id, full_name')
        .in('id', commenterIds)
      for (const u of commenters ?? []) {
        commenterMap[u.id] = u.full_name
      }
    }

    const videoGroups: VideoGroup[] = videos
      .map((v) => {
        const vComments: CommentEntry[] = due
          .filter((n) => n.video_id === v.id)
          .flatMap((n) => {
            const c = comments.find((c) => c.id === n.comment_id)
            if (!c) return []
            return [
              {
                authorName: commenterMap[c.user_id] ?? 'Unknown',
                content: c.content as string,
                timestampSeconds: c.timestamp_seconds ?? undefined,
              },
            ]
          })
        return {
          title: v.title as string,
          videoUrl: `${appUrl}/videos/${v.id}`,
          comments: vComments,
        }
      })
      .filter((g) => g.comments.length > 0)

    if (!videoGroups.length) continue

    const recipient = recipients.find((r) => r.id === recipientId)
    if (!recipient?.email) continue

    try {
      const html = renderCommentsBatchEmail({
        recipientName: (recipient.full_name as string) ?? 'there',
        videos: videoGroups,
      })
      await emailSender({
        to: recipient.email as string,
        subject: 'New comments on your Hudo videos',
        html,
      })
      await admin
        .from('notifications')
        .update({ sent_at: new Date().toISOString() })
        .in(
          'id',
          due.map((n) => n.id)
        )
      sent++
    } catch (err) {
      console.error(`[notifications:batch] Send failed for ${recipientId}:`, err)
      errors++
      // Leave sent_at = NULL — retry next tick
    }
  }

  return { sent, errors }
}
