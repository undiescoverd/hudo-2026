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
let isForbidden: Mw['isForbidden']
let middleware: Mw['middleware']
let matcher: RegExp

// Dynamic import so the env vars above are set before the module-level check runs.
before(async () => {
  ;({ config, isPublicPath, requiredRolesFor, isForbidden, middleware } =
    await import('./middleware'))
  // Approximation of Next's compiled matcher (it also allows an optional
  // /_next/data/<build> prefix, .json suffix and trailing slash). Verified to
  // agree with getMiddlewareMatchers() on every path tested below.
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

test('isForbidden role rules', () => {
  assert.equal(isForbidden('/admin', ['owner']), false)
  assert.equal(isForbidden('/admin/x', ['admin_agent']), false)
  assert.equal(isForbidden('/admin', ['agent']), true)
  assert.equal(isForbidden('/admin', ['talent']), true)
  assert.equal(isForbidden('/agent', ['agent']), false)
  assert.equal(isForbidden('/agent', ['talent']), true)
  assert.equal(isForbidden('/talent', ['talent']), false)
  assert.equal(isForbidden('/talent', ['agent']), false)
  assert.equal(isForbidden('/talent', []), true)
  assert.equal(isForbidden('/agent', ['talent', 'agent']), false)
  assert.equal(isForbidden('/dashboard', []), false)
  assert.equal(isForbidden('/videos', ['talent']), false)
})

test('middleware redirects signed-out request to sign-in', async () => {
  const res = await middleware(new NextRequest('http://localhost/dashboard'))
  assert.ok([302, 307].includes(res.status), `status ${res.status}`)
  const loc = new URL(res.headers.get('location')!)
  assert.equal(loc.pathname, '/auth/signin')
  assert.equal(loc.searchParams.get('redirect'), '/dashboard')
})

test('middleware keeps the query string in redirect, not on the sign-in URL', async () => {
  const res = await middleware(new NextRequest('http://localhost/videos/abc?t=30'))
  const loc = new URL(res.headers.get('location')!)
  assert.equal(loc.pathname, '/auth/signin')
  assert.equal(loc.searchParams.get('redirect'), '/videos/abc?t=30')
  assert.equal(loc.searchParams.get('t'), null)
})

test('middleware redirects signed-out request on a role-gated path', async () => {
  const res = await middleware(new NextRequest('http://localhost/talent'))
  const loc = new URL(res.headers.get('location')!)
  assert.equal(loc.pathname, '/auth/signin')
  assert.equal(loc.searchParams.get('redirect'), '/talent')
})

test('middleware lets public paths through', async () => {
  const res = await middleware(new NextRequest('http://localhost/guest/abc'))
  assert.equal(res.headers.get('location'), null)
  assert.equal(res.status, 200)
})
