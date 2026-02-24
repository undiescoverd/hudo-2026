import { Suspense } from 'react'
import SignInForm from './signin-form'

/** Sign-in page for returning users. */
export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  )
}
