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

function createMockS3Client(options?: { returnUndefinedBody?: boolean }): {
  client: S3Client
  calls: SendCall[]
} {
  const calls: SendCall[] = []

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

  describe('StorageClient interface', () => {
    it('exports all required operations: put, get, delete, generateSignedUrl', () => {
      assert.equal(typeof storage.putObject, 'function')
      assert.equal(typeof storage.getObject, 'function')
      assert.equal(typeof storage.deleteObject, 'function')
      assert.equal(typeof storage.generateSignedUrl, 'function')
    })
  })
})
