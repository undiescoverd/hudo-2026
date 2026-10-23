/**
 * Password validation rules per PRD security requirements.
 * Returns an error message string, or null if the password is valid.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters'
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter'
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter'
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number'
  return null
}

const REDIRECT_BASE = 'http://localhost'
const REDIRECT_BASE_ORIGIN = new URL(REDIRECT_BASE).origin

/**
 * Validates a redirect target is a same-origin path to prevent open redirect attacks.
 * Returns the raw target if it is a safe local path, otherwise `fallback`.
 * Browsers treat `\` as `/` and the URL parser drops tabs/newlines, so `/\evil.com` and
 * `/\t/evil.com` resolve cross-origin even though they start with a single `/`.
 */
export function safeRedirect(target: string | null, fallback = '/videos'): string {
  // '//' is protocol-relative; rejecting it up front also avoids `new URL` throwing on '//['.
  if (!target || !target.startsWith('/') || target.startsWith('//')) return fallback
  // Backslash, whitespace and control chars (C0 + DEL) are normalised away by URL parsers.
  if (/[\\\s\x00-\x1f\x7f]/.test(target)) return fallback
  const parsed = new URL(target, REDIRECT_BASE)
  // '/..//evil.com' normalises to '//evil.com' (protocol-relative); reject, never return `parsed`.
  if (parsed.origin !== REDIRECT_BASE_ORIGIN || parsed.pathname.startsWith('//')) return fallback
  return target
}
