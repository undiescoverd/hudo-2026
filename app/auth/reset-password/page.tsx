import { Suspense } from 'react'
import ResetPasswordForm from './reset-password-form'

/** Page for users to set a new password via a reset link. */
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
