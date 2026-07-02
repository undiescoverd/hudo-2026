import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { type NextRequest, NextResponse } from 'next/server'
import { roleAtLeast, type UserRole } from '@/lib/auth'
import {
  COMMENT_BODY_MAX_LENGTH,
  COMMENTS_PATCH_RATE_LIMIT,
  COMMENTS_DELETE_RATE_LIMIT,
  COMMENTS_RATE_WINDOW,
} from '@/lib/comments'
import { checkRateLimit, requireMembership } from '@/lib/api-helpers'
import { isValidUUID } from '@/lib/validation'

/**
 * PATCH /api/comments/:id
 *
 * Updates a comment. Supports two independent operations:
 * - Update `content` (own comments only; max COMMENT_BODY_MAX_LENGTH chars)
 * - Toggle `resolved` status (agent+ only; derives resolved_at / resolved_by)
 *
 * Security:
 * - Authenticated users only (401)
 * - User must have membership in the comment's agency (403)
 * - Talent users: content edits restricted to own comments only (403)
 * - Talent users: cannot resolve/unresolve comments (403)
 * - Soft-deleted comments cannot be edited (404)
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { id: commentId } = params

  if (!isValidUUID(commentId)) {
    return NextResponse.json({ error: 'Invalid comment ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[comments/[id]:PATCH] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Fail-closed on Redis error: comment mutations are authenticated but still
  // abuse-sensitive (spam/flood); see lib/api-helpers.ts for the posture rationale.
  const patchRl = await checkRateLimit(
    `comments:patch:user:${user.id}`,
    COMMENTS_PATCH_RATE_LIMIT,
    COMMENTS_RATE_WINDOW,
    'comments/[id]:PATCH',
    'Too many requests. Please try again later.',
    'fail-closed'
  )
  if (patchRl) return patchRl

  const admin = createAdminClient()

  // Fetch the comment — 404 if missing or soft-deleted
  const { data: comment, error: commentError } = await admin
    .from('comments')
    .select('id, user_id, agency_id, deleted_at')
    .eq('id', commentId)
    .single()

  if (commentError || !comment || comment.deleted_at !== null) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  // Check user membership in the comment's agency
  const membershipResult = await requireMembership(admin, user.id, comment.agency_id)
  if (membershipResult instanceof NextResponse) return membershipResult

  const role = membershipResult.role as UserRole

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 })
  }

  const b = body as Record<string, unknown>
  const updates: Record<string, unknown> = {}

  // Content update: only the comment owner may edit content
  if ('content' in b) {
    if (comment.user_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    if (typeof b.content !== 'string' || b.content.trim() === '') {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }
    if (b.content.length > COMMENT_BODY_MAX_LENGTH) {
      return NextResponse.json(
        { error: `content must be ${COMMENT_BODY_MAX_LENGTH} characters or fewer` },
        { status: 400 }
      )
    }
    updates.content = b.content
  }

  // Resolved update: agent+ only
  if ('resolved' in b) {
    if (!roleAtLeast(role, 'agent')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    if (typeof b.resolved !== 'boolean') {
      return NextResponse.json({ error: 'resolved must be a boolean' }, { status: 400 })
    }
    updates.resolved = b.resolved
    updates.resolved_at = b.resolved ? new Date().toISOString() : null
    updates.resolved_by = b.resolved ? user.id : null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data: updated, error: updateError } = await admin
    .from('comments')
    .update(updates)
    .eq('id', commentId)
    .is('deleted_at', null)
    .select()
    .single()

  if (updateError || !updated) {
    // If no rows matched, the comment was deleted between our check and update
    if (updateError?.code === 'PGRST116') {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }
    console.error('[comments/[id]:PATCH] Update failed:', updateError)
    return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 })
  }

  return NextResponse.json({ comment: updated })
}

/**
 * DELETE /api/comments/:id
 *
 * Soft-deletes a comment by setting deleted_at = now().
 * No hard DELETE is ever performed.
 *
 * Security:
 * - Authenticated users only (401)
 * - User must have membership in the comment's agency (403)
 * - Talent users: can only soft-delete their own comments (403)
 * - Agents and above: can soft-delete any comment in their agency
 * - Already-deleted comments return 404
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const { id: commentId } = params

  if (!isValidUUID(commentId)) {
    return NextResponse.json({ error: 'Invalid comment ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[comments/[id]:DELETE] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Fail-closed on Redis error — see lib/api-helpers.ts for the posture rationale.
  const deleteRl = await checkRateLimit(
    `comments:delete:user:${user.id}`,
    COMMENTS_DELETE_RATE_LIMIT,
    COMMENTS_RATE_WINDOW,
    'comments/[id]:DELETE',
    'Too many requests. Please try again later.',
    'fail-closed'
  )
  if (deleteRl) return deleteRl

  const admin = createAdminClient()

  // Fetch the comment — 404 if missing or already soft-deleted
  const { data: comment, error: commentError } = await admin
    .from('comments')
    .select('id, user_id, agency_id, deleted_at')
    .eq('id', commentId)
    .single()

  if (commentError || !comment || comment.deleted_at !== null) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  // Check user membership in the comment's agency
  const membershipResult = await requireMembership(admin, user.id, comment.agency_id)
  if (membershipResult instanceof NextResponse) return membershipResult

  const role = membershipResult.role as UserRole

  // Talent can only delete their own comments; agents+ can delete any
  if (role === 'talent' && comment.user_id !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Soft-delete only — never SQL DELETE
  const { data: deleted, error: updateError } = await admin
    .from('comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId)
    .is('deleted_at', null)
    .select('id')

  if (updateError) {
    console.error('[comments/[id]:DELETE] Soft-delete failed:', updateError)
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 })
  }

  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
