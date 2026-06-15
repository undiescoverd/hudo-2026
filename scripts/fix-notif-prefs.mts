/**
 * One-shot: insert notification_preferences for Playwright test recipient.
 * Run: npx tsx --env-file=.env.local scripts/fix-notif-prefs.mts
 */
import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const RECIPIENT_ID = 'f4c26389-9e09-45c0-8639-71b1d7fc03b3'

const { data: existing } = await admin
  .from('notification_preferences')
  .select('*')
  .eq('user_id', RECIPIENT_ID)

console.log('existing prefs:', JSON.stringify(existing))

if (!existing?.length) {
  const { error } = await admin.from('notification_preferences').insert({
    user_id: RECIPIENT_ID,
    email_enabled: true,
    batch_window_minutes: 5,
  })
  if (error) {
    console.error('insert error:', error.message)
    process.exit(1)
  }
  const { data: after } = await admin
    .from('notification_preferences')
    .select('*')
    .eq('user_id', RECIPIENT_ID)
  console.log('inserted:', JSON.stringify(after))
} else {
  // Update batch_window_minutes to 0 so old notifications qualify
  const { error } = await admin
    .from('notification_preferences')
    .update({ batch_window_minutes: 5, email_enabled: true })
    .eq('user_id', RECIPIENT_ID)
  if (error) {
    console.error('update error:', error.message)
    process.exit(1)
  }
  console.log('updated existing row to batch_window_minutes=0')
}

console.log('done')
