import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import type * as MiddlewareModule from './middleware'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon-key'

type Mw = typeof MiddlewareModule
let config: Mw['config']
let isPublicPath: Mw['isPublicPath']
let requiredRolesFor: Mw['requiredRolesFor']
let decideAccess: Mw['decideAccess']
let middleware: Mw['middleware']
let matcher: RegExp

// Dynamic import so the env vars above are set before the module-level check runs.
before(async () => {
  ;({ config, isPublicPath, requiredRolesFor, decideAccess, middleware } =
    await import('./middleware'))
  matcher = new RegExp('^' + config.matcher[0] + '$')
})

test('matcher matches app pages', () => {
  for (const p of [
    '/',
    '/dashboard',
    '/videos/123e4567-e89b-12d3-a456-426614174000',
    '/talent',
    '/settings/billing',
    '/auth/signin',
    // A file-like extension on a page path must not skip the auth check.
    '/talent/x.png',
    '/videos/abc.json',
    '/admin/x.js',
    '/favicon.icox',
  ]) {
    assert.ok(matcher.test(p), `should match ${p}`)
  }
})

test('matcher skips api, internals and static files', () => {
  for (const p of [
    '/api/webhooks/stripe',
    '/api/cron/storage-reconcile',
    '/api/videos/x/playback-url',
    '/_next/static/chunks/a.js',
    '/_next/image',
    '/favicon.ico',
    '/sw.js',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
    '/robots.txt',
    '/sitemap.xml',
  ]) {
    assert.ok(!matcher.test(p), `should not match ${p}`)
  }
})

test('isPublicPath: public pages', () => {
  for (const p of [
    '/auth/signin',
    '/auth/register',
    '/auth/invite/abc123',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/callback',
    '/guest/abc',
    '/guest/invalid',
    '/terms',
    '/privacy',
    '/dpa',
    '/offline',
  ]) {
    assert.equal(isPublicPath(p), true, p)
  }
})

test('isPublicPath: protected and prefix-confusion paths', () => {
  for (const p of [
    '/dashboard',
    '/videos',
    '/talent',
    '/',
    '/guestx',
    '/termsfoo',
    '/auth/signinx',
  ]) {
    assert.equal(isPublicPath(p), false, p)
  }
})

test('requiredRolesFor', () => {
  assert.deepEqual([...requiredRolesFor('/admin')!].sort(), ['admin_agent', 'owner'])
  assert.deepEqual([...requiredRolesFor('/agent/x')!].sort(), ['admin_agent', 'agent', 'owner'])
  assert.deepEqual([...requiredRolesFor('/talent')!].sort(), [
    'admin_agent',
    'agent',
    'owner',
    'talent',
  ])
  assert.equal(requiredRolesFor('/dashboard'), null)
  assert.equal(requiredRolesFor('/administrator'), null)
})

test('decideAccess role rules', () => {
  const d = (pathname: string, roles: string[], userPresent = true) =>
    decideAccess({ pathname, userPresent, roles })
  assert.equal(d('/admin', ['owner']), 'allow')
  assert.equal(d('/admin/x', ['admin_agent']), 'allow')
  assert.equal(d('/admin', ['agent']), 'forbidden')
  assert.equal(d('/admin', ['talent']), 'forbidden')
  assert.equal(d('/agent', ['agent']), 'allow')
  assert.equal(d('/agent', ['talent']), 'forbidden')
  assert.equal(d('/talent', ['talent']), 'allow')
  assert.equal(d('/talent', ['agent']), 'allow')
  assert.equal(d('/talent', []), 'forbidden')
  assert.equal(d('/dashboard', []), 'allow')
  assert.equal(d('/videos', ['talent']), 'allow')
  assert.equal(d('/dashboard', [], false), 'signin')
  assert.equal(d('/talent', [], false), 'signin')
  assert.equal(d('/guest/abc', [], false), 'allow')
})

test('middleware redirects signed-out request to sign-in', async () => {
  const res = await middleware(new NextRequest('http://localhost/dashboard'))
  assert.ok([302, 307].includes(res.status), `status ${res.status}`)
  const loc = new URL(res.headers.get('location')!)
  assert.equal(loc.pathname, '/auth/signin')
  assert.equal(loc.searchParams.get('redirect'), '/dashboard')
})

test('middleware lets public paths through', async () => {
  const res = await middleware(new NextRequest('http://localhost/guest/abc'))
  assert.equal(res.headers.get('location'), null)
  assert.equal(res.status, 200)
})
