'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { validatePassword } from '@/lib/auth-validation'

type InvitationData = {
  valid: boolean
  email?: string
  role?: string
  agencyName?: string
  userExists?: boolean
}

type FieldError = { fullName?: string; password?: string }

function validateFields(fullName: string, password: string, isNewUser: boolean): FieldError {
  if (!isNewUser) return {}
  const errors: FieldError = {}
  if (!fullName.trim()) errors.fullName = 'Full name is required'
  const passwordError = !password ? 'Password is required' : validatePassword(password)
  if (passwordError) errors.password = passwordError
  return errors
}

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>()
  const token = params.token

  const [state, setState] = useState<'loading' | 'valid' | 'invalid' | 'success' | 'error'>(
    'loading'
  )
  const [invitation, setInvitation] = useState<InvitationData | null>(null)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldError>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function validate() {
      try {
        const res = await fetch(`/api/invitations/validate?token=${encodeURIComponent(token)}`)
        const data: InvitationData = await res.json()
        setInvitation(data)
        setState(data.valid ? 'valid' : 'invalid')
      } catch {
        setState('invalid')
      }
    }
    validate()
  }, [token])

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    const isNewUser = !invitation?.userExists
    const errors = validateFields(fullName, password, isNewUser)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setLoading(true)
    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          ...(isNewUser ? { password, fullName } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 410) {
          setState('invalid')
        } else {
          setServerError(data.error ?? 'Failed to accept invitation.')
        }
      } else {
        setState('success')
      }
    } catch {
      setServerError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (state === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Validating invitation...</p>
      </main>
    )
  }

  if (state === 'invalid') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Invalid invitation</h1>
          <p className="text-sm text-muted-foreground">
            This invitation link is invalid or has expired. Please ask your agency admin to send a
            new invitation.
          </p>
          <Link
            href="/auth/signin"
            className="inline-block text-sm underline underline-offset-4 hover:text-foreground"
          >
            Go to sign in
          </Link>
        </div>
      </main>
    )
  }

  if (state === 'success') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Welcome aboard!</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ve joined <strong>{invitation?.agencyName}</strong> as a{' '}
            <strong>{invitation?.role?.replace('_', ' ')}</strong>.
          </p>
          <Link
            href="/auth/signin"
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </main>
    )
  }

  const isNewUser = !invitation?.userExists

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">
            {isNewUser ? 'Create your account' : 'Accept invitation'}
          </h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ve been invited to join <strong>{invitation?.agencyName}</strong> as a{' '}
            <strong>{invitation?.role?.replace('_', ' ')}</strong>.
          </p>
        </div>

        <form onSubmit={handleAccept} noValidate className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              value={invitation?.email ?? ''}
              disabled
              className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm"
            />
          </div>

          {isNewUser && (
            <>
              <div className="space-y-1">
                <label htmlFor="fullName" className="text-sm font-medium">
                  Full name
                </label>
                <input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  aria-describedby={fieldErrors.fullName ? 'fullName-error' : undefined}
                  className={cn(
                    'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none',
                    'focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    fieldErrors.fullName ? 'border-destructive' : 'border-input'
                  )}
                />
                {fieldErrors.fullName && (
                  <p id="fullName-error" className="text-xs text-destructive">
                    {fieldErrors.fullName}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={fieldErrors.password ? 'password-error' : 'password-hint'}
                  className={cn(
                    'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none',
                    'focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    fieldErrors.password ? 'border-destructive' : 'border-input'
                  )}
                />
                {fieldErrors.password ? (
                  <p id="password-error" className="text-xs text-destructive">
                    {fieldErrors.password}
                  </p>
                ) : (
                  <p id="password-hint" className="text-xs text-muted-foreground">
                    Min 8 characters with uppercase, lowercase, and a number.
                  </p>
                )}
              </div>
            </>
          )}

          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Accepting...' : isNewUser ? 'Create account & join' : 'Accept invitation'}
          </button>
        </form>
      </div>
    </main>
  )
}
