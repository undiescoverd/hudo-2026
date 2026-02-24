'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Controlled form to submit a password-reset email request. */
export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setEmailError('Email is required')
      return
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setEmailError('Please enter a valid email address')
      return
    }
    setEmailError(null)

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      })
      const data = await res.json()
      if (res.status === 429) {
        setServerError(data.error ?? 'Too many requests. Please try again later.')
      } else if (!res.ok) {
        setServerError(data.error ?? 'Something went wrong. Please try again.')
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
            If an account exists for that email address, we&apos;ve sent a password reset link.
            Check your inbox and follow the instructions.
          </p>
          <Link
            href="/auth/signin"
            className="inline-block text-sm underline underline-offset-4 hover:text-foreground"
          >
            Back to sign in
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Reset your password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email address and we&apos;ll send you a reset link.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
              aria-describedby={emailError ? 'email-error' : undefined}
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none',
                'focus:ring-2 focus:ring-ring focus:ring-offset-2',
                emailError ? 'border-destructive' : 'border-input'
              )}
            />
            {emailError && (
              <p id="email-error" className="text-xs text-destructive">
                {emailError}
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
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Remembered your password?{' '}
          <Link href="/auth/signin" className="underline underline-offset-4 hover:text-foreground">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
