/**
 * Storage Quota Utilities
 *
 * Centralized helpers for storage quota operations.
 * RPCs are the authoritative source — these helpers wrap the Supabase calls.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Error code returned by increment_storage_usage when quota is exceeded. */
export const QUOTA_EXCEEDED_CODE = 'P0402'

/**
 * Check if a Supabase RPC error is a quota exceeded error.
 */
export function isQuotaExceededError(error: { message?: string; code?: string }): boolean {
  return (
    error.code === QUOTA_EXCEEDED_CODE || error.message?.includes('Storage quota exceeded') === true
  )
}

/**
 * Increment storage usage for an agency. Returns true on success, throws on error.
 * Uses the user-scoped client so auth.uid() is available in the RPC.
 */
export async function incrementStorageUsage(
  supabase: SupabaseClient,
  agencyId: string,
  bytes: number
): Promise<void> {
  const { error } = await supabase.rpc('increment_storage_usage', {
    p_agency_id: agencyId,
    p_bytes: bytes,
  })

  if (error) {
    throw error
  }
}

/**
 * Decrement storage usage for an agency (e.g., on video deletion).
 * Floors at 0 to prevent underflow.
 */
export async function decrementStorageUsage(
  supabase: SupabaseClient,
  agencyId: string,
  bytes: number
): Promise<void> {
  const { error } = await supabase.rpc('decrement_storage_usage', {
    p_agency_id: agencyId,
    p_bytes: bytes,
  })

  if (error) {
    throw error
  }
}
