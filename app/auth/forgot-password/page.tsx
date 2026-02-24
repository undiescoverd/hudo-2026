import { Suspense } from 'react'
import ForgotPasswordForm from './forgot-password-form'

/** Page to request a password-reset email. */
export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  )
}
