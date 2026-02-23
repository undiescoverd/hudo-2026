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

/**
 * Validates redirect target is a same-origin path to prevent open redirect attacks.
 * Returns a safe redirect target: the input if it's a valid local path, otherwise '/'.
 */
export function safeRedirect(target: string | null): string {
  if (!target) return '/'
  // Must start with / and not // (protocol-relative URL)
  if (target.startsWith('/') && !target.startsWith('//')) return target
  return '/'
}
