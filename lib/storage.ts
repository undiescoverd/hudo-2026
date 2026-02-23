import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucketName = process.env.R2_BUCKET_NAME
  const endpoint = process.env.R2_ENDPOINT

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      'Missing required R2 environment variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME'
    )
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint: endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`,
  }
}

function createS3Client(): S3Client {
  const config = getR2Config()
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

/**
 * Generates a pre-signed URL for private R2 object access.
 *
 * CRITICAL: This is the only way object URLs are returned to clients.
 * Direct R2 object URLs are never exposed.
 *
 * @param key - R2 object key
 * @param expiresIn - Expiry in seconds (default: 900 = 15 minutes)
 * @returns Pre-signed HTTPS URL valid for `expiresIn` seconds
 */
export async function generateSignedUrl(key: string, expiresIn: number = 900): Promise<string> {
  const { bucketName } = getR2Config()
  const client = createS3Client()

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  })

  return getSignedUrl(client, command, { expiresIn })
}

/**
 * Uploads an object to R2.
 *
 * @param key - R2 object key
 * @param body - Object body (Buffer, Uint8Array, or ReadableStream)
 * @param contentType - MIME type of the object
 */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array | ReadableStream,
  contentType: string
): Promise<void> {
  const { bucketName } = getR2Config()
  const client = createS3Client()

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
}

/**
 * Deletes an object from R2.
 *
 * @param key - R2 object key
 */
export async function deleteObject(key: string): Promise<void> {
  const { bucketName } = getR2Config()
  const client = createS3Client()

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  )
}
