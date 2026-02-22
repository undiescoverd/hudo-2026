'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

type FieldError = { fullName?: string; email?: string; password?: string }

function validate(fullName: string, email: string, password: string): FieldError {
  const errors: FieldError = {}
  if (!fullName.trim()) errors.fullName = 'Full name is required'
  if (!email.trim()) errors.email = 'Email is required'
  if (!password) errors.password = 'Password is required'
  else if (password.length < 8) errors.password = 'Password must be at least 8 characters'
  else if (!/[A-Z]/.test(password))
    errors.password = 'Password must contain at least one uppercase letter'
  else if (!/[a-z]/.test(password))
    errors.password = 'Password must contain at least one lowercase letter'
  else if (!/[0-9]/.test(password)) errors.password = 'Password must contain at least one number'
  return errors
}

export default function RegisterPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldError>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    const errors = validate(fullName, email, password)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setServerError(data.error ?? 'Registration failed. Please try again.')
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
            <Link href="/sign-in" className="underline underline-offset-4 hover:text-foreground">
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
