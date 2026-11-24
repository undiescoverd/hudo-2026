/**
 * /talent — old talent dashboard URL. Every role now lands on /dashboard (#249).
 */

import { redirect } from 'next/navigation'
import { HOME_PATH } from '@/lib/landing'

export default function TalentPage() {
  redirect(HOME_PATH)
}
