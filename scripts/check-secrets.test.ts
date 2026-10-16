/**
 * Tests for scripts/check-secrets.sh (the pre-commit / pre-push / CI secret scan).
 *
 * Every fake secret is built by string concatenation so this file contains no
 * literal that GitGuardian (or the scanner itself) would flag.
 *
 * Run: pnpm exec tsx --test scripts/check-secrets.test.ts
 */

import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

const SCRIPT = path.resolve(__dirname, 'check-secrets.sh')

// Fake values, assembled at runtime.
const FAKE_PASSWORD = 'Zq9' + 'Lm2Xv' + '7Rt4Kw'
const FAKE_JWT = 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.' + 'eyJ' + 'yb2xlIjoic2VydmljZV9yb2xlIn0' + '.' + 'c2ln' + 'bmF0dXJl'
const FAKE_STRIPE = 'sk_' + 'live_' + 'A1b2C3d4E5f6G7h8I9j0'

let repo: string

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
}

function write(rel: string, content: string) {
  const full = path.join(repo, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function stage(rel: string, content: string) {
  write(rel, content)
  git('add', '--', rel)
}

function scan(...args: string[]) {
  const r = spawnSync('sh', ['scripts/check-secrets.sh', ...args], { cwd: repo, encoding: 'utf8' })
  return { status: r.status, output: `${r.stdout}${r.stderr}` }
}

describe('check-secrets.sh', () => {
  before(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'check-secrets-test-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('config', 'commit.gpgsign', 'false')
    mkdirSync(path.join(repo, 'scripts'))
    copyFileSync(SCRIPT, path.join(repo, 'scripts', 'check-secrets.sh'))
    write('README.md', '# temp\n')
    git('add', '--', 'README.md')
    git('commit', '-q', '-m', 'init')
  })

  beforeEach(() => {
    git('reset', '-q', '--hard', 'HEAD')
    git('clean', '-fdq', '-e', 'scripts')
  })

  after(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('flags a staged hardcoded password and never prints the full value', () => {
    stage('src/seed.ts', `const user = { password: "${FAKE_PASSWORD}" }\n`)
    const { status, output } = scan('--staged')
    assert.equal(status, 1)
    assert.match(output, /src\/seed\.ts:1: hardcoded-credential/)
    assert.ok(!output.includes(FAKE_PASSWORD), 'full value must be masked')
    assert.ok(output.includes(FAKE_PASSWORD.slice(0, 4) + '…'))
    assert.match(output, /process\.env/)
    assert.match(output, /secret-scan: allow/)
  })

  it('flags an UPPER_SNAKE credential constant', () => {
    stage('scripts/seed.mjs', `const TEST_PASSWORD = '${FAKE_PASSWORD}'\n`)
    assert.equal(scan().status, 1) // no argument == --staged
  })

  it('flags a staged fake JWT and masks it', () => {
    stage('lib/keys.ts', `export const k = '${FAKE_JWT}'\n`)
    const { status, output } = scan('--staged')
    assert.equal(status, 1)
    assert.match(output, /lib\/keys\.ts:1: jwt/)
    assert.ok(!output.includes(FAKE_JWT))
  })

  it('flags a live Stripe key', () => {
    stage('lib/pay.ts', `const x = "${FAKE_STRIPE}"\n`)
    const { status, output } = scan('--staged')
    assert.equal(status, 1)
    assert.ok(!output.includes(FAKE_STRIPE))
  })

  it('flags a private key header', () => {
    stage('keys/id.txt', '-----BEGIN ' + 'RSA PRIVATE KEY-----\n')
    assert.equal(scan('--staged').status, 1)
  })

  it('flags a staged .env.local but allows .env.example', () => {
    stage('.env.local', 'FOO=bar\n')
    const { status, output } = scan('--staged')
    assert.equal(status, 1)
    assert.match(output, /\.env\.local:0: env-file/)

    git('reset', '-q', '--hard', 'HEAD')
    git('clean', '-fdq', '-e', 'scripts')
    stage('.env.example', 'FOO=\n')
    assert.equal(scan('--staged').status, 0)
  })

  it('passes clean files and process.env usage', () => {
    stage('src/ok.ts', 'const password = process.env.DEV_QUICK_PASSWORD\nconst x = 1\n')
    stage('src/ph.ts', 'const password = "<your-password-here>"\nconst token = "changeme-changeme"\n')
    assert.equal(scan('--staged').status, 0)
  })

  it('ignores lines marked secret-scan: allow', () => {
    stage('src/fixture.ts', `const password = "${FAKE_PASSWORD}" // secret-scan: allow\n`)
    assert.equal(scan('--staged').status, 0)
  })

  it('skips test files, tests/ and the lockfile', () => {
    stage('lib/a.test.ts', `const password = "${FAKE_PASSWORD}"\n`)
    stage('tests/rls/seed.sql', `-- password = "${FAKE_PASSWORD}"\n`)
    stage('pnpm-lock.yaml', `token: "${FAKE_PASSWORD}"\n`)
    assert.equal(scan('--staged').status, 0)
  })

  it('only looks at ADDED lines in --range mode', () => {
    stage('src/old.ts', `const password = "${FAKE_PASSWORD}"\n`)
    git('commit', '-q', '-m', 'bad commit')
    // Range containing the bad commit is flagged ...
    assert.equal(scan('--range', 'HEAD~1..HEAD').status, 1)
    assert.equal(scan('--range', 'HEAD~1...HEAD').status, 1)
    // ... an empty range is not, and neither is a later unrelated commit.
    stage('src/new.ts', 'export const a = 1\n')
    git('commit', '-q', '-m', 'good commit')
    assert.equal(scan('--range', 'HEAD~1..HEAD').status, 0)
  })

  it('fails closed (exit 2) when the range cannot be resolved', () => {
    assert.equal(scan('--range', 'no-such-ref..HEAD').status, 2)
  })
})
