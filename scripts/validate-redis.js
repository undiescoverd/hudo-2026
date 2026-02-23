#!/usr/bin/env node
/**
 * Validate Upstash Redis connections for dev and staging.
 * Usage: node scripts/validate-redis.js [dev|staging|all]
 */

const fs = require('fs');
const path = require('path');

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
    return;
  }

  try {
    const response = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      const text = await response.text();
      console.log(`✅ ${env}: Connected. Response: ${text}`);
    } else {
      console.error(`❌ ${env}: HTTP ${response.status}`);
    }
  } catch (err) {
    console.error(`❌ ${env}: ${err.message}`);
  }
}

async function main() {
  const target = process.argv[2] || 'all';
  const envs = target === 'all' ? ['dev', 'staging'] : [target];

  console.log('Validating Upstash Redis connections...\n');

  for (const env of envs) {
    await validateRedis(env);
  }

  console.log('\n✓ Done');
}

main().catch(console.error);
