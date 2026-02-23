#!/usr/bin/env node
/**
 * Validate Upstash Redis connections for dev and staging.
 * Usage: node scripts/validate-redis.js [dev|staging|all]
 */

const fs = require('fs');
const path = require('path');

const VALID_ENVS = ['dev', 'staging'];

async function validateRedis(env) {
  let url, token;

  if (env === 'dev') {
    const envFile = path.join(__dirname, '../.env.local');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      url = content.match(/^UPSTASH_REDIS_REST_URL=(.+)/m)?.[1]?.trim();
      token = content.match(/^UPSTASH_REDIS_REST_TOKEN=(.+)/m)?.[1]?.trim();
    }
  } else if (env === 'staging') {
    const envFile = path.join(__dirname, '../.env.staging');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      url = content.match(/^UPSTASH_REDIS_REST_URL=(.+)/m)?.[1]?.trim();
      token = content.match(/^UPSTASH_REDIS_REST_TOKEN=(.+)/m)?.[1]?.trim();
    }
  }

  if (!url || !token) {
    console.error(`❌ ${env}: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN`);
    return false;
  }

  try {
    const response = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      const text = await response.text();
      console.log(`✅ ${env}: Connected. Response: ${text}`);
      return true;
    } else {
      console.error(`❌ ${env}: HTTP ${response.status}`);
      return false;
    }
  } catch (err) {
    console.error(`❌ ${env}: ${err.message}`);
    return false;
  }
}

async function main() {
  const target = process.argv[2] || 'all';

  if (target !== 'all' && !VALID_ENVS.includes(target)) {
    console.error(`Invalid environment: ${target}. Use: dev, staging, or all`);
    process.exit(1);
  }

  const envs = target === 'all' ? VALID_ENVS : [target];

  console.log('Validating Upstash Redis connections...\n');

  let allPassed = true;
  for (const env of envs) {
    const ok = await validateRedis(env);
    if (!ok) allPassed = false;
  }

  if (allPassed) {
    console.log('\n✓ Done');
  } else {
    console.error('\n✗ Some validations failed');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
