/**
 * Tests for scripts/db-push.sh (supabase db push wrapper for hudo-dev / hudo-staging).
 *
 * A fake `supabase` executable is put first on PATH; it records its argv. No real
 * database or credential is touched. Fake passwords are built by concatenation so
 * this file contains no credential-looking literal.
 *
 * Run: pnpm exec tsx --test scripts/db-push.test.ts
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

const SCRIPT = path.resolve(__dirname, 'db-push.sh')
const DEV_REF = 'xyeqnjboqimvhdwnyqbt'
const STAGING_REF = 'egabjtxrrcuzooyclwgw'
const PROD_REF = 'ljesrugaovuoyqhitlsj'

// Awkward on purpose: every special character the spec calls out.
const FAKE_PW = 'Aa1' + '#?&$*+@/:%' + 'Zz9'

let dir: string
let binDir: string
let argvFile: string

function dbUrl(ref: string, pw = FAKE_PW) {
  return 'postgresql://' + 'postgres' + ':' + pw + '@db.' + ref + '.supabase.co:5432/postgres'
}

function writeEnv(name: string, line: string) {
  writeFileSync(path.join(dir, name), `FOO=bar\n${line}\nBAZ=qux\n`)
}

function run(args: string[], fakeExit = 0) {
  const r = spawnSync('sh', [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, FAKE_EXIT: String(fakeExit) },
  })
  const argv = existsSync(argvFile) ? readFileSync(argvFile, 'utf8').split('\n').filter(Boolean) : null
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, all: `${r.stdout}${r.stderr}`, argv }
}

function parsePooled(url: string) {
  const m = /^postgresql:\/\/([^:]+):([^@]+)@([^/]+)\/(.+)$/.exec(url)
  assert.ok(m, 'pooler URL has expected shape')
  return { user: m[1], pwEncoded: m[2], host: m[3], db: m[4] }
}

describe('db-push.sh', () => {
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'db-push-test-'))
    binDir = path.join(dir, 'bin')
    argvFile = path.join(dir, 'argv.txt')
    mkdirSync(binDir)
    const fake = path.join(binDir, 'supabase')
    writeFileSync(
      fake,
      [
        '#!/bin/sh',
        `for a in "$@"; do printf '%s\\n' "$a" >> "${argvFile}"; done`,
        'echo "A new version of Supabase CLI is available"',
        'echo "We recommend updating to the latest version"',
        'echo "connecting to ' + 'postgresql://' + 'user' + ':' + 'sec' + 'ret' + '@host"',
        // Echo the real --db-url so the masking is actually exercised.
        'echo "using $4" >&2',
        'exit "${FAKE_EXIT:-0}"',
        '',
      ].join('\n'),
    )
    chmodSync(fake, 0o755)
  })

  beforeEach(() => {
    rmSync(argvFile, { force: true })
    rmSync(path.join(dir, '.env.local'), { force: true })
    rmSync(path.join(dir, '.env.staging'), { force: true })
  })

  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('local: builds an encoded IPv4 pooler URL and passes extra args through', () => {
    writeEnv('.env.local', `SUPABASE_DB_URL="${dbUrl(DEV_REF)}"`)
    const r = run(['local', '--dry-run', '--include-all'])
    assert.equal(r.status, 0, r.all)
    assert.ok(r.argv)
    assert.deepEqual([r.argv[0], r.argv[1], r.argv[2]], ['db', 'push', '--db-url'])
    assert.deepEqual(r.argv.slice(4), ['--dry-run', '--include-all'])
    const u = parsePooled(r.argv[3])
    assert.equal(u.host, 'aws-1-eu-west-2.pooler.supabase.com:5432')
    assert.equal(u.user, `postgres.${DEV_REF}`)
    assert.equal(u.db, 'postgres')
    assert.equal(decodeURIComponent(u.pwEncoded), FAKE_PW)
    assert.match(u.pwEncoded, /^[A-Za-z0-9._~%-]+$/)
  })

  it('accepts an unquoted URL, the postgres:// scheme, and a POOLER_HOST override', () => {
    writeEnv('.env.staging', 'SUPABASE_DB_URL=' + dbUrl(STAGING_REF).replace('postgresql://', 'postgres://'))
    const r = spawnSync('sh', [SCRIPT, 'staging'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, POOLER_HOST: 'aws-9-eu-west-2.pooler.supabase.com' },
    })
    assert.equal(r.status, 0, r.stderr)
    const argv = readFileSync(argvFile, 'utf8').split('\n').filter(Boolean)
    const u = parsePooled(argv[3])
    assert.equal(u.host, 'aws-9-eu-west-2.pooler.supabase.com:5432')
    assert.equal(u.user, `postgres.${STAGING_REF}`)
    assert.equal(decodeURIComponent(u.pwEncoded), FAKE_PW)
  })

  it('never prints the raw or encoded password; masks URL credentials; drops CLI nag', () => {
    writeEnv('.env.local', `SUPABASE_DB_URL="${dbUrl(DEV_REF)}"`)
    const r = run(['local'])
    assert.equal(r.status, 0, r.all)
    assert.ok(!r.all.includes(FAKE_PW))
    assert.ok(!r.all.includes(encodeURIComponent(FAKE_PW)))
    assert.ok(!r.all.includes('secret'))
    assert.ok(r.all.includes('://***@'))
    assert.ok(!/new version of Supabase CLI/i.test(r.all))
    assert.ok(!/recommend updating/i.test(r.all))
  })

  it('--list runs `supabase migration list`', () => {
    writeEnv('.env.staging', `SUPABASE_DB_URL="${dbUrl(STAGING_REF)}"`)
    const r = run(['staging', '--list'])
    assert.equal(r.status, 0, r.all)
    assert.ok(r.argv)
    assert.deepEqual(r.argv.slice(0, 3), ['migration', 'list', '--db-url'])
    assert.equal(r.argv.length, 4)
  })

  it('refuses the prod ref in .env.staging and never invokes supabase', () => {
    writeEnv('.env.staging', `SUPABASE_DB_URL="${dbUrl(PROD_REF)}"`)
    const r = run(['staging'])
    assert.notEqual(r.status, 0)
    assert.equal(r.argv, null)
    assert.match(r.all, /prod/i)
    assert.ok(!r.all.includes(FAKE_PW))
  })

  it('refuses the dev ref in .env.staging and the staging ref in .env.local', () => {
    writeEnv('.env.staging', `SUPABASE_DB_URL="${dbUrl(DEV_REF)}"`)
    const a = run(['staging'])
    assert.notEqual(a.status, 0)
    assert.equal(a.argv, null)

    writeEnv('.env.local', `SUPABASE_DB_URL="${dbUrl(STAGING_REF)}"`)
    const b = run(['local'])
    assert.notEqual(b.status, 0)
    assert.equal(b.argv, null)
  })

  it('unknown env (prod, production, none) is a usage error (exit 2)', () => {
    writeEnv('.env.local', `SUPABASE_DB_URL="${dbUrl(DEV_REF)}"`)
    for (const args of [['prod'], ['production'], ['bogus'], []]) {
      const r = run(args)
      assert.equal(r.status, 2, `args=${args.join(' ')}`)
      assert.equal(r.argv, null)
    }
  })

  it('missing or malformed SUPABASE_DB_URL fails without echoing the password', () => {
    // no env file
    assert.notEqual(run(['local']).status, 0)

    // no SUPABASE_DB_URL line
    writeFileSync(path.join(dir, '.env.local'), 'FOO=bar\n')
    assert.notEqual(run(['local']).status, 0)

    // malformed shapes
    const bad = [
      'postgresql://postgres:' + FAKE_PW + '@example.com:5432/postgres',
      'mysql://postgres:' + FAKE_PW + '@db.' + DEV_REF + '.supabase.co:5432/postgres',
      FAKE_PW,
    ]
    for (const v of bad) {
      writeEnv('.env.local', `SUPABASE_DB_URL="${v}"`)
      const r = run(['local'])
      assert.notEqual(r.status, 0)
      assert.equal(r.argv, null)
      assert.ok(!r.all.includes(FAKE_PW), 'password leaked')
      assert.ok(!r.all.includes('.supabase.co:5432/postgres'), 'URL leaked')
    }
  })

  it('rejects passthrough args that could retarget the push (second --db-url, --linked, …)', () => {
    writeEnv('.env.local', `SUPABASE_DB_URL="${dbUrl(DEV_REF)}"`)
    for (const extra of [
      ['--db-url', 'postgresql://elsewhere'],
      ['--db-url=postgresql://elsewhere'],
      ['--linked'],
      ['--project-ref', PROD_REF],
      ['--dry-run', '--local'],
      ['--list', '--linked'],
    ]) {
      const r = run(['local', ...extra])
      assert.equal(r.status, 2, `expected usage error for ${extra.join(' ')}`)
      assert.equal(r.argv, null, `supabase must not run for ${extra.join(' ')}`)
    }
  })

  it('refuses a POOLER_HOST outside *.pooler.supabase.com', () => {
    writeEnv('.env.local', `SUPABASE_DB_URL="${dbUrl(DEV_REF)}"`)
    const r = spawnSync('sh', [SCRIPT, 'local'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, POOLER_HOST: 'evil.example.test' },
    })
    assert.notEqual(r.status, 0)
    assert.ok(!existsSync(argvFile), 'supabase must not run')
    assert.ok(!`${r.stdout}${r.stderr}`.includes(FAKE_PW))
  })

  it('propagates the supabase exit code', () => {
    writeEnv('.env.local', `SUPABASE_DB_URL="${dbUrl(DEV_REF)}"`)
    assert.equal(run(['local'], 3).status, 3)
    assert.equal(run(['local', '--list'], 7).status, 7)
  })
})
