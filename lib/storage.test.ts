/**
 * Unit tests for the R2 storage abstraction module.
 *
 * Uses the Node.js built-in test runner (node --test).
 * Tests use createStorageClient() with a mock S3Client and presigner injected.
 *
 * Run: npx tsx --test lib/storage.test.ts
 */

import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { S3Client } from '@aws-sdk/client-s3'
import type { StorageClient } from './storage'
import { createStorageClient } from './storage'

// --- Mock S3Client ---

interface SendCall {
  commandName: string
  input: Record<string, unknown>
}

interface PresignerCall {
  commandInput: Record<string, unknown>
  expiresIn: number
}

interface ListObjectsPage {
  Contents?: Array<{ Size?: number }>
  IsTruncated?: boolean
  NextContinuationToken?: string
}

function createMockS3Client(options?: {
  returnUndefinedBody?: boolean
  headNotFound?: boolean
  headContentLength?: number
  listPages?: ListObjectsPage[]
}): {
  client: S3Client
  calls: SendCall[]
} {
  const calls: SendCall[] = []
  let listPageIndex = 0

  const client = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      calls.push({
        commandName: command.constructor.name,
        input: command.input,
      })

      if (command.constructor.name === 'GetObjectCommand') {
        if (options?.returnUndefinedBody) {
          return { Body: undefined }
        }
        return {
          Body: {
            transformToWebStream: () => new ReadableStream(),
          },
        }
      }
      if (command.constructor.name === 'CreateMultipartUploadCommand') {
        return { UploadId: 'mock-upload-id-123' }
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        if (options?.headNotFound) {
          const err = new Error('NotFound')
          ;(err as Error & { name: string }).name = 'NotFound'
          throw err
        }
        return { ContentLength: options?.headContentLength ?? 1024 }
      }
      if (command.constructor.name === 'ListObjectsV2Command') {
        const pages = options?.listPages ?? [{ Contents: [], IsTruncated: false }]
        const page = pages[listPageIndex] ?? { Contents: [], IsTruncated: false }
        listPageIndex++
        return page
      }
      return {}
    },
  } as unknown as S3Client

  return { client, calls }
}

function createMockPresigner(): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presigner: any
  calls: PresignerCall[]
} {
  const calls: PresignerCall[] = []

  const presigner = async (
    _client: S3Client,
    command: { input: Record<string, unknown> },
    options: { expiresIn: number }
  ) => {
    calls.push({
      commandInput: command.input,
      expiresIn: options.expiresIn,
    })
    return `https://signed-url.example.com/${command.input.Key}?X-Amz-Expires=${options.expiresIn}`
  }

  return { presigner, calls }
}

const TEST_BUCKET = 'test-bucket'

