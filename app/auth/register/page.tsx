'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { validatePassword } from '@/lib/auth-validation'

type FieldError = { fullName?: string; agencyName?: string; email?: string; password?: string }

function validate(
  fullName: string,
  agencyName: string,
  email: string,
  password: string
): FieldError {
  const errors: FieldError = {}
  if (!fullName.trim()) errors.fullName = 'Full name is required'
  if (!agencyName.trim()) {
    errors.agencyName = 'Agency name is required'
  } else if (agencyName.trim().length > 100) {
    errors.agencyName = 'Agency name must be 100 characters or fewer'
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!email.trim()) {
    errors.email = 'Email is required'
  } else if (!EMAIL_RE.test(email.trim())) {
    errors.email = 'Please enter a valid email address'
  }
  const passwordError = !password ? 'Password is required' : validatePassword(password)
  if (passwordError) errors.password = passwordError
  return errors
}

export default function RegisterPage() {
  const [fullName, setFullName] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldError>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    const errors = validate(fullName, agencyName, email, password)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, agencyName, email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setServerError(data.error ?? 'Registration failed. Please try again.')
      } else if (data.session) {
        // Email confirmation is off: the server-side signUp session is not in the browser,
        // so sign in through the cookie-setting route, then land on the dashboard.
        const signIn = await fetch('/api/auth/signin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        })
        if (signIn.ok) {
          window.location.href = '/dashboard'
          return
        }
        setServerError('Account created. Please sign in to continue.')
      } else {
        setSubmitted(true)
      }
    } catch {
      setServerError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to <strong>{email}</strong>. Click the link to activate your
            account.
          </p>
          <p className="text-xs text-muted-foreground">
            Didn&apos;t receive it? Check your spam folder or{' '}
            <button
              onClick={() => setSubmitted(false)}
              className="underline underline-offset-4 hover:text-foreground"
            >
              try again
            </button>
            .
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Create your account</h1>
          <p className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link
              href="/auth/signin"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Sign in
            </Link>
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
            <label htmlFor="agencyName" className="text-sm font-medium">
              Agency name
            </label>
            <input
              id="agencyName"
              type="text"
              autoComplete="organization"
              maxLength={100}
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              aria-describedby={fieldErrors.agencyName ? 'agencyName-error' : undefined}
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none',
                'focus:ring-2 focus:ring-ring focus:ring-offset-2',
                fieldErrors.agencyName ? 'border-destructive' : 'border-input'
              )}
            />
            {fieldErrors.agencyName && (
              <p id="agencyName-error" className="text-xs text-destructive">
                {fieldErrors.agencyName}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none',
                'focus:ring-2 focus:ring-ring focus:ring-offset-2',
                fieldErrors.email ? 'border-destructive' : 'border-input'
              )}
            />
            {fieldErrors.email && (
              <p id="email-error" className="text-xs text-destructive">
                {fieldErrors.email}
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
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </main>
  )
}
