/**
 * End-to-end notification pipeline test (bypasses rate-limited comment API).
 * Run: RESEND_API_KEY=re_test npx tsx --env-file=.env.local scripts/playwright-notif-test.mts
 */
import { createClient } from '@supabase/supabase-js'
import { enqueueCommentNotification, batchAndSendNotifications } from '../lib/notifications'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const AGENT_ID   = '62b0e76d-5510-4fab-b066-426cf0f31c0f'
const AGENCY_ID  = 'b2e8c50a-67ca-435b-b2e5-4573149e2b76'
const RECIPIENT_ID = 'f4c26389-9e09-45c0-8639-71b1d7fc03b3'
const VERSION_ID = '86d24a74-d2e9-458a-8722-9fd3dc0e7881'
const VIDEO_ID   = 'e30d7e33-558a-42cb-a38e-fdcbde74b67a'

console.log('\n── Step 1: Insert 3 comments directly into DB ──────────────────')
const commentTexts = [
  'Great timing on the opening shot',
  'Colour grade looks off at 0:15',
  'Love the soundtrack choice',
]
const commentIds: string[] = []
for (const content of commentTexts) {
  const { data, error } = await admin.from('comments').insert({
    video_version_id: VERSION_ID,
    agency_id: AGENCY_ID,
    user_id: AGENT_ID,
    content,
    comment_type: 'point',
    timestamp_seconds: 10,
  }).select('id').single()
  if (error) { console.error('comment insert failed:', error.message); process.exit(1) }
  commentIds.push(data!.id)
  console.log(`  inserted comment ${data!.id}: "${content}"`)
}

console.log('\n── Step 2: Call enqueueCommentNotification for each comment ────')
for (const commentId of commentIds) {
  await enqueueCommentNotification({
    agencyId: AGENCY_ID,
    videoId: VIDEO_ID,
    commentId,
    commentAuthorId: AGENT_ID,
  })
  console.log(`  enqueued notification for comment ${commentId}`)
}

console.log('\n── Step 3: Check notifications table (should have 3 unsent rows) ──')
const { data: unsent } = await admin
  .from('notifications')
  .select('id, recipient_id, comment_id, sent_at, created_at')
  .eq('video_id', VIDEO_ID)
  .is('sent_at', null)
  .order('created_at', { ascending: false })

console.log(`  found ${unsent?.length ?? 0} unsent rows`)
unsent?.forEach(n => console.log(`  • notif ${n.id} → recipient ${n.recipient_id.slice(0,8)} | sent_at: ${n.sent_at}`))

if (!unsent?.length) {
  console.error('FAIL: expected notifications to exist')
  process.exit(1)
}
if (unsent.some(n => n.recipient_id !== RECIPIENT_ID)) {
  console.error('FAIL: notification sent to wrong recipient (should exclude comment author)')
  process.exit(1)
}
console.log('  ✓ all notifications target the recipient (not the author)')

console.log('\n── Step 3b: Backdate notifications to 6 min ago (past 5-min window) ──')
const sixMinsAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString()
const { error: backdateErr } = await admin
  .from('notifications')
  .update({ created_at: sixMinsAgo })
  .in('id', unsent.map(n => n.id))
if (backdateErr) { console.error('backdate failed:', backdateErr.message); process.exit(1) }
console.log(`  backdated ${unsent.length} rows to ${sixMinsAgo}`)

console.log('\n── Step 4: Run batchAndSendNotifications (mock email sender) ──')
let emailsSent = 0
const mockSender: typeof import('../lib/email').sendEmail = async (params) => {
  emailsSent++
  console.log(`  📧 email #${emailsSent} to ${params.to}`)
  console.log(`     subject: ${params.subject}`)
  console.log(`     html preview: ${params.html.slice(0, 120).replace(/\n/g, ' ')}...`)
  return { id: 'mock-msg-id' } as ReturnType<typeof import('../lib/email').sendEmail> extends Promise<infer T> ? T : never
}

const result = await batchAndSendNotifications({ admin, emailSender: mockSender })
console.log(`\n  result: ${JSON.stringify(result)}`)

console.log('\n── Step 5: Verify sent_at was stamped ──────────────────────────')
const { data: afterSend } = await admin
  .from('notifications')
  .select('id, sent_at')
  .in('id', unsent.map(n => n.id))

const stillUnsent = afterSend?.filter(n => !n.sent_at) ?? []
console.log(`  total: ${afterSend?.length}, with sent_at: ${afterSend?.filter(n => n.sent_at).length}, still null: ${stillUnsent.length}`)

if (stillUnsent.length > 0) {
  console.error('FAIL: some notifications were not marked as sent')
  process.exit(1)
}
console.log('  ✓ all notifications have sent_at stamped')

console.log('\n── Step 6: Second run → should send 0 (already sent) ──────────')
const result2 = await batchAndSendNotifications({ admin, emailSender: mockSender })
console.log(`  result: ${JSON.stringify(result2)}`)
if (result2.sent !== 0) {
  console.error('FAIL: expected 0 sends on second run')
  process.exit(1)
}
console.log('  ✓ second run correctly returns { sent: 0, errors: 0 }')

console.log('\n✅ All checks passed\n')