describe('storage module', () => {
  let storage: StorageClient
  let sendCalls: SendCall[]
  let presignerCalls: PresignerCall[]

  beforeEach(() => {
    const mock = createMockS3Client()
    const mockPresigner = createMockPresigner()
    sendCalls = mock.calls
    presignerCalls = mockPresigner.calls
    storage = createStorageClient({
      client: mock.client,
      bucket: TEST_BUCKET,
      presigner: mockPresigner.presigner,
    })
  })

  describe('putObject', () => {
    it('sends PutObjectCommand with correct bucket, key, body, and content type', async () => {
      const body = Buffer.from('test-content')
      await storage.putObject('videos/test.mp4', body, 'video/mp4')

      assert.equal(sendCalls.length, 1)
      assert.equal(sendCalls[0].commandName, 'PutObjectCommand')
      assert.equal(sendCalls[0].input.Bucket, TEST_BUCKET)
      assert.equal(sendCalls[0].input.Key, 'videos/test.mp4')
      assert.equal(sendCalls[0].input.Body, body)
      assert.equal(sendCalls[0].input.ContentType, 'video/mp4')
    })

    it('supports Uint8Array body', async () => {
      const body = new Uint8Array([1, 2, 3])
      await storage.putObject('data/file.bin', body, 'application/octet-stream')

      assert.equal(sendCalls.length, 1)
      assert.equal(sendCalls[0].input.Key, 'data/file.bin')
      assert.equal(sendCalls[0].input.Body, body)
      assert.equal(sendCalls[0].input.ContentType, 'application/octet-stream')
    })
  })

  describe('getObject', () => {
    it('sends GetObjectCommand and returns a ReadableStream', async () => {
      const result = await storage.getObject('videos/test.mp4')

      assert.equal(sendCalls.length, 1)
      assert.equal(sendCalls[0].commandName, 'GetObjectCommand')
      assert.equal(sendCalls[0].input.Bucket, TEST_BUCKET)
      assert.equal(sendCalls[0].input.Key, 'videos/test.mp4')
      assert.ok(result instanceof ReadableStream)
    })

    it('returns null when Body is undefined', async () => {
      const mock = createMockS3Client({ returnUndefinedBody: true })
      const mockPresigner = createMockPresigner()
      const nullStorage = createStorageClient({
        client: mock.client,
        bucket: TEST_BUCKET,
        presigner: mockPresigner.presigner,
      })

      const result = await nullStorage.getObject('missing/file.mp4')
      assert.equal(result, null)
    })
  })

  describe('deleteObject', () => {
    it('sends DeleteObjectCommand with correct bucket and key', async () => {
      await storage.deleteObject('videos/old.mp4')

      assert.equal(sendCalls.length, 1)
      assert.equal(sendCalls[0].commandName, 'DeleteObjectCommand')
      assert.equal(sendCalls[0].input.Bucket, TEST_BUCKET)
      assert.equal(sendCalls[0].input.Key, 'videos/old.mp4')
    })
  })

  describe('generateSignedUrl', () => {
    it('returns a presigned URL string', async () => {
      const url = await storage.generateSignedUrl('videos/test.mp4')

      assert.equal(typeof url, 'string')
      assert.ok(url.length > 0)
      assert.equal(presignerCalls.length, 1)
    })

    it('uses default 15-minute expiry (900 seconds)', async () => {
      await storage.generateSignedUrl('videos/test.mp4')

      assert.equal(presignerCalls.length, 1)
      assert.equal(presignerCalls[0].expiresIn, 900) // 15 * 60
    })

    it('accepts a custom expiresIn value', async () => {
      await storage.generateSignedUrl('videos/test.mp4', 3600)

      assert.equal(presignerCalls.length, 1)
      assert.equal(presignerCalls[0].expiresIn, 3600)
    })

    it('passes correct bucket and key to presigner', async () => {
      await storage.generateSignedUrl('uploads/agency-123/video.mp4')

      assert.equal(presignerCalls.length, 1)
      assert.equal(presignerCalls[0].commandInput.Bucket, TEST_BUCKET)
      assert.equal(presignerCalls[0].commandInput.Key, 'uploads/agency-123/video.mp4')
    })

    it('never returns a direct R2 URL — always delegates to presigner', async () => {
      const url = await storage.generateSignedUrl('videos/test.mp4')

      // Verify the URL came from the presigner (our mock), not a raw R2 endpoint
      assert.ok(
        url.startsWith('https://signed-url.example.com/'),
        'URL must come from presigner, not raw R2 endpoint'
      )
      assert.equal(presignerCalls.length, 1)
    })
  })

  describe('generateUploadUrl', () => {
    it('returns a presigned URL via the presigner', async () => {
      const url = await storage.generateUploadUrl('uploads/test.mp4', 'video/mp4', 1024)

      assert.equal(typeof url, 'string')
      assert.ok(url.length > 0)
      assert.equal(presignerCalls.length, 1)
    })

    it('passes content type and content length to presigner command', async () => {
      await storage.generateUploadUrl('uploads/test.mp4', 'video/mp4', 2048, 3600)

      assert.equal(presignerCalls.length, 1)
      assert.equal(presignerCalls[0].commandInput.Bucket, TEST_BUCKET)
      assert.equal(presignerCalls[0].commandInput.Key, 'uploads/test.mp4')
      assert.equal(presignerCalls[0].commandInput.ContentType, 'video/mp4')
      assert.equal(presignerCalls[0].commandInput.ContentLength, 2048)
      assert.equal(presignerCalls[0].expiresIn, 3600)
    })

    it('uses default 15-minute expiry when not specified', async () => {
      await storage.generateUploadUrl('k', 'video/mp4', 1)

      assert.equal(presignerCalls[0].expiresIn, 900)
    })
  })

  describe('createMultipartUpload', () => {
    it('sends CreateMultipartUploadCommand and returns the upload ID', async () => {
      const uploadId = await storage.createMultipartUpload('uploads/big.mp4', 'video/mp4')

      assert.equal(uploadId, 'mock-upload-id-123')
      assert.equal(sendCalls.length, 1)
      assert.equal(sendCalls[0].commandName, 'CreateMultipartUploadCommand')
      assert.equal(sendCalls[0].input.Bucket, TEST_BUCKET)
      assert.equal(sendCalls[0].input.Key, 'uploads/big.mp4')
      assert.equal(sendCalls[0].input.ContentType, 'video/mp4')
    })
  })

  describe('generatePartUploadUrl', () => {
    it('returns a presigned URL for the specified part', async () => {
      const url = await storage.generatePartUploadUrl('uploads/big.mp4', 'upload-123', 3)

      assert.equal(typeof url, 'string')
      assert.equal(presignerCalls.length, 1)
      assert.equal(presignerCalls[0].commandInput.Bucket, TEST_BUCKET)
      assert.equal(presignerCalls[0].commandInput.Key, 'uploads/big.mp4')
      assert.equal(presignerCalls[0].commandInput.UploadId, 'upload-123')
      assert.equal(presignerCalls[0].commandInput.PartNumber, 3)
    })

    it('accepts custom expiry', async () => {
      await storage.generatePartUploadUrl('k', 'u', 1, 7200)
      assert.equal(presignerCalls[0].expiresIn, 7200)
    })
  })

  describe('completeMultipartUpload', () => {
    it('sends CompleteMultipartUploadCommand with parts', async () => {
      const parts = [
        { ETag: '"etag1"', PartNumber: 1 },
        { ETag: '"etag2"', PartNumber: 2 },
      ]
      await storage.completeMultipartUpload('uploads/big.mp4', 'upload-123', parts)

      assert.equal(sendCalls.length, 1)
      assert.equal(sendCalls[0].commandName, 'CompleteMultipartUploadCommand')
      assert.equal(sendCalls[0].input.Bucket, TEST_BUCKET)
      assert.equal(sendCalls[0].input.Key, 'uploads/big.mp4')
      assert.equal(sendCalls[0].input.UploadId, 'upload-123')
      assert.deepEqual((sendCalls[0].input.MultipartUpload as { Parts: typeof parts }).Parts, parts)
    })
  })

  describe('abortMultipartUpload', () => {
    it('sends AbortMultipartUploadCommand', async () => {
      await storage.abortMultipartUpload('uploads/big.mp4', 'upload-123')

      assert.equal(sendCalls.length, 1)
      assert.equal(sendCalls[0].commandName, 'AbortMultipartUploadCommand')
      assert.equal(sendCalls[0].input.Bucket, TEST_BUCKET)
      assert.equal(sendCalls[0].input.Key, 'uploads/big.mp4')
      assert.equal(sendCalls[0].input.UploadId, 'upload-123')
    })
  })

  describe('headObject', () => {
    it('returns contentLength when object exists', async () => {
      const mock = createMockS3Client({ headContentLength: 5000 })
      const mockPresigner = createMockPresigner()
      const s = createStorageClient({
        client: mock.client,
        bucket: TEST_BUCKET,
        presigner: mockPresigner.presigner,
      })

      const result = await s.headObject('uploads/test.mp4')

      assert.deepEqual(result, { contentLength: 5000 })
      assert.equal(mock.calls.length, 1)
      assert.equal(mock.calls[0].commandName, 'HeadObjectCommand')
      assert.equal(mock.calls[0].input.Bucket, TEST_BUCKET)
      assert.equal(mock.calls[0].input.Key, 'uploads/test.mp4')
    })

    it('returns null when object is not found', async () => {
      const mock = createMockS3Client({ headNotFound: true })
      const mockPresigner = createMockPresigner()
      const s = createStorageClient({
        client: mock.client,
        bucket: TEST_BUCKET,
        presigner: mockPresigner.presigner,
      })

      const result = await s.headObject('missing/file.mp4')
      assert.equal(result, null)
    })
  })

  describe('sumSizesUnderPrefix', () => {
    it('returns 0 for an empty prefix (no objects)', async () => {
      const mock = createMockS3Client({
        listPages: [{ Contents: [], IsTruncated: false }],
      })
      const s = createStorageClient({ client: mock.client, bucket: TEST_BUCKET })
      const total = await s.sumSizesUnderPrefix('agency-123/')
      assert.equal(total, 0)
      assert.equal(mock.calls.length, 1)
      assert.equal(mock.calls[0].commandName, 'ListObjectsV2Command')
      assert.equal(mock.calls[0].input.Prefix, 'agency-123/')
    })

    it('returns the sum of sizes on a single page', async () => {
      const mock = createMockS3Client({
        listPages: [
          {
            Contents: [{ Size: 100 }, { Size: 200 }, { Size: 300 }],
            IsTruncated: false,
          },
        ],
      })
      const s = createStorageClient({ client: mock.client, bucket: TEST_BUCKET })
      const total = await s.sumSizesUnderPrefix('agency-abc/')
      assert.equal(total, 600)
    })

    it('paginates across multiple pages using ContinuationToken', async () => {
      const mock = createMockS3Client({
        listPages: [
          {
            Contents: [{ Size: 1000 }],
            IsTruncated: true,
            NextContinuationToken: 'token-page-2',
          },
          {
            Contents: [{ Size: 2000 }, { Size: 3000 }],
            IsTruncated: false,
          },
        ],
      })
      const s = createStorageClient({ client: mock.client, bucket: TEST_BUCKET })
      const total = await s.sumSizesUnderPrefix('agency-xyz/')

      assert.equal(total, 6000, 'Must sum across both pages: 1000 + 2000 + 3000')
      assert.equal(mock.calls.length, 2, 'Must make exactly two ListObjectsV2Command calls')
      // Second call must carry the continuation token from the first response.
      assert.equal(mock.calls[1].input.ContinuationToken, 'token-page-2')
    })

    it('treats undefined Size as 0', async () => {
      const mock = createMockS3Client({
        listPages: [
          {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Contents: [{ Size: undefined as any }, { Size: 500 }],
            IsTruncated: false,
          },
        ],
      })
      const s = createStorageClient({ client: mock.client, bucket: TEST_BUCKET })
      const total = await s.sumSizesUnderPrefix('prefix/')
      assert.equal(total, 500)
    })

    it('returns 0 when Contents is undefined (empty bucket prefix)', async () => {
      const mock = createMockS3Client({
        listPages: [{ IsTruncated: false }], // no Contents key at all
      })
      const s = createStorageClient({ client: mock.client, bucket: TEST_BUCKET })
      const total = await s.sumSizesUnderPrefix('empty/')
      assert.equal(total, 0)
    })
  })

  describe('StorageClient interface', () => {
    it('exports all required operations', () => {
      assert.equal(typeof storage.putObject, 'function')
      assert.equal(typeof storage.getObject, 'function')
      assert.equal(typeof storage.deleteObject, 'function')
      assert.equal(typeof storage.generateSignedUrl, 'function')
      assert.equal(typeof storage.generateUploadUrl, 'function')
      assert.equal(typeof storage.createMultipartUpload, 'function')
      assert.equal(typeof storage.generatePartUploadUrl, 'function')
      assert.equal(typeof storage.completeMultipartUpload, 'function')
      assert.equal(typeof storage.abortMultipartUpload, 'function')
      assert.equal(typeof storage.headObject, 'function')
      assert.equal(typeof storage.sumSizesUnderPrefix, 'function')
    })
  })
})
