/**
 * Guest link options shared by the guest-links route and the share modal.
 * Dependency-free so 'use client' components can import it.
 */

export const GUEST_LINK_LABEL_MAX = 80

export const EXPIRY_PRESETS = [
  { id: '24h', label: '24 hours', ms: 24 * 3600_000 },
  { id: '3d', label: '3 days', ms: 3 * 24 * 3600_000 },
  { id: '7d', label: '7 days', ms: 7 * 24 * 3600_000 },
  { id: 'never', label: 'Never', ms: null },
] as const

export type ExpiryPresetId = (typeof EXPIRY_PRESETS)[number]['id']

export const DEFAULT_EXPIRY_PRESET: ExpiryPresetId = '3d'

/** Longest accepted expires_at lead time (the 7 day preset) plus clock skew. */
export const MAX_EXPIRY_MS = 7 * 24 * 3600_000 + 5 * 60_000

/** expires_at ISO string for a preset, or null for "Never". */
export function expiresAtForPreset(id: ExpiryPresetId, now: number = Date.now()): string | null {
  const preset = EXPIRY_PRESETS.find((p) => p.id === id)
  return preset?.ms ? new Date(now + preset.ms).toISOString() : null
}

/** Trim a label; empty becomes null. Returns 'invalid' for non-strings or over-cap. */
export function normalizeLabel(raw: unknown): string | null | 'invalid' {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return 'invalid'
  const trimmed = raw.trim()
  if (!trimmed) return null
  return [...trimmed].length > GUEST_LINK_LABEL_MAX ? 'invalid' : trimmed
}
