# Archive, deletion & GDPR erasure — design spec

**Status:** agreed with the user on 2026-10-14 (grilling session, Q1–Q20). Implementation plan: [`docs/superpowers/plans/2026-10-14-archive-deletion-gdpr.md`](../plans/2026-10-14-archive-deletion-gdpr.md).

## Why
- Users need to get rid of videos, and storage costs money from day one.
- GDPR requires that we can erase everything belonging to a person, or a whole agency, on request.
- The user's previous app struggled with deletion further up its folder hierarchy and had to fall back on cascade deletes. Here, every level deletes the same way (see "The delete path" below).

## How it is today (verified in code, 2026-10-14)
- **What already cleans up after itself.** The tables form a chain: `agencies → videos → video_versions → comments`. Deleting a video automatically removes:
  - its versions and their comments
  - its `guest_links`
  - its `comment_reads`
- **Three links block deletion.** Each references a row without saying what happens when that row is deleted, so the database refuses:
  - `notifications.video_id` and `notifications.comment_id`: any video that ever produced a notification cannot be deleted.
  - `guest_links.video_version_id`: a version pinned by a guest link cannot be deleted.
  - `videos.active_version_id`: the current version cannot be deleted directly.
- **Nothing deletes R2 files.** `StorageClient.deleteObject` exists but nothing calls it. Deleting an agency today would orphan every file it ever uploaded.
- **Storage usage never goes down.** `decrement_storage_usage(p_agency_id, p_bytes)` (migration 0007) only runs as an upload rollback. Its comment says "called on delete (future)".
- **`audit_log` survives deletes.** `resource_id` is a plain uuid, not a foreign key, so log rows outlive the video they describe. The one exception: `audit_log.agency_id` deletes with its agency.
- **User erasure leaves the talent's videos behind.** `lib/erasure.ts` `eraseUser` anonymises the user (tombstone), but leaves every video where `talent_id` is that user, and every R2 file.
- **Erasure reaches across agencies.** An owner of agency A can erase a talent's whole account (`canEraseUser`), including what they have with agency B.
- **Two upload leftovers waste storage:**
  - Failed retries leave empty `draft` videos (bug B2).
  - Abandoned multipart uploads leave orphaned parts in R2.

## Decisions
| # | Decision |
|---|---|
| D1 | **Archive** is the name: the action is "Archive", the place is "Archived". It is a bin: archived items are permanently deleted after a retention period. |
| D2 | You can archive a **whole video** or an **old version**. The **current version** can't be archived on its own; archive the video or upload a new version instead. |
| D3 | An archived item disappears from dashboards and search, its guest links stop working, it can't be commented on or approved, and it **still counts against storage**. It can be restored. |
| D4 | **Retention:** permanently deleted **30 days** after archiving. The top plan (`agency_pro`) gets an opt-in setting to keep the archive until it is emptied by hand. On a downgrade away from that plan, everything already archived gets a fresh 30-day timer and the owner is emailed. |
| D5 | **Who can do what:** talent archive and restore **their own** videos; agents (owner, admin_agent, agent) archive and restore **any video in their agency**. Only **owner and admin_agent** can permanently delete before the timer runs out. |
| D6 | **Comments rule change.** A single comment is still soft-delete only; no endpoint hard-deletes one. Comments are hard-deleted **only** as part of permanently deleting their video or version. CLAUDE.md must be updated to say this. |
| D7 | **One delete path for every level** (version, video, a person's data, an agency). See "The delete path" below. |
| D8 | **Space savers:** an R2 lifecycle rule aborts incomplete multipart uploads after 1 day, and the daily job purges empty drafts (no versions) older than 24 hours. Old versions are **not** auto-deleted on approval. |
| D9 | **Restore:** a restored version goes back into the history as an old version, never the current one. Restoring a video restores its archived versions too. |
| D10 | **No notification** on archive or restore. The Archived view shows who archived each item, when, and when it will be deleted. |
| D11 | The Archived view is an **"Archived · N" chip** at the end of the status chips on both dashboards. There is no new nav item. |
| D12 | **Erasing a talent** permanently deletes every video they are the talent on, immediately, with no 30-day bin. Comments they wrote on other people's videos keep their text and show "Deleted User", as erasure does today. |
| D13 | **Erasure is scoped to one agency.** When an agency removes someone (owner, or admin_agent for non-elevated targets), the system permanently deletes that person's videos **in that agency only** and removes their membership. If that leaves them in no agency, the whole account is erased. A person erasing **themselves** erases everything, everywhere. |
| D14 | **Agency closure** (owner only): the owner types the agency name to confirm. Access is cut immediately and the Stripe subscription is cancelled. After a **7-day cancel window**, the delete path removes everything, and members left in no agency are erased. Deleting the agency's `audit_log` rows along with it is the single documented exception to the insert-only rule. |
| D15 | **Emails:** the erased person gets a confirmation; the agency owner gets a receipt whenever someone is removed with their data; agency closure emails the owner at the start and end of the 7 days, plus the other members. |
| D16 | **Tracking:** one umbrella GitHub issue plus five sub-issues plus three bug issues. Sprint tasks go into `tasks/sprint-N.md` and sync to Linear through `orchestrate.js`. |
| D17 | **Order:** S4 (launch) gets the 3 bugs, the delete path, erasure and space savers. The archive UI and agency closure come right after launch; until then a closure is run by hand through the delete path. |

## The delete path (D7)
Every level of delete goes through the same two steps.

**1. One database function per level, each running as a single transaction.** The functions are `purge_video_version`, `purge_video`, `purge_talent_in_agency` and `purge_agency`. They are `SECURITY DEFINER` and executable by `service_role` only. Each one:
1. Collects every R2 key involved (version files and the video thumbnail) into a `storage_deletions` queue table.
2. Lowers `agencies.storage_usage_bytes` by the version bytes, never below 0.
3. Writes an `audit_log` row (`video_purged` / `version_purged`). Agency purge writes none; its log rows cascade away.
4. Deletes the rows and lets the database cascade the rest. The three blocking links are fixed so cascades succeed:
   - notifications cascade with their video or comment
   - guest links cascade with their pinned version
   - `active_version_id` is cleared first

**2. A daily cron job, `/api/cron/storage-purge`.** It:
1. Purges archived items whose retention has expired.
2. Purges empty drafts.
3. Deletes the queued R2 keys in batches, retrying failures. A key that is already gone counts as success.

**Why this shape:**
- **Agency deletion works without special-casing.** Deleting from higher up is just more rows on the same queue.
- **No unpaid storage leaks.** A crash between the database and R2 never leaves files without records pointing at them, because the queue is the record.

## Bugs found during the upload-flow design (fix in S4)
- **B1 · Agent uploads are owned by the agent.** `app/(dashboard)/upload/page.tsx` never sends `talentId`, so presign sets `talent_id = caller`. Fix: an agent must pick a talent (roster = memberships with role `talent` in the agency). A talent uploading never sends it.
- **B2 · Every retry creates a new empty draft.** `handleRetry` calls presign again without `videoId`. Fix: reuse the `videoId` from the first presign.
- **B3 · "Past due" shows as quota exceeded.** `performUpload` maps every 402 to "Storage quota exceeded", and `UploadProgress` shows the quota panel for any message containing "quota". Fix: pass the server's error message through, and only show the quota panel for the real quota message.

## Out of scope / later
- **Plan display names.** Options are in the upload brief; the user is choosing. IDs and Stripe lookup keys stay unchanged either way.
- **Multi-agency selector on upload.** Deferred to a future version.
- **Auto-deleting old versions** on approval.
- **Cold storage** tiers.
