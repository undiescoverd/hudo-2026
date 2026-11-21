import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const ORIGIN = 'https://hudo.example'
const src = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8')

interface Res {
  ok: boolean
  status: number
  type: string
  redirected: boolean
  clone(): Res
}
const res = (over: Partial<Res> = {}): Res => ({
  ok: true,
  status: 200,
  type: 'basic',
  redirected: false,
  clone() {
    return this
  },
  ...over,
})

function setup(networkRes: Res, cached?: Res) {
  const puts: string[] = []
  const fetched: string[] = []
  let fetchHandler: ((e: unknown) => void) | undefined
  const cache = {
    match: async () => cached,
    put: async (r: { url: string }) => {
      puts.push(r.url)
    },
  }
  vm.runInNewContext(src, {
    URL,
    Promise,
    Response: { error: () => 'error-response' },
    fetch: async (r: { url: string }) => {
      fetched.push(r.url)
      return networkRes
    },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    self: {
      location: { origin: ORIGIN },
      addEventListener: (n: string, h: (e: unknown) => void) => {
        if (n === 'fetch') fetchHandler = h
      },
    },
  })
  async function run(url: string, over: { mode?: string; auth?: boolean; method?: string } = {}) {
    const waits: Promise<unknown>[] = []
    const ev = {
      request: {
        url: ORIGIN + url,
        method: over.method ?? 'GET',
        mode: over.mode ?? 'no-cors',
        headers: { has: (h: string) => !!over.auth && h === 'Authorization' },
      },
      responded: undefined as Promise<unknown> | undefined,
      respondWith(p: Promise<unknown>) {
        this.responded = p
      },
      waitUntil(p: Promise<unknown>) {
        waits.push(p)
      },
    }
    fetchHandler!(ev)
    if (ev.responded) await ev.responded
    await Promise.all(waits)
    return { intercepted: ev.responded !== undefined, puts, fetched }
  }
  return run
}

describe('public/sw.js fetch handler', () => {
  it('stores an allowed 200 basic response', async () => {
    const r = await setup(res())('/_next/static/a.js')
    assert.deepEqual(r.puts, [ORIGIN + '/_next/static/a.js'])
  })
  it('never stores a navigation response', async () => {
    const r = await setup(res())('/offline', { mode: 'navigate' })
    assert.equal(r.puts.length, 0)
    assert.equal(r.fetched.length, 1)
  })
  it('never stores a 206 partial response', async () => {
    const r = await setup(res({ status: 206 }))('/_next/static/a.js')
    assert.equal(r.puts.length, 0)
  })
  it('never stores a redirected response', async () => {
    const r = await setup(res({ redirected: true }))('/_next/static/a.js')
    assert.equal(r.puts.length, 0)
  })
  it('never stores a non-basic response', async () => {
    const r = await setup(res({ type: 'cors' }))('/_next/static/a.js')
    assert.equal(r.puts.length, 0)
  })
  it('does not intercept a request with an Authorization header', async () => {
    const r = await setup(res())('/icons/icon-192.png', { auth: true })
    assert.equal(r.intercepted, false)
    assert.equal(r.puts.length, 0)
  })
  it('does not intercept /api or non-GET requests', async () => {
    assert.equal((await setup(res())('/api/videos')).intercepted, false)
    assert.equal((await setup(res())('/icons/icon-192.png', { method: 'POST' })).intercepted, false)
  })
  it('serves cached static assets without hitting the network', async () => {
    const r = await setup(res(), res())('/_next/static/a.js')
    assert.equal(r.fetched.length, 0)
  })
  it('revalidates cached shell pages in the background', async () => {
    const r = await setup(res(), res())('/offline')
    assert.equal(r.fetched.length, 1)
    assert.deepEqual(r.puts, [ORIGIN + '/offline'])
  })
})
