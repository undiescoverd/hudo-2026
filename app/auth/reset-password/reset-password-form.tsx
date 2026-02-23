'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { validatePassword } from '@/lib/auth-validation'
import { cn } from '@/lib/utils'

type PageState = 'form' | 'success' | 'error'

export default function ResetPasswordForm() {
  const searchParams = useSearchParams()

  const [pageState, setPageState] = useState<PageState>('form')
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Supabase sends the recovery token as a URL hash fragment (#access_token=...&type=recovery).
  // The @supabase/ssr browser client automatically exchanges it on load.
  // We check for error_code in the query string which Supabase sets on invalid/expired links.
  useEffect(() => {
    const errorCode = searchParams.get('error_code')
    const errorDescription = searchParams.get('error_description')
    if (errorCode) {
      setTokenError(
        errorDescription
          ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
          : 'This password reset link is invalid or has expired. Please request a new one.'
      )
      setPageState('error')
    }
  }, [searchParams])

  function validate(): boolean {
    const errors: { password?: string; confirm?: string } = {}

    if (!password) {
      errors.password = 'Password is required'
    } else {
      const passwordError = validatePassword(password)
      if (passwordError) errors.password = passwordError
    }

    if (!confirm) {
      errors.confirm = 'Please confirm your password'
    } else if (password !== confirm) {
      errors.confirm = 'Passwords do not match'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    if (!validate()) return

    setLoading(true)
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        if (
          error.message.toLowerCase().includes('token') ||
          error.message.toLowerCase().includes('expired') ||
          error.message.toLowerCase().includes('invalid')
        ) {
          setTokenError(
            'This password reset link is invalid or has expired. Please request a new one.'
          )
          setPageState('error')
        } else {
          setServerError('Failed to update password. Please try again.')
        }
      } else {
        setPageState('success')
      }
    } catch {
      setServerError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (pageState === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Link expired</h1>
          <p className="text-sm text-muted-foreground">
            {tokenError ??
              'This password reset link is invalid or has expired. Please request a new one.'}
          </p>
          <Link
            href="/auth/forgot-password"
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Request new link
          </Link>
        </div>
      </main>
    )
  }

  if (pageState === 'success') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Password updated</h1>
          <p className="text-sm text-muted-foreground">
            Your password has been changed. You can now sign in with your new password.
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

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Set new password</h1>
          <p className="text-sm text-muted-foreground">Enter and confirm your new password.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium">
              New password
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

          <div className="space-y-1">
            <label htmlFor="confirm" className="text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-describedby={fieldErrors.confirm ? 'confirm-error' : undefined}
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none',
                'focus:ring-2 focus:ring-ring focus:ring-offset-2',
                fieldErrors.confirm ? 'border-destructive' : 'border-input'
              )}
            />
            {fieldErrors.confirm && (
              <p id="confirm-error" className="text-xs text-destructive">
                {fieldErrors.confirm}
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
            {loading ? 'Updating...' : 'Update password'}
          </button>
        </form>
      </div>
    </main>
  )
}
