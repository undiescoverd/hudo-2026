import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * R2 Storage Abstraction Module
 *
 * Single interface for all Cloudflare R2 operations. R2 is S3-compatible,
 * so we use the AWS SDK under the hood.
 *
 * CRITICAL: No R2 URLs are ever returned directly to the client.
 * All client access goes through signed URLs or the signing proxy
 * (/api/videos/:id/playback-url).
 */

/** Default signed URL expiry: 15 minutes (in seconds). */
const DEFAULT_SIGNED_URL_EXPIRY = 15 * 60

/** Storage interface — single abstraction for all R2 operations. */
export interface StorageClient {
  /** Upload an object to R2. */
  putObject(
    key: string,
    body: Buffer | Uint8Array | ReadableStream,
    contentType: string
  ): Promise<void>

  /** Retrieve an object from R2. Returns null if not found. */
  getObject(key: string): Promise<ReadableStream | null>

  /** Delete an object from R2. */
  deleteObject(key: string): Promise<void>

  /** Generate a presigned GET URL. Default expiry: 15 minutes. */
  generateSignedUrl(key: string, expiresIn?: number): Promise<string>
}

/**
 * Create an S3Client configured for Cloudflare R2 from environment variables.
 * Validates that all required env vars are present.
 */
function createR2Client(): { client: S3Client; bucket: string } {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const accountId = process.env.R2_ACCOUNT_ID
  const bucket = process.env.R2_BUCKET_NAME
  const endpoint = process.env.R2_ENDPOINT

  if (!accessKeyId || !secretAccessKey || !accountId || !bucket) {
    throw new Error(
      'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, and R2_BUCKET_NAME are required'
    )
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: endpoint || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })

  return { client, bucket }
}

/** Presigner function type — matches the signature of getSignedUrl from @aws-sdk/s3-request-presigner. */
type PresignerFn = (
  client: S3Client,
  command: GetObjectCommand,
  options: { expiresIn: number }
) => Promise<string>

/**
 * Create a StorageClient backed by Cloudflare R2.
 *
 * Production code: call with no arguments (reads env vars).
 * Tests: pass `overrides` to inject a mock S3Client and/or presigner.
 */
export function createStorageClient(overrides?: {
  client: S3Client
  bucket: string
  presigner?: PresignerFn
}): StorageClient {
  const { client, bucket } = overrides ?? createR2Client()
  const presigner: PresignerFn = overrides?.presigner ?? getSignedUrl

  return {
    async putObject(
      key: string,
      body: Buffer | Uint8Array | ReadableStream,
      contentType: string
    ): Promise<void> {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
      await client.send(command)
    },

    async getObject(key: string): Promise<ReadableStream | null> {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
      const response = await client.send(command)
      return (response.Body?.transformToWebStream() as ReadableStream) ?? null
    },

    async deleteObject(key: string): Promise<void> {
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
      await client.send(command)
    },

    async generateSignedUrl(
      key: string,
      expiresIn: number = DEFAULT_SIGNED_URL_EXPIRY
    ): Promise<string> {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
      return presigner(client, command, { expiresIn })
    },
  }
}

/**
 * Default storage singleton — lazily initialized from environment variables.
 * Uses service role credentials. Call `getStorage()` in API routes and server code.
 */
let _instance: StorageClient | null = null

export function getStorage(): StorageClient {
  if (!_instance) {
    _instance = createStorageClient()
  }
  return _instance
}
