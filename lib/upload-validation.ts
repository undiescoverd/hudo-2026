import { randomUUID } from 'crypto'

// --- Constants ---

export const ALLOWED_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number]

export const ALLOWED_EXTENSIONS = ['.mp4', '.mov'] as const

/** 10 GB in bytes */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 * 1024

/** Files <= 50 MB use a single presigned PUT */
export const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024

/** Each multipart part is 10 MB */
export const MULTIPART_PART_SIZE_BYTES = 10 * 1024 * 1024

/** 10 presigned URL requests per user per hour */
export const UPLOAD_RATE_LIMIT = 10

/** Rate limit window: 1 hour in seconds */
export const UPLOAD_RATE_WINDOW = 3600

/** Presigned URL expiry: 1 hour in seconds */
export const PRESIGNED_URL_EXPIRY = 3600

// --- Validation functions ---

export function validateContentType(contentType: string): string | null {
  if (!ALLOWED_CONTENT_TYPES.includes(contentType as AllowedContentType)) {
    return `Invalid content type: ${contentType}. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`
  }
  return null
}

export function validateFileSize(fileSizeBytes: number): string | null {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return 'File size must be a positive number'
  }
  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    return `File size ${fileSizeBytes} exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes (10 GB)`
  }
  return null
}

export function validateFileName(fileName: string): string | null {
  if (!fileName || typeof fileName !== 'string' || !fileName.trim()) {
    return 'File name is required'
  }
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    return `Invalid file extension: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
  }
  return null
}

// --- Utility functions ---

/**
 * Generate the R2 object key for a video upload.
 * Format: {agencyId}/{videoId}/{uploadId}.{ext}
 */
export function generateR2Key(agencyId: string, videoId: string, fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  const uploadId = randomUUID()
  return `${agencyId}/${videoId}/${uploadId}${ext}`
}

export function isMultipart(fileSizeBytes: number): boolean {
  return fileSizeBytes > MULTIPART_THRESHOLD_BYTES
}

export function calculatePartCount(fileSizeBytes: number): number {
  return Math.ceil(fileSizeBytes / MULTIPART_PART_SIZE_BYTES)
}
